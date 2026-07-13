// Agent 内核（ReAct 推理闭环）—— OmniSense 从"感知+汇报"升级为"能推理、能调用工具、能真正把目标做完"的关键。
//
// 两种推理引擎：
//   1) LLM 推理（有网关/外部 key 时）：模型走 ReAct，动态决定每一步用哪个工具，直到给出 final_answer。
//      这是真正的"智能 agent"，能处理开放式、多分支目标。
//   2) 本地确定性规划器（无模型/agent 模式时）：用通用意图分解把目标拆成有序工具调用并依次执行，
//      同样能完成"抓取网页并写入文件""计算并写入结果""读文件再复制"等复合任务——诚实不伪造。
//
// "越用越强"：每完成一个目标，把"打法"(playbook) 存入记忆；未来同类目标——
//   · 高相似 → 直接复用历史步骤（参数自动迁移），省步骤更稳；
//   · 中相似 → 把历史打法作为 few-shot 注入 LLM 推理器，提升规划质量；
//   · 低相似 → 正常从零规划。 hitCount 随复用累积。
// 诚实边界：三路都走不通时，明确说"无法自主完成，需要在线模型或更具体的目标"，绝不假装成功。

import { log } from './logger.mjs';
import { extractJson } from './llm.mjs';
import { buildDefaultTools, executeTool } from './tools.mjs';
import { EVENTS } from './bus.mjs';

// 本地轻量分词（与 memory.tokenize 同源语义，但此处内联以避免模块耦合）
const STOP = new Set('的 了 和 与 把 在 到 我 你 他 她 它 们 这 那 个 是 有 就 也 都 而 即 若 请 用 为 以 上 下 中 后 前 该 此 每 各 其'.split(/\s+/));
function tokenizeLocal(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  for (const w of (s.match(/[a-z0-9]+/g) || [])) if (w.length > 1 && !STOP.has(w)) out.push(w);
  for (const c of (s.match(/[一-龥]/g) || [])) if (!STOP.has(c)) out.push(c);
  for (const u of (s.match(/https?:\/\/\S+/g) || [])) out.push(u.replace(/^https?:\/\//, '').replace(/[^\w-]/g, '_'));
  for (const p of (s.match(/[\w.\-/\\]+\.\w+/g) || [])) out.push(p.replace(/[^\w-]/g, '_'));
  return out;
}
function jaccard(a, b) {
  const A = new Set(tokenizeLocal(a)), B = new Set(tokenizeLocal(b));
  if (!A.size && !B.size) return 0;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

// 宽松提取：即便目标缺少"抓取/写入"等动词，也尽量从字符串里挖出 URL/路径/算式/引号文本/键值。
// 供"二次召回影响本地规划器"在正则解析失败时，按经验建议的工具重建步骤。
function looseExtract(goal) {
  const g = String(goal || '');
  const urlM = g.match(/https?:\/\/\S+/);
  const url = urlM ? urlM[0] : null;
  const rest = url ? g.replace(url, ' ') : g; // 先去掉 URL，避免把 //example.com 误当成文件路径
  const pathM = rest.match(/([\w.\-\/\\]+\.\w+)/);
  const calcM = g.match(/([\d.]+\s*[\+\-\*\/\%\^]\s*[\d.]+)/);
  const qM = g.match(/[“"']([^”"']+)[”"']/);
  const kvM = g.match(/([\w.\-一-龥]+)\s*[=：:]\s*([^\n,]+)/);
  return {
    url,
    path: pathM ? pathM[1] : null,
    calc: calcM ? calcM[1].trim() : null,
    quote: qM ? qM[1] : null,
    kv: kvM ? { key: kvM[1].trim(), value: kvM[2].trim() } : null,
  };
}

// ───────────────────────── 本地确定性规划器（通用意图分解）─────────────────────────
// 把目标拆成有序工具调用。返回 steps:[{tool,args}] 或 null（无法解析）。
// 支持链式：write_file 的 content 可用 {prev} 占位，执行前自动替换为上一步输出。
// opts.hints：来自记忆二次召回的经验文本（含"工具序列[...]"）。当正则解析不出步骤时，
//   按经验建议的工具 + 从目标宽松提取参数重建步骤——让离线规划器也能"借经验"（二次召回真正影响执行）。
export function localPlan(goal, opts = {}) {
  const g = String(goal || '');
  const gl = g.toLowerCase();
  const intent = { calc: null, fetches: [], summarize: null, writePath: null, writeText: null, readPath: null, remember: null, hot: false, now: false };

  // 算术表达式（含 计算 关键词，或纯表达式）
  // 注：中文关键词不用 \b（JS 中 \b 仅识别 [A-Za-z0-9_]，中文前后无单词边界会导致永不匹配）
  const calcM = g.match(/([\d.]+\s*[\+\-\*\/\%\^]\s*[\d.]+(?:[\d\s+\-*\/%^().]*))/);
  if (/计算|算一下|算清|calc|evaluate|compute|calculate/i.test(gl) && calcM) intent.calc = calcM[1].trim();
  else if (/^[\d.\s+\-*\/%^()]+$/.test(g.trim()) && /[\+\-\*\/]/.test(g)) intent.calc = g.trim();

  // URL + 抓取/摘要意图
  const urls = g.match(/https?:\/\/\S+/g) || [];
  if (/(抓取|fetch|打开|访问|看|下载)/i.test(gl) && urls[0]) intent.fetches.push(urls[0]);
  const su = g.match(/(?:摘要|总结|概括|summar)[\s\S]*?(https?:\/\/\S+)/i) || (urls[0] && /(摘要|总结|概括|summar)/i.test(gl) ? { 1: urls[0] } : null);
  if (su) intent.summarize = su[1] || urls[0];

  // 写文件意图 + 引号内文本
  const wM = g.match(/(?:写入|保存|写进|存到|写到|输出到|write)\s*([^\s'"]+\.\w+)/i);
  if (wM) intent.writePath = wM[1];
  const qM = g.match(/[“"']([^”"']+)[”"']/);
  if (qM) intent.writeText = qM[1];

  // 读文件意图
  const rM = g.match(/(?:读|查看|读取|内容)[\s\S]*?([\w.\-/\\]+\.\w+)/i) || (/read|cat/i.test(gl) && g.match(/([\w.\-/\\]+\.\w+)/));
  if (rM) intent.readPath = rM[1];

  // 记住意图  key=value（含 提醒/告警 类动词，便于 watch 的 alert 模式目标离线可执行）
  const memM = g.match(/(?:记住|记忆|保存|记录|提醒|告警|警示|remember|save|store|notify|记一下)[\s\S]*?([\w.\-一-龥]+)\s*[=：:]\s*([^\n]+)/i);
  if (memM) intent.remember = { key: memM[1].trim(), value: memM[2].trim() };

  if (/热搜|热点|热门|趋势|hot|trending|trends/i.test(gl)) intent.hot = true;
  if (/时间|现在|几点|日期|今天|today|now|date|current/i.test(gl)) intent.now = true;

  const steps = [];
  // 依赖排序：把"数据生产者"排在前，"消费者"(写文件)排在后
  // 1) 抓取/摘要 → 写入
  if ((intent.fetches.length || intent.summarize) && intent.writePath) {
    const url = intent.summarize || intent.fetches[0];
    steps.push({ tool: intent.summarize ? 'summarize_url' : 'web_fetch', args: { url } });
    steps.push({ tool: 'write_file', args: { path: intent.writePath, content: '{prev}' } });
    return steps;
  }
  // 2) 读取 → 写入（文件复制）
  if (intent.readPath && intent.writePath) {
    steps.push({ tool: 'read_file', args: { path: intent.readPath } });
    steps.push({ tool: 'write_file', args: { path: intent.writePath, content: '{prev}' } });
    return steps;
  }
  // 3) 计算 → 写入（结果落盘）
  if (intent.calc && intent.writePath) {
    steps.push({ tool: 'calc', args: { expression: intent.calc } });
    steps.push({ tool: 'write_file', args: { path: intent.writePath, content: '{prev}' } });
    return steps;
  }
  // 4) 独立意图
  if (intent.calc) steps.push({ tool: 'calc', args: { expression: intent.calc } });
  if (intent.fetches.length) steps.push({ tool: 'web_fetch', args: { url: intent.fetches[0] } });
  if (intent.summarize) steps.push({ tool: 'summarize_url', args: { url: intent.summarize } });
  if (intent.readPath) steps.push({ tool: 'read_file', args: { path: intent.readPath } });
  if (intent.remember) steps.push({ tool: 'memory_remember', args: intent.remember });
  if (intent.writePath && !steps.length) steps.push({ tool: 'write_file', args: { path: intent.writePath, content: intent.writeText || '' } });
  if (intent.hot) steps.push({ tool: 'hot_topics', args: {} });
  if (intent.now) steps.push({ tool: 'now', args: {} });

  // 二次召回影响本地规划器：正则解析不出步骤，但有相关经验(工具序列)时，
  // 按经验建议的工具 + 从目标宽松提取参数，重建步骤——让离线规划器也能"借经验"。
  if (!steps.length && opts?.hints?.length) {
    const lz = looseExtract(goal);
    for (const h of opts.hints) {
      const m = String(h).match(/工具序列\[([^\]]+)\]/);
      if (!m) continue;
      const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
      for (const name of names) {
        if (name === 'web_fetch' && lz.url) steps.push({ tool: 'web_fetch', args: { url: lz.url } });
        else if (name === 'summarize_url' && lz.url) steps.push({ tool: 'summarize_url', args: { url: lz.url } });
        else if (name === 'calc' && lz.calc) steps.push({ tool: 'calc', args: { expression: lz.calc } });
        else if (name === 'read_file' && lz.path) steps.push({ tool: 'read_file', args: { path: lz.path } });
        else if (name === 'memory_remember' && lz.kv) steps.push({ tool: 'memory_remember', args: lz.kv });
        else if (name === 'write_file' && lz.path) {
          const prevStep = steps[steps.length - 1];
          steps.push({ tool: 'write_file', args: { path: lz.path, content: prevStep ? '{prev}' : (lz.quote || '') } });
        } else if (name === 'hot_topics') steps.push({ tool: 'hot_topics', args: {} });
        else if (name === 'now') steps.push({ tool: 'now', args: {} });
      }
      if (steps.length) break;
    }
  }

  return steps.length ? steps : null;
}

// 用上一步输出替换 {prev}
function substPrev(args, prev) {
  if (!prev) return args;
  const rep = (s) => typeof s === 'string' ? s.replace(/\{prev\}/g, JSON.stringify(prev?.output ?? prev?.error ?? prev).slice(0, 1500)) : s;
  const out = {};
  for (const [k, v] of Object.entries(args || {})) out[k] = rep(v);
  return out;
}

// 把执行轨迹合成人类可读的结果
function synthesizeFinal(goal, trace) {
  const parts = trace.map(t => {
    const o = t.observation;
    let out;
    if (o?.ok) {
      const ov = o.output;
      if (ov?.result !== undefined) out = '= ' + ov.result;
      else if (ov?.title) out = '《' + ov.title + '》';
      else if (ov?.iso) out = ov.iso;
      else if (t.action === 'write_file') out = '已写入 ' + (t.action_input?.path || '');
      else if (ov?.topics) out = (ov.topics.slice(0, 5).join('、') || '(空)');
      else out = JSON.stringify(ov).slice(0, 160);
    } else out = '失败: ' + (o?.error || '未知');
    return `· ${t.action}(${JSON.stringify(t.action_input)}) → ${out}`;
  });
  return `目标: ${goal}\n已完成步骤:\n${parts.join('\n')}`;
}

function hashGoal(s) {
  let h = 2166136261;
  for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// 规范化 reasoner 输出为 { thought, action, action_input, final_answer }
function normalizeDec(dec) {
  if (typeof dec === 'string') {
    try { dec = extractJson(dec); } catch { dec = {}; }
  }
  if (!dec || typeof dec !== 'object') dec = {};
  let action_input = dec.action_input;
  if (typeof action_input === 'string') { try { action_input = JSON.parse(action_input); } catch { action_input = { value: action_input }; } }
  return {
    thought: dec.thought || '',
    action: dec.action || null,
    action_input: action_input || {},
    final_answer: dec.final_answer != null ? dec.final_answer : null,
  };
}

// 构造 LLM 推理器：用模型走 ReAct。模型不可用(AGENT_DRIVE/BUILTIN_UNAVAILABLE)时抛出异常，由上层转本地规划器。
// fewshot: 可选的历史打法（playbook），作为参考注入，提升同类目标规划质量。
export function makeLLMReasoner(omni, toolList, fewshot, experience) {
  const specs = toolList.map(t => `- ${t.name}: ${t.description}\n  参数: ${JSON.stringify(t.parameters)}`).join('\n');
  let sys = `你是 OmniSense 的Agent推理器。根据目标和已发生的(思考/动作/观察)历史，决定下一步。
可用工具:
${specs}
仅输出一个 JSON（不要多余文字）:
{"thought":"你这一步在想什么","action":"要调用的工具名(没有则 null)","action_input":{工具参数对象},"final_answer":"当目标达成时给出最终回答(否则 null)"}
规则：若需更多信息就调用工具；若已能回答就给 final_answer 并令 action=null。最多8步。`;
  if (fewshot && fewshot.goal && Array.isArray(fewshot.steps) && fewshot.steps.length) {
    const plan = fewshot.steps.map(s => `  ${s.action}(${JSON.stringify(s.action_input)})`).join('\n');
    sys += `\n\n参考：曾有类似目标「${fewshot.goal}」采用如下打法，可借鉴其步骤与参数迁移：\n${plan}`;
  }
  if (experience && experience.ctxText) {
    sys += `\n\n已知相关经验（仅供参考，若不适用请忽略，不要编造）:\n${experience.ctxText}`;
  }

  return async function reasoner(goal, history, stepCtx = '') {
    const msgs = [{ role: 'system', content: sys }, { role: 'user', content: `目标: ${goal}` }];
    for (const h of history) {
      msgs.push({ role: 'assistant', content: JSON.stringify({ thought: h.thought, action: h.action, action_input: h.action_input }) });
      msgs.push({ role: 'user', content: `观察: ${h.observation?.ok ? JSON.stringify(h.observation.output).slice(0, 1200) : '错误: ' + (h.observation?.error || '')}` });
    }
    let tail = '请决定下一步（输出 JSON）。';
    if (stepCtx) tail += `\n\n本轮新增相关经验（基于上一步观察精炼得到，仅供参考，若不适用请忽略）:\n${stepCtx}`;
    msgs.push({ role: 'user', content: tail });
    // models.chat 在 agent 模式抛 AGENT_DRIVE；网关不可用时抛 BUILTIN_UNAVAILABLE —— 都向上传递
    const raw = await omni.models.chat(msgs, { json: true });
    return normalizeDec(raw);
  };
}

// —— playbook 检索与复用 ——
// 从记忆中找与目标最相似的 playbook（BM25/字面相似度在 memory 层，此处用 Jaccard 语义相似度二次精排）
export function recallPlaybook(goal, memory) {
  if (!memory?.search) return null;
  const hits = memory.search('playbook', { topK: 999, includeNotes: false });
  let best = null, bestKey = null, bestScore = 0;
  for (const h of hits) {
    if (!h.key || !String(h.key).startsWith('playbook:')) continue;
    const pb = h.value;
    if (!pb || !pb.goal || !Array.isArray(pb.steps)) continue;
    const s = jaccard(goal, pb.goal);
    if (s > bestScore) { bestScore = s; best = pb; bestKey = h.key; }
  }
  return best ? { pb: best, key: bestKey, score: bestScore } : null;
}

// 召回与目标相关的"经验记忆"（排除 playbook 自身，playbook 由 recallPlaybook 单独处理）。
// 直接复用 memory 深度检索 v3（BM25 + 时间衰减 + 复用权重 + MMR），让 Agent 推理带上"据"。
// 返回 { items:[{type,key?,text,score}], ctxText }，供 LLM 推理注入 / 本地规划器诚实提示。
export function recallContext(goal, memory, topK = 3) {
  if (!memory?.search) return { items: [], ctxText: '' };
  const hits = memory.search(goal, { topK: Math.max(topK * 3, 6), includeNotes: true });
  const items = [];
  for (const h of hits) {
    if (h.type === 'store' && h.key && String(h.key).startsWith('playbook:')) continue; // playbook 单独处理
    const text = h.type === 'note'
      ? `[${h.tag || 'note'}] ${h.text}`
      : `记忆[${h.key}]: ${typeof h.value === 'string' ? h.value : JSON.stringify(h.value).slice(0, 200)}`;
    items.push({ type: h.type, key: h.key, text, score: h.score });
    if (items.length >= topK) break;
  }
  const ctxText = items.map((it, i) => `${i + 1}. ${it.text}`).join('\n');
  return { items, ctxText };
}

// ───────────────────────── Agent 自我反思（reflect）─────────────────────────
// 每次 Agent 跑完，基于执行轨迹 produce "经验教训"，写回记忆，让未来同类目标可召回——把"越用越强"闭环补齐。
// 两种模式：
//   · 离线确定性反思（无模型/默认）：扫描轨迹里的失败、空结果、复用成功、兜底降级等模式，产出结构化 lessons。
//   · LLM 反思（omni.models.chat 可用）：让模型基于轨迹总结 2-4 条可复用教训（best-effort）。
// 诚实边界：反思失败（模型不可用/异常）一律静默退回离线启发式，绝不因反思打断主流程或伪造成功。
//
// @returns {Promise<{enabled,mode,lessons:[{type,text}],fallback:boolean,note:boolean}>}
export async function reflect(omni, { goal, trace, completed, usedLLM, reused, remember = true } = {}) {
  const out = { enabled: true, mode: 'offline', lessons: [], fallback: false, note: false };

  // 离线启发式：不依赖任何模型，纯规则从轨迹抽模式
  const lessons = [];
  const failed = trace.filter(t => t.observation && t.observation.ok === false);
  const failByTool = {};
  for (const t of failed) { const n = t.action || '?'; failByTool[n] = (failByTool[n] || 0) + 1; }
  for (const [tool, c] of Object.entries(failByTool)) {
    lessons.push({ type: 'failure', text: `工具「${tool}」本次执行失败${c > 1 ? ` ${c} 次` : ''}，未来同类目标需先检查参数/网络或考虑替代工具` });
  }
  // 空结果（ok 但无有效输出）
  for (const t of trace) {
    const o = t.observation?.output;
    if (t.observation?.ok && (o == null || (typeof o === 'string' && !o.trim()) || (Array.isArray(o?.topics) && o.topics.length === 0))) {
      lessons.push({ type: 'empty', text: `工具「${t.action}」返回空结果，可能因参数不当或源暂无数据` });
    }
  }
  if (completed && reused) lessons.push({ type: 'success', text: `复用 playbook 成功完成目标，说明该类任务已被沉淀为稳定打法` });
  if (completed && !usedLLM) lessons.push({ type: 'info', text: `目标在"无在线模型"下由本地规划器独立完成，属于可离线稳定复现的复合任务` });
  if (!completed) lessons.push({ type: 'open', text: `目标未完成，需在线模型或更具操作性的目标（如明确 URL/路径/算式）才能自主闭环` });

  // 若模型可用，尝试 LLM 反思（best-effort，失败退回离线）
  if (omni?.models?.chat) {
    try {
      const traj = trace.map(t => {
        const o = t.observation;
        const ov = o?.ok === false ? `失败:${o.error}` : (o?.output != null ? JSON.stringify(o.output).slice(0, 300) : '无输出');
        return `· ${t.action || t.final_answer ? 'final:' + t.final_answer : ''} → ${ov}`;
      }).join('\n');
      const sys = `你是 OmniSense 的反思器。基于一次 Agent 执行轨迹，总结 2-4 条对"未来同类目标"有用的经验教训（失败原因、可复用打法、需注意的坑）。仅输出 JSON 数组，每条形如 {"type":"failure|success|info|open","text":"..."}。不要编造轨迹中没有的信息。`;
      const raw = await omni.models.chat([{ role: 'system', content: sys }, { role: 'user', content: `目标: ${goal}\n完成: ${completed}\n轨迹:\n${traj}` }], { json: true });
      const arr = typeof raw === 'string' ? extractJson(raw) : raw;
      if (Array.isArray(arr) && arr.length) {
        out.mode = 'llm';
        out.lessons = arr.filter(x => x && x.text).map(x => ({ type: x.type || 'info', text: String(x.text) }));
      } else {
        out.lessons = lessons; // 模型没给有效结构，退回离线
      }
    } catch (e) {
      out.fallback = true;
      out.lessons = lessons; // 模型不可用，退回离线启发式
    }
  } else {
    out.lessons = lessons;
  }

  // 写回记忆：作为 agent-reflection 笔记存档，未来 recallContext（含 notes）可召回，真正"影响"下次推理
  if (remember && omni?.memory && out.lessons.length) {
    try {
      for (const l of out.lessons) omni.memory.note(`反思[${l.type}]: ${goal} → ${l.text}`, 'agent-reflection');
      out.note = true;
    } catch { /* 记忆不可用静默 */ }
  }
  return out;
}

// 把历史 playbook 的参数迁移到新目标（替换 URL/路径/表达式）
export function adaptPlaybook(pb, goal) {
  const urls = goal.match(/https?:\/\/\S+/g) || [];
  const noUrl = goal.replace(/https?:\/\/\S+/g, ' '); // 排除 URL 干扰，避免把 example.org 当成文件路径
  const paths = noUrl.match(/[\w.\-/\\]+\.\w+/g) || [];
  const calcs = goal.match(/([\d.]+\s*[\+\-\*\/\%\^]\s*[\d.]+)/g) || [];
  return pb.steps.map(st => {
    const ns = { tool: st.action, args: { ...(st.action_input || {}) } };
    if ((ns.tool === 'web_fetch' || ns.tool === 'summarize_url') && urls[0]) ns.args.url = urls[0];
    if (ns.tool === 'write_file' && paths[0]) ns.args.path = paths[0];
    if (ns.tool === 'read_file' && paths[0]) ns.args.path = paths[0];
    if (ns.tool === 'calc' && calcs[0]) ns.args.expression = calcs[0].trim();
    return ns;
  });
}

// 执行一串步骤（支持 {prev} 链式替换），返回 {trace, completed, result}
async function executePlan(omni, toolList, steps, ctx, goal) {
  const trace = [];
  let last = null;
  for (let i = 0; i < steps.length; i++) {
    const st = steps[i];
    const args = substPrev(st.args, last);
    const t0 = Date.now();
    const obs = await executeTool(toolList, st.tool, args, ctx);
    const tMs = Date.now() - t0; // 单步耗时（可观测性）
    const entry = { step: i + 1, action: st.tool, action_input: args, observation: obs, durationMs: tMs };
    trace.push(entry);
    last = obs;
    if (obs?.ok === false) break; // 任一步失败即停，诚实返回
  }
  const completed = trace.length > 0 && trace.every(t => t.observation?.ok !== false);
  return { trace, completed, result: synthesizeFinal(goal, trace) };
}

/**
 * 运行 Agent：把目标转化为一串工具调用，直到完成。
 * @param {object} omni  OmniSense 实例（提供 .models/.memory/.bus）
 * @param {object} opts
 *   goal        目标描述
 *   maxSteps    最大步数（默认8）
 *   tools       自定义工具集（默认 buildDefaultTools(omni)）
 *   reasoner    注入的推理器（测试用；默认有模型则 LLM，否则本地规划器）
 *   allowShell  是否启用 shell 工具（默认 false）
 *   useLLM      是否尝试 LLM 推理（默认 true）
 *   remember    是否沉淀 playbook 到记忆（默认 true）
 * @returns {Promise<{goal,completed,usedLLM,reused,playbookScore,steps,result}>}
 */
export async function runAgent(omni, {
  goal,
  maxSteps = 8,
  tools,
  reasoner,
  allowShell = false,
  useLLM = true,
  remember = true,
  reflect: doReflect = true,
} = {}) {
  const toolList = tools || buildDefaultTools(omni, { allowShell });
  const trace = [];
  const ctx = { omni, memory: omni?.memory, allowShell };
  let usedLLM = false;
  let completed = false;
  let result = null;
  let reused = false;
  let playbookScore = 0;
  const stepHints = [];       // 每步观察触发的"二次经验召回"（越用越强·推理时增强），最终并入 experienceHints
  let originalSteps = null; // 本地规划器生成的"模板"步骤（含 {prev} 占位），沉淀 playbook 时用，避免存成已解析的静态值

  // ── 0) 预检索历史 playbook（用于复用 / few-shot）+ 经验记忆（用于推理上下文）──
  let recalled = null;
  let experienceCtx = { items: [], ctxText: '' };
  if (omni?.memory) {
    try { recalled = recallPlaybook(goal, omni.memory); } catch { /* 记忆不可用静默 */ }
    try { experienceCtx = recallContext(goal, omni.memory, 3); } catch { /* 记忆不可用静默 */ }
  }
  const HIGH = 0.5, MID = 0.25;

  // ── 1) LLM ReAct 动态循环 ──
  const rea = reasoner || (useLLM ? makeLLMReasoner(omni, toolList, (recalled && recalled.score >= MID) ? recalled.pb : null, experienceCtx) : null);
  if (rea) {
    const history = [];
    let stepCtx = '';
    for (let step = 1; step <= maxSteps; step++) {
      let dec;
      try {
        dec = await rea(goal, history, stepCtx);
        usedLLM = true;
      } catch (e) {
        // 模型不可用（AGENT_DRIVE / 网关未起 / 鉴权失败）→ 转本地规划器
        log.warn('[agent] 推理器不可用，转本地规划器:', e?.message || e);
        usedLLM = false;
        break;
      }
      dec = normalizeDec(dec);
      if (dec.final_answer != null && dec.final_answer !== '') {
        result = dec.final_answer;
        completed = true;
        trace.push({ step, thought: dec.thought, final_answer: result });
        break;
      }
      if (!dec.action) { log.warn('[agent] 推理器未给出动作且未给结论，终止'); break; }
      const t0 = Date.now();
      const obs = await executeTool(toolList, dec.action, dec.action_input, ctx);
      const tMs = Date.now() - t0; // 单步耗时（可观测性）
      // 每步二次经验召回：基于本次观察再精炼相关经验，注入下一步推理（避免只靠初始目标召回的片面性）
      const obsText = obs?.ok !== false ? JSON.stringify(obs?.output).slice(0, 400) : '错误: ' + (obs?.error || '');
      if (omni?.memory) {
        try {
          const se = recallContext(obsText, omni.memory, 2);
          for (const it of se.items) stepHints.push(it);
          stepCtx = stepHints.map((it, i) => `${i + 1}. ${it.text}`).join('\n');
        } catch { /* 记忆不可用静默 */ }
      }
      const entry = { step, thought: dec.thought, action: dec.action, action_input: dec.action_input, observation: obs, durationMs: tMs };
      trace.push(entry);
      history.push(entry);
      if (step === maxSteps) result = '（达到最大步数，目标可能未完成）';
    }
  }

  // ── 2) 兜底：复用历史 playbook（高相似）→ 本地规划器 → 诚实降级 ──
  if (!completed) {
    if (recalled && recalled.score >= HIGH && Array.isArray(recalled.pb.steps) && recalled.pb.steps.length) {
      // 直接复用历史打法（参数迁移到新目标）
      const steps = adaptPlaybook(recalled.pb, goal);
      const ex = await executePlan(omni, toolList, steps, ctx, goal);
      trace.push(...ex.trace);
      completed = ex.completed;
      result = ex.result;
      reused = true;
      playbookScore = recalled.score;
      // 累积被复用 playbook 的命中（越用越强：被复用次数真实增长）
      try {
        omni.memory.remember(recalled.key, { ...recalled.pb, hitCount: (recalled.pb.hitCount || 0) + 1, reused: true, lastReusedAt: Date.now() });
      } catch { /* 记忆不可用静默 */ }
      } else {
        const plan = localPlan(goal, { hints: experienceCtx.items.map(it => it.text) });
      if (!plan) {
        result = result || '〔诚实降级〕当前无在线模型，且无法用本地规则解析该目标。请接入 LLM 网关/key，或给出更具体的可操作目标（如"抓取 https://x.com 并写入 a.txt""计算 2+2""计算 3*7 并写入 r.txt"）。';
      } else {
        originalSteps = plan.map(s => ({ action: s.tool, action_input: s.args }));
        const ex = await executePlan(omni, toolList, plan, ctx, goal);
        trace.push(...ex.trace);
        completed = ex.completed;
        result = ex.result;
      }
    }
  }

  // ── 3) 沉淀 / 更新 playbook（越用越强）──
  if (remember && completed && omni?.memory) {
    try {
      if (reused) {
        // 复用分支：保留历史"模板"步骤（含 {prev} 占位），只累积命中次数，避免被本次已解析的静态值覆盖
        omni.memory.remember(recalled.key, { ...recalled.pb, hitCount: (recalled.pb.hitCount || 0) + 1, reused: true, lastReusedAt: Date.now() });
      } else {
        // 首次/本地规划完成：存"模板"步骤（originalSteps 含 {prev} 占位与原始参数），未来复用才会在执行时按新参数重新解析
        const key = 'playbook:' + hashGoal(goal);
        const prev = omni.memory.recall(key);
        const steps = originalSteps || trace.filter(t => t.action).map(t => ({ action: t.action, action_input: t.action_input }));
        omni.memory.remember(key, {
          goal,
          steps,
          result: String(result).slice(0, 800),
          at: Date.now(),
          hitCount: prev?.hitCount || 0,
          reused: false,
        });
      }
      omni.memory.note(`完成目标: ${goal}${reused ? '（复用 playbook）' : ''}`, 'agent');
      // 经验沉淀（越用越强·经验层闭环）：记录"目标 → 工具序列"模式，未来同类目标召回时注入推理上下文
      const toolsUsed = [...new Set(trace.filter(t => t.action).map(t => t.action))];
      if (toolsUsed.length) omni.memory.note(`经验: ${goal} → 工具序列[${toolsUsed.join(', ')}]`, 'agent-experience');
    } catch { /* 记忆不可用时静默 */ }
  }

  // ── 4) 自我反思（越用越强·闭环补齐）：把本次轨迹变成可召回的"经验教训" ──
  // 独立于 completed：未达成时反思"为何失败"最有价值。best-effort，异常静默不影响主流程。
  let reflection = { enabled: false };
  if (doReflect && omni?.memory) {
    try {
      reflection = await reflect(omni, { goal, trace, completed, usedLLM, reused, remember });
    } catch {
      reflection = { enabled: false, error: true };
    }
  }

  if (omni?.bus) omni.bus.emit(EVENTS.DECISION, { action: 'agent', goal, completed, usedLLM, reused, steps: trace.length });

  // 合并"初始目标召回" + "每步观察二次召回"，去重，作为最终经验提示（越用越强·推理可观测）
  const merged = [];
  const seenT = new Set();
  for (const it of [...experienceCtx.items, ...stepHints]) {
    if (seenT.has(it.text)) continue;
    seenT.add(it.text);
    merged.push(it.text);
  }
  // ── 5) 可观测性：把本次执行轨迹记录为可回放 trace（LangSmith/OTel 式）──
  // 非侵入：tracer 不可用/异常一律静默，绝不阻断主流程或伪造成功。
  if (omni?.tracer?.recordRun) {
    try {
      omni.tracer.recordRun({
        goal,
        engine: usedLLM ? 'llm' : 'local',
        completed,
        usedLLM,
        reused,
        playbookScore,
        finalAnswer: result,
        steps: trace.map(t => ({
          step: t.step,
          thought: t.thought,
          action: t.action != null ? t.action : (t.final_answer != null ? '(final_answer)' : null),
          action_input: t.action_input,
          observation: t.observation,
          durationMs: t.durationMs,
        })),
        tags: ['agent'],
        meta: { reused, playbookScore, reflectionMode: reflection?.mode || 'offline', steps: trace.length },
      });
    } catch { /* tracer 失败不影响主流程 */ }
  }

  return { goal, completed, usedLLM, reused, playbookScore, steps: trace, result, experienceHints: merged, reflection };
}
