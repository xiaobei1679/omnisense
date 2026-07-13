// 多 Agent 协作内核（Multi-Agent Orchestration）
// ─────────────────────────────────────────────────────────────────────────────
// 把"单体 Agent"升级为"协调器 + 角色子 agent"的可编排团队：
//   · 协调器(coordinator) 把复杂目标离线确定性拆成角色子任务（有 LLM 时可升级为智能拆解）；
//   · 每个子任务交给一个"角色子 agent"（复用 runAgent 内核，但工具集被角色限定）；
//   · 子 agent 的结果写入共享黑板(blackboard)，最后由协调器综合产出；
//   · 部分子任务失败也诚实报告（不谎称全员成功）。
//
// 设计原则（与单体 Agent 一致）：
//   1) 零新增运行时依赖，离线可跑、可测；
//   2) 角色隔离通过"工具集限定"实现——子 agent 只能调用被授权工具，天然沙箱化；
//   3) 诚实降级：拆解不出子任务 / 子 agent 抛异常，都明确返回失败原因，绝不伪造成功。
import { runAgent } from './agent.mjs';
import { buildDefaultTools, executeTool } from './tools.mjs';

// ───────────────────────── 角色定义 ─────────────────────────
// 每个角色限定可调用工具名（必须是 buildDefaultTools 产出的工具名）。
// 工具集 = 角色的能力边界，子 agent 越权即拿不到工具、调用会失败（诚实沙箱）。
export const ROLES = {
  researcher: {
    desc: '检索 / 抓取 / 摘要信息',
    tools: ['web_fetch', 'read_file', 'write_file', 'list_dir', 'memory_search', 'summarize_url', 'memory_remember', 'now', 'hot_topics'],
  },
  analyst: {
    desc: '计算 / 分析 / 结构化',
    tools: ['calc', 'read_file', 'write_file', 'memory_search', 'memory_remember', 'now'],
  },
  writer: {
    desc: '写文件 / 产出文档',
    tools: ['write_file', 'read_file', 'memory_remember', 'now'],
  },
  critic: {
    desc: '校验 / 复核结果',
    tools: ['read_file', 'calc', 'memory_search', 'memory_remember'],
  },
};

// 按关键词把一句话分派到角色（离线确定性，无需模型）。
// 顺序即优先级：critic > researcher > analyst > writer；都不中则回退到 allowedRoles[0] 或 researcher。
const ROLE_RULES = [
  ['critic', /校验|复核|审查|核对|检查|验证|critique|review|check|verify|validate/i],
  ['researcher', /抓取|fetch|访问|看|下载|摘要|总结|概括|调研|搜索|搜一下|查资料|热搜|热点|summar|research|search|investigate/i],
  ['analyst', /计算|算一下|算清|分析|统计|对比|比较|calc|compute|analyze|analyse|evaluate|统计/i],
  ['writer', /写入|保存|写进|存到|写到|输出到|生成|产出|文档|报告|文章|write|produce|draft|create/i],
];

export function classifyRole(clause, allowedRoles) {
  for (const [role, re] of ROLE_RULES) {
    if (allowedRoles && !allowedRoles.includes(role)) continue;
    if (re.test(clause)) return role;
  }
  return (allowedRoles && allowedRoles[0]) || 'researcher';
}

// 把目标按"任务级连接词"拆成子句（不拆动作级连接词如 并/且，避免把"抓取并写入"误拆）。
const CLAUSE_SPLIT = /[。；;\n]+|(然后|同时|另外|以及|与此同时|顺带|接着|再|并随后|随后)/;
const CONNECTORS = new Set(['然后', '同时', '另外', '以及', '与此同时', '顺带', '接着', '再', '并随后', '随后']);
export function splitClauses(goal) {
  const raw = String(goal || '').split(CLAUSE_SPLIT).map(s => s?.trim()).filter(Boolean);
  // 去掉拆分后残留在句尾的标点（如 "抓取 x 并写入 a.txt，" 中的全角逗号），避免污染子目标/写路径
  return raw.filter(p => !CONNECTORS.has(p)).map(c => c.replace(/[，。、；;\s]+$/, ''));
}

// 协调器：把目标拆成角色子任务序列（离线确定性，无需模型）。
// roles 限定本团队启用哪些角色；某子句分到的角色不在 roles 内时，回退到 roles[0]。
export function planSubtasks(goal, roles) {
  const r = roles && roles.length ? roles : Object.keys(ROLES);
  const clauses = splitClauses(goal);
  if (!clauses.length) return [];
  return clauses.map(c => ({ role: classifyRole(c, r), goal: c }));
}

// 智能拆解：有模型或注入 decompose 时，让 LLM 把目标拆成角色子任务；否则退回离线 planSubtasks。
// 返回 [{role, goal}]。任何失败都诚实降级到离线拆解，绝不伪造成功。
//   decompose: 注入函数 (goal, roles) => Promise<[{role, goal}]>，测试用；
//   omni.models.chat 可用 → 调模型输出 JSON 数组 [{role, goal}]。
export async function planSubtasksSmart(omni, goal, roles, { decompose } = {}) {
  const r = roles && roles.length ? roles : Object.keys(ROLES);
  if (typeof decompose === 'function') {
    try {
      const s = await decompose(goal, r);
      if (Array.isArray(s) && s.length) return s.map(x => ({ role: x.role || classifyRole(x.goal || '', r), goal: x.goal })).filter(s => s.goal);
    } catch { /* 注入拆解失败 → 退回离线 */ }
  }
  if (omni?.models?.chat) {
    try {
      const sys = '你是 OmniSense 多 Agent 协调器的任务拆解器。把用户的总目标拆成若干子任务，每个子任务指定一个角色(researcher/analyst/writer/critic)和该子任务的简短目标。只输出一个 JSON 数组，不要多余文字：[{"role":"角色","goal":"子任务目标"}, ...]';
      const raw = await omni.models.chat(
        [{ role: 'system', content: sys }, { role: 'user', content: `总目标: ${goal}\n可选角色: ${r.join('/')}` }],
        { json: true },
      );
      const arr = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(arr) && arr.length) {
        return arr.map(x => ({ role: x.role || classifyRole(x.goal || '', r), goal: x.goal })).filter(s => s.goal);
      }
    } catch { /* 模型不可用 → 退回离线 */ }
  }
  return planSubtasks(goal, roles);
}

// 工具集按角色名过滤（子 agent 的能力边界）。
export function filterTools(tools, names) {
  if (!names || !names.length) return tools;
  const set = new Set(names);
  return tools.filter(t => set.has(t.name));
}

// 提取子句中的写文件目标（供 synthesis 子句把综合结果落盘）。
function writePathOf(goal) {
  const m = String(goal).match(/(?:写入|保存|写进|存到|写到|输出到|write)\s*([^\s'"]+\.\w+)/i);
  return m ? m[1] : null;
}

// 合成/聚合类意图：这类子句依赖其他子 agent 的产出，必须等 worker 跑完。
const SYNTHESIS_RE = /汇总|综合|整合|结合|归纳|合并|综上|根据上述|基于上面|基于上述|把上面的|把前面的|结合以上|整合以上|汇总以上|结合前文|汇总前文/;

// 把协调器拆解出的子任务分批：独立 worker 一批(可并行)，合成类一批(依赖 worker 产出)。
export function scheduleBatches(sub) {
  const workers = [], synthesis = [];
  sub.forEach((s, i) => { (SYNTHESIS_RE.test(s.goal) ? synthesis : workers).push(i); });
  return { workers, synthesis };
}

// 构造协调器综合函数：
//   · 注入函数(coordinator) → 直接使用；
//   · coordinator===true 且 useLLM 且有 models.chat → 用模型走协调器(智能综合)；
//   · 否则返回 null（上层退回确定性综合）。
// 模型不可用/调用失败 → 返回 null（诚实降级，不伪造综合）。
function buildCoordinator(omni, { useLLM, coordinator } = {}) {
  if (typeof coordinator === 'function') return coordinator;
  if (coordinator === true && useLLM && omni?.models?.chat) {
    return async ({ goal, subtasks }) => {
      const brief = subtasks.map((s, i) =>
        `[${i + 1}](${s.role}) ${s.goal} => ${(String(s.result || '').split('\n')[0] || '').slice(0, 300)}`).join('\n');
      try {
        const msgs = [
          { role: 'system', content: '你是 OmniSense 多 Agent 协调器。基于各角色子 agent 的产出，写一段简洁中文综合汇报：达成了什么、各角色贡献、有无失败。只陈述子 agent 实际给出的内容，不要编造未给出的数据。' },
          { role: 'user', content: `总目标: ${goal}\n\n子 agent 产出:\n${brief}\n\n请输出综合汇报:` },
        ];
        const raw = await omni.models.chat(msgs, { json: false });
        return String(raw || '').trim() || null;
      } catch { return null; }
    };
  }
  return null;
}

// 综合各子 agent 结果成可读摘要。
function synthesizeTeam(goal, subtasks) {
  const lines = subtasks.map((s, i) =>
    `[${i + 1}] (${s.role}) ${s.goal}\n   状态: ${s.completed ? '完成' : '失败'} | 结果: ${(String(s.result || '').split('\n')[0] || '').slice(0, 200)}`);
  return `多 Agent 协作完成: ${goal}\n子任务(${subtasks.length}):\n${lines.join('\n')}`;
}

/**
 * 运行多 Agent 协作：协调器拆解 → 按角色委派子 agent → 共享黑板 → 协调器综合产出。
 *   · worker 子任务(彼此独立)默认并行执行(Promise.all)，显著快于串行；
 *   · synthesis 子句(汇总/综合类，依赖 worker 产出)归入第二批，待 worker 跑完后执行；
 *   · 协调器综合：确定性默认；coordinator===true 且有模型时走 LLM 智能综合；可注入自定义 coordinator。
 * @param {object} omni  OmniSense 实例（提供 .memory / .models 等）
 * @param {object} opts
 *   goal          目标描述
 *   roles         启用的角色 id 列表（默认全部：researcher/analyst/writer/critic）
 *   useLLM        子 agent 是否尝试 LLM 推理（默认 false，离线确定性）
 *   allowShell    是否启用 shell 工具（默认 false）
 *   remember      子 agent 是否沉淀个人 playbook（默认 false，避免团队任务污染）
 *   maxSteps      单子 agent 最大步数（默认 8）
 *   tools         自定义全量工具集（测试注入；默认 buildDefaultTools(omni)）
 *   parallel      worker 是否并行执行（默认 true；false 时串行，兼容严格有序场景）
 *   coordinator   综合函数(注入) | true(启用 LLM 协调器) | 省略(确定性综合)
 *   decompose     子任务拆解函数(注入) | 省略(useLLM 且有模型时走 LLM 智能拆解，否则离线拆解)
 * @returns {Promise<{goal,completed,allCompleted,usedLLM,subtasks,blackboard,batches,parallelWorkers,coordinatorMode,result}>}
 */
export async function runMultiAgent(omni, {
  goal,
  roles,
  useLLM = false,
  allowShell = false,
  remember = false,
  maxSteps = 8,
  tools,
  parallel = true,
  coordinator,
  decompose,
} = {}) {
  const allTools = tools || buildDefaultTools(omni, { allowShell });
  // 智能拆解：useLLM 且有模型/注入 decompose 时走 LLM 拆解，否则离线确定性拆解
  const subAll = (useLLM || typeof decompose === 'function')
    ? await planSubtasksSmart(omni, goal, roles, { decompose })
    : planSubtasks(goal, roles);
  if (!subAll.length) {
    return {
      goal, completed: false, allCompleted: false, usedLLM: false, subtasks: [], blackboard: {},
      batches: 0, parallelWorkers: 0, coordinatorMode: 'none',
      result: '〔诚实降级〕无法将目标拆解为子任务，请提供更具体的可操作目标（如"抓取 https://x.com 并写入 a.txt，然后计算 2+2 并写入 b.txt"）。',
    };
  }

  const { workers, synthesis } = scheduleBatches(subAll);
  const blackboard = {};
  const subtasks = [];
  let anyCompleted = false, allCompleted = true, usedLLM = false;
  const ctx = { omni, memory: omni?.memory, allowShell };

  // 记录一个子任务结果到黑板(按原始序号键，避免并行完成顺序影响键名)
  const recordSub = (idx, res) => {
    const st = subAll[idx];
    const entry = { role: st.role, goal: st.goal, completed: !!res.completed, usedLLM: !!res.usedLLM, reused: !!res.reused, result: res.result };
    subtasks.push(entry);
    blackboard[`${st.role}#${idx + 1}`] = res.result;
    if (entry.completed) anyCompleted = true; else allCompleted = false;
    if (entry.usedLLM) usedLLM = true;
    return entry;
  };

  // 单子任务执行（复用 Agent 内核，工具集按角色限定）
  const runOne = async (idx) => {
    const st = subAll[idx];
    const roleSpec = ROLES[st.role];
    const roleTools = filterTools(allTools, roleSpec ? roleSpec.tools : allTools.map(t => t.name));
    try {
      return await runAgent(omni, { goal: st.goal, tools: roleTools, useLLM, allowShell, remember, maxSteps });
    } catch (e) {
      return { completed: false, usedLLM: false, reused: false, result: '〔子 agent 异常〕' + (e?.message || String(e)) };
    }
  };

  // ── 第一批：worker 子任务（独立，默认并行）──
  if (parallel) {
    const rs = await Promise.all(workers.map(runOne));
    rs.forEach((res, k) => recordSub(workers[k], res));
  } else {
    for (const idx of workers) recordSub(idx, await runOne(idx));
  }

  // ── 协调器综合（基于 worker 黑板产出）──
  const brief = subtasks.map((s, i) =>
    `[${i + 1}](${s.role}) ${s.goal} => ${(String(s.result || '').split('\n')[0] || '').slice(0, 300)}`).join('\n');
  let result = synthesizeTeam(goal, subtasks);
  let coordinatorMode = 'deterministic';
  const coordinatorFn = buildCoordinator(omni, { useLLM, coordinator });
  if (coordinatorFn) {
    const wantMode = (typeof coordinator === 'function') ? 'injected' : 'llm';
    try {
      const syn = await coordinatorFn({ goal, subtasks, blackboard });
      if (syn && String(syn).trim()) { result = String(syn).trim(); coordinatorMode = wantMode; }
    } catch { /* 协调器失败 → 退回确定性综合 */ }
  }

  // ── 第二批：synthesis 子句（依赖 worker 产出）→ 把综合结果落盘到其写目标 ──
  if (synthesis.length) {
    for (const idx of synthesis) {
      const st = subAll[idx];
      const path = writePathOf(st.goal);
      let ok = false, out;
      if (path) {
        try {
          const w = await executeTool(allTools, 'write_file', { path, content: result }, ctx);
          ok = !!w?.ok; out = ok ? `已汇总写入 ${path}` : '〔合成写入失败〕';
        } catch (e) { out = '〔合成写入异常〕' + (e?.message || String(e)); }
      } else { ok = true; out = result; } // 无写目标则仅作为综合步骤
      const entry = { role: st.role, goal: st.goal, completed: ok, usedLLM: false, reused: false, result: out };
      subtasks.push(entry);
      blackboard[`${st.role}#${idx + 1}`] = out;
      if (ok) anyCompleted = true; else allCompleted = false;
    }
  }

  const completed = anyCompleted;

  // 可观测性：把本次多 Agent 编排记录为一条 dispatcher trace（非侵入，静默失败）
  if (omni?.tracer?.recordRun) {
    try {
      omni.tracer.recordRun({
        goal,
        engine: 'dispatcher',
        completed: allCompleted,
        usedLLM,
        finalAnswer: result,
        steps: subtasks.map((s, i) => ({
          step: i + 1,
          action: `subagent:${s.role}`,
          action_input: { goal: s.goal },
          observation: { ok: s.completed, output: String(s.result || '').slice(0, 500) },
        })),
        tags: ['multiagent', ...subtasks.map(s => s.role)],
        meta: {
          allCompleted, parallelWorkers: parallel ? workers.length : 1,
          coordinatorMode, batches: (workers.length ? 1 : 0) + (synthesis.length ? 1 : 0),
        },
      });
    } catch { /* 静默 */ }
  }
  // 团队经验沉淀（越用越强·团队层）
  try {
    if (omni?.memory?.note) omni.memory.note(`团队经验: ${goal} → 角色[${subAll.map(s => s.role).join(', ')}]`, 'multi-agent');
  } catch { /* 记忆不可用静默 */ }

  return {
    goal, completed, allCompleted, usedLLM, subtasks, blackboard,
    batches: (workers.length ? 1 : 0) + (synthesis.length ? 1 : 0),
    parallelWorkers: parallel ? workers.length : 1,
    coordinatorMode,
    result,
  };
}
