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
