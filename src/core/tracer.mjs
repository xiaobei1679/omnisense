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

// 归一化目标文本（用于"同目标多次运行"检索/对比：忽略大小写与多余空白）
function normGoal(g) {
  return String(g || '').toLowerCase().replace(/\s+/g, ' ').trim();
}
// 目标匹配：精确归一化匹配优先；无果则回退「归一化包含」匹配。
// 让 `trace --find="autopilot:"` 能检索所有 `autopilot: <intent>` 自驱轨迹（可观测性闭环前缀检索），
// 同时保留精确匹配语义（既有「同目标多次运行」回归检索不受影响）。
function matchGoal(runs, ng) {
  if (!ng) return [];
  let arr = runs.filter(r => normGoal(r.goal) === ng);
  if (arr.length === 0) arr = runs.filter(r => normGoal(r.goal).includes(ng));
  return arr;
}
// 一步的稳定动作名（final_answer 归一化）
function stepAction(s) {
  return s.action != null ? s.action
    : (s.final_answer != null ? '(final_answer)' : null);
}
// 一步是否成功
function stepOk(s) {
  const obs = s.observation || {};
  return obs.ok !== false;
}
// 一步的"可比对输出指纹"（成功看 output、失败看 error；统一字符串便于 diff）
function stepOut(s) {
  const obs = s.observation || {};
  if (obs.ok === false) return 'ERROR:' + (obs.error != null ? String(obs.error) : '');
  return JSON.stringify(obs.output ?? null);
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

  /**
   * 回放对比：对比两次运行（同目标或不同时刻），找出行为分歧点。
   * 借鉴 Forkline「first point of divergence」思想：离线、无网络、确定性地定位"行为从第几步开始不一样"。
   *  来源: https://github.com/sauravvenkat/forkline （replay-first tracing & diffing，仅借鉴思想/结构，非代码）
   * @param {string} aId 基线 runId
   * @param {string} bId 当前 runId
   * @returns {object} { ok, a, b, divergenceCount, firstDivergence, divergences[], verdict }
   *   verdict: 'identical' | 'similar' | 'improved' | 'regressed'
   *   divergence type: 'action_changed' | 'success_to_fail' | 'fail_to_success' | 'output_changed' | 'missing_in_a' | 'missing_in_b'
   */
  compareRuns(aId, bId) {
    const A = this.getRun(aId);
    const B = this.getRun(bId);
    if (!A || !B) {
      return { ok: false, error: !A ? `找不到 run ${aId}` : `找不到 run ${bId}`, found: { a: !!A, b: !!B } };
    }
    const aSteps = A.steps || [];
    const bSteps = B.steps || [];
    const n = Math.max(aSteps.length, bSteps.length);
    const divergences = [];
    for (let i = 0; i < n; i++) {
      const a = aSteps[i];
      const b = bSteps[i];
      if (!a && b) { divergences.push({ step: i + 1, type: 'missing_in_a', actionB: stepAction(b) }); continue; }
      if (a && !b) { divergences.push({ step: i + 1, type: 'missing_in_b', actionA: stepAction(a) }); continue; }
      const actA = stepAction(a);
      const actB = stepAction(b);
      if (actA !== actB) { divergences.push({ step: i + 1, type: 'action_changed', actionA: actA, actionB: actB }); continue; }
      const okA = stepOk(a);
      const okB = stepOk(b);
      if (okA && !okB) { divergences.push({ step: i + 1, type: 'success_to_fail', action: actA }); continue; }
      if (!okA && okB) { divergences.push({ step: i + 1, type: 'fail_to_success', action: actA }); continue; }
      if (okA && okB && stepOut(a) !== stepOut(b)) {
        divergences.push({ step: i + 1, type: 'output_changed', action: actA });
      }
    }
    const verdict = divergences.length === 0 ? 'identical'
      : (A.completed && !B.completed) ? 'regressed'
      : (!A.completed && B.completed) ? 'improved'
      : 'similar';
    return {
      ok: true,
      a: { runId: A.runId, goal: A.goal, engine: A.engine, completed: A.completed, durationMs: A.durationMs, stepCount: aSteps.length },
      b: { runId: B.runId, goal: B.goal, engine: B.engine, completed: B.completed, durationMs: B.durationMs, stepCount: bSteps.length },
      divergenceCount: divergences.length,
      firstDivergence: divergences.length ? divergences[0].step : null,
      divergences,
      verdict,
    };
  }

  /**
   * 按目标检索运行（"同目标多次运行"对比的前提）。
   * @param {string} goal @param {object} [opts] { limit }
   * @returns {Array} 精简运行概览（含 runId，供 compareRuns 取用）
   */
  findRunsByGoal(goal, opts = {}) {
    const ng = normGoal(goal);
    if (!ng) return [];
    let arr = matchGoal(this.runs, ng);
    arr.reverse(); // 最新在前
    if (opts.limit) arr = arr.slice(0, opts.limit);
    return arr.map(r => ({
      runId: r.runId, goal: r.goal, engine: r.engine,
      completed: r.completed, durationMs: r.durationMs, stepCount: (r.steps || []).length,
    }));
  }

  /** 公共过滤：按 goal/engine/completed/limit 选 run（最近 N 条）。供 exportDataset / exportOtlp 复用 */
  _filterRuns(opts = {}) {
    let arr = this.runs.slice();
    if (opts.goal) {
      const ng = normGoal(opts.goal);
      arr = matchGoal(arr, ng);
    }
    if (opts.engine) arr = arr.filter(r => r.engine === opts.engine);
    if (typeof opts.completed === 'boolean') arr = arr.filter(r => r.completed === opts.completed);
    if (opts.limit) arr = arr.slice(-opts.limit); // 最近 N 条
    return arr;
  }

  /**
   * 导出回归数据集（对齐 LangSmith「trace → dataset」：把历史/生产 trace 导出为回归基准，
   * 供 CI 反复跑同一目标对比行为是否退化）。离线、本地优先；仅保留结构化结论，不落全量大内容。
   *  来源: https://theneuralbase.com/langsmith/learn/intermediate/setting-up-a-regression-test-suite
   *        https://blog.langchain.com/p/647419d5-fa7e-493f-a997-d81fd0009f7a/ （LangSmith Fetch：从 trace 建回归测试套件，仅借鉴思想）
   * @param {object} [opts] { goal, engine, completed(bool), limit, path, format('json'|'jsonl'|'otlp') }
   *   format='otlp' 时按 OTLP/JSON 导出（详见 exportOtlp），返回 { ok, count, format, path, otlp }。
   * @returns {object} { ok, count, format, path, dataset[] | otlp }
   */
  exportDataset(opts = {}) {
    if (opts.format === 'otlp') return this.exportOtlp(opts);
    const arr = this._filterRuns(opts);
    const dataset = arr.map(r => ({
      runId: r.runId,
      goal: r.goal,
      engine: r.engine,
      completed: r.completed,
      durationMs: r.durationMs,
      finalAnswer: r.finalAnswer,
      steps: (r.steps || []).map(s => ({ step: s.step, action: stepAction(s), ok: stepOk(s), durationMs: s.durationMs })),
      tags: r.tags || [],
    }));
    if (opts.path) {
      const text = opts.format === 'jsonl'
        ? dataset.map(d => JSON.stringify(d)).join('\n') + (dataset.length ? '\n' : '')
        : JSON.stringify(dataset, null, 2);
      writeFileSync(opts.path, text);
    }
    return { ok: true, count: dataset.length, format: opts.format === 'jsonl' ? 'jsonl' : 'json', path: opts.path || null, dataset };
  }

  // ── OTLP/GenAI 可观测性导出（OTel-native，可投递 Grafana Tempo / Phoenix / Jaeger / OTel Collector） ──
  // 借鉴（思想/协议结构，非代码）：
  //   OTLP/HTTP+JSON wire 编码：message body = { resourceSpans:[{ resource, scopeSpans:[{ scope, spans:[...] }] }] }；
  //   每个 span 必填 traceId/spanId/name/kind/startTimeUnixNano/endTimeUnixNano/attributes，非根 span 含 parentSpanId；
  //   时间值为纳秒级 Unix timestamp 字符串，traceId/spanId 为十六进制，kind/status.code 为整数，属性值按类型(stringValue 等)。
  //     来源: https://opentelemetry.io/docs/specs/otlp/#otlphttp （OTLP/HTTP JSON 编码）
  //   GenAI 语义约定：gen_ai.operation.name ∈ { invoke_agent(根), execute_tool(工具步) }、gen_ai.tool.name / call.arguments / call.result / error.type。
  //     来源: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
  //           https://learn.microsoft.com/zh-cn/microsoft-agent-365/developer/direct-open-telemetry-integration
  //           https://greptime.cn/blogs/2026-05-09-opentelemetry-genai-semantic-conventions
  //   一次 run → 一条 trace；run 本身一个 root span(invoke_agent)，每步一个 child span(execute_tool)。

  // FNV-1a 派生确定性 hex（保证同一 runId 每次导出得到同一 traceId/spanId，OTel 可正确重建链路）
  _hashHex(str, len) {
    let s = this._fnv(str);
    while (s.length < len) s += this._fnv(s + '#pad');
    return s.slice(0, len);
  }
  _fnv(str) {
    let h = 0x811c9dc5 >>> 0;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
  }
  _toNano(ms) { return String(Math.round((ms || 0) * 1e6)); }

  /** 把若干 run 转换为 OTLP/JSON 对象（resourceSpans[]） */
  _toOtlp(runs) {
    const resourceSpans = [];
    for (const r of runs) {
      const traceId = this._hashHex(r.runId, 32);
      const rootSpanId = this._hashHex(r.runId + '#root', 16);
      const spans = [];
      let cursor = r.startedAt || 0;
      for (const s of (r.steps || [])) {
        const isTool = !!s.action && s.action !== '(final_answer)' && s.action !== '(thought)';
        const spanId = this._hashHex(r.runId + '#' + (s.step || 0), 16);
        const start = cursor;
        const dur = typeof s.durationMs === 'number' ? s.durationMs : 0;
        const end = start + dur;
        const attrs = [
          { key: 'gen_ai.operation.name', value: { stringValue: isTool ? 'execute_tool' : 'agent.step' } },
        ];
        if (isTool) {
          attrs.push({ key: 'gen_ai.tool.name', value: { stringValue: String(s.action) } });
          if (s.action_input != null) attrs.push({ key: 'gen_ai.tool.call.arguments', value: { stringValue: JSON.stringify(s.action_input).slice(0, MAX_ARG) } });
          const obs = s.observation || {};
          if (obs.ok === false) {
            const e = obs.error;
            const etype = (e && typeof e === 'object') ? (e.code || e.name || 'tool_error') : 'tool_error';
            attrs.push({ key: 'error.type', value: { stringValue: String(etype) } });
            if (obs.error != null) attrs.push({ key: 'error.message', value: { stringValue: String(obs.error).slice(0, MAX_ERR) } });
          } else if (obs.output != null) {
            attrs.push({ key: 'gen_ai.tool.call.result', value: { stringValue: JSON.stringify(obs.output).slice(0, MAX_OUT) } });
          }
        }
        spans.push({
          traceId, spanId, parentSpanId: rootSpanId,
          name: isTool ? String(s.action) : (s.action || 'agent.step'),
          kind: 1, // INTERNAL
          startTimeUnixNano: this._toNano(start),
          endTimeUnixNano: this._toNano(end),
          attributes: attrs,
          events: [],
          status: { code: (s.observation?.ok === false) ? 2 : 1 }, // 2=ERROR, 1=OK
        });
        cursor = end;
      }
      const rootAttrs = [
        { key: 'gen_ai.operation.name', value: { stringValue: 'invoke_agent' } },
        { key: 'gen_ai.agent.description', value: { stringValue: String(r.goal || '').slice(0, MAX_GOAL) } },
        { key: 'gen_ai.agent.engine', value: { stringValue: String(r.engine || 'unknown') } },
        { key: 'gen_ai.response.completed', value: { boolValue: !!r.completed } },
        { key: 'gen_ai.response.used_llm', value: { boolValue: !!r.usedLLM } },
        { key: 'gen_ai.response.final_answer', value: { stringValue: String(r.finalAnswer || '').slice(0, MAX_OUT) } },
      ];
      spans.unshift({
        traceId, spanId: rootSpanId,
        name: 'agent.run:' + (r.goal || r.runId),
        kind: 2, // SERVER
        startTimeUnixNano: this._toNano(r.startedAt),
        endTimeUnixNano: this._toNano(r.finishedAt),
        attributes: rootAttrs,
        events: [],
        status: { code: r.completed ? 1 : 2 },
      });
      resourceSpans.push({
        resource: { attributes: [], droppedAttributesCount: 0 },
        scopeSpans: [{ scope: { name: 'omnisense.tracer', version: '1.0.0' }, spans }],
      });
    }
    return { resourceSpans };
  }

  /**
   * 导出 OTLP/JSON（OTel-native，可对接 Grafana Tempo / Phoenix / Jaeger / OTel Collector 的 /v1/traces）。
   * 离线、本地；与现有 json/jsonl 导出共享同一份过滤逻辑与诚实截断。
   * @param {object} [opts] { goal, engine, completed(bool), limit, path }
   * @returns {object} { ok, count, format:'otlp', path, otlp:{ resourceSpans:[] } }
   */
  exportOtlp(opts = {}) {
    const arr = this._filterRuns(opts);
    const otlp = this._toOtlp(arr);
    if (opts.path) {
      try { writeFileSync(opts.path, JSON.stringify(otlp, null, 2)); } catch { /* 落盘失败静默：导出不应阻断主流程 */ }
    }
    return { ok: true, count: arr.length, format: 'otlp', path: opts.path || null, otlp };
  }

  // ── 基线 / 回归门禁（CI 风：把某次 run 固定为基线，后续 run 与之对比，退化即判 FAIL） ──
  // 借鉴 recut-ai / shadow「行为回归门禁」：对比最新 run 与基线，退化则非零退出。
  //  来源: https://github.com/ksek87/recut-ai · https://pypi.org/project/shadow-diff/ （仅借鉴思想，非代码）
  _baselinePath() { return this.path + '.baseline'; }

  /** 把某次 run 设为基线（落盘 .omni-traces.json.baseline） */
  setBaseline(runId) {
    const run = this.getRun(runId);
    if (!run) return { ok: false, error: `找不到 run ${runId}` };
    const snap = { runId, goal: run.goal, setAt: Date.now() };
    try {
      const tmp = this._baselinePath() + '.tmp';
      writeFileSync(tmp, JSON.stringify(snap, null, 2));
      renameSync(tmp, this._baselinePath());
    } catch { /* 静默：基线失败不应阻断主流程 */ }
    return { ok: true, runId, goal: run.goal };
  }

  /** 读取当前基线（无则 null） */
  getBaseline() {
    try {
      if (existsSync(this._baselinePath())) return JSON.parse(readFileSync(this._baselinePath(), 'utf8'));
    } catch { /* 损坏则视为无基线 */ }
    return null;
  }

  /**
   * 回归门禁：用基线对比"当前最新 run"（或指定 runId）。
   * @returns {object} { ok, passed, baseline, current, verdict, divergenceCount, firstDivergence }
   *   passed = verdict !== 'regressed'
   */
  regressionCheck(opts = {}) {
    const base = this.getBaseline();
    if (!base) return { ok: false, error: '未设置基线（先 trace --baseline=<id> 设置）' };
    const current = opts.runId ? this.getRun(opts.runId) : this.runs[this.runs.length - 1];
    if (!current) return { ok: false, error: '当前无 run 可对比' };
    const diff = this.compareRuns(base.runId, current.runId);
    if (!diff.ok) return { ok: false, error: diff.error };
    return {
      ok: true,
      passed: diff.verdict !== 'regressed',
      baseline: base.runId,
      current: current.runId,
      verdict: diff.verdict,
      divergenceCount: diff.divergenceCount,
      firstDivergence: diff.firstDivergence,
    };
  }
}

export function createTracer(path, opts) {
  return new Tracer(path, opts);
}
