// Tracer 可观测性离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tracer } from '../src/core/tracer.mjs';
import { runAgent } from '../src/core/agent.mjs';
import { Memory } from '../src/core/memory.mjs';

function tmpPath(name) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-trace-'));
  return join(dir, name);
}

test('Tracer: recordRun 落盘并可 getRun / listRuns 回放', () => {
  const p = tmpPath('a.json');
  const tr = new Tracer(p);
  const run = tr.recordRun({
    goal: '计算 2+2',
    engine: 'local',
    completed: true,
    steps: [
      { step: 1, action: 'calc', action_input: { expression: '2+2' }, observation: { ok: true, output: { result: 4 } }, durationMs: 3 },
    ],
  });
  assert.ok(run.runId);
  // 从新实例重新加载，验证真实落盘（非仅内存）
  const tr2 = new Tracer(p);
  const got = tr2.getRun(run.runId);
  assert.ok(got, '应能从磁盘回放该 run');
  assert.equal(got.goal, '计算 2+2');
  assert.equal(got.steps.length, 1);
  assert.equal(got.steps[0].observation.output.result, 4);
  const list = tr2.listRuns();
  assert.equal(list.length, 1);
  assert.equal(list[0].runId, run.runId);
  rmSync(p, { force: true });
});

test('Tracer: findRunsByGoal 精确优先，无果回退「包含」检索（autopilot 前缀可观测性闭环）', () => {
  const p = tmpPath('b.json');
  const tr = new Tracer(p);
  tr.recordRun({ goal: 'autopilot: 思考当前感知并决定下一步该关注什么', engine: 'autopilot', completed: true, steps: [{ step: 1, action: 'brain.think', observation: { ok: true } }] });
  tr.recordRun({ goal: 'autopilot: 把最值得关注的话题记入长期记忆', engine: 'autopilot', completed: true, steps: [{ step: 1, action: 'brain.remember', observation: { ok: true } }] });
  tr.recordRun({ goal: '计算 2+2', engine: 'local', completed: true, steps: [{ step: 1, action: 'calc', observation: { ok: true } }] });
  // 精确匹配仍可用（既有同目标回归检索不受影响）
  const exact = tr.findRunsByGoal('计算 2+2');
  assert.equal(exact.length, 1);
  assert.equal(exact[0].engine, 'local');
  // 前缀/包含检索：'autopilot:' 应命中全部 autopilot 自驱轨迹（可观测性闭环）
  const byPrefix = tr.findRunsByGoal('autopilot:');
  assert.equal(byPrefix.length, 2, '应包含检索命中全部 autopilot 轨迹');
  assert.ok(byPrefix.every(r => r.engine === 'autopilot'));
  // exportDataset 用同一匹配逻辑，--find="autopilot:" 应导出全部自驱轨迹
  const exp = tr.exportDataset({ goal: 'autopilot:', format: 'json' });
  assert.equal(exp.count, 2, '导出目标过滤应与 find 一致');
  rmSync(p, { force: true });
});


test('Tracer: 失败步骤标记 error.type（对齐 OTel GenAI 语义约定）', () => {
  const tr = new Tracer(tmpPath('b.json'));
  const run = tr.recordRun({
    goal: '抓取不存在的站',
    engine: 'local',
    completed: false,
    steps: [
      { step: 1, action: 'web_fetch', action_input: { url: 'http://x' }, observation: { ok: false, error: 'ECONNREFUSED' }, durationMs: 12 },
    ],
  });
  const s = run.steps[0];
  assert.equal(s.observation.ok, false);
  assert.equal(s.attrs['gen_ai.operation.name'], 'execute_tool');
  assert.equal(s.attrs['gen_ai.tool.name'], 'web_fetch');
  assert.equal(s.attrs['gen_ai.tool.call.arguments'].url, 'http://x');
  assert.equal(s.attrs['error.type'], 'tool_error'); // error.type 归类（对象错误也归为 tool_error）
  assert.ok(!('gen_ai.tool.call.result' in s.attrs), '失败步不应写 call.result');
});

test('Tracer: summarize 聚合成功率/平均步数与工具级耗时', () => {
  const tr = new Tracer(tmpPath('c.json'));
  tr.recordRun({
    goal: 'g1', engine: 'local', completed: true,
    steps: [
      { step: 1, action: 'calc', action_input: {}, observation: { ok: true, output: { result: 4 } }, durationMs: 5 },
      { step: 2, action: 'write_file', action_input: {}, observation: { ok: true, output: { path: 'a' } }, durationMs: 7 },
    ],
  });
  tr.recordRun({
    goal: 'g2', engine: 'local', completed: false,
    steps: [
      { step: 1, action: 'web_fetch', action_input: {}, observation: { ok: false, error: 'x' }, durationMs: 20 },
    ],
  });
  const s = tr.summarize();
  assert.equal(s.total, 2);
  assert.equal(s.completed, 1);
  assert.equal(s.successRate, 0.5);
  assert.equal(s.avgSteps, 1.5);
  const calc = s.perTool.find(t => t.tool === 'calc');
  assert.ok(calc, '应按工具聚合');
  assert.equal(calc.calls, 1);
  assert.equal(calc.avgMs, 5);
  assert.equal(s.errorTools.web_fetch, 1);
  assert.equal(s.engineBreakdown.local, 2);
});

test('Tracer: 长文本截断（诚实/隐私，默认不落全量大内容）', () => {
  const big = 'x'.repeat(5000);
  const tr = new Tracer(tmpPath('d.json'));
  const run = tr.recordRun({ goal: big, engine: 'local', completed: true, steps: [
    { step: 1, action: 'calc', action_input: { expression: big }, observation: { ok: true, output: { result: big } }, durationMs: 1 },
  ] });
  // 截断后缀「…(N)」会略增长度，断言落在合理上限内（远小于原始 5000）
  assert.ok(run.goal.length <= 2100, 'goal 应被截断');
  assert.ok(JSON.stringify(run.steps[0].action_input).length <= 2100, '参数应被截断');
  assert.ok(JSON.stringify(run.steps[0].observation.output).length <= 2100, '输出应被截断');
});

test('Tracer: clear 清空轨迹', () => {
  const p = tmpPath('e.json');
  const tr = new Tracer(p);
  tr.recordRun({ goal: 'g', engine: 'local', completed: true, steps: [] });
  assert.equal(tr.listRuns().length, 1);
  tr.clear();
  assert.equal(tr.listRuns().length, 0);
  // 落盘也应清空
  const tr2 = new Tracer(p);
  assert.equal(tr2.listRuns().length, 0);
  rmSync(p, { force: true });
});

test('Tracer 集成 runAgent：本地规划器完成目标后自动记录 trace（engine=local）', async () => {
  const p = tmpPath('f.json');
  const omni = {
    memory: new Memory(tmpPath('mem.json')),
    tracer: new Tracer(p),
  };
  const r = await runAgent(omni, { goal: '计算 2+2', useLLM: false });
  assert.equal(r.completed, true);
  const runs = omni.tracer.listRuns();
  assert.equal(runs.length, 1, '应记录一条 run');
  const run = runs[0];
  assert.equal(run.engine, 'local');
  assert.equal(run.completed, true);
  assert.ok(run.steps.some(s => s.action === 'calc'), '轨迹应包含 calc 步骤');
  assert.ok(typeof run.steps[0].durationMs === 'number', '步骤应带耗时');
  rmSync(p, { force: true });
});

test('Tracer: exportOtlp 输出合法 OTLP/JSON（OTel-native，可投 Grafana Tempo/Phoenix/Jaeger）', () => {
  const tr = new Tracer(tmpPath('otlp-ok.json'));
  const run = tr.recordRun({
    goal: '计算 2+2', engine: 'local', completed: true, startedAt: 1000, finishedAt: 1010,
    steps: [
      { step: 1, action: 'calc', action_input: { expression: '2+2' }, observation: { ok: true, output: { result: 4 } }, durationMs: 4 },
    ],
  });
  const r = tr.exportOtlp();
  assert.equal(r.format, 'otlp');
  assert.equal(r.count, 1);
  assert.ok(r.otlp && Array.isArray(r.otlp.resourceSpans), '应含 resourceSpans[]');
  const rs = r.otlp.resourceSpans[0];
  assert.ok(Array.isArray(rs.scopeSpans) && rs.scopeSpans.length === 1, '应含 scopeSpans[]');
  const spans = rs.scopeSpans[0].spans;
  assert.equal(spans.length, 2, 'root(invoke_agent) + 1 步(execute_tool)');
  // traceId/spanId 为合法 hex
  const hex32 = /^[0-9a-f]{32}$/; const hex16 = /^[0-9a-f]{16}$/;
  for (const sp of spans) {
    assert.ok(hex32.test(sp.traceId), 'traceId 应为 32 位 hex');
    assert.ok(hex16.test(sp.spanId), 'spanId 应为 16 位 hex');
    assert.ok(/^\d+$/.test(sp.startTimeUnixNano) && /^\d+$/.test(sp.endTimeUnixNano), '时间戳应为纳秒字符串');
  }
  const root = spans.find(s => s.parentSpanId === undefined);
  const child = spans.find(s => s.parentSpanId !== undefined);
  assert.ok(root && child, '应有一个 root 与至少一个 child，且 child 带 parentSpanId');
  assert.equal(root.attributes.find(a => a.key === 'gen_ai.operation.name').value.stringValue, 'invoke_agent');
  assert.equal(root.status.code, 1, '完成 run 的 root span 应 status.code=1(OK)');
  assert.equal(child.attributes.find(a => a.key === 'gen_ai.operation.name').value.stringValue, 'execute_tool');
  assert.equal(child.attributes.find(a => a.key === 'gen_ai.tool.name').value.stringValue, 'calc');
  assert.ok(child.attributes.find(a => a.key === 'gen_ai.tool.call.result'), '成功步应写 call.result');
  assert.ok(!child.attributes.some(a => a.key === 'error.type'), '成功步不应有 error.type');
  // 确定性：同一 runId 导出得到同一 traceId
  const r2 = tr.exportOtlp();
  assert.equal(r2.otlp.resourceSpans[0].scopeSpans[0].spans[0].traceId, root.traceId, 'traceId 应确定性可重建');
  rmSync(tmpPath('otlp-ok.json'), { force: true });
});

test('Tracer: exportOtlp 失败步标记 error.type 且 status.code=2（对齐 OTel status）', () => {
  const tr = new Tracer(tmpPath('otlp-fail.json'));
  tr.recordRun({
    goal: '抓取坏站', engine: 'local', completed: false, startedAt: 2000, finishedAt: 2030,
    steps: [
      { step: 1, action: 'web_fetch', action_input: { url: 'http://x' }, observation: { ok: false, error: 'ECONNREFUSED' }, durationMs: 20 },
    ],
  });
  const spans = tr.exportOtlp().otlp.resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find(s => s.parentSpanId === undefined);
  const child = spans.find(s => s.parentSpanId !== undefined);
  assert.equal(root.status.code, 2, '未完成 run 的 root span 应 status.code=2(ERROR)');
  assert.equal(child.status.code, 2, '失败步应 status.code=2(ERROR)');
  assert.equal(child.attributes.find(a => a.key === 'error.type').value.stringValue, 'tool_error');
  assert.ok(!child.attributes.some(a => a.key === 'gen_ai.tool.call.result'), '失败步不应写 call.result');
  rmSync(tmpPath('otlp-fail.json'), { force: true });
});

test('Tracer: exportDataset(format:"otlp") 委托到 OTLP 导出（单一 CLI 路径）', () => {
  const tr = new Tracer(tmpPath('otlp-del.json'));
  tr.recordRun({ goal: 'g', engine: 'local', completed: true, steps: [] });
  const r = tr.exportDataset({ format: 'otlp' });
  assert.equal(r.format, 'otlp');
  assert.ok(r.otlp && r.otlp.resourceSpans.length === 1, '应返回 OTLP 结构');
  rmSync(tmpPath('otlp-del.json'), { force: true });
});

test('Tracer: exportOtlp 为每个 span 注入 OTel GenAI span events（user/assistant/tool/exception）', () => {
  const tr = new Tracer(tmpPath('otlp-events.json'));
  tr.recordRun({
    goal: '帮我查天气并算温差', engine: 'local', completed: true,
    finalAnswer: '温差 8 度', startedAt: 1000, finishedAt: 1030,
    steps: [
      { step: 1, action: 'web_fetch', thought: '先抓天气页', action_input: { url: 'http://w' }, observation: { ok: true, output: { temp: 20 } }, durationMs: 10 },
      { step: 2, action: 'calc', thought: '算温差', action_input: { expression: '28-20' }, observation: { ok: true, output: { result: 8 } }, durationMs: 4 },
    ],
  });
  const spans = tr.exportOtlp().otlp.resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find(s => s.parentSpanId === undefined);
  const childWeb = spans.find(s => s.attributes.some(a => a.key === 'gen_ai.tool.name' && a.value.stringValue === 'web_fetch'));
  const childCalc = spans.find(s => s.attributes.some(a => a.key === 'gen_ai.tool.name' && a.value.stringValue === 'calc'));
  assert.ok(root && childWeb && childCalc, '应含 root 与两个工具 child span');

  const evName = (sp, name) => sp.events.find(e => e.name === name);
  const evAttr = (e, k) => e?.attributes.find(a => a.key === k)?.value?.stringValue;

  // root：用户请求 + 最终答案
  assert.ok(evName(root, 'gen_ai.user.message'), 'root 应含 gen_ai.user.message 事件');
  assert.equal(evAttr(evName(root, 'gen_ai.user.message'), 'gen_ai.prompt.content'), '帮我查天气并算温差');
  assert.ok(evName(root, 'gen_ai.assistant.message'), 'root 应含 gen_ai.assistant.message 事件(最终答案)');
  assert.equal(evAttr(evName(root, 'gen_ai.assistant.message'), 'gen_ai.completion.content'), '温差 8 度');
  // root 完成态不应有 exception 事件
  assert.ok(!evName(root, 'exception'), '已完成 run 的 root 不应有 exception 事件');

  // 工具 child：思考(assistant.message) + 工具结果(tool.message) + 关联 call.id
  assert.ok(evName(childWeb, 'gen_ai.assistant.message'), '工具 span 应含思考事件');
  assert.equal(evAttr(evName(childWeb, 'gen_ai.assistant.message'), 'gen_ai.completion.content'), '先抓天气页');
  assert.ok(evName(childWeb, 'gen_ai.tool.message'), '工具 span 应含 gen_ai.tool.message 事件');
  assert.equal(evAttr(evName(childWeb, 'gen_ai.tool.message'), 'gen_ai.tool.message'), JSON.stringify({ temp: 20 }));
  // 工具调用关联 id（对齐 gen_ai.tool.call.id，便于与模型响应关联）
  const callId = childWeb.attributes.find(a => a.key === 'gen_ai.tool.call.id');
  assert.ok(callId, '工具 span 应含 gen_ai.tool.call.id 属性');
  assert.ok(/^call_/.test(callId.value.stringValue), 'gen_ai.tool.call.id 应以 call_ 开头');

  // 每个事件都应符合 OTLP 形状：timeUnixNano 数字串 + name + 非空 attributes
  for (const sp of spans) {
    assert.ok(Array.isArray(sp.events) && sp.events.length >= 1, `span ${sp.name} 应至少含 1 个事件`);
    for (const e of sp.events) {
      assert.ok(/^\d+$/.test(e.timeUnixNano), '事件 timeUnixNano 应为纳秒数字串');
      assert.ok(typeof e.name === 'string' && e.name.length > 0, '事件应有 name');
      assert.ok(Array.isArray(e.attributes) && e.attributes.length >= 1, '事件应含 attributes');
    }
  }
  rmSync(tmpPath('otlp-events.json'), { force: true });
});

test('Tracer: exportOtlp 失败步注入 exception 事件 + 未完成 run 的 root 注入 agent_run_incomplete 异常', () => {
  const tr = new Tracer(tmpPath('otlp-exc.json'));
  tr.recordRun({
    goal: '抓坏站', engine: 'local', completed: false,
    finalAnswer: '未完成', startedAt: 2000, finishedAt: 2030,
    steps: [
      { step: 1, action: 'web_fetch', action_input: { url: 'http://x' }, observation: { ok: false, error: 'ECONNREFUSED' }, durationMs: 20 },
    ],
  });
  const spans = tr.exportOtlp().otlp.resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find(s => s.parentSpanId === undefined);
  const child = spans.find(s => s.parentSpanId !== undefined);
  const evName = (sp, name) => sp.events.find(e => e.name === name);
  const evAttr = (e, k) => e?.attributes.find(a => a.key === k)?.value?.stringValue;

  // 失败步：exception 事件（对齐 OTel exception 约定）
  assert.ok(evName(child, 'exception'), '失败步应含 exception 事件');
  assert.equal(evAttr(evName(child, 'exception'), 'exception.type'), 'tool_error');
  assert.equal(evAttr(evName(child, 'exception'), 'exception.message'), 'ECONNREFUSED');
  assert.equal(evAttr(evName(child, 'exception'), 'exception.escaped'), 'false');
  // 工具结果事件即便失败也携带错误信息（便于 root-cause）
  assert.ok(evName(child, 'gen_ai.tool.message'), '失败步仍应有 tool.message 事件');
  assert.equal(evAttr(evName(child, 'gen_ai.tool.message'), 'gen_ai.tool.message'), 'ECONNREFUSED');

  // 未完成 run：root 注入 agent_run_incomplete 异常事件
  assert.ok(evName(root, 'exception'), '未完成 run 的 root 应含 exception 事件');
  assert.equal(evAttr(evName(root, 'exception'), 'exception.type'), 'agent_run_incomplete');
  assert.equal(evAttr(evName(root, 'exception'), 'exception.escaped'), 'false');
  rmSync(tmpPath('otlp-exc.json'), { force: true });
});
