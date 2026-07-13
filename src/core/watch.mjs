// 常驻感知循环（Watch Loop）：让 OmniSense 成为持续感知系统。
// - runWatchTick：单次快照（热搜聚合 + 感知合成 + 离线规划 + 可选在线思考）
// - runWatch：按间隔循环执行，写 JSON 快照历史，支持 SIGINT/SIGTERM 优雅停止
// 设计要点：纯逻辑可测——omni 作为参数传入（依赖 seeHotAll/sense/plan/think/remember），
// 测试用 fake omni 即可离线覆盖。
import { writeFileSync } from 'node:fs';
import { log } from './logger.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 热点签名：取前 5 条标题排序后拼接，用于跨 tick 变化检测（只看"有意义"的变化）
export function signatureOf(topics) {
  const titles = (Array.isArray(topics) ? topics : []).slice(0, 5).map(t => t?.title || '').filter(Boolean);
  return JSON.stringify([...titles].sort());
}

// 从签名串恢复标题数组（签名即排序标题的 JSON，安全解析；失败返回空）
export function titlesFromSig(sig) {
  try {
    const a = JSON.parse(sig);
    return Array.isArray(a) ? a.filter(t => typeof t === 'string') : [];
  } catch { return []; }
}

// 结构化差异检测：对比上轮与本轮热点标题，产出「新增 / 消失」列表（离线可测）
export function diffTopics(prevTitles = [], currTitles = []) {
  const prev = new Set(prevTitles), curr = new Set(currTitles);
  const added = [...curr].filter(t => !prev.has(t));
  const removed = [...prev].filter(t => !curr.has(t));
  return { added, removed };
}

// 联网抓新增热点的 URL 并摘要（best-effort，单条失败不影响其余）。
// 仅对带 url 的话题调用 omni.summarizeWebsite（真实联网摘要）；无该能力则标记不可用。
// 返回 [{title, url, summary|error}]，诚实不伪造。
export async function summarizeNewTopics(omni, topics, { maxWords = 60 } = {}) {
  const list = (Array.isArray(topics) ? topics : [])
    .filter(t => t?.url)
    .map(t => ({ title: t.title || t.url, url: t.url }));
  const out = [];
  for (const t of list) {
    try {
      if (!omni?.summarizeWebsite) { out.push({ title: t.title, url: t.url, error: 'summarizeWebsite 不可用' }); continue; }
      const r = await omni.summarizeWebsite(t.url, maxWords);
      out.push({ title: t.title, url: t.url, summary: r?.summary || r?.mainText || r?.error || '(无摘要)' });
    } catch (e) {
      out.push({ title: t.title, url: t.url, error: e?.message || String(e) });
    }
  }
  return out;
}

// 合成"自主行动"目标：把最新热点转变为一个 Agent 可离线执行的动作。
// 支持自定义模板占位：{date}{top3}{topics}{added}{removed}{count}
// 内置模式（agentMode）：
//   remember(默认) — 把「当前 / 新增 / 消失」写入记忆（零成本、离线）
//   alert          — 仅在"突变"（有新增话题）时触发，目标为一条告警记忆
//   digest         — 把本轮热点 + 差异写成 markdown 摘要文件落盘（可附新增热点联网摘要）
export function synthesizeAgentGoal(topics, template, opts = {}) {
  const { mode = 'remember', diff = { added: [], removed: [] }, summaries = [] } = opts;
  const list = (Array.isArray(topics) ? topics : []).filter(t => t?.title);
  const date = new Date().toISOString().slice(0, 10);
  const top3 = list.slice(0, 3).map(t => t.title).join('、');
  const all = list.map(t => t.title).join('、');
  const added = (diff.added || []).join('、') || '(无)';
  const removed = (diff.removed || []).join('、') || '(无)';
  const count = String(list.length);
  if (template) {
    return template
      .replace(/\{date\}/g, date).replace(/\{top3\}/g, top3).replace(/\{topics\}/g, all)
      .replace(/\{added\}/g, added).replace(/\{removed\}/g, removed).replace(/\{count\}/g, count);
  }
  if (mode === 'alert') return `提醒 突变_${date}=${added}`;
  if (mode === 'digest') {
    let md = `话题摘要（${date}）\n\n当前话题(${count}): ${all || '(空)'}\n\n新增话题: ${added}\n\n消失话题: ${removed}`;
    if (summaries && summaries.length) {
      md += '\n\n新增热点摘要:\n' + summaries.map(s => `- ${s.title}（${s.url}）: ${s.summary || s.error || '(无摘要)'}`).join('\n');
    }
    return `写入 ./watch_digest_${date}.md 内容: "${md}"`;
  }
  // default remember：把差异一并记下，比单纯 top3 更有信息量
  return `记住 watch_${date}=当前:${top3} | 新增:${added} | 消失:${removed}`;
}

// 单次感知快照：聚合热搜 → 合成情境 → 规划下一步（可选思考）→ 可选自主派发 Agent
// agent 选项开启后：当检测到热点"有意义变化"且已过冷却，自动把目标交给 omni.act（Agent 内核）真正执行。
export async function runWatchTick(omni, {
  enableThink = false,
  agent = false,            // 是否开启"变化即行动"自主编排
  agentGoal,                // 自定义目标模板（{date}{top3}{topics}{added}{removed}{count}）
  agentMode = 'remember',   // 内置模式：remember(默认) / alert(仅突变) / digest(写摘要)
  agentUseLLM = false,      // 自主 agent 默认离线确定性（零成本、诚实不伪造）
  agentCooldownMs = 60000,  // 两次自主行动最小间隔（防刷）
  summarizeNew = false,     // 是否对新增热点联网抓 URL 并摘要（默认关闭，需显式开启避免意外联网）
  summarizeMaxWords = 60,   // 单条摘要字数上限
  prevSig,                  // 上一轮热点签名（变化检测；不传视为首轮）
  prevAgentAt = 0,          // 上一次自主行动时间戳（冷却）
} = {}) {
  const hot = await omni.seeHotAll().catch(e => ({ error: e.message, topics: [] }));
  const situation = omni.sense();
  const plan = omni.plan('基于当前感知，给出下一步行动建议');
  let thought = null;
  if (enableThink) {
    thought = await omni.think('基于当前感知环境，我应优先关注什么').catch(e => ({ error: e.message }));
  }

  // 结构化差异（新增 / 消失）——支撑"突变告警"与更有信息量的记忆/摘要
  const currTitles = (Array.isArray(hot?.topics) ? hot.topics : []).slice(0, 5).map(t => t?.title || '').filter(Boolean);
  const prevTitles = titlesFromSig(prevSig);
  const diff = diffTopics(prevTitles, currTitles);

  // 联网抓新增热点 URL 并摘要（best-effort；默认关闭，需显式开启避免意外联网）
  let newSummaries = [];
  if (summarizeNew && diff.added.length) {
    const addedTopics = (Array.isArray(hot?.topics) ? hot.topics : []).filter(t => diff.added.includes(t?.title || t));
    try { newSummaries = await summarizeNewTopics(omni, addedTopics, { maxWords: summarizeMaxWords }); }
    catch (e) { newSummaries = [{ error: e?.message || String(e) }]; }
  }

  // —— 自主编排：变化检测 → 派发 Agent ——
  const sig = signatureOf(hot?.topics);
  let agentAction = null;
  if (agent) {
    const changed = prevSig === undefined ? true : sig !== prevSig;
    const cooled = Date.now() - prevAgentAt >= agentCooldownMs;
    const mutated = diff.added.length > 0;
    let fire = changed && cooled;
    let reason;
    if (prevSig === undefined) reason = '首轮播种';
    else if (!changed) reason = '热点无变化';
    else if (!cooled) reason = '冷却中';
    else reason = '检测到热点变化';
    // alert 模式：仅当真正"突变"（有新增话题）才触发，无新增则记为未触发（避免无谓刷记忆）
    if (agentMode === 'alert' && changed && cooled && !mutated) {
      fire = false;
      reason = '无新增话题';
    }
    if (fire) {
      const goal = synthesizeAgentGoal(hot?.topics, agentGoal, { mode: agentMode, diff, summaries: newSummaries });
      let res = null;
      try { res = await omni.act(goal, { useLLM: agentUseLLM, remember: true }); }
      catch (e) { res = { completed: false, result: '〔agent 调用失败〕' + (e?.message || e) }; }
      agentAction = {
        fired: true,
        reason,
        mode: agentMode,
        goal,
        diff,
        completed: !!res?.completed,
        usedLLM: !!res?.usedLLM,
        reused: !!res?.reused,
        result: res?.result ?? null,
        at: Date.now(),
      };
    } else {
      agentAction = {
        fired: false,
        reason,
        mode: agentMode,
        goal: null,
        diff,
        at: Date.now(),
      };
    }
  }

  return {
    at: Date.now(),
    hotCount: Array.isArray(hot?.topics) ? hot.topics.length : 0,
    situation,
    plan,
    thought,
    sig,            // 本轮热点签名，供调用方透传下一轮做变化检测
    diff,           // 本轮热点相对上轮的结构化差异（新增/消失）
    newSummaries,   // 新增热点联网摘要（summarizeNew 开启时；否则空数组）
    agentAction,
  };
}

// 常驻循环：每个 tick 调用 runWatchTick 并落盘快照；信号触发优雅停止
// 跨 tick 透传热点签名与上次行动时间，使"变化检测 + 冷却"在循环内持续生效。
export async function runWatch(omni, {
  interval = 60000,
  maxTicks = Infinity,
  enableThink = false,
  outFile = './.omni-watch.json',
  rememberLatest = false,
  agent = false,
  agentGoal,
  agentMode = 'remember',
  agentUseLLM = false,
  agentCooldownMs = 60000,
  summarizeNew = false,
  summarizeMaxWords = 60,
  onTick,
} = {}) {
  const snapshots = [];
  let stopped = false;
  const stop = () => { stopped = true; };
  const onSig = () => { log.info('[watch] 收到停止信号，结束循环…'); stop(); };
  process.on('SIGINT', onSig);
  process.on('SIGTERM', onSig);
  let tick = 0;
  let prevSig;            // 跨 tick 透传热点签名
  let prevAgentAt = 0;    // 跨 tick 透传上次自主行动时间
  try {
    while (!stopped && tick < maxTicks) {
      tick++;
      const snapshot = await runWatchTick(omni, { enableThink, agent, agentGoal, agentMode, agentUseLLM, agentCooldownMs, summarizeNew, summarizeMaxWords, prevSig, prevAgentAt });
      snapshot.tick = tick;
      if (snapshot.sig !== undefined) prevSig = snapshot.sig;
      if (snapshot.agentAction?.fired) prevAgentAt = snapshot.agentAction.at;
      snapshots.push(snapshot);
      if (outFile) {
        try {
          writeFileSync(outFile, JSON.stringify({ ticks: snapshots }, null, 2));
        } catch (e) {
          log.warn('[watch] 写快照失败:', e.message);
        }
      }
      if (rememberLatest && omni.remember) {
        try {
          omni.remember('lastWatch', JSON.stringify({
            tick, at: snapshot.at, hotCount: snapshot.hotCount,
            actions: snapshot.plan?.actions || [],
            agentFired: snapshot.agentAction?.fired || false,
            agentMode: snapshot.agentAction?.mode || null,
            agentGoal: snapshot.agentAction?.goal || null,
            added: snapshot.diff?.added || [],
            removed: snapshot.diff?.removed || [],
          }));
        } catch { /* 记忆不可用时静默 */ }
      }
      if (onTick) {
        onTick(snapshot);
      } else {
        const act = (snapshot.plan?.actions || []).join(', ') || '(无需行动)';
        const auto = snapshot.agentAction?.fired ? ` | 自主行动: ${snapshot.agentAction.goal}` : ` | 自主: ${snapshot.agentAction?.reason || '关'}`;
        log.info(`[watch] tick ${tick}: ${snapshot.hotCount} 热点 | 建议: ${act}${auto}`);
      }
      if (stopped || tick >= maxTicks) break;
      await sleep(interval);
    }
  } finally {
    process.off('SIGINT', onSig);
    process.off('SIGTERM', onSig);
  }
  return { ticks: snapshots, stopped: stopped || tick >= maxTicks, total: snapshots.length, agentFired: snapshots.filter(s => s.agentAction?.fired).length };
}
