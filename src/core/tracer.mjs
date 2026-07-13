// Agent 执行轨迹追踪层（Agent Tracing & Observability）
// ─────────────────────────────────────────────────────────────────────────────
// 借鉴（思想/模式，非代码）：
//   1) LangSmith / LangChain v1「全链路 Trace」：一次 Agent 运行 = 一条 trace，
//      内部由若干 run/step 组成，每个 step 是可回放的因果事件（id/耗时/输入/输出/错误）。
//      来源: https://www.wangyiyang.cc/2025/12/14/langchain-guide-20/ 与
//             https://developer.volcengine.com/articles/7647092173612433444
//   2) HuggingFace smolagents 的 ActionStep 模型：每步 = thought + action + observation，
//      与 OmniSense 既有 trace 形状天然一致。
//      来源: https://hugging-face.cn/docs/smolagents/conceptual_guides/react
//   3) OpenTelemetry GenAI 语义约定：可移植的 span 属性命名
//      （gen_ai.operation.name / gen_ai.tool.name / gen_ai.tool.call.arguments|result / error.type）。
//      来源: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
//             https://technspire.com/blog/agent-observability-tracing-decisions-tool-calls
//
// 设计原则（与框架一致）：零依赖、文件落盘、绝不阻断主流程、离线可跑、诚实降级。
//
// 隐私/诚实：默认不落全量大内容（参考 OTel「敏感内容默认不记录」约定），
//   目标/参数/输出统一截断；只保留 ok / error 这类结构化结论，便于回顾而非泄密。
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const DEFAULT_PATH = './.omni-traces.json';
const MAX_GOAL = 2000;
const MAX_ARG = 2000;
const MAX_OUT = 2000;
const MAX_ERR = 500;

// 截断：保留结构化（对象/数组）以可回放；仅当序列化长度超限时退化为「截断字符串」避免无限膨胀。
function clip(v, n) {
  if (v == null) return v;
  if (typeof v === 'string') {
    return v.length > n ? v.slice(0, n) + `…(${v.length})` : v;
  }
  if (Array.isArray(v)) return v.map(x => clip(x, n));
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    if (s.length <= n) return v; // 未超限：保留原结构，便于回放时按字段访问
    return s.slice(0, n) + `…(${s.length})`; // 超限：截断字符串（诚实/防膨胀）
  }
  return v; // number / boolean 等原样
}

// 把一步规范化为对齐 OpenTelemetry GenAI 语义约定的 span-like 结构。
// 参考: gen_ai.operation.name = execute_tool | invoke_agent(总链路)；gen_ai.tool.name / call.arguments / call.result / error.type。
function normalizeStep(st) {
  const action = st.action != null ? st.action
    : (st.final_answer != null ? '(final_answer)' : null);
  const obs = st.observation || {};
  const isTool = !!action && action !== '(final_answer)' && action !== '(thought)';
  const attrs = { 'gen_ai.operation.name': isTool ? 'execute_tool' : 'agent.step' };
  if (isTool) {
    attrs['gen_ai.tool.name'] = action;
    attrs['gen_ai.tool.call.arguments'] = clip(st.action_input, MAX_ARG);
    if (obs.ok === false) {
      const e = obs.error;
      attrs['error.type'] = (e && typeof e === 'object') ? (e.code || e.name || 'tool_error') : 'tool_error';
    } else {
      attrs['gen_ai.tool.call.result'] = clip(obs.output, MAX_OUT);
    }
  }
  return {
    step: st.step || 0,
    thought: clip(st.thought, MAX_ARG),
    action,
    action_input: clip(st.action_input, MAX_ARG),
    observation: {
      ok: obs.ok,
      error: obs.ok === false ? clip(obs.error, MAX_ERR) : undefined,
      output: obs.ok === false ? undefined : clip(obs.output, MAX_OUT),
    },
    durationMs: typeof st.durationMs === 'number' ? st.durationMs : undefined,
    attrs,
  };
}

export class Tracer {
  /**
   * @param {string} path   轨迹落盘路径（默认 ./.omni-traces.json）
   * @param {object} [opts] { maxRuns=500 } 内存保留的最大 run 数（超出裁尾，防无限膨胀）
   */
  constructor(path = DEFAULT_PATH, opts = {}) {
    this.path = path;
    this.maxRuns = opts.maxRuns || 500;
    this.runs = [];
    this._load();
  }

  _load() {
    try {
      if (existsSync(this.path)) {
        const d = JSON.parse(readFileSync(this.path, 'utf8'));
        this.runs = Array.isArray(d) ? d : (Array.isArray(d.runs) ? d.runs : []);
      }
    } catch {
      this.runs = []; // 损坏则重建，诚实不崩
    }
  }

  // 原子落盘（tmp + rename，规避本环境 rmSync 被安全删除拦截）
  _save() {
    try {
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify(this.runs, null, 2));
      renameSync(tmp, this.path);
    } catch {
      /* 落盘失败静默：追踪不应影响主流程 */
    }
  }

  /**
   * 记录一次 Agent 运行（trace → run → steps）。
   * @param {object} run
   *   runId, goal, engine('llm'|'local'|'dispatcher'|'unknown'),
   *   startedAt, finishedAt, completed, usedLLM, reused, playbookScore,
   *   finalAnswer, steps:[{step,thought,action,action_input,observation,durationMs}], tags, meta
   * @returns {object} 规范化后的 run（含 runId）
   */
  recordRun(run = {}) {
    const started = run.startedAt || Date.now();
    const finished = run.finishedAt || Date.now();
    const steps = Array.isArray(run.steps) ? run.steps.map(normalizeStep) : [];
    const r = {
      runId: run.runId || ('run_' + randomUUID().slice(0, 8)),
      goal: clip(run.goal, MAX_GOAL),
      engine: run.engine || 'unknown',
      startedAt: started,
      finishedAt: finished,
      durationMs: (finished - started) || 0,
      completed: !!run.completed,
      usedLLM: !!run.usedLLM,
      reused: !!run.reused,
      playbookScore: run.playbookScore || 0,
      finalAnswer: clip(run.finalAnswer, MAX_OUT),
      steps,
      tags: Array.isArray(run.tags) ? run.tags.slice() : [],
      meta: run.meta || {},
    };
    this.runs.push(r);
    if (this.runs.length > this.maxRuns) this.runs = this.runs.slice(-this.maxRuns);
    this._save();
    return r;
  }

  /** 按 runId 取一条完整 run（用于回放「模型看见了什么→决定了什么→执行了什么」） */
  getRun(runId) {
    return this.runs.find(r => r.runId === runId) || null;
  }

  /**
   * 列出 run（最新在前）。
   * @param {object} [opts] { limit, engine, completed(bool), tag }
   */
  listRuns(opts = {}) {
    let arr = this.runs.slice();
    if (opts.engine) arr = arr.filter(r => r.engine === opts.engine);
    if (typeof opts.completed === 'boolean') arr = arr.filter(r => r.completed === opts.completed);
    if (opts.tag) arr = arr.filter(r => (r.tags || []).includes(opts.tag));
    arr.reverse();
    if (opts.limit) arr = arr.slice(0, opts.limit);
    return arr;
  }

  /**
   * 聚合观测指标（离线、可测）：成功率、平均步数/耗时、工具级调用/成功/失败/平均耗时、错误归类、引擎分布。
   * 对齐 AWS「Agent 可观测性」关注的维度：响应时间、工具执行时间、错误与异常追踪。
   * 来源: https://aws.amazon.com/cn/blogs/china/agentic-ai-infrastructure-practice-series-7/
   */
  summarize() {
    const runs = this.runs;
    const total = runs.length;
    const completed = runs.filter(r => r.completed).length;
    const totalSteps = runs.reduce((s, r) => s + r.steps.length, 0);
    const avgDurationMs = total
      ? Math.round(runs.reduce((s, r) => s + (r.durationMs || 0), 0) / total)
      : 0;
    const avgSteps = total ? Number((totalSteps / total).toFixed(2)) : 0;

    const tool = {};       // name -> {calls, ok, fail, durSum}
    const errorTools = {}; // name -> 失败次数
    for (const r of runs) {
      for (const s of r.steps) {
        if (!s.action || s.action === '(final_answer)') continue;
        const t = (tool[s.action] ||= { calls: 0, ok: 0, fail: 0, durSum: 0 });
        t.calls++;
        if (s.observation?.ok === false) {
          t.fail++;
          errorTools[s.action] = (errorTools[s.action] || 0) + 1;
        } else {
          t.ok++;
        }
        if (typeof s.durationMs === 'number') t.durSum += s.durationMs;
      }
    }
    const perTool = Object.entries(tool)
      .map(([name, v]) => ({
        tool: name, calls: v.calls, ok: v.ok, fail: v.fail,
        avgMs: v.calls ? Math.round(v.durSum / v.calls) : 0,
      }))
      .sort((a, b) => b.calls - a.calls);

    const engineBreakdown = {};
    for (const r of runs) engineBreakdown[r.engine] = (engineBreakdown[r.engine] || 0) + 1;

    return {
      total, completed,
      successRate: total ? Number((completed / total).toFixed(3)) : 0,
      avgSteps, avgDurationMs, perTool, errorTools, engineBreakdown,
      traceFile: this.path,
    };
  }

  /** 清空全部轨迹（仅本地文件，不影响其他状态） */
  clear() {
    this.runs = [];
    this._save();
    return { cleared: true, count: 0 };
  }
}

export function createTracer(path, opts) {
  return new Tracer(path, opts);
}
