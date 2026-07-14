// 监控器官（Monitor）测试：统一状态快照 / Agent 健康 / 多种状态检测告警 / 可视化仪表盘 / 指标记录
// 全部离线、确定性，用最小 fake omni（bus 桩 + memory/tracer/body 桩）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Monitor } from '../src/modules/monitor.mjs';
import { Body } from '../src/body.mjs';

const TD = mkdtempSync(join(tmpdir(), 'omni-mon-'));

function fakeMemory() {
  return { layerSnapshot: () => ({ memory: { keys: 2, facts: 1, notes: 3 }, rule: 1, skill: 0, knowledge: 4 }) };
}
function richMemory() {
  const now = Date.now();
  return {
    layerSnapshot: () => ({ memory: { keys: 10, facts: 5, notes: 3 }, rule: 2, skill: 4, knowledge: 3 }),
    store: Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['k' + i, 'v' + i])),
    facts: [{ subj: 'a', rel: 'r', obj: 'b', source: 'x' }],
    notes: [{ t: now - 1000, tag: 't', text: 'recent note' }],
    skills: [
      { id: 's1', hitCount: 3, at: now },
      { id: 's2', hitCount: 0, at: now - 10 * 86400000 },
      { id: 's3', hitCount: 1, at: now },
      { id: 's4', hitCount: 0, at: now },
    ],
    knowledge: [
      { id: 'k1', confidence: 0.9, at: now },
      { id: 'k2', confidence: 0.3, at: now - 10 * 86400000 },
      { id: 'k3', confidence: 0.7, at: now },
    ],
  };
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
function makeOmni(runs = [], memory) {
  return { bus: { register: () => {} }, memory: memory || fakeMemory(), tracer: makeTracer(runs), body: fakeBody() };
}
function mkMon(runs = [], memory) {
  const omni = makeOmni(runs, memory);
  return new Monitor(omni.bus, omni, { metricsFile: join(TD, `m-${Math.random().toString(36).slice(2)}.json`) });
}

test('Monitor 构造并注册 15 个总线方法(核心 6 + 新增 9)', () => {
  const reg = {};
  const bus = { register: (o, m) => { reg[`${o}.${m}`] = true; } };
  const omni = { bus, memory: fakeMemory(), tracer: makeTracer(), body: fakeBody() };
  new Monitor(bus, omni, { metricsFile: join(TD, 'reg.json') });
  for (const m of ['snapshot', 'health', 'alerts', 'dashboard', 'recordMetric', 'checkAlerts',
    'latency', 'statusGrid', 'memoryHealth', 'anomalies', 'recentRuns', 'toolHealth', 'trends', 'trendAnomalies', 'config']) {
    assert.ok(reg[`monitor.${m}`], `应注册 monitor.${m}`);
  }
});

test('snapshot 返回统一结构(状态/器官/记忆/活动/告警)', () => {
  const now = Date.now();
  const m = mkMon([
    { runId: 'r1', goal: 'autopilot: x', engine: 'autopilot', completed: true, startedAt: now - 1000, finishedAt: now - 500, steps: [{}] },
  ]);
  const s = m.snapshot();
  assert.equal(s.status, 'healthy');
  assert.ok(s.organs.count >= 2, '应含 7+ 器官');
  assert.equal(s.memory.knowledge, 4, '应读到记忆四层快照');
  assert.equal(s.activity.totalRuns, 1);
  assert.equal(s.activity.successRate, 1);
  assert.deepEqual(s.activity.engineBreakdown, { autopilot: 1 });
  assert.equal(s.alerts.length, 0, '单机成功运行不应产生告警');
});

test('snapshot 新增：延迟/状态网格/记忆健康/时间线/异常 字段齐全', () => {
  const now = Date.now();
  const m = mkMon([
    { runId: 'r1', engine: 'autopilot', completed: true, startedAt: now - 1000, finishedAt: now - 500, durationMs: 120, steps: [{}] },
    { runId: 'r2', engine: 'llm', completed: false, startedAt: now - 800, finishedAt: now - 400, durationMs: 300, steps: [{}] },
  ]);
  const s = m.snapshot();
  assert.ok(s.latency && typeof s.latency.p50 !== 'undefined', '应有延迟指标');
  assert.ok(s.statusGrid && Array.isArray(s.statusGrid.grid), '应有状态网格');
  assert.ok(s.memoryHealth, '应有记忆健康');
  assert.ok(s.toolHealth && s.toolHealth.ok === true, '应有工具管线健康');
  assert.ok(Array.isArray(s.recentRuns) && s.recentRuns.length >= 1, '应有运行时间线');
  assert.ok(Array.isArray(s.anomalies), '应有异常检测数组');
});

test('checkAlerts: 连续 3 次未完成 -> error(consecutive_failures)', () => {
  const now = Date.now();
  const runs = [0, 1, 2].map(i => ({ runId: 'f' + i, engine: 'autopilot', completed: false, startedAt: now - i * 1000, finishedAt: now - i * 1000 + 500, steps: [] }));
  const a = mkMon(runs).checkAlerts();
  assert.ok(a.some(x => x.type === 'consecutive_failures' && x.level === 'error'));
});

test('checkAlerts: 超过 48h 无产出 -> warning(inactive)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [{ runId: 'o1', engine: 'autopilot', completed: true, startedAt: old, finishedAt: old + 500, steps: [] }];
  const a = mkMon(runs).checkAlerts();
  assert.ok(a.some(x => x.type === 'inactive' && x.level === 'warning'));
});

test('checkAlerts: 无任何轨迹 -> warning(no_data)', () => {
  const a = mkMon([]).checkAlerts();
  assert.ok(a.some(x => x.type === 'no_data'));
});

test('checkAlerts: 近 5 次失败率飙升至基线 2x -> warning(error_rate_spike)', () => {
  const now = Date.now();
  const base = Array.from({ length: 10 }, (_, i) => ({ runId: 'b' + i, engine: 'llm', completed: i !== 0, startedAt: now, finishedAt: now, steps: [] }));
  const recent5 = Array.from({ length: 5 }, (_, i) => ({ runId: 'r' + i, engine: 'llm', completed: i === 0, startedAt: now, finishedAt: now, steps: [] }));
  const a = mkMon([...base, ...recent5]).checkAlerts();
  assert.ok(a.some(x => x.type === 'error_rate_spike' && x.level === 'warning'));
});

test('recordMetric 落盘 + checkAlerts 检测连续报错(兼容 health-observer)', async () => {
  const td = mkdtempSync(join(tmpdir(), 'omni-mon-'));
  const metricsFile = join(td, '.metrics.json');
  const m = mkMon([], fakeMemory());
  m.metricsFile = metricsFile;
  m.recordMetric('agentA', { errors: 2 });
  m.recordMetric('agentA', { errors: 1 });
  m.recordMetric('agentA', { errors: 3 });
  const a = m.checkAlerts('agentA');
  assert.ok(a.some(x => x.type === 'consecutive_errors' && x.agent === 'agentA'));
  const bad = m.recordMetric('', { errors: 1 });
  assert.equal(bad.ok, false);
});

test('agentHealth: 高失败率 -> critical', () => {
  const runs = [0, 1, 2, 3].map(i => ({ runId: 'h' + i, engine: 'llm', completed: i < 1, startedAt: Date.now(), finishedAt: Date.now(), steps: [] }));
  assert.equal(mkMon(runs).agentHealth().status, 'critical');
});

test('agentHealth: 全成功 -> healthy', () => {
  const runs = [0, 1].map(i => ({ runId: 'ok' + i, engine: 'llm', completed: true, startedAt: Date.now(), finishedAt: Date.now(), steps: [] }));
  assert.equal(mkMon(runs).agentHealth().status, 'healthy');
});

test('latencyStats 计算 P50/P95/P99 与按引擎分布', () => {
  const now = Date.now();
  const runs = [
    { engine: 'llm', durationMs: 100, startedAt: now, finishedAt: now },
    { engine: 'llm', durationMs: 200, startedAt: now, finishedAt: now },
    { engine: 'llm', durationMs: 300, startedAt: now, finishedAt: now },
    { engine: 'autopilot', durationMs: 50, startedAt: now, finishedAt: now },
  ];
  const lat = mkMon(runs).latencyStats(runs);
  assert.equal(lat.count, 4);
  assert.equal(lat.p50, 100);     // 排序 [50,100,200,300]，p50 idx=ceil(0.5*4)-1=1 -> 100
  assert.equal(lat.p95, 300);
  assert.ok(lat.byEngine.llm && lat.byEngine.llm.count === 3);
});

test('statusGrid 引擎颜色化健康(错误率/最后活跃)', () => {
  const now = Date.now();
  // llm 全失败且刚活跃 -> critical；autopilot 全成功且 2h 前 -> degraded(存活降级)
  const runs = [
    { engine: 'llm', completed: false, startedAt: now - 1000, finishedAt: now - 500 },
    { engine: 'llm', completed: false, startedAt: now - 800, finishedAt: now - 400 },
    { engine: 'autopilot', completed: true, startedAt: now - 2 * 3600000, finishedAt: now - 2 * 3600000 + 100 },
  ];
  const grid = mkMon(runs).statusGrid(runs);
  const llm = grid.grid.find(g => g.engine === 'llm');
  const auto = grid.grid.find(g => g.engine === 'autopilot');
  assert.equal(llm.status, 'critical');
  assert.equal(auto.status, 'degraded');
  assert.equal(grid.fleet.down >= 1, true);
});

test('memoryHealth 记忆专属指标(技能利用率/信任分/陈旧/增长)', () => {
  const m = mkMon([], richMemory()).memoryHealth();
  assert.equal(m.layers.knowledge, 3);
  assert.equal(m.skillUtilization, 0.5, '4 个技能中 2 个有命中');
  assert.ok(Math.abs(m.avgConfidence - 0.63) < 0.01, '平均信任分 (0.9+0.3+0.7)/3');
  assert.equal(m.lowConfidence, 1, '1 条低信任(<0.5)');
  assert.equal(m.staleCount, 2, '1 陈旧知识 + 1 陈旧技能');
});

test('detectAnomalies: 延迟突增 -> duration_spike', () => {
  const now = Date.now();
  const runs = [];
  // 基线 10 条短延迟(老)
  for (let i = 0; i < 10; i++) runs.push({ engine: 'llm', completed: true, durationMs: 50, startedAt: now - 100000, finishedAt: now - 99000 });
  // 近 10 条长延迟(老，但近窗口)
  for (let i = 0; i < 10; i++) runs.push({ engine: 'llm', completed: true, durationMs: 2000, startedAt: now - 1000, finishedAt: now - 500 });
  const a = mkMon(runs).detectAnomalies();
  assert.ok(a.some(x => x.type === 'duration_spike'), '应检出延迟突增');
});

test('detectAnomalies: 记忆批量注入 -> memory_bulk_injection', () => {
  const m = mkMon([], {
    layerSnapshot: () => ({ memory: { keys: 50, facts: 0, notes: 0 }, rule: 0, skill: 0, knowledge: 0 }),
  });
  m._anomalyBase = { memory: 0, rule: 0, skill: 0, knowledge: 0 };
  const a = m.detectAnomalies();
  assert.ok(a.some(x => x.type === 'memory_bulk_injection'), '应检出记忆批量注入');
});

test('toolHealth 返回缓存/熔断/工具级延迟分布(P50/P95/P99)', () => {
  const now = Date.now();
  const runs = [
    { engine: 'llm', completed: true, startedAt: now, finishedAt: now, steps: [
      { action: 'web_fetch', durationMs: 100 },
      { action: 'web_fetch', durationMs: 300 },
      { action: 'calc', durationMs: 5 },
    ] },
    { engine: 'llm', completed: true, startedAt: now, finishedAt: now, steps: [
      { action: 'web_fetch', durationMs: 200 },
      { action: 'calc', durationMs: 7 },
    ] },
  ];
  const m = mkMon(runs);
  m.omni.toolCacheStats = () => ({ size: 2, keys: ['web_fetch::x', 'hot_topics::y'] });
  m.omni.toolBreakerStatus = () => [{ name: 'web_fetch', open: false, fails: 1, maxFails: 3 }];
  const th = m.toolHealth();
  assert.equal(th.ok, true);
  assert.equal(th.cache.size, 2);
  assert.equal(th.openCircuits, 0, '无开启熔断器');
  assert.ok(th.toolLatency.web_fetch, 'web_fetch 应有延迟分布');
  // web_fetch durations [100,300,200] 排序 [100,200,300] -> p50=200, p95=300, p99=300
  assert.equal(th.toolLatency.web_fetch.count, 3);
  assert.equal(th.toolLatency.web_fetch.p50, 200);
  assert.equal(th.toolLatency.web_fetch.p95, 300);
  assert.equal(th.toolLatency.calc.count, 2, 'calc 应有 2 次调用');
});

test('detectAnomalies: 工具熔断器开启 -> circuit_open(工具管线降级信号)', () => {
  const m = mkMon([]);
  m.omni.toolBreakerStatus = () => [{ name: 'web_fetch', open: true, fails: 3, maxFails: 3 }];
  const a = m.detectAnomalies();
  assert.ok(a.some(x => x.type === 'circuit_open' && x.level === 'warning' && x.agent === 'tool:web_fetch'), '应检出熔断开启');
});

test('trends: 多次快照累积时间序列点并捕获 P95/成功率/记忆总量 + 生成 sparkline', () => {
  const now = Date.now();
  const m = mkMon([
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now, durationMs: 100, steps: [] },
    { runId: 'r2', engine: 'llm', completed: true, startedAt: now, finishedAt: now, durationMs: 300, steps: [] },
  ], fakeMemory());
  m.snapshot();
  m.snapshot();
  const t = m.trends();
  assert.ok(t.count >= 2, '应累积 ≥2 个趋势点');
  assert.ok(t.series.p95.every(v => typeof v === 'number'), 'p95 序列应为数值');
  assert.equal(t.last.p95, 300, '最新点 p95 应反映最近一次快照');
  assert.ok(t.sparkline && typeof t.sparkline.p95 === 'string' && t.sparkline.p95.includes('<svg'), 'p95 应生成 sparkline SVG');
  assert.ok(typeof t.sparkline.successRate === 'string' && t.sparkline.successRate.includes('<svg'), '成功率应生成 sparkline SVG');
});

test('snapshot 返回 trend 趋势字段(含 count/last/series)，且趋势点随快照跨进程持久化', () => {
  const m = mkMon([], fakeMemory());
  m.snapshot();
  m.snapshot();
  const s = m.snapshot();
  assert.ok(s.trend && typeof s.trend.count === 'number' && s.trend.count >= 3, 'snapshot 应内嵌 trend 且累积 ≥3 点');
  assert.ok(Array.isArray(s.trend.series.p95), 'trend.series.p95 应为数组');
  // 跨进程：用同指标文件新建 Monitor，应重载出历史趋势点
  const m2 = new Monitor({ register: () => {} }, makeOmni([], fakeMemory()), { metricsFile: m.metricsFile });
  assert.ok(m2.trends().count >= 3, '新建 Monitor 应从指标文件重载历史趋势点');
});

test('renderDashboard 返回自包含 HTML(含状态/器官/记忆/告警 + 新区块)', () => {
  const now = Date.now();
  const m = mkMon([
    { runId: 'r1', goal: 'autopilot: x', engine: 'autopilot', completed: true, startedAt: now - 1000, finishedAt: now - 500, durationMs: 120, steps: [{}] },
  ]);
  const html = m.renderDashboard();
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('OmniSense · 监控仪表盘'));
  assert.ok(html.includes('器官状态'));
  assert.ok(html.includes('记忆状态'));
  assert.ok(html.includes('告警'));
  assert.ok(html.includes('舰队健康'), '应有状态网格区块');
  assert.ok(html.includes('延迟指标'), '应有延迟区块');
  assert.ok(html.includes('运行时间线'), '应有运行时间线区块');
  assert.ok(html.includes('工具管线健康'), '应有工具管线健康区块');
  assert.ok(html.includes('趋势 / Trends'), '应有趋势基线区块');
  assert.ok(html.includes('<svg'), '趋势区块应含 sparkline');
});

test('_detectTrendAnomalies: P95 持续上升触发 trend_regression', () => {
  const m = mkMon([]);
  // 模拟 8 个趋势点：P95 从 100 逐步上升到 500（每点 +57ms 爬坡）
  for (let i = 0; i < 8; i++) {
    m._trendPoints.push({ p95: 100 + i * 57, successRate: 0.95, memTotal: 20, fleetHealthy: 3 });
  }
  const a = m._detectTrendAnomalies();
  assert.ok(a.some(x => x.type === 'trend_regression' && x.agent === 'latency'),
    'P95 爬坡应触发 trend_regression');
});

test('_detectTrendAnomalies: 成功率下降触发 trend_drift', () => {
  const m = mkMon([]);
  // 模拟 6 个趋势点：成功率从 0.95 逐步降至 0.70
  for (let i = 0; i < 6; i++) {
    m._trendPoints.push({ p95: 200, successRate: 0.95 - i * 0.05, memTotal: 20, fleetHealthy: 3 });
  }
  const a = m._detectTrendAnomalies();
  assert.ok(a.some(x => x.type === 'trend_drift' && x.agent === 'quality'),
    '成功率下降应触发 trend_drift');
});

test('_detectTrendAnomalies: 记忆快速增长触发 trend_pre_warning', () => {
  const m = mkMon([]);
  // 模拟 5 个趋势点：记忆总量从 20 激增到 200
  for (let i = 0; i < 5; i++) {
    m._trendPoints.push({ p95: 200, successRate: 0.95, memTotal: 20 + i * 45, fleetHealthy: 3 });
  }
  const a = m._detectTrendAnomalies();
  assert.ok(a.some(x => x.type === 'trend_pre_warning' && x.agent === 'memory'),
    '记忆快速增长应触发 trend_pre_warning');
});

test('_detectTrendAnomalies: 不足 4 点返回空数组', () => {
  const m = mkMon([]);
  m._trendPoints.push({ p95: 100, successRate: 0.95, memTotal: 20 });
  m._trendPoints.push({ p95: 120, successRate: 0.90, memTotal: 25 });
  m._trendPoints.push({ p95: 110, successRate: 0.92, memTotal: 22 });
  assert.equal(m._detectTrendAnomalies().length, 0, '3 点不足以检测趋势');
});

test('detectAnomalies 集成趋势退化去重：相同 type+agent 只保留一条', () => {
  const m = mkMon([]);
  // 同时触发生成 trend_regression(latency) 和 trend_drift(quality)
  for (let i = 0; i < 6; i++) {
    m._trendPoints.push({ p95: 100 + i * 60, successRate: 0.95 - i * 0.05, memTotal: 20, fleetHealthy: 3 });
  }
  const a = m.detectAnomalies();
  const types = a.map(x => x.type);
  // 不应有重复的 type+agent
  const seen = new Set();
  for (const t of types) {
    assert.ok(!seen.has(t), `不应有重复异常类型: ${t}`);
    seen.add(t);
  }
});

test('config: 无 env/opts 时全部返回默认值且 source=default', () => {
  const m = mkMon([]);
  const c = m.config();
  assert.equal(c.ok, true);
  assert.equal(c.count, 0, '默认无覆盖');
  assert.equal(c.thresholds.inactiveMs.value, 48 * 3600 * 1000, 'inactiveMs 默认 48h');
  assert.equal(c.thresholds.spikeFactor.value, 2, 'spikeFactor 默认 2');
  assert.equal(c.thresholds.trendSlopeP95.value, 50, 'trendSlopeP95 默认 50');
  assert.equal(c.thresholds.spikeFactor.source, 'default');
  assert.equal(c.thresholds.spikeFactor.envKey, 'OMNI_MONITOR_SPIKE_FACTOR');
  assert.equal(c.thresholds.spikeFactor.overridden, false);
});

test('config: opts.thresholds 覆盖默认(优先级最高, source=opts)', () => {
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `cfg-${Math.random().toString(36).slice(2)}.json`),
    thresholds: { spikeFactor: 5, trendSlopeP95: 200 },
  });
  const c = m.config();
  assert.equal(c.thresholds.spikeFactor.value, 5);
  assert.equal(c.thresholds.spikeFactor.source, 'opts');
  assert.equal(c.thresholds.spikeFactor.overridden, true);
  assert.equal(c.thresholds.trendSlopeP95.value, 200);
  assert.ok(c.overrides.includes('spikeFactor') && c.overrides.includes('trendSlopeP95'));
  assert.equal(c.count, 2);
});

test('config: 环境变量覆盖默认(source=env)，非法值回退默认', () => {
  const omni = makeOmni([], fakeMemory());
  process.env.OMNI_MONITOR_MEM_BULK = '3';
  process.env.OMNI_MONITOR_SPIKE_FACTOR = 'not-a-number'; // 非法 → 回退默认
  try {
    const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `env-${Math.random().toString(36).slice(2)}.json`) });
    const c = m.config();
    assert.equal(c.thresholds.memBulk.value, 3, 'env 覆盖 memBulk');
    assert.equal(c.thresholds.memBulk.source, 'env');
    assert.equal(c.thresholds.spikeFactor.value, 2, '非法 env 回退默认');
    assert.equal(c.thresholds.spikeFactor.source, 'default');
  } finally {
    delete process.env.OMNI_MONITOR_MEM_BULK;
    delete process.env.OMNI_MONITOR_SPIKE_FACTOR;
  }
});

test('阈值真实生效：memBulk 降低后更小的记忆增长即触发批量注入', () => {
  const omni = makeOmni([], {
    layerSnapshot: () => ({ memory: { keys: 5, facts: 0, notes: 0 }, rule: 0, skill: 0, knowledge: 0 }),
  });
  // 默认阈值 20：增长 5 条不触发
  const mDef = new Monitor(omni.bus, omni, { metricsFile: join(TD, `bd-${Math.random().toString(36).slice(2)}.json`) });
  mDef._anomalyBase = { memory: 0, rule: 0, skill: 0, knowledge: 0 };
  assert.ok(!mDef.detectAnomalies().some(x => x.type === 'memory_bulk_injection'), '默认阈值不应触发');
  // 阈值降到 4：增长 5 条应触发
  const mLow = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `bl-${Math.random().toString(36).slice(2)}.json`),
    thresholds: { memBulk: 4 },
  });
  mLow._anomalyBase = { memory: 0, rule: 0, skill: 0, knowledge: 0 };
  assert.ok(mLow.detectAnomalies().some(x => x.type === 'memory_bulk_injection'), '降低阈值后应触发批量注入');
});

test('阈值真实生效：trendSlopeP95 调高后 P95 爬坡不再误报', () => {
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `ts-${Math.random().toString(36).slice(2)}.json`),
    thresholds: { trendSlopeP95: 1000 }, // 提高到 1000ms/点，普通爬坡不触发
  });
  for (let i = 0; i < 8; i++) m._trendPoints.push({ p95: 100 + i * 57, successRate: 0.95, memTotal: 20, fleetHealthy: 3 });
  assert.ok(!m._detectTrendAnomalies().some(x => x.type === 'trend_regression'), '高阈值应抑制 P95 爬坡误报');
});

test('dashboard 含阈值配置区块', () => {
  const html = mkMon([]).renderDashboard();
  assert.ok(html.includes('阈值配置'), '仪表盘应含阈值配置区块');
  assert.ok(html.includes('OMNI_MONITOR_SPIKE_FACTOR'), '应展示环境变量名');
});

test('Body.monitor 委托到 omni.monitor（第 8 器官接线正确）', () => {
  const fake = { monitor: { snapshot: () => ({ ok: true, fromMonitor: true }) } };
  const body = new Body(fake);
  const r = body.monitor('snapshot');
  assert.deepEqual(r, { ok: true, fromMonitor: true });
});
