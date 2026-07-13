// 框架自带在线大模型网关代理层 —— 免 key
// 两种运行模式自动识别：
//   1) QClaw / OpenClaw 运行时：本地暴露「控制网关」(openclaw.json 的 gateway.port，默认 55695)，
//      OpenAI 兼容端点 POST http://127.0.0.1:<port>/v1/chat/completions，模型固定 "openclaw"，必须 stream。
//      鉴权用网关令牌(框架统一管，不需要任何供应商 key)。脚本直接免 key 真思考/真说。
//   2) agent 模式(WorkBuddy 等无该网关的环境)：眼/耳的真抓取仍由本脚本本机真实执行；
//      脑(思考)/嘴(说)由调用本脚本的运行体(agent)自身驱动——即"你(agent)就是大脑/嘴巴"，同样免 key。
// 识别方式：环境变量 OMNI_RUNTIME 可强制 'qclaw'|'agent'；否则自动探测网关可达性。
//   网关可达 → qclaw 模式；不可达 → agent 模式。

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

// 解析网关令牌：环境变量优先，否则读 openclaw.json 的 gateway.auth.token
function resolveToken() {
  if (process.env.GATEWAY_TOKEN) return process.env.GATEWAY_TOKEN;
  try {
    const d = readGatewayConfig();
    return d?.gateway?.auth?.token || '';
  } catch { return ''; }
}

// 模型：网关只接受 openclaw / openclaw/<agentId>
function resolveModel() {
  if (process.env.OMNI_MODEL) return process.env.OMNI_MODEL;
  return 'openclaw';
}

let _baseCache = null;
let _unavailable = false; // 最近一次连接失败/未鉴权则标记，避免每次重试超时
let _runtime = null;      // 运行模式：'qclaw' | 'agent'（懒探测后缓存）

export function isConnError(e) {
  const c = e?.cause?.code || e?.code || (typeof e?.message === 'string' ? e.message : '');
  return /ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|ETIMEDOUT|fetch failed|aborted|timeout/i.test(c);
}

// 探测网关是否可达且提供 openclaw 模型（连不上即判定为 agent 模式）。
// 单次抖动可能误判，故失败重试一次（共 2 次），避免整进程被翻成 agent 模式。
async function probeOnce() {
  try {
    const r = await fetch(`${resolveBase()}/models`, {
      headers: { 'Content-Type': 'application/json', ...(resolveToken() ? { Authorization: `Bearer ${resolveToken()}` } : {}) },
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return false;
    const j = await r.json().catch(() => ({}));
    return (j?.data || []).some(m => String(m.id).startsWith('openclaw'));
  } catch { return false; }
}
async function probeGateway() {
  if (await probeOnce()) return true;
  await new Promise(r => setTimeout(r, 500));
  return probeOnce();
}

// 懒识别运行模式（仅首次用到模型时触发一次探测）
async function ensureRuntime() {
  if (_runtime) return _runtime;
  if (process.env.OMNI_RUNTIME === 'qclaw' || process.env.OMNI_RUNTIME === 'agent') {
    _runtime = process.env.OMNI_RUNTIME;
    return _runtime;
  }
  _runtime = (await probeGateway()) ? 'qclaw' : 'agent';
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
    // 快速路径：未显式给网关地址，且框架配置(openclaw.json)不存在
    // → 直接判定 agent 模式，避免无谓的联网探测等待（standalone 秒级进入）
    if (!process.env.OMNI_GATEWAY_BASE && !existsSync(CONFIG_PATH)) {
      _runtime = 'agent';
      return false;
    }
    const rt = await ensureRuntime();
    if (rt === 'agent') return false;
    return probeGateway();
  }

  /**
   * 调用框架自带在线大模型（免 key）。
   * agent 模式下不连网关，直接抛出 AGENT_DRIVE，交由上层(运行体/agent)驱动大脑与嘴巴。
   */
  async chat(messages, { json = false, temperature = 0.7, image = null, timeoutMs = 90000, model = null } = {}) {
    const rt = await ensureRuntime();
    if (rt === 'agent') {
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
    const mdl = model || this.model;
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

    let r;
    try {
      r = await fetch(`${this.base}/chat/completions`, {
        method: 'POST',
        headers: await this._headers(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      if (isConnError(e)) { _unavailable = true; e.code = 'BUILTIN_UNAVAILABLE'; }
      throw e;
    }
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
}

export const builtin = new BuiltinLLM();

// 同步读取当前可用性（基于最近一次探测缓存）
export function isBuiltinAvailable() { return !_unavailable; }
// 重置缓存（如用户中途启动了 QClaw）
export function resetBuiltin() { _baseCache = null; _unavailable = false; _runtime = null; }
