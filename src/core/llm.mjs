// 本地模型网关代理层 —— 免 key
// 两种运行模式自动识别：
//   1) 网关模式(gateway)：本机运行了兼容 OpenAI 的本地模型网关(默认 127.0.0.1:<port>/v1，
//      端口可由配置文件或 OMNI_GATEWAY_BASE 指定)，POST /v1/chat/completions 即可真思考真说，
//      鉴权用网关令牌(由网关统管，不需要任何供应商 key)。
//   2) 驱动模式(driver)：无网关的环境(如普通 Node / 任意调用方)，眼/耳的真抓取仍本机真实执行；
//      脑(思考)/嘴(说)由调用方(你的代码 / 你的 agent)自身驱动——同样免 key。
// 识别方式：环境变量 OMNI_RUNTIME 可强制 'gateway'|'driver'；否则自动探测网关可达性。
//   网关可达 → gateway 模式；不可达 → driver 模式。

import { existsSync } from 'node:fs';
import { readGatewayConfig, CONFIG_PATH } from './config.mjs';

// 解析网关基础地址（含 /v1）。优先环境变量 OMNI_GATEWAY_BASE，否则读配置 gateway.port。
function resolveBase() {
  if (process.env.OMNI_GATEWAY_BASE) return process.env.OMNI_GATEWAY_BASE.replace(/\/$/, '');
  let port = 55695;
  try {
    const d = readGatewayConfig();
    if (d?.gateway?.port) port = d.gateway.port;
  } catch {}
  return `http://127.0.0.1:${port}/v1`;
}

// 解析网关令牌：环境变量优先，否则读网关配置文件的 gateway.auth.token
function resolveToken() {
  if (process.env.GATEWAY_TOKEN) return process.env.GATEWAY_TOKEN;
  try {
    const d = readGatewayConfig();
    return d?.gateway?.auth?.token || '';
  } catch { return ''; }
}

// 模型：优先 OMNI_MODEL 环境变量；网关可用时取网关返回的首个模型；否则回退 'openclaw'(兼容既有网关)。
let _defaultModel = null;
let _modelList = [];
function resolveModel() {
  if (process.env.OMNI_MODEL) return process.env.OMNI_MODEL;
  try {
    const d = readGatewayConfig();
    if (d?.gateway?.model) return d.gateway.model; // 网关配置文件可显式引脚模型
  } catch {}
  return _defaultModel || 'openclaw';
}

let _baseCache = null;
let _unavailable = false; // 最近一次连接失败/未鉴权则标记，避免每次重试超时
let _runtime = null;      // 运行模式：'gateway' | 'driver'（懒探测后缓存）

export function isConnError(e) {
  const c = e?.cause?.code || e?.code || (typeof e?.message === 'string' ? e.message : '');
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed|aborted|timeout/i.test(c);
}

// 探测网关是否可达且提供至少一个模型（连不上即判定为 driver 模式）。
// 单次抖动可能误判，故失败重试一次（共 2 次），避免整进程被翻成 driver 模式。
async function probeModels() {
  try {
    const r = await fetch(`${resolveBase()}/models`, {
      headers: { 'Content-Type': 'application/json', ...(resolveToken() ? { Authorization: `Bearer ${resolveToken()}` } : {}) },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => ({}));
    const arr = Array.isArray(j?.data) ? j.data : [];
    return arr.map(m => String(m.id)).filter(Boolean);
  } catch { return null; }
}
async function probeGateway() {
  const ms = await probeModels();
  if (ms && ms.length) return ms;
  await new Promise(r => setTimeout(r, 500));
  const ms2 = await probeModels();
  return (ms2 && ms2.length) ? ms2 : null;
}

// 懒识别运行模式（仅首次用到模型时触发一次探测）
async function ensureRuntime() {
  if (_runtime) return _runtime;
  if (process.env.OMNI_RUNTIME === 'gateway' || process.env.OMNI_RUNTIME === 'driver') {
    _runtime = process.env.OMNI_RUNTIME;
    return _runtime;
  }
  const ms = await probeGateway();
  _runtime = ms ? 'gateway' : 'driver';
  if (ms && ms.length) { _modelList = ms; if (!_defaultModel) _defaultModel = ms[0]; }
  return _runtime;
}

// 从 SSE 流中解析并累积文本内容
async function readSSE(resp) {
  const rd = resp.body.getReader();
  let out = '';
  let buf = '';
  while (true) {
    const { done, value } = await rd.read();
    if (done) break;
    buf += Buffer.from(value).toString();
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return out;
      try {
        const j = JSON.parse(data);
        out += j?.choices?.[0]?.delta?.content || '';
      } catch {}
    }
  }
  return out;
}

// 健壮提取 JSON：去 code fence，取首个 { ... } 块
export function extractJson(text) {
  if (!text) return text;
  let s = text.trim();
  if (s.startsWith('```')) {
    s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/```$/, '').trim();
  }
  try { return JSON.parse(s); } catch {}
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try { return JSON.parse(s.slice(a, b + 1)); } catch {}
  }
  return text; // 解析失败则返回原文本，交由上层处理
}

export class BuiltinLLM {
  get base() { return _baseCache || (_baseCache = resolveBase()); }
  get token() { return resolveToken(); }
  get model() { return resolveModel(); }
  get runtime() { return _runtime; } // 可能为 null（尚未探测）

  async _headers() {
    const h = { 'Content-Type': 'application/json' };
    const t = this.token;
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  }

  /** 只读探测：网关是否可达且已鉴权（不污染 _unavailable 缓存） */
  async available() {
    if (_unavailable) return false;
    // 快速路径：未显式给网关地址，且网关配置文件不存在
    // → 直接判定 driver 模式，避免无谓的联网探测等待（standalone 秒级进入）
    if (!process.env.OMNI_GATEWAY_BASE && !existsSync(CONFIG_PATH)) {
      _runtime = 'driver';
      return false;
    }
    const rt = await ensureRuntime();
    if (rt === 'driver') return false;
    return probeGateway();
  }

  /**
   * 调用框架自带在线大模型（免 key）。
   * agent 模式下不连网关，直接抛出 AGENT_DRIVE，交由上层(运行体/agent)驱动大脑与嘴巴。
   */
  // 单次补全（不含多模型回退）；连接错误由 chat() 捕获后换新模型重试。
  async _chatOnce(messages, { json = false, temperature = 0.7, image = null, timeoutMs = 90000, model: mdl }) {
    const last = messages[messages.length - 1];
    const text = (last && typeof last.content === 'string') ? last.content : '请描述这张图。';
    const userMsg = image
      ? { role: 'user', content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: image } },
        ] }
      : last;
    const body = {
      model: mdl,
      messages: image ? [...messages.slice(0, -1), userMsg] : messages,
      temperature,
      stream: true, // 网关必须流式；非流式会挂起超时
    };
    const r = await fetch(`${this.base}/chat/completions`, {
      method: 'POST',
      headers: await this._headers(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      const errBody = await r.text().catch(() => '');
      if (r.status === 401 || r.status === 403 || /auth_error|9002|暂不可|Unauthorized/i.test(errBody)) {
        _unavailable = true;
        const e = new Error(`BUILTIN_UNAVAILABLE(${r.status})`);
        e.code = 'BUILTIN_UNAVAILABLE';
        throw e;
      }
      throw new Error(`builtin chat HTTP ${r.status}: ${errBody}`);
    }
    const raw = await readSSE(r);
    return json ? extractJson(raw) : raw;
  }

  async chat(messages, { json = false, temperature = 0.7, image = null, timeoutMs = 90000, model = null } = {}) {
    const rt = await ensureRuntime();
    if (rt === 'driver') {
      const e = new Error('AGENT_DRIVE');
      e.code = 'AGENT_DRIVE';
      e.messages = messages; e.opts = { json, temperature, image };
      throw e;
    }
    if (_unavailable) {
      const e = new Error('BUILTIN_UNAVAILABLE');
      e.code = 'BUILTIN_UNAVAILABLE';
      throw e;
    }
    const explicit = !!model;
    const requested = model || this.model;
    const seen = new Set();
    // 显式指定模型时只试它（尊重意图）；否则按 [默认模型, 探测到的其他模型] 顺序回退
    const candidates = explicit
      ? [requested]
      : [requested, ..._modelList].filter((m) => m && !seen.has(m) && seen.add(m));
    let lastErr;
    for (const mdl of candidates) {
      try {
        return await this._chatOnce(messages, { json, temperature, image, timeoutMs, model: mdl });
      } catch (e) {
        lastErr = e;
        if (isConnError(e)) continue; // 主模型连不上 → 试探测到的下一个可用模型
        throw e; // 非连接错误（鉴权/格式）→ 不重试，直接抛
      }
    }
    _unavailable = true;
    if (lastErr && !lastErr.code) lastErr.code = 'BUILTIN_UNAVAILABLE';
    throw lastErr;
  }
}

export const builtin = new BuiltinLLM();

// 同步读取当前可用性（基于最近一次探测缓存）
export function isBuiltinAvailable() { return !_unavailable; }
// 重置缓存（如用户中途启动了本地模型网关）
export function resetBuiltin() { _baseCache = null; _unavailable = false; _runtime = null; _defaultModel = null; _modelList = []; }
