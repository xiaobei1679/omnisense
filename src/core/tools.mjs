// 工具执行器（Tools）—— 让 OmniSense 真正"动手"，而不只是感知与汇报。
// 设计原则：
//   1) 零依赖：仅用 Node 内置模块 + 已有的 core/http.mjs。
//   2) 诚实安全：calc 用白名单递归下降求值，杜绝任意代码执行；shell 默认禁用，需显式开启。
//   3) 可测：buildDefaultTools(omni) 依赖 omni 注入，测试可传入 fake omni 或真实 omni。
//   4) 统一契约：每个工具 { name, description, parameters, run(args, ctx) -> any }。
//      executeTool 统一捕获异常，返回 { ok, output | error }，绝不因单工具失败打断整条流水线。

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, statSync } from 'node:fs';
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

// ───────────────────────── 工具级缓存/熔断 持久化（落盘） ─────────────────────────
// 问题：前面这套 breaker 基础设施（TTL 缓存 + 熔断）完全在内存，进程一重启就清零——
// 于是「避免重复联网」的目标在重启后会失效，刚重启的热搜/抓取又得重新联网、刚熔断的源也重新探活。
// 解法：把缓存条目 + 熔断状态写进一个零依赖的 JSON 文件（默认不落盘，opt-in 开启），
// 进程启动时 --persist-file=<path> 或设 OMNI_TOOL_CACHE_FILE 即自动从磁盘载入，实现「跨重启续命」。
// 设计取舍：
//   · 仅落盘「声明了 cacheTtl / circuit 的工具」在用的缓存与熔断（其余工具本就不声明、无需持久）；
//   · 熔断的 openUntil 一并保存 → 重启后若仍在冷却期，继续短路而非立刻重试（符合熔断语义）；
//   · 写入是 best-effort：文件不可写/序列化失败一律静默降级，绝不拖垮工具执行；
//   · 与监控器官的「阈值/权重 JSON 文件」同属 Observability-as-Code 思路（配置可版本化、可溯源），
//     但此处落的是「运行时状态」而非「配置」，解决的是「重启后状态不丢」而非「配置可变」。
// 借鉴（思想/模式，非代码）：SQLiteCache / disk-backed TTL cache（缓存放磁盘、重启不丢，
//   常见于抓取/爬虫/LLM 调用缓存，如 langchain 的 SQLiteCache、redis 持久化语义）。
let PERSIST_FILE = null;     // 当前启用的持久化文件路径（null = 未启用）
let PERSIST_LOADED = false;  // 是否曾从磁盘成功载入过
function _injectCache(name, ttl, entries) {
  const c = new TtlCache(ttl || 60000);
  for (const [k, e] of entries || []) {
    if (e && typeof e.t === 'number' && 'v' in e) c.m.set(k, e);
  }
  toolCaches.set(name, c);
}
function _injectBreaker(name, b) {
  const br = new CircuitBreaker(Number(b.maxFails) || 3, Number(b.cooldown) || 5 * 60 * 1000);
  br.fails = Number(b.fails) || 0;
  br.openUntil = Number(b.openUntil) || 0;
  toolBreakers.set(name, br);
}
function _loadPersistence(file) {
  let raw;
  try { raw = readFileSync(file, 'utf8'); } catch { return { loaded: false, reason: 'missing' }; }
  let data;
  try { data = JSON.parse(raw); } catch { return { loaded: false, reason: 'corrupt' }; }
  if (data && data.caches) {
    for (const [name, obj] of Object.entries(data.caches)) {
      if (obj && Array.isArray(obj.entries)) _injectCache(name, obj.ttl, obj.entries);
    }
  }
  if (data && data.breakers) {
    for (const [name, b] of Object.entries(data.breakers)) {
      if (b && typeof b === 'object') _injectBreaker(name, b);
    }
  }
  return { loaded: true };
}
function _persistNow() {
  if (!PERSIST_FILE) return false;
  const data = { version: 1, savedAt: Date.now(), caches: {}, breakers: {} };
  for (const [name, c] of toolCaches) {
    const entries = [];
    for (const [k, e] of c.m) entries.push([k, e]);
    if (entries.length) data.caches[name] = { ttl: c.ttl, entries };
  }
  for (const [name, b] of toolBreakers) {
    if (b.fails > 0 || b.openUntil > Date.now()) {
      data.breakers[name] = { fails: b.fails, openUntil: b.openUntil, maxFails: b.maxFails, cooldown: b.cooldown };
    }
  }
  try {
    mkdirSync(dirname(PERSIST_FILE), { recursive: true });
    writeFileSync(PERSIST_FILE, JSON.stringify(data));
    return true;
  } catch { return false; }
}

// 启用/关闭持久化：file 为真 → 启用以 file 为落盘路径并尝试从磁盘载入；file 为假(null/undefined/false) → 关闭。
export function setToolCachePersistence(file, { load = true } = {}) {
  if (!file) {
    const prev = PERSIST_FILE;
    PERSIST_FILE = null; PERSIST_LOADED = false;
    return { ok: true, enabled: false, prevFile: prev };
  }
  const path = String(file);
  PERSIST_FILE = path;
  let loaded = { loaded: false, reason: 'skipped' };
  if (load) loaded = _loadPersistence(path);
  PERSIST_LOADED = loaded.loaded;
  return { ok: true, enabled: true, file: path, loaded: PERSIST_LOADED, reason: loaded.reason || null };
}
// 当前持久化状态（CLI `cache` 与工作区 `omnisense-link cache` 复用）。
export function toolCachePersistence() {
  return {
    enabled: !!PERSIST_FILE,
    file: PERSIST_FILE,
    loaded: PERSIST_LOADED,
    cacheEntries: [...toolCaches.values()].reduce((s, c) => s + c.m.size, 0),
    breakerCount: toolBreakers.size,
  };
}
// 立即落盘一次（best-effort）。
export function persistToolCache() {
  const ok = _persistNow();
  return { ok, file: PERSIST_FILE, enabled: !!PERSIST_FILE };
}
// 清空持久化：内存与磁盘双双清空（disk 用写空对象而非 rm，规避 safe-delete shim）。
export function clearToolCachePersistence() {
  for (const c of toolCaches.values()) c.clear();
  toolBreakers.clear();
  let deleted = false;
  if (PERSIST_FILE) {
    try { writeFileSync(PERSIST_FILE, JSON.stringify({ version: 1, caches: {}, breakers: {} })); deleted = true; } catch {}
  }
  PERSIST_LOADED = false;
  return { ok: true, deleted, file: PERSIST_FILE };
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

// 零配置持久化：设了 OMNI_TOOL_CACHE_FILE 即自动启用并载入（best-effort 失败静默降级）。
// 不设置则完全不动（与历史行为一致，零风险）。CLI `--persist-file=<path>` / 工作区 `--persist-file=<path>` 亦可随时开启。
if (process.env.OMNI_TOOL_CACHE_FILE) {
  try { setToolCachePersistence(process.env.OMNI_TOOL_CACHE_FILE, { load: true }); }
  catch { /* 落盘不可用时静默不启用，绝不拖垮启动 */ }
}

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
    if (cacheable && key != null) { getToolCache(name, t.cacheTtl).set(key, output); if (PERSIST_FILE) _persistNow(); }
    if (useCircuit) { getToolBreaker(name).success(); if (PERSIST_FILE) _persistNow(); }
    return { ok: true, output };
  } catch (e) {
    if (useCircuit) { getToolBreaker(name).fail(); if (PERSIST_FILE) _persistNow(); }
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
  if (PERSIST_FILE) _persistNow();
  return { ok: true, cleared: toolCaches.size, persisted: !!PERSIST_FILE };
}
export function toolBreakerStatus() {
  // 只报告被触发的熔断器（有失败记录），无则空数组
  const out = [];
  for (const [name, b] of toolBreakers) out.push({ name, open: b.open, fails: b.fails, maxFails: b.maxFails });
  return out;
}
export function resetToolBreakers() {
  toolBreakers.clear();
  if (PERSIST_FILE) _persistNow();
  return { ok: true, reset: true, persisted: !!PERSIST_FILE };
}

// 给 LLM 用的工具清单（JSON Schema 子集）
export function toolSpecs(tools) {
  return tools.map(t => ({ name: t.name, description: t.description, parameters: t.parameters }));
}
