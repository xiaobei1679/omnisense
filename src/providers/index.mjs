// 模型适配层 —— 统一 LLM / VLM / ASR / TTS
// 核心原则：**默认使用框架「控制网关」自带在线大模型（127.0.0.1:<gateway.port>/v1，免 key）**。
//   - 眼(看图) / 脑(思考) / 嘴(说话) 在 QClaw 运行时里自动免 key 真跑。
//   - 音频"听"(ASR)与"出声"(TTS)：框架代理当前无此能力，需外部 key 或本地引擎；
//     未配置时诚实返回说明，不假装已听懂/出声。
// 可选回退：若设置了外部 LLM_* / VLM_* / ASR_* / TTS_* 环境变量，builtin 不可用时使用。
// 全部不可用时：诚实本地降级，绝不假装已接入模型。

import { readFileSync, existsSync } from 'node:fs';
import { builtin } from '../core/llm.mjs';
import { log } from '../core/logger.mjs';

// —— 极简 .env 加载（零依赖，可选）——
export function loadEnv(path = './.env') {
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k, fb = '') => process.env[k] ?? fb;
const SK = 'sk-your-key-here';

export class Models {
  constructor() {
    this.llm = { base: env('LLM_BASE_URL'), key: env('LLM_KEY'), model: env('LLM_MODEL') };
    this.vlm = {
      base: env('VLM_BASE_URL') || this.llm.base,
      key: env('VLM_KEY') || this.llm.key,
      model: env('VLM_MODEL') || this.llm.model,
    };
    this.asr = {
      base: env('ASR_BASE_URL') || this.llm.base,
      key: env('ASR_KEY') || this.llm.key,
      model: env('ASR_MODEL') || 'whisper-1',
    };
    this.tts = {
      base: env('TTS_BASE_URL') || this.llm.base,
      key: env('TTS_KEY') || this.llm.key,
      model: env('TTS_MODEL') || 'tts-1',
    };
  }

  _auth(cfg) { return { Authorization: `Bearer ${cfg.key}` }; }
  _has(cfg) { return !!(cfg.key && cfg.key !== SK); }

  /** 运行模式：'qclaw'(免key网关) | 'agent'(无网关，由运行体/agent 驱动大脑与嘴巴) | null(尚未探测) */
  get runtime() { return builtin.runtime; }

  // —— 文本/多模态对话：优先框架自带在线模型（免 key）——
  async chat(messages, opts = {}) {
    try { return await builtin.chat(messages, opts); }
    catch (e) {
      if (e?.code === 'BUILTIN_UNAVAILABLE') {
        if (this._has(this.llm)) { try { return await this._chatExt(messages, opts); } catch (_) {} }
      } else throw e; // 非连接错误（如模型拒绝）直接抛出
    }
    return this._fallbackChat(messages);
  }

  async _chatExt(messages, { json = false, temperature = 0.7 } = {}) {
    const cfg = this.llm;
    const body = { model: cfg.model, messages, temperature };
    if (json) body.response_format = { type: 'json_object' };
    const r = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._auth(cfg) },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    return (await r.json())?.choices?.[0]?.message?.content ?? '';
  }

  _fallbackChat(messages) {
    const last = messages[messages.length - 1]?.content || '';
    const q = typeof last === 'string' ? last : JSON.stringify(last);
    log.warn('   ⚠ 未接入在线模型（框架代理未运行且无外部 key），使用本地规则降级');
    return `〔未接入在线模型〕已收到: ${String(q).slice(0, 60)}…\n（在 QClaw/OpenClaw 运行时中，将由框架自带在线大模型真实回答——真看真思真说。）`;
  }

  // —— 视觉理解：优先框架自带多模态（免 key）——
  async describe(image, prompt = '请客观描述这张图里能看到的内容（不超过80字）。', opts = {}) {
    try { return await builtin.chat([{ role: 'user', content: prompt }], { ...opts, image }); }
    catch (e) {
      // agent 模式：把 AGENT_DRIVE 向上抛出（携带图像信息），交给 eyes.seeImage 落本地后由运行体(agent)读图
      if (e?.code === 'AGENT_DRIVE') {
        const err = new Error('AGENT_DRIVE');
        err.code = 'AGENT_DRIVE';
        err.image = image;
        throw err;
      }
      // 任何失败（网关不可用 / 图像格式不被接受）都诚实降级，绝不假装已看懂
      if (e?.code === 'BUILTIN_UNAVAILABLE' && this._has(this.vlm)) {
        try { return await this._describeExt(image, prompt); } catch (_) {}
      }
    }
    return '〔视觉模型暂不可用〕已获取图像，但框架代理当前无法生成语义描述（可能不支持图像，或需配置外部 VLM key）。';
  }

  async _describeExt(image, prompt) {
    const cfg = this.vlm;
    // 本地图片路径 → 转 base64 data URL（兼容 OpenAI 视觉接口）
    let imgUrl = image;
    if (typeof image === 'string' && !image.startsWith('http') && existsSync(image)) {
      const b64 = readFileSync(image).toString('base64');
      const ext = (image.split('.').pop() || 'png').toLowerCase();
      imgUrl = `data:image/${ext};base64,${b64}`;
    }
    const messages = [{ role: 'user', content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: imgUrl } },
    ] }];
    const r = await fetch(`${cfg.base}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...this._auth(cfg) },
      body: JSON.stringify({ model: cfg.model, messages, temperature: 0.3 }),
    });
    if (!r.ok) throw new Error(`VLM HTTP ${r.status}`);
    return (await r.json())?.choices?.[0]?.message?.content ?? '';
  }

  // —— 语音转写：框架代理无 ASR，仅支持外部 key / 本地 whisper ——
  async transcribe(audioBuf, filename = 'audio.wav') {
    if (this._has(this.asr)) {
      try {
        const cfg = this.asr;
        const fd = new FormData();
        fd.append('file', new Blob([audioBuf], { type: 'application/octet-stream' }), filename);
        fd.append('model', cfg.model);
        const r = await fetch(`${cfg.base}/audio/transcriptions`, {
          method: 'POST', headers: this._auth(cfg), body: fd,
        });
        if (!r.ok) throw new Error(`ASR HTTP ${r.status}`);
        return (await r.json().catch(() => ({}))).text ?? (await r.text());
      } catch (e) { /* 落到降级 */ }
    }
    return '〔未接入 ASR〕框架代理无语音转写能力；需配置外部 ASR key 或本地 whisper 才能“听懂”语音内容。';
  }

  // —— 语音合成：框架代理无 TTS，仅支持外部 key ——
  async speak(text, { voice = 'alloy' } = {}) {
    if (this._has(this.tts)) {
      const cfg = this.tts;
      const r = await fetch(`${cfg.base}/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...this._auth(cfg) },
        body: JSON.stringify({ model: cfg.model, input: String(text).slice(0, 4000), voice }),
      });
      if (!r.ok) throw new Error(`TTS HTTP ${r.status}`);
      return Buffer.from(await r.arrayBuffer());
    }
    throw new Error('未配置 TTS_KEY，且框架代理无出声能力；嘴巴以文本形式“说”（已输出）。');
  }

  // 模型能力状态（异步，真实探测运行模式）
  async status() {
    const reachable = await builtin.available().catch(() => false);
    const rt = builtin.runtime || (reachable ? 'qclaw' : 'agent');
    const agent = rt === 'agent';
    return {
      backend: agent ? 'agent(运行体驱动·免key)' : (reachable ? 'builtin(框架网关·免key)' : 'none'),
      runtime: rt,
      think: agent ? true : reachable,
      seeVision: false,         // 视觉(看图)网关暂不支持，需外部 VLM key 或本地引擎 / agent 直接读图
      webFetch: true,           // 网站/热搜抓取本机真实执行，无需任何 key
      hear: false,              // 语音转写需外部 key 或本地引擎
      speak: false,             // 出声需外部 key 或本地引擎；文本"说"由 agent 承担
      note: agent
        ? '无 QClaw 网关的环境（如 WorkBuddy/普通 Node）：眼/耳真抓取由脚本本机真实执行，脑(思考)/嘴(说)由运行体(agent)自身驱动——即你我对话，完全免 key。'
        : (reachable
            ? '框架网关在线模型可用：真思(文本推理)/真说(文本交流)。网站与热搜抓取本机真实执行(免key)。看图(视觉)与听/说出声需外部 key 或本地引擎。'
            : '框架网关不可达(未运行QClaw)。文本听(理解意见/小说/文案)/说由本机会话承担；深度推理需启动QClaw。'),
    };
  }

  // 通用摘要：用聊天模型概括文本（agent 模式抛出交由运行体驱动）
  async summarize(text, maxWords = 80) {
    if (!text) return '';
    const prompt = `请用不超过${maxWords}字概括以下内容的核心信息，不要发散：\n${String(text).slice(0, 4000)}`;
    try {
      const s = await this.chat([{ role: 'user', content: prompt }]);
      return s || String(text).slice(0, maxWords);
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') throw e;
      return String(text).slice(0, maxWords * 2);
    }
  }
}

export const models = new Models();
