// 本地 HTTP 驱动服务：让外部门户（另一个进程 / 任意脚本 / 你的 agent）以 JSON API 驱动 OmniSense 能力。
// 诚实边界（务必知悉）：仅监听 127.0.0.1，无 TLS——仅用于本机跨进程编排，切勿用 -h 0.0.0.0 或端口转发暴露到公网。
// 鉴权：若设置了 token（OMNI_TOKEN 或 startServer 传入），所有路由要求 `Authorization: Bearer <token>`（或 ?token=），
// 否则返回 401。未设置 token 时保持无鉴权（仅本机），但会在日志中警示。
import { createServer } from 'node:http';
import { log } from './core/logger.mjs';

// 路由表：方法 + 路径 -> (omni, body) => result
const ROUTES = {
  'GET /health': async (omni) => ({ ok: true, runtime: (await omni.status()).runtime }),
  'POST /see': async (omni, b) => omni.seeWebsite(b.url),
  'POST /hot': async (omni, b) => omni.seeHotTopics(b.source || 'bilibili', { force: !!b.force }),
  'POST /all': async (omni, b) => omni.seeHotAll(b.force ? { force: true } : {}),
  'POST /summarize': async (omni, b) => omni.summarizeWebsite(b.url, b.maxWords),
  'POST /think': async (omni, b) => omni.think(b.goal, b.context || ''),
  'POST /plan': async (omni, b) => omni.plan(b.goal || ''),
  'POST /tick': async (omni, b) => omni.watchTick({
    enableThink: !!b.enableThink,
    agent: !!b.agent,
    agentGoal: b.agentGoal,
    agentUseLLM: !!b.agentUseLLM,
    agentCooldownMs: b.agentCooldownMs || 60000,
    prevSig: b.prevSig,
    prevAgentAt: b.prevAgentAt || 0,
  }),
  'POST /agent': async (omni, b) => omni.act(b.goal, { maxSteps: b.maxSteps || 8, allowShell: !!b.allowShell, useLLM: b.useLLM !== false }),
  'POST /speak': async (omni, b) => omni.speak(b.text, { tts: !!b.tts }),
  'POST /remember': async (omni, b) => ({ ok: true, value: omni.remember(b.key, b.value) }),
  'POST /recall': async (omni, b) => ({ key: b.key, value: omni.recall(b.key) }),
  'POST /search': async (omni, b) => omni.search(b.q || b.query || ''),
  'POST /sense': async (omni) => omni.sense(),
  'POST /status': async (omni) => omni.status(),
  'GET /traces': async (omni, b, url) => omni.traces({
    limit: url?.searchParams?.get('limit') ? Number(url.searchParams.get('limit')) : 10,
    engine: url?.searchParams?.get('engine') || undefined,
  }),
  'GET /trace-summary': async (omni) => omni.traceSummary(),
  'GET /trace-find': async (omni, b, url) => omni.findTracesByGoal(url?.searchParams?.get('goal') || '', {
    limit: url?.searchParams?.get('limit') ? Number(url.searchParams.get('limit')) : 10,
  }),
  'GET /trace-diff': async (omni, b, url) => {
    const a = url?.searchParams?.get('a');
    const c = url?.searchParams?.get('b');
    if (!a || !c) return { error: '需要 ?a=<runId>&b=<runId>' };
    return omni.compareTraces(a, c);
  },
  'GET /trace-regression': async (omni) => omni.traceRegression(),
  'POST /trace-baseline': async (omni, b) => {
    if (!b.runId) return { error: '需要 { runId }' };
    return omni.setTraceBaseline(b.runId);
  },
  'GET /trace-export': async (omni, b, url) => {
    const format = url?.searchParams?.get('format') || 'json';
    return omni.exportTraceDataset({ format, path: undefined, limit: url?.searchParams?.get('limit') ? Number(url.searchParams.get('limit')) : 10 });
  },
  'GET /monitor': async (omni) => omni.monitor.snapshot(),
  'GET /dashboard': async (omni) => omni.monitor.renderDashboard(),
};

function send(res, code, obj) {
  const body = JSON.stringify(obj, null, 2);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

// 鉴权：未设 token 放行；设了 token 则校验 Bearer 头或 ?token= 查询
function authorized(req, url, token) {
  if (!token) return true;
  const auth = req.headers['authorization'] || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (m && m[1] === token) return true;
  if (url.searchParams.get('token') === token) return true;
  return false;
}

export function startServer(omni, { port = 8787, host = '127.0.0.1', token = process.env.OMNI_TOKEN || '' } = {}) {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${host}:${port}`);
    const key = `${req.method} ${url.pathname}`;
    // 鉴权检查（覆盖所有路由，含 /health）
    if (!authorized(req, url, token)) {
      return send(res, 401, {
        error: '缺少或无效的 Authorization 令牌',
        hint: 'Header: Authorization: Bearer <OMNI_TOKEN> 或 ?token=<OMNI_TOKEN>',
      });
    }
    const route = ROUTES[key];
    if (!route) return send(res, 404, { error: `未知路径 ${req.method} ${url.pathname}` });
    // /dashboard 返回零依赖 HTML 仪表盘（可视化），单独按 text/html 输出
    if (key === 'GET /dashboard') {
      try {
        const html = await route(omni, {}, url);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      } catch (e) {
        log.error('[serve]', e?.message || e);
        return send(res, 500, { ok: false, error: e?.message || String(e) });
      }
    }
    try {
      let body = {};
      if (req.method === 'POST') {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        if (raw) body = JSON.parse(raw);
      }
      const result = await route(omni, body || {}, url);
      send(res, 200, { ok: true, result });
    } catch (e) {
      log.error('[serve]', e?.message || e);
      send(res, 500, { ok: false, error: e?.message || String(e) });
    }
  });
  server.listen(port, host, () => {
    if (token) {
      log.info(`[serve] OmniSense 驱动服务已启动: http://${host}:${port}  (Bearer 鉴权已启用)`);
    } else {
      log.warn(`[serve] OmniSense 驱动服务已启动: http://${host}:${port}  (仅本机 127.0.0.1，无鉴权——切勿用 -h 0.0.0.0 或端口转发暴露公网)`);
    }
  });
  return server;
}
