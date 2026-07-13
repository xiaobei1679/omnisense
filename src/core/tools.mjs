// 工具执行器（Tools）—— 让 OmniSense 真正"动手"，而不只是感知与汇报。
// 设计原则：
//   1) 零依赖：仅用 Node 内置模块 + 已有的 core/http.mjs。
//   2) 诚实安全：calc 用白名单递归下降求值，杜绝任意代码执行；shell 默认禁用，需显式开启。
//   3) 可测：buildDefaultTools(omni) 依赖 omni 注入，测试可传入 fake omni 或真实 omni。
//   4) 统一契约：每个工具 { name, description, parameters, run(args, ctx) -> any }。
//      executeTool 统一捕获异常，返回 { ok, output | error }，绝不因单工具失败打断整条流水线。

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { httpGet } from './http.mjs';
import { log } from './logger.mjs';
import { TtlCache, CircuitBreaker } from './breaker.mjs';

// ───────────────────────── 工具级缓存 / 熔断 ─────────────────────────
// 复用 breaker.mjs 的 TtlCache / CircuitBreaker（此前只用于热搜抓取），
// 把同一套"健壮性基础设施"扩展到 Agent 工具调用——联网类工具（web_fetch / summarize_url / hot_topics）
// 命中缓存直接返回、避免重复联网；某工具持续失败则熔断，避免反复超时拖垮整条 agent 流水线。
// 声明式启用：工具定义加 `cacheTtl`(ms) 或 `circuit:true` 即生效，未声明的默认工具行为完全不变。
// 设计借鉴（思想/模式，非代码）：
//   · LangChain 的 LLM/工具调用缓存（InMemoryCache：相同请求直接命中、不再重复触网，https://mintlify.wiki/langchain-ai/langchain/advanced/performance）
//   · AutoGen / 生产实践里"把工具包进 per-tool circuit breaker"（tenacity / Resilience4j 思想；altersquare.io 的 Tool-Calling Reliability 亦建议 wrap tools in per-tool circuit breakers）
const toolCaches = new Map();   // name -> TtlCache(cacheTtl)
const toolBreakers = new Map(); // name -> CircuitBreaker
function getToolCache(name, ttl) {
  let c = toolCaches.get(name);
  if (!c) { c = new TtlCache(ttl || 60000); toolCaches.set(name, c); }
  return c;
}
function getToolBreaker(name, maxFails = 3, cooldownMs = 5 * 60 * 1000) {
  let b = toolBreakers.get(name);
  if (!b) { b = new CircuitBreaker(maxFails, cooldownMs); toolBreakers.set(name, b); }
  return b;
}
function toolCacheKey(name, args) {
  // 稳定键：联网工具参数通常很小（url）；大参数工具不会声明 cacheTtl，故不做修剪也安全。
  // 仅做最大长度保护，避免极端长参数占内存。
  const s = JSON.stringify(args ?? {});
  return name + '::' + (s.length > 512 ? s.slice(0, 512) : s);
}

// ───────────────────────── 安全算术求值（递归下降） ─────────────────────────
// 仅允许：数字、运算符 + - * / % ^、括号、逗号、空白、白名单内的 Math 函数/常量。
// 不依赖 eval/Function，从根本上杜绝任意代码执行。
const CALC_FUNCS = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  sqrt: Math.sqrt, log: Math.log, ln: Math.log, exp: Math.exp,
  abs: Math.abs, floor: Math.floor, ceil: Math.ceil, round: Math.round,
  pow: Math.pow, min: Math.min, max: Math.max,
  pi: Math.PI, e: Math.E,
};

export function safeCalc(input) {
  const s = String(input || '').trim().toLowerCase();
  if (!s) throw new Error('空表达式');
  if (!/^[0-9+\-*/%^().\s,a-z]+$/.test(s)) throw new Error('表达式含非法字符');

  // 词法分析
  const tokens = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ') { i++; continue; }
    if (c === ',') { tokens.push({ t: 'op', v: ',' }); i++; continue; }
    if (/[0-9.]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[0-9.]/.test(s[j])) j++;
      tokens.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
      i = j; continue;
    }
    if (/[a-z]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[a-z]/.test(s[j])) j++;
      const w = s.slice(i, j);
      if (!(w in CALC_FUNCS)) throw new Error('不支持的函数/常量: ' + w);
      tokens.push({ t: 'id', v: w });
      i = j; continue;
    }
    if ('+-*/%^()'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    throw new Error('非法字符: ' + c);
  }

  let p = 0;
  const peek = () => tokens[p];
  const eat = (v) => { if (tokens[p] && tokens[p].v === v) { p++; return true; } throw new Error('语法错误，期望 ' + v); };

  function parseExpr() {
    let v = parseTerm();
    while (peek() && (peek().v === '+' || peek().v === '-')) {
      const op = peek().v; p++;
      const r = parseTerm();
      v = op === '+' ? v + r : v - r;
    }
    return v;
  }
  function parseTerm() {
    let v = parsePow();
    while (peek() && (peek().v === '*' || peek().v === '/' || peek().v === '%')) {
      const op = peek().v; p++;
      const r = parsePow();
      v = op === '*' ? v * r : op === '/' ? v / r : v % r;
    }
    return v;
  }
  function parsePow() {
    const base = parseUnary();
    if (peek() && peek().v === '^') { p++; return Math.pow(base, parsePow()); }
    return base;
  }
  function parseUnary() {
    if (peek() && peek().v === '-') { p++; return -parseUnary(); }
    if (peek() && peek().v === '+') { p++; return parseUnary(); }
    return parsePrimary();
  }
  function parsePrimary() {
    const tk = peek();
    if (!tk) throw new Error('表达式意外结束');
    if (tk.t === 'num') { p++; return tk.v; }
    if (tk.t === 'id') {
      p++;
      if (peek() && peek().v === '(') {
        p++; const args = [];
        if (peek() && peek().v !== ')') { args.push(parseExpr()); while (peek() && peek().v === ',') { p++; args.push(parseExpr()); } }
        eat(')');
        const fn = CALC_FUNCS[tk.v];
        return typeof fn === 'function' ? fn(...args) : fn;
      }
      return CALC_FUNCS[tk.v];
    }
    if (tk.v === '(') { p++; const v = parseExpr(); eat(')'); return v; }
    throw new Error('无法解析: ' + (tk.v || '?'));
  }

  const val = parseExpr();
  if (p !== tokens.length) throw new Error('表达式存在多余内容');
  if (!isFinite(val)) throw new Error('结果非有限数: ' + val);
  return val;
}

// ───────────────────────── 工具定义 ─────────────────────────

// 纯文本抽取（与 eyes 对齐，但工具层自包含，不依赖 eyes）
function stripText(html, maxLen = 1500) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: title.trim(), text: text.slice(0, maxLen) };
}

// ───────────────────────── 工具自发现（插件） ─────────────────────────
// 借鉴 Nanobot / OpenSquilla 的「技能/工具自动加载」模式：往目录丢一个 .mjs
// 模块（默认导出 { name, description, parameters, run }）即被自动注册为 hand 工具，
// 无需改动核心。内置插件目录 src/tools/；额外可用 env OMNI_PLUGINS_DIR 指定用户目录。
// 加载失败或契约不合法的工具会被跳过并记录警告，绝不拖垮启动。
async function loadPluginsFrom(dir) {
  const out = [];
  let entries = [];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const f of entries) {
    if (!f.endsWith('.mjs')) continue;
    try {
      const mod = await import(pathToFileURL(join(dir, f)).href);
      const tool = mod.default || mod.tool;
      if (tool && typeof tool.name === 'string' && typeof tool.run === 'function') {
        out.push(tool);
      } else {
        log.warn(`[plugins] 跳过 ${f}：未导出合法工具（default/tool 需含 name+run）`);
      }
    } catch (e) {
      log.warn(`[plugins] 加载 ${f} 失败，已跳过：${e.message}`);
    }
  }
  return out;
}

const BUILTIN_PLUGIN_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');
const DISCOVERED_TOOLS = await (async () => {
  const builtin = await loadPluginsFrom(BUILTIN_PLUGIN_DIR);
  const extra = process.env.OMNI_PLUGINS_DIR ? await loadPluginsFrom(process.env.OMNI_PLUGINS_DIR) : [];
  return [...builtin, ...extra];
})();

// 构建默认工具集。omni 用于注入 memory / seeHotAll / summarizeWebsite。
export function buildDefaultTools(omni, { allowShell = false } = {}) {
  const memory = omni?.memory;
  const tools = [
    {
      name: 'web_fetch',
      description: '抓取一个网址的网页，返回标题与正文片段（纯文本，最多1500字）。用于获取网页信息。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '目标网址，需以 http(s):// 开头' } }, required: ['url'] },
      // 工具级缓存/熔断：同一 url 在 TTL 内直接命中、不重复联网；持续失败则熔断避免反复超时。
      cacheTtl: 60000, circuit: true,
      run: async ({ url }) => {
        if (!/^https?:\/\//.test(url || '')) throw new Error('url 必须以 http(s):// 开头');
        const html = await httpGet(url, { timeout: 15000 });
        return stripText(html);
      },
    },
    {
      name: 'read_file',
      description: '读取本地文本文件内容（最多8000字）。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '文件绝对或相对路径' } }, required: ['path'] },
      run: async ({ path }) => {
        if (!existsSync(path)) throw new Error('文件不存在: ' + path);
        return { path, content: readFileSync(path, 'utf8').slice(0, 8000) };
      },
    },
    {
      name: 'write_file',
      description: '把文本内容写入本地文件（若用 {prev} 作为 content，则自动填入上一步工具的输出）。',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async ({ path, content }) => {
        writeFileSync(path, String(content ?? ''));
        return { ok: true, path, bytes: String(content ?? '').length };
      },
    },
    {
      name: 'list_dir',
      description: '列出目录下的条目（名称 + 是否目录）。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '目录路径，默认当前目录' } }, required: [] },
      run: async ({ path = '.' } = {}) => ({
        path,
        entries: readdirSync(path).map(n => ({ name: n, isDir: statSync(join(path, n)).isDirectory() })),
      }),
    },
    {
      name: 'memory_search',
      description: '在记忆中检索（匹配键值或笔记文本，大小写不敏感）。',
      parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number', description: '返回条数上限，默认10' } }, required: ['query'] },
      run: async ({ query, limit = 10 }) => {
        if (!memory) return { hits: [], note: '记忆中枢不可用' };
        return { hits: memory.search(query, limit) };
      },
    },
    {
      name: 'memory_remember',
      description: '把一条键值对写入长期记忆（落盘，会话间持久）。',
      parameters: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } }, required: ['key', 'value'] },
      run: async ({ key, value }) => {
        if (!memory) throw new Error('记忆中枢不可用');
        memory.remember(key, value);
        return { ok: true, key };
      },
    },
    {
      name: 'calc',
      description: '安全算术/数学计算：支持 + - * / % ^、括号、常量 pi/e、函数 sin/cos/tan/sqrt/log/exp/abs/floor/ceil/round/pow/min/max。',
      parameters: { type: 'object', properties: { expression: { type: 'string', description: '数学表达式，例如 "2+2" 或 "sqrt(16)+pi" ' } }, required: ['expression'] },
      run: async ({ expression }) => ({ expression, result: safeCalc(expression) }),
    },
    {
      name: 'now',
      description: '返回当前日期时间（ISO 字符串 + 时间戳）。',
      parameters: { type: 'object', properties: {}, required: [] },
      run: async () => ({ iso: new Date().toISOString(), ts: Date.now() }),
    },
    {
      name: 'hot_topics',
      description: '聚合多平台实时热搜（联网，免 key）。',
      parameters: { type: 'object', properties: {}, required: [] },
      cacheTtl: 60000, circuit: true,
      run: async () => {
        if (!omni?.seeHotAll) return { topics: [], error: 'omni.seeHotAll 不可用' };
        const r = await omni.seeHotAll().catch(e => ({ error: e.message }));
        return { topics: r.topics || [], error: r.error, freq: r.freq };
      },
    },
    {
      name: 'summarize_url',
      description: '抓取并摘要一个网页（需在线模型做概括；agent 模式会返回正文供运行体驱动）。',
      parameters: { type: 'object', properties: { url: { type: 'string' }, maxWords: { type: 'number', description: '摘要字数上限' } }, required: ['url'] },
      cacheTtl: 300000, circuit: true,
      run: async ({ url, maxWords = 80 }) => {
        if (!omni?.summarizeWebsite) return { error: 'omni.summarizeWebsite 不可用' };
        return omni.summarizeWebsite(url, maxWords).catch(e => ({ error: e.message }));
      },
    },
  ];

  // shell 默认禁用：任意命令执行风险高，必须显式开启（--allow-shell 或 OMNI_ALLOW_SHELL=1）
  if (allowShell) {
    tools.push({
      name: 'shell',
      description: '执行本机 shell 命令（已显式授权开启）。返回标准输出前3000字符。谨慎使用。',
      parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] },
      run: async ({ command }) => {
        const { execFile } = await import('node:child_process');
        const out = await new Promise((res, rej) => {
          execFile('bash', ['-c', String(command)], { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
            (e, so) => e ? rej(new Error((so || '') + (e.message || ''))) : res(so || ''));
        });
        return { output: out.slice(0, 3000) };
      },
    });
  }

  // 合并自发现插件：不与内置重名；重名时内置优先并记录警告
  const builtinNames = new Set(tools.map(t => t.name));
  for (const d of DISCOVERED_TOOLS) {
    if (builtinNames.has(d.name)) {
      log.warn(`[plugins] 插件工具「${d.name}」与内置重名，已忽略插件版本`);
      continue;
    }
    tools.push(d);
  }

  return tools;
}

// 统一执行：捕获异常，返回 { ok, output | error }
export async function executeTool(tools, name, args, { allowShell = false } = {}) {
  const t = tools.find(x => x.name === name);
  if (!t) return { ok: false, error: `未知工具: ${name}` };
  if (name === 'shell' && !allowShell) return { ok: false, error: 'shell 工具未启用（需 allowShell=true 或环境变量 OMNI_ALLOW_SHELL=1）' };

  // 声明式健壮性：仅对显式声明 cacheTtl / circuit 的工具生效，默认工具行为完全不变。
  const cacheable = Number(t.cacheTtl) > 0;
  const useCircuit = t.circuit === true;
  const key = cacheable ? toolCacheKey(name, args) : null;

  // 1) 命中缓存直接返回（避免重复联网）
  if (cacheable && key != null) {
    const hit = getToolCache(name, t.cacheTtl).get(key);
    if (hit !== undefined) return { ok: true, output: hit, cached: true };
  }
  // 2) 熔断开启：直接短路，绝不反复超时拖垮整条流水线
  if (useCircuit && getToolBreaker(name).open) {
    return { ok: false, error: `circuit-open: ${name}`, circuitOpen: true };
  }
  try {
    const output = await t.run(args || {}, { allowShell });
    if (cacheable && key != null) getToolCache(name, t.cacheTtl).set(key, output);
    if (useCircuit) getToolBreaker(name).success();
    return { ok: true, output };
  } catch (e) {
    if (useCircuit) getToolBreaker(name).fail();
    return { ok: false, error: e?.message || String(e) };
  }
}

// 工具级缓存/熔断状态查询（CLI `cache` 与 工作区 `omnisense-link cache` 复用；也便于排查 agent 流水线）。
export function toolCacheStats() {
  let size = 0; const keys = [];
  for (const [name, c] of toolCaches) {
    const m = c.m; size += m.size;
    for (const k of m.keys()) keys.push(`${name}:${k}`);
  }
  return { size, keys };
}
export function clearToolCache() {
  for (const c of toolCaches.values()) c.clear();
  return { ok: true, cleared: toolCaches.size };
}
export function toolBreakerStatus() {
  // 只报告被触发的熔断器（有失败记录），无则空数组
  const out = [];
  for (const [name, b] of toolBreakers) out.push({ name, open: b.open, fails: b.fails, maxFails: b.maxFails });
  return out;
}
export function resetToolBreakers() {
  toolBreakers.clear();
  return { ok: true, reset: true };
}

// 给 LLM 用的工具清单（JSON Schema 子集）
export function toolSpecs(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
