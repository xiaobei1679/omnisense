// 监控器官（Monitor）测试：统一状态快照 / Agent 健康 / 多种状态检测告警 / 可视化仪表盘 / 指标记录
// 全部离线、确定性，用最小 fake omni（bus 桩 + memory/tracer/body 桩）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
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

test('Monitor 构造并注册 22 个总线方法(核心 6 + 新增 16，含综合健康评分/维度权重/真实告警推送)', () => {
  const reg = {};
  const bus = { register: (o, m) => { reg[`${o}.${m}`] = true; } };
  const omni = { bus, memory: fakeMemory(), tracer: makeTracer(), body: fakeBody() };
  new Monitor(bus, omni, { metricsFile: join(TD, 'reg.json') });
  for (const m of ['snapshot', 'health', 'alerts', 'dashboard', 'recordMetric', 'checkAlerts',
    'latency', 'statusGrid', 'memoryHealth', 'anomalies', 'recentRuns', 'toolHealth', 'trends', 'trendAnomalies', 'config', 'thresholdHealth', 'thresholdAlerts', 'alertables', 'healthScore', 'score', 'weights', 'pushAlerts']) {
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
  // 显式传入不存在的 thresholdFile，确保不依赖 ~/.omnisense/monitor.json 是否存在（确定性）。
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `def-${Math.random().toString(36).slice(2)}.json`),
    thresholdFile: join(TD, 'no-such-config.json'),
  });
  const c = m.config();
  assert.equal(c.ok, true);
  assert.equal(c.count, 0, '默认无覆盖');
  assert.equal(c.configFileLoaded, false);
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

test('config: JSON 文件覆盖默认(source=file，Observability-as-Code)', () => {
  const cfgPath = join(TD, `mon-config-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(cfgPath, JSON.stringify({ spikeFactor: 7, memBulk: 3, trendSlopeP95: 200 }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `fc-${Math.random().toString(36).slice(2)}.json`),
    thresholdFile: cfgPath,
  });
  const c = m.config();
  assert.equal(c.thresholds.spikeFactor.value, 7, 'JSON 文件覆盖 spikeFactor');
  assert.equal(c.thresholds.spikeFactor.source, 'file');
  assert.equal(c.thresholds.memBulk.value, 3, 'JSON 文件覆盖 memBulk');
  assert.equal(c.thresholds.memBulk.source, 'file');
  assert.equal(c.thresholds.trendSlopeP95.value, 200);
  assert.equal(c.configFile, cfgPath, 'config 应暴露配置文件路径');
  assert.equal(c.configFileLoaded, true);
  assert.equal(c.count, 3, '应识别 3 项被覆盖');
});

test('config: --config-file 加载未知键被忽略、非法值回退默认', () => {
  const cfgPath = join(TD, `mon-bad-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(cfgPath, JSON.stringify({ spikeFactor: 9, unknownKey: 999, memBulk: 'not-a-number' }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `fb-${Math.random().toString(36).slice(2)}.json`) });
  const r = m.loadConfigFile(cfgPath);
  assert.equal(r.ok, true);
  assert.equal(r.loaded, true);
  const c = m.config();
  assert.equal(c.thresholds.spikeFactor.value, 9, '合法键生效');
  assert.equal(c.thresholds.spikeFactor.source, 'file');
  assert.equal(c.thresholds.memBulk.value, 20, '非法值回退默认');
  assert.equal(c.thresholds.memBulk.source, 'default');
  assert.equal(c.overrides.includes('unknownKey'), false, '未知键不应污染阈值');
});

test('config: --config-file 指向不存在文件 → 静默降级(loaded=false，保持默认)', () => {
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `fmi-${Math.random().toString(36).slice(2)}.json`) });
  const r = m.loadConfigFile(join(TD, 'does-not-exist.json'));
  assert.equal(r.loaded, false);
  const c = m.config();
  assert.equal(c.thresholds.spikeFactor.source, 'default', '文件不存在应回退默认');
  assert.equal(c.configFileLoaded, false);
});

test('config: 优先级 opts > env > file > default（env 盖过 file，opts 盖过 env）', () => {
  const cfgPath = join(TD, `mon-pri-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(cfgPath, JSON.stringify({ spikeFactor: 7 }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  process.env.OMNI_MONITOR_SPIKE_FACTOR = '4';
  try {
    const m = new Monitor(omni.bus, omni, {
      metricsFile: join(TD, `pri-${Math.random().toString(36).slice(2)}.json`),
      thresholdFile: cfgPath,
      thresholds: { spikeFactor: 11 },
    });
    const c = m.config();
    assert.equal(c.thresholds.spikeFactor.value, 11, 'opts 最高优先级，盖过 env 与 file');
    assert.equal(c.thresholds.spikeFactor.source, 'opts');
  } finally {
    delete process.env.OMNI_MONITOR_SPIKE_FACTOR;
  }
});

test('dashboard 阈值区块含配置文件路径(Observability-as-Code 可溯源)', () => {
  const cfgPath = join(TD, `mon-dash-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(cfgPath, JSON.stringify({ spikeFactor: 6 }), 'utf8');
  const m = mkMon([]);
  m.loadConfigFile(cfgPath);
  const html = m.renderDashboard();
  assert.ok(html.includes('配置来源文件'), '仪表盘应展示配置来源文件行');
  assert.ok(html.includes(cfgPath), '仪表盘应含配置文件路径');
});

test('weights: 无 env/opts 时默认权重(0.25/0.25/0.20/0.15/0.15)且 source=default、归一化和=1', () => {
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `wdef-${Math.random().toString(36).slice(2)}.json`),
    weightFile: join(TD, 'no-such-weights.json'),
  });
  const w = m.weights();
  assert.equal(w.ok, true);
  assert.equal(w.count, 0, '默认无覆盖');
  assert.equal(w.weightFileLoaded, false);
  assert.equal(w.weights.liveness.weight, 0.25, 'liveness 默认 0.25');
  assert.equal(w.weights.reliability.weight, 0.25, 'reliability 默认 0.25');
  assert.equal(w.weights.threshold.weight, 0.20, 'threshold 默认 0.20');
  assert.equal(w.weights.anomalies.weight, 0.15, 'anomalies 默认 0.15');
  assert.equal(w.weights.tool.weight, 0.15, 'tool 默认 0.15');
  assert.equal(w.weights.liveness.source, 'default');
  assert.equal(w.weights.liveness.envKey, 'OMNI_MONITOR_WEIGHT_LIVENESS');
  assert.equal(w.sum, 1, '默认权重和应为 1');
  assert.equal(w.weights.liveness.normalized, 0.25, '归一化权重应一致');
});

test('weights: opts.weights 覆盖默认(优先级最高, source=opts)', () => {
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `wcfg-${Math.random().toString(36).slice(2)}.json`),
    weights: { liveness: 0.5, reliability: 0.3, threshold: 0.1, anomalies: 0.05, tool: 0.05 },
  });
  const w = m.weights();
  assert.equal(w.weights.liveness.weight, 0.5);
  assert.equal(w.weights.liveness.source, 'opts');
  assert.equal(w.weights.liveness.overridden, true);
  assert.equal(w.sum, 1.0);
  assert.equal(w.count, 5);
});

test('weights: 环境变量覆盖默认(source=env)，非法值回退默认', () => {
  const omni = makeOmni([], fakeMemory());
  process.env.OMNI_MONITOR_WEIGHT_TOOL = '0.4';
  process.env.OMNI_MONITOR_WEIGHT_ANOMALIES = 'not-a-number'; // 非法 → 回退默认
  try {
    const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `wenv-${Math.random().toString(36).slice(2)}.json`) });
    const w = m.weights();
    assert.equal(w.weights.tool.weight, 0.4, 'env 覆盖 tool');
    assert.equal(w.weights.tool.source, 'env');
    assert.equal(w.weights.anomalies.weight, 0.15, '非法 env 回退默认');
    assert.equal(w.weights.anomalies.source, 'default');
  } finally {
    delete process.env.OMNI_MONITOR_WEIGHT_TOOL;
    delete process.env.OMNI_MONITOR_WEIGHT_ANOMALIES;
  }
});

test('weights: JSON 文件覆盖默认(source=file，Observability-as-Code)', () => {
  const wPath = join(TD, `mon-weights-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(wPath, JSON.stringify({ liveness: 0.6, tool: 0.3, anomalies: 0.1 }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `wfc-${Math.random().toString(36).slice(2)}.json`),
    weightFile: wPath,
  });
  const w = m.weights();
  assert.equal(w.weights.liveness.weight, 0.6, 'JSON 文件覆盖 liveness');
  assert.equal(w.weights.liveness.source, 'file');
  assert.equal(w.weights.tool.weight, 0.3, 'JSON 文件覆盖 tool');
  assert.equal(w.weights.anomalies.weight, 0.1, 'JSON 文件覆盖 anomalies');
  assert.equal(w.weights.reliability.weight, 0.25, '未覆盖项保持默认');
  assert.equal(w.weightFile, wPath, 'weights 应暴露配置文件路径');
  assert.equal(w.weightFileLoaded, true);
  assert.equal(w.count, 3, '应识别 3 项被覆盖');
});

test('weights: --weights-file 加载未知键被忽略、非法值回退默认', () => {
  const wPath = join(TD, `mon-weights-bad-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(wPath, JSON.stringify({ liveness: 0.8, unknownKey: 0.9, tool: 'not-a-number' }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `wfb-${Math.random().toString(36).slice(2)}.json`) });
  const r = m.loadWeightsFile(wPath);
  assert.equal(r.ok, true);
  assert.equal(r.loaded, true);
  const w = m.weights();
  assert.equal(w.weights.liveness.weight, 0.8, '合法键生效');
  assert.equal(w.weights.liveness.source, 'file');
  assert.equal(w.weights.tool.weight, 0.15, '非法值回退默认');
  assert.equal(w.weights.tool.source, 'default');
  assert.equal(w.overrides.includes('unknownKey'), false, '未知键不应污染权重');
});

test('weights: 优先级 opts > env > file > default（env 盖过 file，opts 盖过 env）', () => {
  const wPath = join(TD, `mon-weights-pri-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(wPath, JSON.stringify({ liveness: 0.7 }), 'utf8');
  const omni = makeOmni([], fakeMemory());
  process.env.OMNI_MONITOR_WEIGHT_LIVENESS = '0.5';
  try {
    const m = new Monitor(omni.bus, omni, {
      metricsFile: join(TD, `wpri-${Math.random().toString(36).slice(2)}.json`),
      weightFile: wPath,
      weights: { liveness: 0.9 },
    });
    const w = m.weights();
    assert.equal(w.weights.liveness.weight, 0.9, 'opts 最高优先级，盖过 env 与 file');
    assert.equal(w.weights.liveness.source, 'opts');
  } finally {
    delete process.env.OMNI_MONITOR_WEIGHT_LIVENESS;
  }
});

test('healthScore: 维度权重配置生效 —— tool 权重置 1 时分数随工具健康(0/100)变化', () => {
  const now = Date.now();
  const runs = [{ runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] }];
  const zeroW = { liveness: 0, reliability: 0, threshold: 0, anomalies: 0, tool: 1 };
  // 无熔断：tool subScore=1 → 分数 100
  const omniClosed = makeOmni(runs, fakeMemory());
  const mClosed = new Monitor(omniClosed.bus, omniClosed, { metricsFile: join(TD, `hs-w-close-${Math.random().toString(36).slice(2)}.json`), weights: zeroW });
  const rClosed = mClosed.healthScore();
  assert.equal(rClosed.score, 100, 'tool 权重=1、无熔断 → 分数 100');
  assert.equal(rClosed.dimensions.find(d => d.key === 'tool').weight, 1, '维度权重应反映配置');
  assert.equal(rClosed.dimensions.find(d => d.key === 'reliability').weight, 0, '其余维度权重应反映配置');
  // 熔断开启：tool subScore=0 → 分数 0
  const omniOpen = makeOmni(runs, fakeMemory());
  const mOpen = new Monitor(omniOpen.bus, omniOpen, { metricsFile: join(TD, `hs-w-open-${Math.random().toString(36).slice(2)}.json`), weights: zeroW });
  mOpen.omni.toolBreakerStatus = () => [{ name: 'web_fetch', open: true, fails: 3, maxFails: 3 }];
  mOpen.omni.toolCacheStats = () => ({ size: 0, keys: [] });
  const rOpen = mOpen.healthScore();
  assert.equal(rOpen.score, 0, 'tool 权重=1、熔断开启 → 分数 0（证明权重确实改变了打分）');
});

test('healthScore: 权重之和≠1 时仍归一化到 0-100（全维度满分不应溢出）', () => {
  const now = Date.now();
  const omni = makeOmni([
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] },
  ], fakeMemory());
  // 故意给一组和≠1 的权重（全 0.5），归一化后每维度 0.2
  const m = new Monitor(omni.bus, omni, {
    metricsFile: join(TD, `hs-w-norm-${Math.random().toString(36).slice(2)}.json`),
    weights: { liveness: 0.5, reliability: 0.5, threshold: 0.5, anomalies: 0.5, tool: 0.5 },
  });
  const r = m.healthScore();
  assert.equal(r.score, 100, '全部 subScore=1 时归一化后分数仍应为 100，不溢出');
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

test('thresholdHealth: 返回 11 项阈值 + 当前测量值 + 状态(ok/na) + 汇总', () => {
  const m = mkMon([]);
  const th = m.thresholdHealth();
  assert.equal(th.ok, true);
  assert.equal(th.items.length, 11, '应覆盖 11 个阈值 key');
  assert.ok(th.summary && typeof th.summary === 'object', '应有 summary');
  // 无运行/记忆数据时：idle/mem/liveness/趋势维度应为 na（灰），绝不伪造读数
  const byKey = Object.fromEntries(th.items.map(i => [i.key, i]));
  assert.equal(byKey.inactiveMs.status, 'na', '无活动数据应 na');
  assert.equal(byKey.spikeFactor.status, 'na', '无数据应 na');
  assert.equal(byKey.trendSlopeP95.status, 'na', '无趋势点应 na');
  assert.equal(byKey.livenessHealthyMs.status, 'na', '无引擎应 na');
  assert.ok(th.summary.na >= 6, '多数无数据维度应计为 na');
  // 每项应含 threshold(值/来源/envKey) + unit + current + status
  for (const it of th.items) {
    assert.ok('value' in it.threshold && 'source' in it.threshold && 'envKey' in it.threshold, 'threshold 应含值/来源/envKey');
    assert.ok(['ms', 'x', '条', 'ms/点', '/点', '条/点'].includes(it.unit), '应有单位');
    assert.ok(['ok', 'warn', 'over', 'na'].includes(it.status), 'status 应在合法集合');
  }
});

test('thresholdHealth: 长期无活动 -> inactiveMs 状态 over(红)，引擎存活降级 -> warn/over', () => {
  const old = Date.now() - 49 * 3600 * 1000; // 49h 前，超过默认 inactiveMs(48h)
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
    { runId: 'o2', engine: 'autopilot', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
  ];
  const m = mkMon(runs);
  const th = m.thresholdHealth();
  const byKey = Object.fromEntries(th.items.map(i => [i.key, i]));
  assert.equal(byKey.inactiveMs.status, 'over', '超 48h 无活动应 over(红)');
  // 引擎最久未活跃 49h：> livenessDegradedMs(24h) → over；> livenessHealthyMs(1h) → over
  assert.equal(byKey.livenessHealthyMs.status, 'over', '引擎 49h 未活跃应 over');
  assert.equal(byKey.livenessDegradedMs.status, 'over', '引擎 49h 未活跃应 over');
  assert.ok(byKey.inactiveMs.current != null && byKey.inactiveMs.current > 48 * 3600 * 1000, 'current 应超过 48h 阈值(驱动 over)');
});

test('thresholdHealth: 刚活跃数据 -> 相关维度 ok(绿)，且状态与阈值服从来源', () => {
  const now = Date.now();
  const runs = [
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] },
    { runId: 'r2', engine: 'autopilot', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 50, steps: [] },
  ];
  const m = mkMon(runs);
  const th = m.thresholdHealth();
  const byKey = Object.fromEntries(th.items.map(i => [i.key, i]));
  assert.equal(byKey.inactiveMs.status, 'ok', '刚活跃应 ok(绿)');
  assert.equal(byKey.livenessHealthyMs.status, 'ok', '刚活跃引擎应 ok');
  assert.equal(byKey.livenessDegradedMs.status, 'ok', '刚活跃引擎应 ok');
  assert.equal(byKey.spikeFactor.status, 'na', '数据不足(<5 运行)时 spikeFactor 应为 na，绝不伪造读数');
});

test('dashboard 阈值区块含当前值 vs 阈值 + 红黄绿着色(状态点/状态标签)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
    { runId: 'o2', engine: 'autopilot', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
  ];
  const html = mkMon(runs).renderDashboard();
  assert.ok(html.includes('当前值 vs 阈值'), '仪表盘阈值区块应说明当前值 vs 阈值');
  assert.ok(html.includes('超标'), '超标状态标签应出现在仪表盘');
  assert.ok(html.includes('th-dot'), '应渲染红黄绿状态点');
  assert.ok(html.includes('阈值健康'), '应展示阈值健康汇总');
  assert.ok(html.includes('可推送告警清单'), '仪表盘应含 Alertmanager-ready 可推送告警清单区块');
});

test('thresholdHealth: 每项含 severity(over→critical / warn→warning / ok,na→none)，对齐 Alertmanager', () => {
  const m = mkMon([]);
  const th = m.thresholdHealth();
  for (const it of th.items) {
    assert.ok('severity' in it, `item ${it.key} 应含 severity`);
    assert.ok(['critical', 'warning', 'none'].includes(it.severity), 'severity 应在合法集合');
    if (it.status === 'over') assert.equal(it.severity, 'critical', `${it.key} over 应映射 critical`);
    else if (it.status === 'warn') assert.equal(it.severity, 'warning', `${it.key} warn 应映射 warning`);
    else assert.equal(it.severity, 'none', `${it.key} ${it.status} 应映射 none`);
  }
});

test('thresholdHealth: 长期无活动 -> inactiveMs 状态 over + severity critical(可直推 Alertmanager)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
    { runId: 'o2', engine: 'autopilot', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
  ];
  const th = mkMon(runs).thresholdHealth();
  const byKey = Object.fromEntries(th.items.map(i => [i.key, i]));
  assert.equal(byKey.inactiveMs.severity, 'critical', '超 48h 无活动应 critical');
  assert.equal(byKey.livenessHealthyMs.severity, 'critical', '引擎 49h 未活跃应 critical');
});

test('thresholdAlerts: 只产出非 none 项，形状对齐 Alertmanager(labels+annotations+稳定 fingerprint)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
  ];
  const r = mkMon(runs).thresholdAlerts();
  assert.equal(r.ok, true);
  assert.ok(r.count > 0, '长期无活动应产出告警');
  assert.equal(r.count, r.critical + r.warning, 'count = critical + warning');
  for (const a of r.alerts) {
    assert.ok(['critical', 'warning'].includes(a.severity), '告警 severity 仅 critical/warning');
    assert.ok(typeof a.fingerprint === 'string' && /^[0-9a-f]{16}$/.test(a.fingerprint), '应有稳定 16 位 sha1 fingerprint');
    assert.equal(a.labels.alertname, `omnisense_threshold_${a.labels.key}`, 'labels.alertname = omnisense_threshold_<key>');
    assert.equal(a.labels.severity, a.severity, 'labels.severity 与顶层 severity 一致');
    assert.equal(a.labels.monitor, 'omnisense');
    assert.ok(a.annotations && a.annotations.summary && a.annotations.description, 'annotations 应含 summary/description');
  }
  // 同一 key 的 fingerprint 跨调用稳定（Alertmanager 去重聚合依据）
  const r2 = mkMon(runs).thresholdAlerts();
  const a1 = r.alerts.find(x => x.labels.key === 'inactiveMs');
  const a2 = r2.alerts.find(x => x.labels.key === 'inactiveMs');
  if (a1 && a2) assert.equal(a1.fingerprint, a2.fingerprint, '同一 key 的 fingerprint 应跨调用稳定');
});

// ── pushAlerts：真实告警推送（零依赖 webhook/Alertmanager 客户端，离线可测）──
test('pushAlerts: 无 target 且未配置 env -> 结构化报错不伪造(ok:false)', async () => {
  const m = mkMon([]);
  const r = await m.pushAlerts();
  assert.equal(r.ok, false);
  assert.equal(r.error, 'no-alert-target');
  assert.equal(r.sent, 0);
  assert.ok('available' in r, '应带 available 字段');
});

test('pushAlerts: 有 target 但无 active 告警 -> ok:true, sent:0, 不联网', async () => {
  const m = mkMon([]);
  m.checkAlerts = () => [];   // 隔离统一告警源，仅验证阈值告警路径
  const r = await m.pushAlerts({ type: 'webhook', url: 'http://example.test/hook' });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 0);
  assert.equal(r.reason, 'no-active-alerts');
  assert.equal(r.type, 'webhook');
});

test('pushAlerts: webhook 目标 -> 注入 mock fetch 收到正确 JSON 负载', async () => {
  const m = mkMon([]);
  m.checkAlerts = () => [];   // 隔离统一告警源
  m.thresholdAlerts = () => ({
    ok: true, count: 2, critical: 1, warning: 1,
    alerts: [
      { fingerprint: 'a'.repeat(16), severity: 'critical', labels: { key: 'inactiveMs' }, annotations: { summary: 'x' } },
      { fingerprint: 'b'.repeat(16), severity: 'warning', labels: { key: 'memStaleMs' }, annotations: { summary: 'y' } },
    ],
  });
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { status: 200, statusCode: 200 }; };
  const r = await m.pushAlerts({ type: 'webhook', url: 'http://example.test/hook' }, { fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 2);
  assert.equal(r.critical, 1);
  assert.equal(r.warning, 1);
  assert.equal(captured.url, 'http://example.test/hook');
  assert.equal(captured.opts.method, 'POST');
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.monitor, 'omnisense');
  assert.equal(body.count, 2);
  assert.equal(body.alerts.length, 2);
});

test('pushAlerts: alertmanager 目标 -> URL 补齐 /api/v2/alerts 且 body 为数组', async () => {
  const m = mkMon([]);
  m.checkAlerts = () => [];   // 隔离统一告警源
  m.thresholdAlerts = () => ({ ok: true, count: 1, critical: 1, warning: 0, alerts: [{ fingerprint: 'c'.repeat(16), severity: 'critical', labels: { key: 'inactiveMs' }, annotations: {} }] });
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { status: 200, statusCode: 200 }; };
  const r = await m.pushAlerts({ type: 'alertmanager', url: 'http://am:9093' }, { fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 1);
  assert.equal(captured.url, 'http://am:9093/api/v2/alerts', 'alertmanager URL 应补齐 /api/v2/alerts');
  const body = JSON.parse(captured.opts.body);
  assert.ok(Array.isArray(body), 'alertmanager body 应为告警数组');
  assert.equal(body.length, 1);
});

test('pushAlerts: fetch 失败 -> ok:false 且 sent:0(诚实不谎报成功)', async () => {
  const m = mkMon([]);
  m.checkAlerts = () => [];   // 隔离统一告警源
  m.thresholdAlerts = () => ({ ok: true, count: 1, critical: 1, warning: 0, alerts: [{ fingerprint: 'd'.repeat(16), severity: 'critical', labels: { key: 'inactiveMs' }, annotations: {} }] });
  const fakeFetch = async () => { throw new Error('ECONNREFUSED'); };
  const r = await m.pushAlerts({ type: 'webhook', url: 'http://dead/hook' }, { fetch: fakeFetch });
  assert.equal(r.ok, false);
  assert.equal(r.sent, 0);
  assert.ok(/ECONNREFUSED/.test(r.error), '错误应透传');
});

test('pushAlerts: 合并 checkAlerts 统一告警一起推送（统一告警闭环）', async () => {
  const m = mkMon([]);
  m.thresholdAlerts = () => ({ ok: true, count: 1, critical: 0, warning: 1, alerts: [{ fingerprint: 'a'.repeat(16), severity: 'warning', labels: { key: 'memStaleMs' }, annotations: { summary: 'y' } }] });
  m.checkAlerts = () => [{ level: 'error', type: 'consecutive_failures', message: '连续 3 次运行未完成', agent: 'tracer' }];
  let captured = null;
  const fakeFetch = async (url, opts) => { captured = { url, opts }; return { status: 200, statusCode: 200 }; };
  const r = await m.pushAlerts({ type: 'webhook', url: 'http://example.test/hook' }, { fetch: fakeFetch });
  assert.equal(r.ok, true);
  assert.equal(r.sent, 2, '阈值告警(1) + 统一告警(1) 共 2 条');
  assert.equal(r.critical, 1, '统一告警 error 级应映射为 critical');
  assert.equal(r.warning, 1);
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.alerts.length, 2);
  assert.ok(body.alerts.some(a => a.labels?.source === 'unified'), '应含归一化的统一告警');
});

test('thresholdAlerts: 全部健康(ok/na)时无告警可推送(离线不伪造告警)', () => {
  const r = mkMon([]).thresholdAlerts();
  assert.equal(r.ok, true);
  assert.equal(r.count, 0, '无超标/关注项');
  assert.equal(r.critical, 0);
  assert.equal(r.warning, 0);
  assert.deepEqual(r.alerts, []);
});

test('healthScore: 返回综合健康评分结构(score/grade/status/5 维度/issues)', () => {
  const m = mkMon([]);
  const r = m.healthScore();
  assert.equal(r.ok, true);
  assert.ok('score' in r, '应含 score');
  assert.ok(['A', 'B', 'C', 'D', 'F', 'N/A'].includes(r.grade), 'grade 应在合法集合');
  assert.ok(['healthy', 'degraded', 'warning', 'critical', 'unknown'].includes(r.status), 'status 应在合法集合');
  assert.equal(r.dimensions.length, 5, '应含 5 个加权维度');
  for (const d of r.dimensions) {
    assert.ok(['liveness', 'reliability', 'threshold', 'anomalies', 'tool'].includes(d.key), '维度 key 合法');
    assert.ok(d.weight > 0 && d.label && typeof d.detail === 'string', '维度应含权重/标签/详情');
    assert.ok(d.subScore == null || (d.subScore >= 0 && d.subScore <= 1), 'subScore 应在 [0,1] 或 null(未知)');
  }
  assert.ok(Array.isArray(r.issues), 'issues 应为数组');
});

test('healthScore: 单一近期成功运行 -> 满分(>=90) + 等级 A + status healthy', () => {
  const now = Date.now();
  const runs = [
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] },
  ];
  const r = mkMon(runs).healthScore();
  assert.equal(r.status, 'healthy', '应健康');
  assert.equal(r.grade, 'A', '满分应等级 A');
  assert.ok(r.score >= 90, `满分场景 score 应 ≥90，实际 ${r.score}`);
  assert.equal(r.dimensions.find(d => d.key === 'reliability').subScore, 1, '成功率维度应为 1');
});

test('healthScore: 长期无活动(阈值 over) -> 评分显著低于满分 + 含关键问题 + 非 healthy', () => {
  const old = Date.now() - 49 * 3600 * 1000; // 49h 前，超 inactiveMs(48h) 与 livenessDegradedMs(24h)
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
  ];
  const r = mkMon(runs).healthScore();
  assert.notEqual(r.grade, 'A', '退化场景不应再是 A');
  assert.notEqual(r.status, 'healthy', '退化场景不应仍 healthy');
  assert.ok(r.score < 90, `退化场景 score 应 <90，实际 ${r.score}`);
  assert.ok(r.issueCount >= 2, '应聚合出 ≥2 个关键问题(长期无活动/引擎失联)');
  assert.ok(r.issues.some(i => /inactiveMs|liveness/.test(i.message || i.key || '')), '关键问题应含长期无活动/引擎存活');
});

test('healthScore: 工具熔断开启 -> 工具管线维度扣分 + 关键问题含 circuit_open', () => {
  const now = Date.now();
  const runs = [
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] },
  ];
  const m = mkMon(runs);
  m.omni.toolBreakerStatus = () => [{ name: 'web_fetch', open: true, fails: 3, maxFails: 3 }];
  m.omni.toolCacheStats = () => ({ size: 0, keys: [] });
  const r = m.healthScore();
  assert.equal(r.dimensions.find(d => d.key === 'tool').subScore, 0, '工具维度(1 开/1 总)应扣到 0');
  assert.ok(r.issues.some(i => i.dimension === 'tool'), '关键问题应含工具管线项');
});

test('healthScore: 无运行轨迹 -> status unknown + grade N/A + score null(诚实不伪造读数)', () => {
  const r = mkMon([]).healthScore();
  assert.equal(r.status, 'unknown', '无数据应 unknown');
  assert.equal(r.grade, 'N/A', '无数据应 N/A');
  assert.equal(r.score, null, '无数据应 score=null，绝不伪造满分');
});

test('healthScore(scope): 引擎 scope 只计该引擎的 runs（llm vs autopilot 分数分化）', () => {
  const now = Date.now();
  // llm 引擎：全成功+刚活跃 -> 高分；autopilot 引擎：49h 前超 inactiveMs -> 低分
  const runs = [
    { runId: 'llm-ok', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, durationMs: 100, steps: [] },
    { runId: 'old-ap', engine: 'autopilot', completed: true, startedAt: now - 49 * 3600 * 1000, finishedAt: now - 49 * 3600 * 1000 + 500, steps: [] },
  ];
  const m = mkMon(runs);
  const globalScore = m.healthScore();                // 全局：含两引擎，autopilot 长无活动拉低
  const llmScore = m.healthScore('llm');               // llm scope：单引擎刚活跃 → 高分
  const apScore = m.healthScore('autopilot');           // autopilot scope：单引擎 49h 无活动 → 低分
  assert.equal(llmScore.status, 'healthy', 'llm scope 应 healthy（近期活跃+全成功）');
  assert.notEqual(apScore.status, 'healthy', 'autopilot scope 不应 healthy（49h 无活动）');
  assert.ok(llmScore.score > apScore.score, 'llm scope 分数应高于 autopilot scope');
  // global 应回显 scope=null（全局无 scope）
  assert.equal(globalScore.scope, undefined, '全局 healthScore 不应回显 scope');
  assert.equal(llmScore.scope, 'llm', 'llm scope 应回显 scope 名');
  assert.equal(apScore.scope, 'autopilot', 'autopilot scope 应回显 scope 名');
  // 维度 3（阈值合规）应为 scoped：llm 刚活跃 → 阈值 ok；autopilot 无活动 → 部分 over
  const llmDim = llmScore.dimensions.find(d => d.key === 'threshold');
  const apDim = apScore.dimensions.find(d => d.key === 'threshold');
  assert.ok(llmDim.subScore >= 0.8, 'llm scope 阈值合规应高分');
  assert.ok(apDim.subScore < 0.8, 'autopilot scope 阈值合规应因无活动而低分');
});

test('healthScore(scope): 同名 bus 方法接受 payload.scope（总线可观测入口）', () => {
  const now = Date.now();
  const runs = [
    { runId: 'llm-ok', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, steps: [] },
    { runId: 'ap-old', engine: 'autopilot', completed: true, startedAt: now - 49 * 3600 * 1000, finishedAt: now - 49 * 3600 * 1000 + 500, steps: [] },
  ];
  const reg = {};
  const bus = { register: (o, m, fn) => { reg[`${o}.${m}`] = fn; } };
  const omni = { bus, memory: fakeMemory(), tracer: makeTracer(runs), body: fakeBody() };
  const m = new Monitor(bus, omni, { metricsFile: join(TD, `bus-scope-${Math.random().toString(36).slice(2)}.json`) });
  // 通过总线注册的 handler 模拟：healthScore({scope:'llm'}) 应与直接调用 healthScore('llm') 一致
  const direct = m.healthScore('llm');
  const busFn = reg['monitor.healthScore'];
  assert.ok(typeof busFn === 'function', '总线应注册 healthScore');
  const viaBus = busFn({ scope: 'llm' });
  assert.equal(viaBus.status, direct.status, '总线途径应与直接调用状态一致');
  assert.equal(viaBus.score, direct.score, '总线途径应与直接调用分数一致');
  assert.equal(viaBus.scope, 'llm', '总线途径应回显 scope');
  // score 别名也应接受 scope
  const busScoreFn = reg['monitor.score'];
  assert.ok(typeof busScoreFn === 'function', '总线应注册 score 别名');
  const viaBusScore = busScoreFn({ scope: 'autopilot' });
  assert.equal(viaBusScore.scope, 'autopilot', 'score 别名途径应回显 scope');
});

test('healthScore(scope): 引擎 scope 下的关键问题只含该引擎的阈值项', () => {
  const now = Date.now();
  const runs = [
    { runId: 'llm-ok', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, steps: [] },
    { runId: 'ap-old', engine: 'autopilot', completed: true, startedAt: now - 49 * 3600 * 1000, finishedAt: now - 49 * 3600 * 1000 + 500, steps: [] },
  ];
  const m = mkMon(runs);
  const llmIssues = m.healthScore('llm').issues;
  const apIssues = m.healthScore('autopilot').issues;
  const globalIssues = m.healthScore().issues;
  // llm 刚活跃 → 阈值项不应含 inactiveMs 超标
  const llmInactiveIssue = llmIssues.find(i => i.key === 'inactiveMs');
  assert.equal(llmInactiveIssue, undefined, 'llm scope 不应有 inactiveMs 超标问题');
  // autopilot 49h 无活动 → 应含 inactiveMs 超标
  const apInactiveIssue = apIssues.find(i => i.key === 'inactiveMs');
  assert.ok(apInactiveIssue, 'autopilot scope 应有 inactiveMs 超标问题');
  assert.equal(apInactiveIssue.severity, 'critical', 'inactiveMs over 应映射 critical');
});

test('healthScore(scope): 未知 scope 静默回退全局（不报错）', () => {
  const now = Date.now();
  const runs = [
    { runId: 'r1', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, steps: [] },
  ];
  const global = mkMon(runs).healthScore();
  const unknown = mkMon(runs).healthScore('nonexistent-scope');
  assert.equal(unknown.score, global.score, '未知 scope 分数应与全局一致');
  assert.equal(unknown.status, global.status, '未知 scope 状态应与全局一致');
  // 不把未知 scope 当引擎，因此回退全局评分
  assert.equal(unknown.scope, undefined, '未知 scope 应以全局方式返回（不回显无效 scope）');
});

test('healthScore(scope): 与 scoped thresholdHealth 的 items 状态一致（引擎 scope 只含该引擎测量）', () => {
  const now = Date.now();
  const runs = [
    { runId: 'llm-ok', engine: 'llm', completed: true, startedAt: now, finishedAt: now + 100, steps: [] },
    { runId: 'ap-old', engine: 'autopilot', completed: true, startedAt: now - 49 * 3600 * 1000, finishedAt: now - 49 * 3600 * 1000 + 500, steps: [] },
  ];
  const m = mkMon(runs);
  const llmHS = m.healthScore('llm');
  const llmTH = m.thresholdHealth('llm');
  const llmTHMap = Object.fromEntries(llmTH.items.map(i => [i.key, i]));
  // healthScore 的阈值维度 issues 应与 thresholdHealth 的 over/warn 项对应
  const llmIssues = llmHS.issues.filter(i => i.dimension === 'threshold');
  for (const issue of llmIssues) {
    const thItem = llmTHMap[issue.key];
    assert.ok(thItem, `issue ${issue.key} 应在 thresholdHealth 中存在`);
    assert.equal(thItem.status, issue.status, `issue ${issue.key} 状态应一致`);
  }
});
test('dashboard 含综合健康评分区块(0-100 + 等级 + 5 维度 + 关键问题)', () => {
  const m = mkMon([
    { runId: 'r1', goal: 'autopilot: x', engine: 'autopilot', completed: true, startedAt: Date.now() - 1000, finishedAt: Date.now() - 500, durationMs: 120, steps: [{}] },
  ]);
  const html = m.renderDashboard();
  assert.ok(html.includes('综合健康评分'), '仪表盘应含综合健康评分区块');
  assert.ok(html.includes('Health Score'), '应含英文标题');
  assert.ok(html.includes('关键问题'), '应含关键问题聚合');
  assert.ok(html.includes('舰队存活'), '应展示五个维度之一(标签)');
});

test('Body.monitor 委托到 omni.monitor（第 8 器官接线正确）', () => {
  const fake = { monitor: { snapshot: () => ({ ok: true, fromMonitor: true }) } };
  const body = new Body(fake);
  const r = body.monitor('snapshot');
  assert.deepEqual(r, { ok: true, fromMonitor: true });
});

// ── 多舰队差异化阈值（scope）：按引擎/环境 profile 分组查询差异化阈值配置 ──
function mkScopedMon(scopes, runs = []) {
  const cfgPath = join(TD, `mon-scope-${Math.random().toString(36).slice(2)}.json`);
  const file = { spikeFactor: 7 }; // 平铺默认
  if (scopes) file.scopes = scopes;
  writeFileSync(cfgPath, JSON.stringify(file), 'utf8');
  const omni = makeOmni(runs, fakeMemory());
  const m = new Monitor(omni.bus, omni, { metricsFile: join(TD, `sc-${Math.random().toString(36).slice(2)}.json`), thresholdFile: cfgPath });
  return { m, cfgPath };
}

test('scoped 阈值: config(scope) 返回 scope 差异化覆盖(source=scope) + 列出 availableScopes', () => {
  const { m } = mkScopedMon({ prod: { spikeFactor: 9 }, llm: { inactiveMs: 1000 } });
  const c = m.config('prod');
  assert.equal(c.scope, 'prod', '应回显当前 scope');
  assert.equal(c.thresholds.spikeFactor.value, 9, 'prod scope 应覆盖 spikeFactor');
  assert.equal(c.thresholds.spikeFactor.source, 'scope', '来源应标注 scope');
  assert.equal(c.thresholds.spikeFactor.overridden, true);
  // 未在 prod scope 覆盖、且平铺文件也未定义 inactiveMs 的项 → 回退内置 default（诚实：不伪造来源）
  assert.equal(c.thresholds.inactiveMs.source, 'default', '未覆盖项回退内置默认（平铺文件未定义则 default，不谎报 file）');
  assert.equal(c.thresholds.inactiveMs.value, 48 * 3600 * 1000, '未覆盖项保持内置默认值');
  // 另一个 scope 不应串扰
  const c2 = m.config('llm');
  assert.equal(c2.thresholds.spikeFactor.value, 7, 'llm scope 不继承 prod 的覆盖');
  assert.equal(c2.thresholds.inactiveMs.value, 1000, 'llm scope 的 inactiveMs 覆盖生效');
  assert.equal(c2.thresholds.inactiveMs.source, 'scope');
  // availableScopes 列出全部定义的 scope
  assert.deepEqual(c.availableScopes.sort(), ['llm', 'prod'], 'availableScopes 应含全部 scope');
});

test('scoped 阈值: config() 无 scope 时仍返回平铺默认(不污染 scope 覆盖)', () => {
  const { m } = mkScopedMon({ prod: { spikeFactor: 9 } });
  const c = m.config();
  assert.equal(c.scope, null, '无 scope 应回显 null');
  assert.equal(c.thresholds.spikeFactor.value, 7, '无 scope 应用平铺默认');
  assert.equal(c.thresholds.spikeFactor.source, 'file', '来源为 file 而非 scope');
});

test('scoped 阈值: 优先级 opts > env > scope > file > default（env 盖过 scope）', () => {
  const { m } = mkScopedMon({ prod: { spikeFactor: 9 } });
  process.env.OMNI_MONITOR_SPIKE_FACTOR = '4';
  try {
    const c = m.config('prod');
    assert.equal(c.thresholds.spikeFactor.value, 4, 'env 盖过 scope 与 file');
    assert.equal(c.thresholds.spikeFactor.source, 'env');
  } finally {
    delete process.env.OMNI_MONITOR_SPIKE_FACTOR;
  }
});

test('scoped 阈值: thresholdHealth(scope) 用差异化阈值 + 按引擎过滤测量(engineScope)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  // llm 引擎 49h 前活跃；autopilot 引擎刚活跃
  const runs = [
    { runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] },
    { runId: 'a1', engine: 'autopilot', completed: true, startedAt: Date.now(), finishedAt: Date.now() + 100, steps: [] },
  ];
  const { m } = mkScopedMon({ llm: { inactiveMs: 1000 } }, runs); // llm scope 把"无活动"阈值调到 1s；runs 已注入 tracer
  const th = m.thresholdHealth('llm');
  assert.equal(th.scope, 'llm');
  assert.equal(th.engineScope, true, 'llm 是已知引擎，应按引擎过滤测量');
  const byKey = Object.fromEntries(th.items.map(i => [i.key, i]));
  // llm 引擎自身 49h 无活动 → inactiveMs 应 over；llm scope 把阈值降到 1000ms，更是 over
  assert.equal(byKey.inactiveMs.status, 'over', 'llm scope 下该引擎无活动应 over');
  assert.equal(byKey.inactiveMs.threshold.source, 'scope', '该阈值项来源应标 scope');
  // 对比：无 scope 时测量为全局（含刚活跃的 autopilot 引擎）→ 全局 inactiveMs 应为 ok（另一引擎仍在活动）
  // 这正体现 "按引擎 scope 分化" 的价值：llm 引擎已凉，但全局因 autopilot 活跃而不算 over。
  const thGlobal = m.thresholdHealth();
  assert.equal(thGlobal.scope, null);
  assert.equal(thGlobal.engineScope, false, '无 scope 应为全局测量');
  assert.equal(thGlobal.items.find(i => i.key === 'inactiveMs').status, 'ok', '全局因 autopilot 活跃而 ok（与 llm scope 的 over 形成分化）');
});

test('scoped 阈值: thresholdAlerts(scope) 委托到 scoped thresholdHealth(同结构同 fingerprint)', () => {
  const old = Date.now() - 49 * 3600 * 1000;
  const runs = [{ runId: 'o1', engine: 'llm', completed: true, startedAt: old, finishedAt: old + 500, steps: [] }];
  const { m } = mkScopedMon({ prod: { inactiveMs: 1000 } }, runs);
  const r = m.thresholdAlerts('prod');
  assert.equal(r.ok, true);
  assert.ok(r.count > 0, 'prod scope 下长期无活动应产出告警');
  for (const a of r.alerts) {
    assert.ok(['critical', 'warning'].includes(a.severity));
    assert.ok(/^[0-9a-f]{16}$/.test(a.fingerprint), '应有稳定 fingerprint');
    assert.equal(a.labels.monitor, 'omnisense');
  }
});

test('scoped 阈值: 未知 scope 静默回退默认(不报错，source=default)', () => {
  const { m } = mkScopedMon({ prod: { spikeFactor: 9 } });
  const c = m.config('nonexistent-scope');
  assert.equal(c.scope, 'nonexistent-scope');
  assert.equal(c.thresholds.spikeFactor.value, 7, '未知 scope 回退平铺文件默认');
  assert.equal(c.thresholds.spikeFactor.source, 'file');
});

test('scoped 阈值: dashboard 展示当前 scope 与可用 scope 列表(多舰队差异化阈值)', () => {
  const { m } = mkScopedMon({ prod: { spikeFactor: 9 }, llm: { inactiveMs: 1000 } });
  const html = m.renderDashboard(undefined, 'prod');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('scope'), '仪表盘应提及 scope(多舰队差异化阈值)');
  assert.ok(html.includes('prod'), '仪表盘应含当前 scope 名');
  assert.ok(html.includes('llm'), '仪表盘应列出可用 scope(llm)');
});

