// Tracer 回放对比 / 回归数据集 / 回归门禁 离线单测（node --test，不触网）
// 借鉴思想（非代码）：Forkline 的 first-divergence 检测、LangSmith trace→dataset、recut-ai/shadow 的行为回归门禁。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Tracer } from '../src/core/tracer.mjs';

function tmpPath(name) {
  const dir = mkdtempSync(join(tmpdir(), 'omni-tracediff-'));
  return join(dir, name);
}

const okStep = (action, output) => ({ step: 1, action, action_input: {}, observation: { ok: true, output }, durationMs: 1 });
const failStep = (action, error) => ({ step: 1, action, action_input: {}, observation: { ok: false, error }, durationMs: 1 });

test('Tracer.compareRuns: 两次运行完全一致 → identical / 0 分歧', () => {
  const tr = new Tracer(tmpPath('ident.json'));
  const a = tr.recordRun({ goal: '计算 2+2', engine: 'local', completed: true, steps: [okStep('calc', { result: 4 })] });
  const b = tr.recordRun({ goal: '计算 2+2', engine: 'local', completed: true, steps: [okStep('calc', { result: 4 })] });
  const r = tr.compareRuns(a.runId, b.runId);
  assert.equal(r.ok, true);
  assert.equal(r.divergenceCount, 0);
  assert.equal(r.firstDivergence, null);
  assert.equal(r.verdict, 'identical');
});

test('Tracer.compareRuns: 检测首次分歧点（action_changed + success_to_fail）', () => {
  const tr = new Tracer(tmpPath('div.json'));
  const a = tr.recordRun({
    goal: 'g', engine: 'local', completed: true,
    steps: [okStep('calc', { result: 4 }), okStep('write_file', { path: 'a' })],
  });
  const b = tr.recordRun({
    goal: 'g', engine: 'local', completed: false,
    steps: [okStep('calc', { result: 4 }), failStep('web_fetch', 'ECONNREFUSED')],
  });
  const r = tr.compareRuns(a.runId, b.runId);
  assert.equal(r.firstDivergence, 2, '首次分歧应在第 2 步');
  const types = r.divergences.map(d => d.type);
  assert.ok(types.includes('action_changed'), '应检测到动作变化');
  // A 完成而 B 未完成 → regressed
  assert.equal(r.verdict, 'regressed');
});

test('Tracer.compareRuns: output_changed 与 missing_in_b 分歧类型', () => {
  const tr = new Tracer(tmpPath('out.json'));
  const a = tr.recordRun({
    goal: 'g', engine: 'local', completed: true,
    steps: [okStep('calc', { result: 4 }), okStep('a2', { x: 1 })],
  });
  const b = tr.recordRun({
    goal: 'g', engine: 'local', completed: true,
    steps: [okStep('calc', { result: 5 })],
  });
  const r = tr.compareRuns(a.runId, b.runId);
  const byType = Object.fromEntries(r.divergences.map(d => [d.type, d]));
  assert.ok(byType.output_changed, 'calc 输出不同应触发 output_changed');
  assert.ok(byType.missing_in_b, 'A 多出的步应触发 missing_in_b');
  assert.equal(r.firstDivergence, 1);
  assert.equal(r.verdict, 'similar'); // 双方都 completed
});

test('Tracer.compareRuns: success_to_fail 与 fail_to_success 判定', () => {
  const tr = new Tracer(tmpPath('sf.json'));
  const s2f = tr.recordRun({
    goal: 'g', engine: 'local', completed: true,
    steps: [okStep('calc', { result: 4 })],
  });
  const f2s = tr.recordRun({
    goal: 'g', engine: 'local', completed: true,
    steps: [failStep('calc', 'x')],
  });
  const r1 = tr.compareRuns(s2f.runId, f2s.runId);
  assert.ok(r1.divergences.some(d => d.type === 'success_to_fail'));

  const f = tr.recordRun({ goal: 'h', engine: 'local', completed: false, steps: [failStep('calc', 'x')] });
  const s = tr.recordRun({ goal: 'h', engine: 'local', completed: true, steps: [okStep('calc', { result: 9 })] });
  const r2 = tr.compareRuns(f.runId, s.runId);
  assert.ok(r2.divergences.some(d => d.type === 'fail_to_success'));
  assert.equal(r2.verdict, 'improved', 'A 未完成而 B 完成 → improved');
});

test('Tracer.findRunsByGoal: 按目标检索同目标多次运行（忽略大小写/空白）', () => {
  const tr = new Tracer(tmpPath('find.json'));
  const a = tr.recordRun({ goal: '计算 2+2', engine: 'local', completed: true, steps: [] });
  const b = tr.recordRun({ goal: '  计算  2+2  ', engine: 'local', completed: true, steps: [] });
  const c = tr.recordRun({ goal: '其他目标', engine: 'local', completed: true, steps: [] });
  const r = tr.findRunsByGoal('计算 2+2');
  assert.equal(r.length, 2, '应找到两条归一化后相同的目标');
  assert.equal(r[0].runId, b.runId, '最新在前');
  assert.ok(!r.some(x => x.runId === c.runId));
});

test('Tracer.exportDataset: 导出回归数据集（数组 + 落盘 JSON）', () => {
  const tr = new Tracer(tmpPath('exp.json'));
  tr.recordRun({ goal: '计算 2+2', engine: 'local', completed: true, steps: [okStep('calc', { result: 4 })] });
  tr.recordRun({ goal: '其他', engine: 'local', completed: false, steps: [failStep('web_fetch', 'x')] });
  const p = tmpPath('dataset.json');
  const r = tr.exportDataset({ path: p, goal: '计算 2+2' });
  assert.equal(r.ok, true);
  assert.equal(r.count, 1, '按目标过滤应只导出 1 条');
  assert.equal(r.format, 'json');
  assert.ok(existsSync(p), '应落盘文件');
  const onDisk = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(onDisk.length, 1);
  assert.equal(onDisk[0].steps[0].action, 'calc');
  assert.equal(onDisk[0].completed, true);
});

test('Tracer 基线/回归门禁: setBaseline + regressionCheck（PASS / FAIL）', () => {
  const tr = new Tracer(tmpPath('base.json'));
  const good = tr.recordRun({ goal: 'g', engine: 'local', completed: true, steps: [okStep('calc', { result: 4 })] });
  const bad = tr.recordRun({ goal: 'g', engine: 'local', completed: false, steps: [failStep('calc', 'x')] });
  // 设 good 为基线
  const set = tr.setBaseline(good.runId);
  assert.equal(set.ok, true);
  assert.ok(tr.getBaseline(), '应能读回基线');
  // 当前指定为 good 自身 → identical → PASS（默认对比最新=bad，故显式传 runId）
  const passCheck = tr.regressionCheck({ runId: good.runId });
  assert.equal(passCheck.ok, true);
  assert.equal(passCheck.passed, true);
  assert.equal(passCheck.verdict, 'identical');
  // 把 bad 设为最新（移除 good 的基线对比对象，直接对 bad 检查）：改设基线为 good，再让 bad 成为"当前最新"
  // 通过临时构造：把基线指向 good，当前取 bad
  tr.setBaseline(good.runId);
  const failCheck = tr.regressionCheck({ runId: bad.runId });
  assert.equal(failCheck.ok, true);
  assert.equal(failCheck.passed, false, 'A 完成而 B 未完成 → 退化 → FAIL');
  assert.equal(failCheck.verdict, 'regressed');
  // 无基线应报错（诚实，不伪造成功）
  const tr2 = new Tracer(tmpPath('base2.json'));
  tr2.recordRun({ goal: 'x', engine: 'local', completed: true, steps: [] });
  const noBase = tr2.regressionCheck();
  assert.equal(noBase.ok, false);
  assert.match(noBase.error, /基线/);
});
