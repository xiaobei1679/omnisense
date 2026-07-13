// 监控器官（Monitor）测试：统一状态快照 / Agent 健康 / 多种状态检测告警 / 可视化仪表盘 / 指标记录
// 全部离线、确定性，用最小 fake omni（bus 桩 + memory/tracer/body 桩）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Monitor } from '../src/modules/monitor.mjs';
import { Body } from '../src/body.mjs';

function fakeMemory() {
  return { layerSnapshot: () => ({ memory: { keys: 2, facts: 1, notes: 3 }, rule: 1, skill: 0, knowledge: 4 }) };
}
function fakeBody() {
  return { describe: () => ([
    { key: 'eye', name: '眼', methods: [{ name: 'seeWebsite' }] },
    { key: 'monitor', name: '监控', methods: [{ name: 'snapshot' }] },
  ]) };
}
function makeTracer(runs = []) {
  return {
    runs,
    findRunsByGoal: (g, o = {}) => runs.filter(r => r.goal && String(r.goal).startsWith('autopilot')).slice(-(o.limit || 5)),
  };
}
function makeOmni(runs = []) {
  return { bus: { register: () => {} }, memory: fakeMemory(), tracer: makeTracer(runs), body: fakeBody() };
}

test('Monitor 构造并注册 6 个总线方法', () => {
  const reg = {};
  const bus = { register: (o, m) => { reg[`${o}.${m}`] = true; } };
  new Monitor(bus, { bus, memory: fakeMemory(), tracer: makeTracer(), body: fakeBody() });
  for (const m of ['snapshot', 'health', 'alerts', 'dashboard', 'recordMetric', 'checkAlerts']) {
    assert.ok(reg[`monitor.${m}`], `应注册 monitor.${m}`);
  }
});

test('snapshot 返回统一结构(状态/器官/记忆/活动/告警)', () => {
  const now = Date.now();
  const omni = makeOmni([
    { runId: 'r1', goal: 'autopilot: x', engine: 'autopilot', completed: true, startedAt: now - 1000, finishedAt: now - 500, steps: [{}] },
  ]);
  const m = new Monitor(omni.bus, omni);
  const s = m.snapshot();
  assert.equal(s.status, 'healthy');
  assert.ok(s.organs.count >= 2, '应含 7+ 器官');
  assert.equal(s.memory.knowledge, 4, '应读到记忆四层快照');
  assert.equal(s.activity.totalRuns, 1);
  assert.equal(s.activity.successRate, 1);
  assert.deepEqual(s.activity.engineBreakdown, { autopilot: 1 });
  assert.equal(s.alerts.length, 0, '单机成功运行不应产生告警');
});

test('checkAlerts: 连续 3 次未完成 -> error(consecutive_failures)', () => {
  const now = Date.now();
  const runs = [0, 1, 2].map(i => ({ runId: 'f' + i, engine: 'autopilot', completed: false, startedAt: now - i * 1000, finishedAt: now - i * 1000 + 500, steps: [] }));
  const m = new Monitor(makeOmni(runs).bus, makeOmni(runs));
  const a = m.checkAlerts();
  assert.ok(a.some(x => x.type === 'consecutive_failures' && x.level === 'error'));
});

test('checkAlerts: 超过 48h 无产出 -> warning(inactive)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [{ runId: 'o1', engine: 'autopilot', completed: true, startedAt: old, finishedAt: old + 500, steps: [] }];
  const m = new Monitor(makeOmni(runs).bus, makeOmni(runs));
  const a = m.checkAlerts();
  assert.ok(a.some(x => x.type === 'inactive' && x.level === 'warning'));
});

test('checkAlerts: 无任何轨迹 -> warning(no_data)', () => {
  const omni = makeOmni([]);
  const m = new Monitor(omni.bus, omni);
  const a = m.checkAlerts();
  assert.ok(a.some(x => x.type === 'no_data'));
});

test('checkAlerts: 近 5 次失败率飙升至基线 2x -> warning(error_rate_spike)', () => {
  const now = Date.now();
  // 基线 10 次：1 失败(0.1)；最近 5 次：4 失败(0.8) -> 0.8 > 0.1*2
  const base = Array.from({ length: 10 }, (_, i) => ({ runId: 'b' + i, engine: 'llm', completed: i !== 0, startedAt: now, finishedAt: now, steps: [] }));
  const recent5 = Array.from({ length: 5 }, (_, i) => ({ runId: 'r' + i, engine: 'llm', completed: i === 0, startedAt: now, finishedAt: now, steps: [] }));
  const runs = [...base, ...recent5];
  const m = new Monitor(makeOmni(runs).bus, makeOmni(runs));
  const a = m.checkAlerts();
  assert.ok(a.some(x => x.type === 'error_rate_spike' && x.level === 'warning'));
});

test('recordMetric 落盘 + checkAlerts 检测连续报错(兼容 health-observer)', async () => {
  const td = mkdtempSync(join(tmpdir(), 'omni-mon-'));
  const metricsFile = join(td, '.metrics.json');
  const omni = makeOmni([]);
  const m = new Monitor(omni.bus, omni, { metricsFile });
  m.recordMetric('agentA', { errors: 2 });
  m.recordMetric('agentA', { errors: 1 });
  m.recordMetric('agentA', { errors: 3 });
  const a = m.checkAlerts('agentA');
  assert.ok(a.some(x => x.type === 'consecutive_errors' && x.agent === 'agentA'));
  // recordMetric 失败：缺 agentId
  const bad = m.recordMetric('', { errors: 1 });
  assert.equal(bad.ok, false);
});

test('agentHealth: 高失败率 -> critical', () => {
  const runs = [0, 1, 2, 3].map(i => ({ runId: 'h' + i, engine: 'llm', completed: i < 1, startedAt: Date.now(), finishedAt: Date.now(), steps: [] }));
  const m = new Monitor(makeOmni(runs).bus, makeOmni(runs));
  const h = m.agentHealth();
  assert.equal(h.status, 'critical');
  assert.equal(h.errorRate, 0.75);
});

test('agentHealth: 全成功 -> healthy', () => {
  const runs = [0, 1].map(i => ({ runId: 'ok' + i, engine: 'llm', completed: true, startedAt: Date.now(), finishedAt: Date.now(), steps: [] }));
  const m = new Monitor(makeOmni(runs).bus, makeOmni(runs));
  assert.equal(m.agentHealth().status, 'healthy');
});

test('renderDashboard 返回自包含 HTML(含状态/器官/记忆/告警标记)', () => {
  const now = Date.now();
  const omni = makeOmni([
    { runId: 'r1', goal: 'autopilot: x', engine: 'autopilot', completed: true, startedAt: now - 1000, finishedAt: now - 500, steps: [{}] },
  ]);
  const m = new Monitor(omni.bus, omni);
  const html = m.renderDashboard();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('OmniSense · 监控仪表盘'));
  assert.ok(html.includes('器官状态'));
  assert.ok(html.includes('记忆状态'));
  assert.ok(html.includes('告警'));
});

test('Body.monitor 委托到 omni.monitor（第 8 器官接线正确）', () => {
  const fake = { monitor: { snapshot: () => ({ ok: true, fromMonitor: true }) } };
  const body = new Body(fake);
  const r = body.monitor('snapshot');
  assert.deepEqual(r, { ok: true, fromMonitor: true });
});
