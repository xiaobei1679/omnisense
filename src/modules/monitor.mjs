// 监控器官（Monitor）—— 统一观测 Agent 状态 / 记忆 / 多种状态检测 / 可视化驾驶舱
// ─────────────────────────────────────────────────────────────────────────────
// 把散落在 openclaw-workspace 的 health-observer.js / dashboard.mjs / observer.mjs
// 升格为 OmniSense 内核的一等公民（第 8 器官）。
//
// 设计原则（与框架一致）：零新增依赖、文件落盘、绝不阻断主流程、离线可跑、诚实降级。
//
// 借鉴（仅取思想，不照搬代码；诚实标注）：
//   - LangSmith / Langfuse / CloudWatch GenAI Observability 的"可观测三支柱"：
//     指标(延迟P50/P95/P99、成功率、错误率、吞吐) + 追踪(运行轨迹) + 日志。
//   - ClawHub greenhelix / OpenClaw Dashboard 的"舰队健康总览"：每个 agent 颜色化状态网格(green/yellow/red)。
//   - perfecxion.ai 的"记忆专属指标"：信任分分布、检索命中、陈旧记录、批量注入检测。
//   - 心跳/存活(heartbeat)模式：进程活着≠在干活；用"最后活跃"推导 degraded/down 状态。
//   - 工具管线健康(tool pipeline health)：每个工具的 P50/P95/P99 延迟分布与熔断状态——"工具可靠性是
//     agent 延迟的暗物质"(OpenLIT + VictoriaMetrics，https://openlit.io/blogs/victoriametrics-openlit-agents-observability)；
//     a 2% 工具错误率经 10 次工具调用会放大成高得多的 workflow 失败率。熔断开启(circuit_open)即 agent
//     流水线降级信号(借鉴 dev.to 的 AgentCircuitBreaker 思想：https://dev.to/pockit_tools/llm-observability-deep-dive-how-to-monitor-trace-and-debug-ai-agents-in-production-2mob)。
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { EVENTS } from '../core/bus.mjs';
import { log } from '../core/logger.mjs';

const DEFAULT_METRIC_FILE = './.omni-health-metrics.json';
const INACTIVE_MS = 48 * 3600 * 1000;   // 48h 无产出即告警（兼容 health-observer）
const SPIKE_FACTOR = 2;                  // 失败率/延迟飙升至基线 2x 即告警
const MEM_STALE_MS = 7 * 86400000;       // 记忆记录 >7d 视为"陈旧"
const MEM_BULK_THRESHOLD = 20;           // 单次检查记忆层增长 ≥20 条 → 疑似批量注入
const LIVENESS_HEALTHY_MS = 3600000;     // <1h 视为活跃(healthy)
const LIVENESS_DEGRADED_MS = 86400000;   // 1h~24h 降级(degraded)，>24h 失联(down)
const MAX_TREND_POINTS = 120;            // 趋势点环形缓冲上限（约 120 次快照，足够观察曲线形态）

// ── 阈值配置（可调，避免硬编码告警阈值这一反模式）──
// 借鉴 Prometheus/Grafana 可观测最佳实践：「先监控建立基线，再据基线设阈值；阈值应动态化而非固定值，
// 以减少误报」(https://alwaysinvictus.blog.csdn.net/article/details/157546925 · https://www.grafana.com/docs/grafana/latest/alerting/examples/dynamic-thresholds/)。
// 不同部署（吵闹/安静、快/慢机器）需要不同阈值——把所有告警/异常阈值抽成一份可观测、可覆盖的配置：
//   优先级：构造 opts.thresholds > 环境变量 > 内置默认。每个阈值的生效来源在 config() 里诚实标注。
// 全部零依赖、离线、可测；不设环境变量时行为与旧版完全一致（默认值即旧硬编码值）。
const THRESHOLD_SPEC = {
  // key: [环境变量名, 默认值, 单位/说明]
  inactiveMs:          ['OMNI_MONITOR_INACTIVE_MS', INACTIVE_MS, 'ms · 无产出多久判 inactive 告警'],
  spikeFactor:         ['OMNI_MONITOR_SPIKE_FACTOR', SPIKE_FACTOR, 'x · 失败率/延迟飙升至基线几倍判突增'],
  memStaleMs:          ['OMNI_MONITOR_MEM_STALE_MS', MEM_STALE_MS, 'ms · 记忆记录多久判「陈旧」'],
  memBulk:             ['OMNI_MONITOR_MEM_BULK', MEM_BULK_THRESHOLD, '条 · 单次检查记忆层增长几条判批量注入'],
  livenessHealthyMs:   ['OMNI_MONITOR_LIVENESS_HEALTHY_MS', LIVENESS_HEALTHY_MS, 'ms · 引擎多久内算 healthy'],
  livenessDegradedMs:  ['OMNI_MONITOR_LIVENESS_DEGRADED_MS', LIVENESS_DEGRADED_MS, 'ms · 引擎多久内算 degraded（超出算 down）'],
  trendSlopeP95:       ['OMNI_MONITOR_TREND_SLOPE_P95', 50, 'ms/点 · P95 延迟趋势爬坡斜率阈值(trend_regression)'],
  trendSlopeSuccess:   ['OMNI_MONITOR_TREND_SLOPE_SUCCESS', 0.02, '/点 · 成功率趋势下降斜率阈值(trend_drift)'],
  trendSlopeMemGrow:   ['OMNI_MONITOR_TREND_SLOPE_MEM_GROW', 10, '条/点 · 记忆快速增长斜率阈值(trend_pre_warning)'],
  trendSlopeMemIdle:   ['OMNI_MONITOR_TREND_SLOPE_MEM_IDLE', 0.5, '条/点 · 记忆增长停滞斜率阈值(空转 pre_warning)'],
  trendSlopeFleet:     ['OMNI_MONITOR_TREND_SLOPE_FLEET', 0.5, '/点 · 舰队健康引擎数下降斜率阈值(trend_regression)'],
};

// 阈值配置来源之三：JSON 文件（Observability-as-Code）。
// 借鉴 Grafana/Prometheus「阈值即配置、纳入版本控制——每次阈值变更都是一次可审查的提交」实践
// （https://codelit.io/blog/observability-as-code · https://thegarnetwiki.com/devops/monitoring-as-code）：
// 把全部告警/异常阈值写成一份 JSON 配置，优先级 opts > 环境变量 > JSON文件 > 内置默认。
// 文件不存在/损坏时静默降级（绝不因观测配置影响主流程）。默认路径 ~/.omnisense/monitor.json，
// 可用构造 opts.thresholdFile 或环境变量 OMNI_MONITOR_CONFIG 指向任意路径（也支持测试用临时文件）。
const DEFAULT_MONITOR_CONFIG_PATH = (() => {
  try { return join(homedir(), '.omnisense', 'monitor.json'); } catch { return null; }
})();

// 读取并校验阈值 JSON 文件：仅保留 THRESHOLD_SPEC 中定义的 key（防御：忽略未知键，避免误配污染阈值）。
function loadThresholdFile(path) {
  if (!path || typeof path !== 'string') return null;
  try {
    if (!existsSync(path)) return null;
    const obj = JSON.parse(readFileSync(path, 'utf8'));
    if (!obj || typeof obj !== 'object') return null;
    const clean = {};
    for (const k of Object.keys(THRESHOLD_SPEC)) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) clean[k] = obj[k];
    }
    return Object.keys(clean).length ? clean : null;
  } catch { return null; }
}

// 解析单个阈值：opts 覆盖 > 环境变量 > JSON文件 > 默认；返回 { value, source }。
function resolveThreshold(key, opts, env, fileObj) {
  const [envKey, def] = THRESHOLD_SPEC[key];
  if (opts && Object.prototype.hasOwnProperty.call(opts, key)) {
    const v = Number(opts[key]);
    if (Number.isFinite(v)) return { value: v, source: 'opts' };
  }
  const raw = env ? env[envKey] : undefined;
  if (raw != null && String(raw).trim() !== '') {
    const v = Number(raw);
    if (Number.isFinite(v)) return { value: v, source: 'env' };
  }
  if (fileObj && Object.prototype.hasOwnProperty.call(fileObj, key)) {
    const v = Number(fileObj[key]);
    if (Number.isFinite(v)) return { value: v, source: 'file' };
  }
  return { value: def, source: 'default' };
}

function completedCount(runs) {
  return runs.filter(r => r.completed).length;
}
function lastActiveAt(runs) {
  const last = runs.length ? runs[runs.length - 1] : null;
  return last ? (last.finishedAt || last.startedAt || 0) : 0;
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[Math.floor(idx)];
}
function sparkline(values, w = 260, h = 46, color = '#5b8cff') {
  if (!values.length) return '<span class="muted">(无数据)</span>';
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const range = max - min || 1;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - ((v - min) / range) * h).toFixed(1)}`).join(' ');
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="vertical-align:middle"><polyline fill="none" stroke="${color}" stroke-width="2" points="${pts}"/></svg>`;
}

// 简单 OLS 线性回归斜率（x=index, y=value），用于趋势异常检测与阈值"当前值"对比。
function linRegSlope(values) {
  if (!Array.isArray(values) || values.length < 2) return 0;
  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const dx = i - meanX;
    num += dx * (values[i] - meanY);
    den += dx * dx;
  }
  return den === 0 ? 0 : num / den;
}

// 把 thresholdHealth 的着色状态(status ∈ ok/warn/over/na)映射为 Prometheus Alertmanager 的 severity 标签：
//   over → critical（红·严重，需立即处理）· warn → warning（黄·关注）· ok/na → none（无需告警）。
// Alertmanager 用 severity 标签做路由/静默/分组（severity="critical" 通常进电话/钉钉，warning 进工单），
// 故我们把"看板上的红黄绿"与"告警系统的严重度"对齐，让同一份健康数据既能可视化又能直推告警（离线不发送，
// 仅产出 Alertmanager 形状的 payload，对接方自行 POST /api/v2/alerts 即可，见 thresholdAlerts()）。
function severityOf(status) {
  if (status === 'over') return 'critical';
  if (status === 'warn') return 'warning';
  return 'none';
}

// 稳定的告警指纹：Alertmanager 用 fingerprint 做告警去重/聚合（同一 alertname+key 的多次采样视为同一告警）。
// 用内置 crypto 做确定性 sha1（非外部依赖），无需真随机/时间因子，保证同一阈值项的 fingerprint 跨运行稳定。
function fingerprint(str) {
  return createHash('sha1').update(String(str)).digest('hex').slice(0, 16);
}

export class Monitor {
  constructor(bus, omni, opts = {}) {
    this.bus = bus;
    this.omni = omni;
    this.metricsFile = opts.metricsFile || DEFAULT_METRIC_FILE;
    this._optsThresholds = opts.thresholds || null;
    // 阈值配置 JSON 文件（Observability-as-Code）：opts.thresholdFile > 环境变量 OMNI_MONITOR_CONFIG > 默认 ~/.omnisense/monitor.json
    const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
    this._thresholdFile = opts.thresholdFile || env.OMNI_MONITOR_CONFIG || DEFAULT_MONITOR_CONFIG_PATH;
    const fileObj = loadThresholdFile(this._thresholdFile);
    this._thresholdFileLoaded = !!fileObj;
    // 阈值配置：opts.thresholds 覆盖 > 环境变量 > JSON文件 > 内置默认；来源可经 config() 观测（诚实标注）。
    this._resolveConfig(this._optsThresholds, fileObj);
    // 记忆增长基线：内存缓存（检测更可靠、测试无文件污染），构造时若文件已有则载入以便跨进程延续。
    const seeded = this._loadMetrics();
    this._baseline = seeded._memBaseline || null;        // 稳定基线：供 memoryHealth.growth（自首次观察起的累计增长，仅首次建立）
    this._anomalyBase = seeded._anomalyBaseline || null; // 滑动基线：供 detectAnomalies 批量注入检测（每次检查后更新）
    this._trendPoints = Array.isArray(seeded._trend) ? seeded._trend : []; // 趋势点：供 trends() 时间序列（跨进程延续）
    this._wire();
  }

  _wire() {
    this.bus.register('monitor', 'snapshot', () => this.snapshot());
    this.bus.register('monitor', 'health', () => this.agentHealth());
    this.bus.register('monitor', 'alerts', () => this.checkAlerts());
    this.bus.register('monitor', 'dashboard', () => this.renderDashboard());
    this.bus.register('monitor', 'recordMetric', p => this.recordMetric(p && p.agent, p && p.metrics));
    this.bus.register('monitor', 'checkAlerts', p => this.checkAlerts(p && p.agent));
    // 新增（更全面的状态检测 / 可视化数据源）
    this.bus.register('monitor', 'latency', () => this.latencyStats(this._tracerRuns()));
    this.bus.register('monitor', 'statusGrid', () => this.statusGrid(this._tracerRuns()));
    this.bus.register('monitor', 'memoryHealth', () => this.memoryHealth());
    this.bus.register('monitor', 'anomalies', () => this.detectAnomalies());
    this.bus.register('monitor', 'recentRuns', p => this.recentRuns(p && p.limit));
    this.bus.register('monitor', 'toolHealth', () => this.toolHealth());
    this.bus.register('monitor', 'trends', p => this.trends(p || {}));
    this.bus.register('monitor', 'trendAnomalies', () => this._detectTrendAnomalies());
    this.bus.register('monitor', 'config', () => this.config());
    this.bus.register('monitor', 'thresholdHealth', () => this.thresholdHealth());
    this.bus.register('monitor', 'thresholdAlerts', () => this.thresholdAlerts());
    this.bus.register('monitor', 'alertables', () => this.thresholdAlerts());
  }

  // ── 阈值配置解析 + 观测 ──
  // 把所有告警/异常阈值收敛到 this.cfg（数值）与 this._cfgSource（来源），避免散落硬编码。
  _resolveConfig(optsThresholds, fileObj) {
    const env = (typeof process !== 'undefined' && process.env) ? process.env : {};
    this.cfg = {};
    this._cfgSource = {};
    for (const key of Object.keys(THRESHOLD_SPEC)) {
      const { value, source } = resolveThreshold(key, optsThresholds, env, fileObj);
      this.cfg[key] = value;
      this._cfgSource[key] = source;
    }
  }

  // 运行时切换阈值配置 JSON 文件并重新解析（不做破坏性重建）：
  // 常用于 CLI `monitor --config-file=<path>` / 工作区 `omnisense-link monitor --config-file=<path>`。
  // 优先级保持 opts > env > json文件 > 默认；返回加载结果与当前生效覆盖清单。
  loadConfigFile(path) {
    this._thresholdFile = path || null;
    const fileObj = loadThresholdFile(path);
    this._thresholdFileLoaded = !!fileObj;
    this._resolveConfig(this._optsThresholds, fileObj);
    const cfg = this.config();
    return { ok: true, configFile: this._thresholdFile, loaded: !!fileObj, count: cfg.count, overrides: cfg.overrides };
  }

  // 返回当前生效的阈值配置（值 + 来源 default/env/opts + 环境变量名 + 说明），供 CLI/工作区/仪表盘观测。
  // 让「阈值为什么是这个数、能怎么调」透明可查（可观测性最佳实践：阈值应可见、可调、可溯源）。
  config() {
    const thresholds = {};
    for (const key of Object.keys(THRESHOLD_SPEC)) {
      const [envKey, def, desc] = THRESHOLD_SPEC[key];
      thresholds[key] = {
        value: this.cfg[key],
        source: this._cfgSource[key],
        envKey,
        default: def,
        overridden: this._cfgSource[key] !== 'default',
        desc,
      };
    }
    const overrides = Object.keys(thresholds).filter(k => thresholds[k].overridden);
    return { ok: true, thresholds, overrides, count: overrides.length, metricsFile: this.metricsFile, configFile: this._thresholdFile || null, configFileLoaded: this._thresholdFileLoaded };
  }

  // ── 阈值健康（threshold health）：把"当前测量值"与生效阈值并排对比，红黄绿着色 ──
  // 借鉴 Grafana 阈值的"红黄绿"状态着色（Base=green / warning=yellow / critical=red，
  // https://grafana.com/docs/grafana/latest/visualizations/panels-visualizations/configure-thresholds/）——
  // 不只告诉运维"阈值是多少"，更直观显示"现在离阈值有多近、是否已超标"，一眼看出身体在退化还是健康。
  // 全部带保护、读优先（绝不因观测改动状态/基线）：无数据时对应维度标 na(灰)，绝不伪造读数。
  _measureCurrent() {
    const runs = this._tracerRuns();
    const now = Date.now();
    const la = lastActiveAt(runs);
    const idleMs = la ? now - la : null;          // 距上次活动(ms)，对比 inactiveMs

    // 引擎存活：所有引擎中"最久未活跃"的那一个（liveness 最坏情况），对比 liveness*Ms
    let maxEngineIdleMs = null;
    try {
      const grid = this.statusGrid(runs).grid;
      for (const g of grid) if (g.ageHours != null && g.ageHours >= 0) {
        const ms = g.ageHours * 3600000;
        if (maxEngineIdleMs == null || ms > maxEngineIdleMs) maxEngineIdleMs = ms;
      }
    } catch { /* noop */ }

    // 记忆最陈旧记录的年龄(ms)，对比 memStaleMs
    let maxMemAgeMs = null;
    try {
      const mem = this.omni && this.omni.memory;
      if (mem) {
        const ages = [].concat(
          (mem.notes || []).map(n => n.t).filter(Boolean),
          (mem.knowledge || []).map(k => k.at).filter(Boolean),
          (mem.skills || []).map(s => s.at).filter(Boolean),
        ).map(t => now - t);
        if (ages.length) maxMemAgeMs = Math.max(...ages);
      }
    } catch { /* noop */ }

    // 记忆增长(自上次异常检查基线)，对比 memBulk（读 _anomalyBase，不改动它）
    let memGrowth = null;
    if (this._anomalyBase) {
      const cur = this._currentLayers();
      memGrowth = Math.max(0, ...['memory', 'rule', 'skill', 'knowledge'].map(k => cur[k] - (this._anomalyBase[k] || 0)));
    }

    // 突增倍数：近 10 次 P95 / 基线 P95，或近 5 次失败率 / 基线失败率，对比 spikeFactor
    let spikeRatio = null;
    if (runs.length >= 20) {
      const baseRuns = runs.slice(0, -10).map(r => r.durationMs).filter(d => typeof d === 'number' && d > 0).sort((a, b) => a - b);
      const recent = runs.slice(-10).map(r => r.durationMs).filter(d => typeof d === 'number' && d > 0).sort((a, b) => a - b);
      if (baseRuns.length && recent.length) {
        const p95a = percentile(baseRuns, 95), p95r = percentile(recent, 95);
        if (p95a) spikeRatio = p95r / p95a;
      }
    }
    if (spikeRatio == null && runs.length >= 5) {
      const total = runs.length, baseRate = (total - completedCount(runs)) / total;
      const recent = runs.slice(-5);
      const recentRate = (recent.length - completedCount(recent)) / recent.length;
      if (baseRate > 0) spikeRatio = recentRate / baseRate;
    }

    // 趋势斜率：当前 P95/成功率/记忆/舰队 的 OLS 斜率，对比各 trendSlope* 阈值
    const pts = this._trendPoints;
    let trendP95 = null, trendSuccess = null, trendMem = null, trendFleet = null;
    if (pts.length >= 4) {
      const p95s = pts.map(p => p.p95).filter(v => v != null);
      const srs = pts.map(p => p.successRate).filter(v => v != null);
      const mems = pts.map(p => p.memTotal).filter(v => v != null);
      const fleets = pts.map(p => p.fleetHealthy).filter(v => v != null);
      if (p95s.length >= 4) trendP95 = linRegSlope(p95s);
      if (srs.length >= 4) trendSuccess = linRegSlope(srs);
      if (mems.length >= 4) trendMem = linRegSlope(mems);
      if (fleets.length >= 4) trendFleet = linRegSlope(fleets);
    }

    return { idleMs, maxEngineIdleMs, maxMemAgeMs, memGrowth, spikeRatio, trendP95, trendSuccess, trendMem, trendFleet };
  }

  // 返回每个阈值的"当前测量值 + 状态(ok/warn/over/na) + 阈值来源"，供 CLI/工作区/仪表盘做红黄绿着色。
  // status 语义（对齐 Grafana 红黄绿）：ok=绿(在阈值内/健康) · warn=黄(接近或轻度超标，关注) · over=红(超标) · na=灰(无数据)。
  thresholdHealth() {
    const cur = this._measureCurrent();
    const cfg = this.config().thresholds;
    const items = [];
    const add = (key, current, status, unit) => items.push({
      key,
      description: cfg[key].desc,
      unit,
      threshold: { value: cfg[key].value, source: cfg[key].source, envKey: cfg[key].envKey },
      current: current == null ? null : current,
      status,
      severity: severityOf(status), // 对齐 Prometheus Alertmanager severity 标签（over→critical / warn→warning / 其余→none）
    });
    // 无活动 = na（既不报"健康"也不报"超标"，避免伪造读数）
    {
      const t = cfg.inactiveMs.value;
      const st = cur.idleMs == null ? 'na' : (cur.idleMs > t ? 'over' : 'ok');
      add('inactiveMs', cur.idleMs, st, 'ms');
    }
    {
      const t = cfg.spikeFactor.value;
      const st = cur.spikeRatio == null ? 'na' : (cur.spikeRatio > t ? 'over' : 'ok');
      add('spikeFactor', cur.spikeRatio == null ? null : Number(cur.spikeRatio.toFixed(2)), st, 'x');
    }
    {
      const t = cfg.memStaleMs.value;
      const st = cur.maxMemAgeMs == null ? 'na' : (cur.maxMemAgeMs > t ? 'warn' : 'ok');
      add('memStaleMs', cur.maxMemAgeMs, st, 'ms');
    }
    {
      const t = cfg.memBulk.value;
      const st = cur.memGrowth == null ? 'na' : (cur.memGrowth >= t ? 'warn' : 'ok');
      add('memBulk', cur.memGrowth, st, '条');
    }
    {
      const idle = cur.maxEngineIdleMs;
      const th = cfg.livenessHealthyMs.value, td = cfg.livenessDegradedMs.value;
      const stH = idle == null ? 'na' : (idle > th ? (idle > td ? 'over' : 'warn') : 'ok');
      const stD = idle == null ? 'na' : (idle > td ? 'over' : 'ok');
      add('livenessHealthyMs', idle, stH, 'ms');
      add('livenessDegradedMs', idle, stD, 'ms');
    }
    {
      const t = cfg.trendSlopeP95.value;
      const st = cur.trendP95 == null ? 'na' : (cur.trendP95 > t ? 'warn' : 'ok');
      add('trendSlopeP95', cur.trendP95 == null ? null : Number(cur.trendP95.toFixed(1)), st, 'ms/点');
    }
    {
      const t = cfg.trendSlopeSuccess.value;
      const st = cur.trendSuccess == null ? 'na' : (cur.trendSuccess < -t ? 'warn' : 'ok');
      add('trendSlopeSuccess', cur.trendSuccess == null ? null : Number(cur.trendSuccess.toFixed(3)), st, '/点');
    }
    {
      const t = cfg.trendSlopeMemGrow.value;
      const st = cur.trendMem == null ? 'na' : (cur.trendMem > t ? 'warn' : 'ok');
      add('trendSlopeMemGrow', cur.trendMem == null ? null : Number(cur.trendMem.toFixed(1)), st, '条/点');
    }
    {
      const t = cfg.trendSlopeMemIdle.value;
      const st = cur.trendMem == null ? 'na' : (this._trendPoints.length >= 6 && Math.abs(cur.trendMem) < t ? 'warn' : 'ok');
      add('trendSlopeMemIdle', cur.trendMem == null ? null : Number(cur.trendMem.toFixed(1)), st, '条/点');
    }
    {
      const t = cfg.trendSlopeFleet.value;
      const st = cur.trendFleet == null ? 'na' : (cur.trendFleet < -t ? 'warn' : 'ok');
      add('trendSlopeFleet', cur.trendFleet == null ? null : Number(cur.trendFleet.toFixed(2)), st, '/点');
    }
    const summary = { total: items.length, ok: 0, warn: 0, over: 0, na: 0 };
    for (const it of items) summary[it.status]++;
    return { ok: true, items, summary };
  }

  // ── 阈值告警清单（Alertmanager-ready）：把"超标/关注"的阈值项转成可直接提交给 Prometheus Alertmanager
  //     的告警 payload（labels + annotations + 稳定 fingerprint），让看板上的红黄绿能"直推"外部告警系统。
  // 借鉴 Prometheus Alertmanager 的告警数据模型（https://prometheus.io/docs/alerting/latest/alertmanager/、
  // https://michele.incuda.com/2022/07/14/introduction-to-prometheus-alertmanager/）：
  //   - labels：标识告警身份（alertname/severity/monitor/key/status），severity ∈ {critical, warning} 用于路由/静默/分组
  //   - annotations：人类可读的上下文（summary/description/当前值/阈值/来源），对应 Alertmanager annotations
  //   - fingerprint：同一 alertname+key 的稳定哈希，用于告警去重聚合（对齐 Alertmanager fingerprint 语义）
  // 诚实边界：本框架离线运行、不主动外发；这里只产出"与 Alertmanager API 形状一致"的 payload，
  //   接入方可把 alerts[] 直接 POST 到 Alertmanager `POST /api/v2/alerts`（或经 webhook），无需格式转换。
  // 全部零依赖（仅用内置 crypto 生成 fingerprint）；none 状态（ok/na）不产出告警，绝不伪造告警。
  thresholdAlerts() {
    const th = this.thresholdHealth();
    const alerts = th.items
      .filter(it => it.severity !== 'none')
      .map(it => {
        const alertname = `omnisense_threshold_${it.key}`;
        const fp = fingerprint(`${alertname}|${it.key}`);
        const isOver = it.status === 'over';
        return {
          fingerprint: fp,
          status: it.status,
          severity: it.severity,
          labels: {
            alertname,
            severity: it.severity,    // critical | warning（Alertmanager 路由/静默依据）
            monitor: 'omnisense',
            key: it.key,
            status: it.status,
          },
          annotations: {
            summary: `${it.key} ${isOver ? '超标' : '关注'}（${isOver ? 'critical' : 'warning'}）`,
            description: it.description,
            current: it.current == null ? 'na' : String(it.current),
            threshold: `${it.threshold.value}（来源 ${it.threshold.source}）`,
            envKey: it.threshold.envKey,
            source: it.threshold.source,
          },
          generatedAt: new Date().toISOString(),
        };
      });
    const critical = alerts.filter(a => a.severity === 'critical').length;
    const warning = alerts.filter(a => a.severity === 'warning').length;
    return { ok: true, count: alerts.length, critical, warning, alerts };
  }

  // ── 数据来源（全部带保护，缺失即降级为空）──
  _tracerRuns() {
    try { return (this.omni && this.omni.tracer && this.omni.tracer.runs) || []; }
    catch { return []; }
  }
  _layerSnapshotSafe() {
    try { const m = this.omni && this.omni.memory; return (m && m.layerSnapshot) ? m.layerSnapshot() : null; }
    catch { return null; }
  }
  _currentLayers() {
    const s = this._layerSnapshotSafe();
    if (!s) return { memory: 0, rule: 0, skill: 0, knowledge: 0 };
    return {
      memory: (s.memory.keys + s.memory.facts + s.memory.notes),
      rule: s.rule, skill: s.skill, knowledge: s.knowledge,
    };
  }

  // ── ① 延迟指标（P50/P95/P99，借鉴可观测三支柱的"延迟分布"）──
  latencyStats(runs = this._tracerRuns()) {
    const durs = runs.filter(r => typeof r.durationMs === 'number' && r.durationMs > 0)
      .map(r => r.durationMs).sort((a, b) => a - b);
    const byEngine = {};
    for (const r of runs) {
      if (typeof r.durationMs !== 'number' || r.durationMs <= 0) continue;
      const e = r.engine || 'unknown';
      (byEngine[e] = byEngine[e] || []).push(r.durationMs);
    }
    for (const e of Object.keys(byEngine)) byEngine[e].sort((a, b) => a - b);
    const pe = e => {
      const arr = byEngine[e];
      return { count: arr.length, p50: percentile(arr, 50), p95: percentile(arr, 95), p99: percentile(arr, 99),
        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) };
    };
    return {
      count: durs.length,
      p50: percentile(durs, 50), p95: percentile(durs, 95), p99: percentile(durs, 99),
      avg: durs.length ? Math.round(durs.reduce((a, b) => a + b, 0) / durs.length) : null,
      byEngine: Object.fromEntries(Object.keys(byEngine).map(e => [e, pe(e)])),
    };
  }

  // ── ② 状态网格（借鉴"舰队健康总览"：每引擎颜色化健康）──
  statusGrid(runs = this._tracerRuns()) {
    const byEngine = {};
    for (const r of runs) {
      const e = r.engine || 'unknown';
      const g = byEngine[e] || (byEngine[e] = { total: 0, completed: 0, last: 0 });
      g.total++; if (r.completed) g.completed++;
      const t = r.finishedAt || r.startedAt || 0;
      if (t > g.last) g.last = t;
    }
    const now = Date.now();
    const rank = { healthy: 0, degraded: 1, critical: 2, unknown: 1, down: 2 };
    const grid = Object.entries(byEngine).map(([engine, g]) => {
      const errorRate = g.total ? (g.total - g.completed) / g.total : 0;
      const ageMs = g.last ? now - g.last : Infinity;
      const liveness = g.last ? (ageMs < this.cfg.livenessHealthyMs ? 'healthy' : ageMs < this.cfg.livenessDegradedMs ? 'degraded' : 'down') : 'unknown';
      const errState = errorRate <= 0.01 ? 'healthy' : errorRate <= 0.05 ? 'degraded' : 'critical';
      const status = [liveness, errState].sort((a, b) => rank[b] - rank[a])[0];
      return {
        engine, total: g.total, completed: g.completed,
        errorRate: Number(errorRate.toFixed(3)),
        lastSeenAt: g.last ? new Date(g.last).toISOString() : null,
        ageHours: g.last ? Math.round(ageMs / 3600000) : null,
        liveness, status,
      };
    });
    const fleet = { healthy: 0, degraded: 0, down: 0, unknown: 0 };
    for (const g of grid) fleet[g.status === 'critical' ? 'down' : g.status]++;
    return { grid, fleet };
  }

  // ── ⑤ 工具管线健康（tool pipeline health）：缓存命中 + 熔断状态 + 每工具延迟分布 ──
  // 借鉴 OpenLIT「工具可靠性是 agent 延迟的暗物质」：把工具级缓存/熔断/延迟并到可观测面板。
  // 全部带保护：缺 tool* 函数即降级为空，绝不因观测逻辑影响主流程。
  toolHealth() {
    let cache = { size: 0, keys: [] };
    try {
      const c = this.omni && this.omni.toolCacheStats ? this.omni.toolCacheStats() : null;
      if (c) cache = { size: c.size || 0, keys: Array.isArray(c.keys) ? c.keys : [] };
    } catch { /* 观测不影响主流程 */ }
    let breakers = [];
    try {
      const b = this.omni && this.omni.toolBreakerStatus ? this.omni.toolBreakerStatus() : null;
      if (Array.isArray(b)) breakers = b;
    } catch { /* 观测不影响主流程 */ }
    const openCircuits = breakers.filter(x => x && x.open).length;
    return { ok: true, cache, breakers, openCircuits, toolLatency: this._toolLatency() };
  }

  // ── ⑥ 趋势基线（trend baseline）：把每次快照的关键指标落盘为时间序列，画随"时间"变化的 sparkline。
  // 借鉴 Prometheus/Grafana 的时序面板思想（histogram_quantile(p95)[5m]、周环比回归 TTFTRegression 等）：
  // 单点数值看不到"在变好还是在变坏"，必须看趋势。零依赖、离线、落盘跨进程延续。
  _trendSeries(win) {
    const series = (key) => win.map(p => (p && typeof p[key] === 'number' ? p[key] : null));
    return {
      p95: series('p95'), p50: series('p50'), successRate: series('successRate'),
      memTotal: series('memTotal'), openCircuits: series('openCircuits'),
      fleetHealthy: series('fleetHealthy'), fleetDown: series('fleetDown'),
    };
  }

  // 每次 snapshot 落盘一个轻量趋势点（持久化到指标文件，跨进程延续）。
  _appendTrend(s) {
    const pt = {
      t: s.generatedAt,
      p95: s.latency && s.latency.p95 != null ? s.latency.p95 : null,
      p50: s.latency && s.latency.p50 != null ? s.latency.p50 : null,
      successRate: s.activity && typeof s.activity.successRate === 'number' ? s.activity.successRate : null,
      totalRuns: s.activity ? s.activity.totalRuns : null,
      memTotal: s.memoryHealth && s.memoryHealth.layers
        ? (s.memoryHealth.layers.memory + s.memoryHealth.layers.rule + s.memoryHealth.layers.skill + s.memoryHealth.layers.knowledge)
        : null,
      openCircuits: s.toolHealth ? s.toolHealth.openCircuits : null,
      fleetHealthy: s.statusGrid && s.statusGrid.fleet ? (s.statusGrid.fleet.healthy || 0) : null,
      fleetDown: s.statusGrid && s.statusGrid.fleet ? (s.statusGrid.fleet.down || 0) : null,
    };
    this._trendPoints.push(pt);
    if (this._trendPoints.length > MAX_TREND_POINTS) this._trendPoints = this._trendPoints.slice(-MAX_TREND_POINTS);
    try {
      const all = this._loadMetrics();
      all._trend = this._trendPoints;
      this._saveJson(this.metricsFile, all);
    } catch { /* 静默：观测不应影响主流程 */ }
  }

  // 返回时间序列趋势（可选 limit 只看最近 N 个点）：原始点 + 各指标 series + sparkline SVG。
  trends(opts = {}) {
    const pts = this._trendPoints;
    const limit = opts && opts.limit && opts.limit > 0 ? opts.limit : pts.length;
    const win = pts.slice(-limit);
    const series = this._trendSeries(win);
    const spark = (key, color) => sparkline(series[key].filter(v => v != null), 260, 46, color);
    return {
      count: pts.length,
      points: win,
      series,
      sparkline: {
        p95: spark('p95', '#f85149'),
        successRate: spark('successRate', '#3fb950'),
        memTotal: spark('memTotal', '#5b8cff'),
      },
      last: pts.length ? pts[pts.length - 1] : null,
    };
  }

  // snapshot 内嵌的精简趋势（JSON 干净，不含 sparkline SVG）。
  _trendSummary() {
    const pts = this._trendPoints;
    return { count: pts.length, last: pts.length ? pts[pts.length - 1] : null, series: this._trendSeries(pts) };
  }

  // ── 趋势异常检测（trend-based anomaly detection）：随时间变化的渐进式退化
  // 借鉴业界最佳实践（OpenObserve/AIOps 2026 + Drift Detection 思想 + LangSmith 时序评估框架）：
  //   逐新的退化(gradual degradation)比突发尖峰更难抓——"慢煮青蛙"式 P95 爬坡(→regression)、
  //   成功率缓慢下降(→drift)、记忆增长停滞(→可能空转)都需要趋势回归法检测。
  // 零依赖：仅基于 _trendPoints 的时序列做简单线性回归 + 符号判定。
  // 设计原则：宁可误报也不漏报（info 级告警用于 pre-warning，warning 级用于退化）。
  _detectTrendAnomalies() {
    const pts = this._trendPoints;
    if (pts.length < 4) return []; // 最少 4 个趋势点才能看出趋势

    // 线性回归斜率 (简单 OLS，x=index, y=value) —— 复用模块级 linRegSlope
    const alerts = [];

    // 1. P95 延迟趋势回归检测：延迟持续上升 → trend_regression
    const p95s = pts.map(p => p.p95).filter(v => v != null);
    if (p95s.length >= 4) {
      const slope = linRegSlope(p95s);
      if (slope > this.cfg.trendSlopeP95) { // 每趋势点爬升超阈值(默认 >50ms)
        const recent = p95s.slice(-3);
        alerts.push({
          level: 'warning', type: 'trend_regression',
          message: `P95 延迟持续上升（斜率 ${slope.toFixed(0)}ms/点，最近 3 次均值 ${Math.round(recent.reduce((a, b) => a + b, 0) / recent.length)}ms，初始 ${Math.round(p95s[0])}ms）——"慢煮青蛙"式退化`,
          agent: 'latency',
        });
      }
    }

    // 2. 成功率趋势漂移检测：成功率持续下降 → trend_drift
    const srs = pts.map(p => p.successRate).filter(v => v != null);
    if (srs.length >= 4) {
      const slope = linRegSlope(srs);
      if (slope < -this.cfg.trendSlopeSuccess) { // 每趋势点下降超阈值(默认 >2%)
        alerts.push({
          level: 'warning', type: 'trend_drift',
          message: `成功率持续下降（斜率 ${(slope * 100).toFixed(1)}%/点，最近 3 次均值 ${(srs.slice(-3).reduce((a, b) => a + b, 0) / 3 * 100).toFixed(0)}%，初始 ${(srs[0] * 100).toFixed(0)}%）——Agent 行为漂移`,
          agent: 'quality',
        });
      }
    }

    // 3. 记忆增长趋势异常：快速增长（≈写入风暴）/ 增长停滞（≈空转）
    const mems = pts.map(p => p.memTotal).filter(v => v != null);
    if (mems.length >= 4) {
      const slope = linRegSlope(mems);
      if (slope > this.cfg.trendSlopeMemGrow) {
        alerts.push({
          level: 'info', type: 'trend_pre_warning',
          message: `记忆快速增长（斜率 ${slope.toFixed(1)}条/点，最近 3 次均值 ${Math.round(mems.slice(-3).reduce((a, b) => a + b, 0) / 3)} 条，初始 ${Math.round(mems[0])} 条）——可能的记忆写入风暴`,
          agent: 'memory',
        });
      }
      if (Math.abs(slope) < this.cfg.trendSlopeMemIdle && mems.length >= 6) {
        alerts.push({
          level: 'info', type: 'trend_pre_warning',
          message: `记忆增长近乎停滞（斜率 ${slope.toFixed(1)}条/点），身体可能处于"空转"状态，不记新东西`,
          agent: 'memory',
        });
      }
    }

    // 4. 舰队健康退化趋势：健康引擎数持续下降
    const fleets = pts.map(p => p.fleetHealthy).filter(v => v != null);
    if (fleets.length >= 4) {
      const slope = linRegSlope(fleets);
      if (slope < -this.cfg.trendSlopeFleet) {
        alerts.push({
          level: 'warning', type: 'trend_regression',
          message: `健康引擎数持续下降（斜率 ${slope.toFixed(2)}/点），舰队多个引擎可能正在逐步退化`,
          agent: 'fleet',
        });
      }
    }

    return alerts;
  }

  // ── ③ 记忆健康（借鉴 perfecxion 的"记忆专属指标"）──
  memoryHealth() {
    const mem = this.omni && this.omni.memory;
    if (!mem) return null;
    const layers = this._currentLayers();
    const skills = Array.isArray(mem.skills) ? mem.skills : [];
    const knowledge = Array.isArray(mem.knowledge) ? mem.knowledge : [];
    const notes = Array.isArray(mem.notes) ? mem.notes : [];
    const skillUtil = skills.length ? skills.filter(s => (s.hitCount || 0) > 0).length / skills.length : 0;
    const confidences = knowledge.map(k => (typeof k.confidence === 'number' ? k.confidence : 0.5));
    const avgConf = confidences.length ? Number((confidences.reduce((a, b) => a + b, 0) / confidences.length).toFixed(2)) : null;
    const lowConf = confidences.filter(c => c < 0.5).length;
    const now = Date.now();
    const staleMs = this.cfg.memStaleMs;
    let stale = 0;
    for (const n of notes) if (n.t && now - n.t > staleMs) stale++;
    for (const k of knowledge) if (k.at && now - k.at > staleMs) stale++;
    for (const s of skills) if (s.at && now - s.at > staleMs) stale++;
    const base = this._readBaseline();
    const growth = {};
    for (const k of ['memory', 'rule', 'skill', 'knowledge']) growth[k] = base ? (layers[k] - (base[k] || 0)) : 0;
    if (!this._baseline) this._saveBaseline(layers); // 仅首次建立稳定基线（不每次覆盖，否则 growth 恒为 0）
    return {
      layers, skillUtilization: Number(skillUtil.toFixed(2)), avgConfidence: avgConf,
      lowConfidence: lowConf, staleCount: stale, staleWindowDays: Math.round(staleMs / 86400000), growth, baseline: base,
    };
  }

  // ── ④ 异常检测（延迟突增 / 吞吐骤降 / 记忆批量注入 / 熔断开启 + 趋势退化检测）──
  detectAnomalies() {
    const runs = this._tracerRuns();
    const alerts = [];
    // 熔断开启：任何工具 breaker 处于 open 状态 → agent 流水线降级（诚实降级信号，借鉴 AgentCircuitBreaker 思想）
    try {
      const breakers = this.omni && this.omni.toolBreakerStatus ? this.omni.toolBreakerStatus() : null;
      if (Array.isArray(breakers)) {
        for (const b of breakers) {
          if (b && b.open) {
            alerts.push({
              level: 'warning', type: 'circuit_open',
              message: `工具 ${b.name} 熔断器开启（连续失败 ${b.fails || 0} 次），agent 工具流水线可能降级`,
              agent: 'tool:' + (b.name || 'unknown'),
            });
          }
        }
      }
    } catch { /* 观测不影响主流程 */ }
    // 延迟突增：近 10 次 P95 > 基线(排除近 10 次) P95 的 2x
    if (runs.length >= 20) {
      const baseRuns = runs.slice(0, -10).map(r => r.durationMs).filter(d => typeof d === 'number' && d > 0).sort((a, b) => a - b);
      const recent = runs.slice(-10).map(r => r.durationMs).filter(d => typeof d === 'number' && d > 0).sort((a, b) => a - b);
      if (baseRuns.length && recent.length) {
        const p95a = percentile(baseRuns, 95), p95r = percentile(recent, 95);
        if (p95a && p95r > p95a * this.cfg.spikeFactor) {
          alerts.push({ level: 'warning', type: 'duration_spike', message: `近 10 次 P95 延迟 ${p95r}ms 飙升至基线 ${p95a}ms 的 ${(p95r / p95a).toFixed(1)}x`, agent: 'latency' });
        }
      }
      // 吞吐骤降：历史有运行但近 1h 为 0
      const now = Date.now();
      const last1h = runs.filter(r => (r.startedAt || 0) > now - 3600000).length;
      const prior = runs.filter(r => (r.startedAt || 0) <= now - 3600000);
      if (prior.length && last1h === 0) {
        alerts.push({ level: 'warning', type: 'volume_drop', message: `近 1h 无新运行，但历史有 ${prior.length} 条（吞吐骤降）`, agent: 'throughput' });
      }
    }
    // 记忆批量注入：自上次异常检查某层增长 ≥ 阈值（滑动基线，每次检查后更新，
    // 避免单次 snapshot 内 memoryHealth 覆盖基线导致批量注入检测永不触发）。
    const base = this._anomalyBase;
    if (base) {
      const cur = this._currentLayers();
      for (const k of ['memory', 'rule', 'skill', 'knowledge']) {
        const d = cur[k] - (base[k] || 0);
        if (d >= this.cfg.memBulk) {
          alerts.push({ level: 'warning', type: 'memory_bulk_injection', message: `记忆层 ${k} 自上次检查增长 ${d} 条（疑似批量注入）`, agent: 'memory' });
        }
      }
    }
    this._anomalyBase = this._currentLayers();
    this._saveAnomalyBaseline(this._anomalyBase);
    // 趋势退化检测（渐进退化比突发尖峰更难抓：P95 爬坡/成功率漂移/记忆空转）
    for (const ta of this._detectTrendAnomalies()) alerts.push(ta);
    // 去重：相同 type+agent 的告警只保留一条（防趋势检测叠在点异常上产生噪声）
    const seen = new Set();
    const deduped = [];
    for (const a of alerts) {
      const k = a.type + ':' + a.agent;
      if (seen.has(k)) continue;
      seen.add(k);
      deduped.push(a);
    }
    return deduped;
  }

  // ── 统一告警 = 核心 4 信号 + 异常检测 ──
  allAlerts(agentId) {
    return [...this.checkAlerts(agentId), ...this.detectAnomalies()];
  }

  // ── 统一状态快照（可视化监控的核心数据；向下兼容旧字段）──
  snapshot() {
    const memory = this._layerSnapshotSafe();
    const runs = this._tracerRuns();
    const total = runs.length;
    const completed = completedCount(runs);
    const tracer = this.omni && this.omni.tracer;
    const autopilot = (tracer && tracer.findRunsByGoal) ? tracer.findRunsByGoal('autopilot', { limit: 5 }) : [];
    const la = lastActiveAt(runs);
    const anoms = this.detectAnomalies(); // 单次计算（同时推进滑动基线，避免被重复调用吞掉批量注入告警）
    const alerts = [...this.checkAlerts(), ...anoms];
    const organs = (this.omni && this.omni.body && this.omni.body.describe)
      ? this.omni.body.describe().map(o => ({ key: o.key, name: o.name, methods: o.methods.length }))
      : [];
    const grid = this.statusGrid(runs);
    const lat = this.latencyStats(runs);
    const memHealth = this.memoryHealth();
    const s = {
      generatedAt: new Date().toISOString(),
      status: alerts.some(a => a.level === 'error') ? 'degraded'
            : alerts.some(a => a.level === 'warning') ? 'warning' : 'healthy',
      organs: { count: organs.length, items: organs },
      memory,
      activity: {
        totalRuns: total,
        completedRuns: completed,
        successRate: total ? Number((completed / total).toFixed(3)) : 0,
        engineBreakdown: this._engineBreakdown(runs),
        lastActiveAt: la ? new Date(la).toISOString() : null,
        inactiveHours: la ? Math.round((Date.now() - la) / 3600000) : null,
        recentAutopilot: autopilot.map(r => ({
          runId: r.runId, completed: r.completed, durationMs: r.durationMs, stepCount: r.stepCount,
        })),
      },
      latency: lat,
      statusGrid: grid,
      memoryHealth: memHealth,
      toolHealth: this.toolHealth(),
      anomalies: anoms,
      recentRuns: this.recentRuns(12),
      alerts,
    };
    this._appendTrend(s);            // 落盘趋势点（每次快照累积时间序列，供 trends() 画随时间变化曲线）
    s.trend = this._trendSummary();  // 内嵌精简趋势，dashboard/JSON 直接可用
    return s;
  }

  _engineBreakdown(runs) {
    const m = {};
    for (const r of runs) m[r.engine] = (m[r.engine] || 0) + 1;
    return m;
  }

  // ── 工具级延迟分布（借鉴"工具可靠性是 agent 延迟的暗物质"：按工具聚合 P50/P95/P99）──
  _toolLatency(runs = this._tracerRuns()) {
    const byTool = {};
    for (const r of runs) {
      const steps = r && r.steps;
      if (!Array.isArray(steps)) continue;
      for (const s of steps) {
        const name = s && s.action;
        const d = s && typeof s.durationMs === 'number' ? s.durationMs : null;
        if (typeof name !== 'string' || !name || d == null || d <= 0) continue;
        (byTool[name] = byTool[name] || []).push(d);
      }
    }
    const out = {};
    for (const k of Object.keys(byTool)) {
      const arr = byTool[k].slice().sort((a, b) => a - b);
      out[k] = {
        count: arr.length,
        p50: percentile(arr, 50), p95: percentile(arr, 95), p99: percentile(arr, 99),
        avg: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
      };
    }
    return out;
  }

  // ── Agent 健康（基于 tracer 运行轨迹；向下兼容）──
  agentHealth() {
    const runs = this._tracerRuns();
    const total = runs.length;
    const completed = completedCount(runs);
    const la = lastActiveAt(runs);
    const errorRate = total ? Number(((total - completed) / total).toFixed(3)) : 0;
    const status = errorRate > 0.5 ? 'critical' : errorRate > 0.2 ? 'degraded' : 'healthy';
    return {
      ok: true, status, totalRuns: total, completedRuns: completed, errorRate,
      lastActiveAt: la ? new Date(la).toISOString() : null,
      inactiveHours: la ? Math.round((Date.now() - la) / 3600000) : null,
    };
  }

  // ── 核心 4 信号告警（连续失败 / 48h 无产出 / 失败率飙升 / 兼容 health-observer）──
  checkAlerts(agentId) {
    const runs = this._tracerRuns();
    const alerts = [];
    const completed = completedCount(runs);

    const tail = runs.slice(-3);
    if (tail.length >= 3 && tail.every(r => !r.completed)) {
      alerts.push({ level: 'error', type: 'consecutive_failures', message: '连续 3 次运行未完成', agent: 'tracer' });
    }
    const la = lastActiveAt(runs);
    const inactiveHrs = this.cfg.inactiveMs / 3600000;
    if (la) {
      const hrs = (Date.now() - la) / 3600000;
      if (hrs > inactiveHrs) alerts.push({ level: 'warning', type: 'inactive', message: `超过 ${Math.round(inactiveHrs)}h 无运行产出（${Math.round(hrs)}h）`, agent: 'tracer' });
    } else {
      alerts.push({ level: 'warning', type: 'no_data', message: '尚无任何运行轨迹', agent: 'tracer' });
    }
    if (runs.length >= 5) {
      const baseRate = (runs.length - completed) / runs.length;
      const recent = runs.slice(-5);
      const recentRate = (recent.length - completedCount(recent)) / recent.length;
      if (baseRate > 0 && recentRate > baseRate * this.cfg.spikeFactor) {
        alerts.push({
          level: 'warning', type: 'error_rate_spike',
          message: `近 5 次失败率 ${recentRate.toFixed(2)} 飙升至基线 ${baseRate.toFixed(2)} 的 ${(recentRate / baseRate).toFixed(1)}x`,
          agent: 'tracer',
        });
      }
    }

    const recorded = this._loadMetrics();
    // 排除所有内部键（_memBaseline/_anomalyBaseline/_trend 等），只遍历真正的 agent 指标历史。
    const ids = agentId ? [agentId] : Object.keys(recorded).filter(k => !k.startsWith('_'));
    for (const id of ids) {
      const hist = recorded[id];
      if (!Array.isArray(hist) || !hist.length) continue;
      const last3 = hist.slice(-3);
      if (last3.length >= 3 && last3.every(m => (m.errors || 0) > 0)) {
        alerts.push({ level: 'error', type: 'consecutive_errors', message: `${id} 连续 3 次报错`, agent: id });
      }
      const lastM = hist[hist.length - 1];
      if (lastM && (Date.now() - new Date(lastM.ts).getTime()) > this.cfg.inactiveMs) {
        alerts.push({ level: 'warning', type: 'inactive', message: `${id} 超过 ${Math.round(this.cfg.inactiveMs / 3600000)}h 无产出`, agent: id });
      }
    }
    return alerts;
  }

  // ── 最近运行时间线（trace-lite）──
  recentRuns(limit = 12) {
    const runs = this._tracerRuns();
    return runs.slice(-limit).reverse().map(r => ({
      runId: r.runId, engine: r.engine, completed: !!r.completed,
      durationMs: typeof r.durationMs === 'number' ? r.durationMs : null,
      stepCount: Array.isArray(r.steps) ? r.steps.length : 0,
      startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
      ageMinutes: r.startedAt ? Math.round((Date.now() - r.startedAt) / 60000) : null,
    }));
  }

  // ── 兼容 health-observer.js 的指标记录（可携带 errors/latencyMs/tokens/cost 等任意字段）──
  recordMetric(agentId, metrics = {}) {
    if (!agentId) return { ok: false, error: '需要 agentId' };
    const all = this._loadMetrics();
    all[agentId] = all[agentId] || [];
    all[agentId].push({ ts: new Date().toISOString(), ...metrics });
    const cutoff = Date.now() - 90 * 86400000;
    all[agentId] = all[agentId].filter(m => new Date(m.ts).getTime() >= cutoff);
    this._saveJson(this.metricsFile, all);
    return { ok: true, agent: agentId, recorded: metrics };
  }

  _loadMetrics() {
    try {
      if (existsSync(this.metricsFile)) return JSON.parse(readFileSync(this.metricsFile, 'utf8')) || {};
    } catch { /* 损坏则重建 */ }
    return {};
  }
  _readBaseline() {
    return this._baseline || null;
  }
  _saveBaseline(layers) {
    this._baseline = layers;
    // 跨进程延续：持久化到指标文件（失败静默，不影响主流程/检测）。
    try {
      const all = this._loadMetrics();
      all._memBaseline = layers;
      this._saveJson(this.metricsFile, all);
    } catch { /* 静默 */ }
  }
  _saveAnomalyBaseline(layers) {
    this._anomalyBase = layers;
    // 滑动基线持久化（供跨进程心跳的批量注入检测），失败静默。
    try {
      const all = this._loadMetrics();
      all._anomalyBaseline = layers;
      this._saveJson(this.metricsFile, all);
    } catch { /* 静默 */ }
  }
  _saveJson(file, obj) {
    try {
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(obj, null, 2));
      renameSync(tmp, file);
    } catch { /* 落盘失败静默：监控不应影响主流程 */ }
  }

  // ── 可视化：零依赖静态 HTML 仪表盘（作战指挥中心 / 驾驶舱风格）──
  renderDashboard(snapshot = this.snapshot()) {
    const s = snapshot;
    const genTime = new Date(s.generatedAt).toLocaleString('zh-CN', { hour12: false });
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pct = (p, w) => (w ? Math.round((p / w) * 100) : 0);
    const ms = (n) => (n == null ? '—' : n + 'ms');
    const statusColor = (st) => (st === 'healthy' ? '#3fb950' : (st === 'critical' || st === 'down') ? '#f85149' : '#d29922');

    const organHtml = (s.organs && s.organs.items || []).map(o =>
      `<li><span class="dot"></span><b>${esc(o.name)}</b> <code>${esc(o.key)}</code> · ${o.methods} 项能力</li>`).join('') || '<li>（无器官）</li>';

    const grid = (s.statusGrid && s.statusGrid.grid) || [];
    const fleet = (s.statusGrid && s.statusGrid.fleet) || {};
    const gridHtml = grid.length ? grid.map(g =>
      `<div class="ecard" style="border-left:4px solid ${statusColor(g.status)}">
        <div class="e-top"><span class="e-dot" style="background:${statusColor(g.status)}"></span><b>${esc(g.engine)}</b></div>
        <div class="e-row">状态: <span style="color:${statusColor(g.status)};font-weight:700">${esc(g.status)}</span></div>
        <div class="e-row">运行: ${g.total} · 完成: ${g.completed}</div>
        <div class="e-row">错误率: ${(g.errorRate * 100).toFixed(1)}%</div>
        <div class="e-row muted">最后活跃: ${g.ageHours == null ? '—' : g.ageHours + 'h 前'}</div>
      </div>`).join('') : '<div class="muted">（无运行轨迹，暂无引擎状态）</div>';

    const lat = s.latency || {};
    const latTrend = this._tracerRuns().filter(r => typeof r.durationMs === 'number' && r.durationMs > 0)
      .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)).slice(-30).map(r => r.durationMs);
    const latHtml = `
      <div class="cards3">
        <div class="mini"><div class="v">${ms(lat.p50)}</div><div class="l">P50 延迟</div></div>
        <div class="mini"><div class="v">${ms(lat.p95)}</div><div class="l">P95 延迟</div></div>
        <div class="mini"><div class="v">${ms(lat.p99)}</div><div class="l">P99 延迟</div></div>
      </div>
      <div style="margin-top:10px">${sparkline(latTrend)} <span class="muted">近 ${latTrend.length} 次延迟趋势(ms)</span></div>`;

    const mh = s.memoryHealth || {};
    const layers = mh.layers || (s.memory || {});
    const memRows = [
      ['Memory 记忆键/事实/笔记', layers.memory],
      ['Rule 规则', layers.rule],
      ['Skill 技能', layers.skill],
      ['Knowledge 知识', layers.knowledge],
    ];
    const memMax = Math.max(1, ...memRows.map(r => r[1] || 0));
    const memBars = memRows.map(r =>
      `<div class="row"><span class="lbl">${esc(r[0])}</span><span class="val">${r[1] || 0}</span>
        <span class="bar"><span style="width:${pct(r[1] || 0, memMax)}%"></span></span></div>`).join('');
    const growth = mh.growth || {};
    const growHtml = ['memory', 'rule', 'skill', 'knowledge'].map(k => {
      const d = growth[k] || 0;
      const col = d > 0 ? '#d29922' : d < 0 ? '#3fb950' : '#9aa3b2';
      return `<span class="chip">${esc(k)}: <span style="color:${col}">${d >= 0 ? '+' : ''}${d}</span></span>`;
    }).join(' ');
    const memHtml = `
      ${memBars}
      <div class="kv"><span>技能利用率</span><b>${(mh.skillUtilization != null ? (mh.skillUtilization * 100).toFixed(0) : '—')}%</b></div>
      <div class="kv"><span>平均信任分(confidence)</span><b>${mh.avgConfidence != null ? mh.avgConfidence : '—'}</b></div>
      <div class="kv"><span>低信任条目(&lt;0.5)</span><b>${mh.lowConfidence != null ? mh.lowConfidence : '—'}</b></div>
      <div class="kv"><span>陈旧记录(&gt;${mh.staleWindowDays || 7}d)</span><b>${mh.staleCount != null ? mh.staleCount : '—'}</b></div>
      <div style="margin-top:8px">增长(自上次检查): ${growHtml}</div>`;

    const th = s.toolHealth || {};
    const thCache = (th.cache && th.cache.size) || 0;
    const thOpen = th.openCircuits || 0;
    const thBreakers = Array.isArray(th.breakers) ? th.breakers : [];
    const thLat = th.toolLatency || {};
    const thLatRows = Object.keys(thLat).map(k => {
      const v = thLat[k];
      return `<div class="row"><span class="lbl">${esc(k)}</span><span class="val">${v.count}</span>
        <span class="muted">P50 ${v.p50 == null ? '—' : v.p50} · P95 ${v.p95 == null ? '—' : v.p95} · P99 ${v.p99 == null ? '—' : v.p99}ms</span></div>`;
    }).join('') || '<div class="muted">（暂无工具调用轨迹）</div>';
    const thBreakerHtml = thBreakers.length ? thBreakers.map(b => {
      const st = b.open ? '#f85149' : '#3fb950';
      const label = b.open ? '开启(降级)' : '正常';
      return `<span class="chip" style="border-color:${st};color:${st}">${esc(b.name)}: ${label}${b.open ? ` (${b.fails}/${b.maxFails} 失败)` : ''}</span>`;
    }).join(' ') : '<span class="chip">（无熔断记录）</span>';
    const toolHtml = `
      <div class="kv"><span>工具缓存条目</span><b>${thCache}</b></div>
      <div class="kv"><span>开启的熔断器</span><b style="color:${thOpen ? '#f85149' : '#3fb950'}">${thOpen}</b></div>
      <div style="margin-top:8px">熔断状态: ${thBreakerHtml}</div>
      <div style="margin-top:10px;color:var(--muted);font-size:12px">工具级延迟分布(P50/P95/P99):</div>
      <div style="margin-top:6px">${thLatRows}</div>`;

    const act = s.activity || {};
    const engHtml = Object.entries(act.engineBreakdown || {}).map(([k, v]) =>
      `<span class="chip">${esc(k)}: ${v}</span>`).join(' ') || '<span class="chip">（无）</span>';
    const errHtml = Object.entries(act.engineBreakdown || {}).map(([k, v]) => {
      const done = (s.recentRuns || []).filter(r => r.engine === k && r.completed).length;
      return `<div class="row"><span class="lbl">${esc(k)}</span><span class="val">${v}</span><span class="muted">完成 ${done}</span></div>`;
    }).join('') || '<div class="muted">（无）</div>';

    const alertHtml = (s.alerts || []).length
      ? s.alerts.map(a => `<li class="al ${a.level}"><span class="badge ${a.level}">${a.level}</span> ${esc(a.message)} <code>${esc(a.agent)}</code></li>`).join('')
      : '<li class="ok">✓ 一切正常</li>';

    const runHtml = (s.recentRuns || []).length
      ? s.recentRuns.map(r => `<li><span class="rdot ${r.completed ? 'ok' : 'bad'}"></span>
        <code>${esc(r.runId)}</code> · ${esc(r.engine)} · ${r.completed ? '完成' : '未完成'}
        · ${ms(r.durationMs)} · ${r.stepCount}步 · ${r.ageMinutes == null ? '' : r.ageMinutes + 'min前'}</li>`).join('')
      : '<li class="muted">（暂无运行）</li>';

    const fleetHtml = `<span class="chip" style="border-color:#3fb950;color:#3fb950">健康 ${fleet.healthy || 0}</span>
      <span class="chip" style="border-color:#d29922;color:#d29922">降级 ${fleet.degraded || 0}</span>
      <span class="chip" style="border-color:#f85149;color:#f85149">失联 ${fleet.down || 0}</span>
      <span class="chip">未知 ${fleet.unknown || 0}</span>`;

    // 趋势（trend baseline）：随时间变化的 sparkline（借鉴 Prometheus/Grafana 时序面板）
    const t = this.trends();
    const tLast = t.last || {};
    const tSr = tLast.successRate != null ? (tLast.successRate * 100).toFixed(0) + '%' : '—';
    const trendHtml = `
      <div class="cards3">
        <div class="mini"><div class="v">${ms(tLast.p95)}</div><div class="l">P95 延迟(最新)</div></div>
        <div class="mini"><div class="v">${tSr}</div><div class="l">成功率(最新)</div></div>
        <div class="mini"><div class="v">${tLast.memTotal == null ? '—' : tLast.memTotal}</div><div class="l">记忆总量(最新)</div></div>
      </div>
      <div style="margin-top:10px">${t.sparkline.p95} <span class="muted">P95 延迟趋势</span></div>
      <div style="margin-top:8px">${t.sparkline.successRate} <span class="muted">成功率趋势</span></div>
      <div style="margin-top:8px">${t.sparkline.memTotal} <span class="muted">记忆总量趋势</span></div>
      <div class="muted" style="margin-top:8px">采样点: ${t.count}（每次快照自动落盘轻量指标点，跨进程延续；环形缓冲上限 ${MAX_TREND_POINTS}）</div>`;

    // 阈值配置（可调）+ 阈值健康着色：把"当前测量值 vs 阈值"红黄绿并排展示（借鉴 Grafana 阈值状态着色）。
    // 不只告诉运维"阈值是多少"，更直观显示"现在离阈值多近、是否已超标"——可观测仪表盘的眼睛。
    const cfg = this.config();
    const thHealth = this.thresholdHealth();
    const statusColorOf = (st) => st === 'ok' ? '#3fb950' : st === 'warn' ? '#d29922' : st === 'over' ? '#f85149' : 'var(--muted)';
    const statusLabelOf = (st) => st === 'ok' ? '正常' : st === 'warn' ? '关注' : st === 'over' ? '超标' : '无数据';
    const fmtTh = (val, unit) => {
      if (val == null) return '—';
      if (unit === 'ms') { const a = Math.abs(val); if (a >= 3600000) return (val / 3600000).toFixed(1) + 'h'; if (a >= 60000) return (val / 60000).toFixed(0) + 'm'; if (a >= 1000) return (val / 1000).toFixed(0) + 's'; return Math.round(val) + 'ms'; }
      if (unit === 'x') return val.toFixed(1) + 'x';
      if (unit === '条') return Math.round(val) + ' 条';
      if (unit === 'ms/点') return val.toFixed(0) + 'ms/点';
      if (unit === '/点') return val.toFixed(3) + '/点';
      return String(val);
    };
    const cfgRows = thHealth.items.map(it => {
      const col = statusColorOf(it.status);
      return `<div class="row"><span class="lbl"><span class="th-dot" style="background:${col}"></span>${esc(it.key)}</span>
        <span class="val" style="color:${col}">${esc(fmtTh(it.current, it.unit))}</span>
        <span class="thr" style="color:${col}">/ ${esc(fmtTh(it.threshold.value, it.unit))}</span>
        <span class="muted">${statusLabelOf(it.status)} · ${esc(it.description)} · 来源 <b style="color:${col}">${esc(it.threshold.source)}</b> · <code>${esc(it.threshold.envKey)}</code></span></div>`;
    }).join('');
    // 可推送告警清单（Alertmanager 形状）：把"超标/关注"项转成 fingerprint+labels+annotations 的 payload，
    // 离线不发送，仅供对接方直接 POST 到 Alertmanager（见 thresholdAlerts()）。
    const ta = this.thresholdAlerts();
    const taRows = ta.alerts.length
      ? ta.alerts.map(a => {
        const col = a.severity === 'critical' ? '#f85149' : '#d29922';
        return `<div class="row"><span class="lbl"><span class="th-dot" style="background:${col}"></span>${esc(a.labels.key)}</span>
          <span class="val" style="color:${col}">${esc(a.severity)}</span>
          <span class="muted">${esc(a.annotations.summary)} · 当前 ${esc(a.annotations.current)} / 阈值 ${esc(a.annotations.threshold)} · fp:${esc(a.fingerprint)}</span></div>`;
      }).join('')
      : '<div class="muted">（无超标/关注项，阈值健康，暂无告警可推送）</div>';
    const taHtml = `
      <div style="margin-top:12px;color:var(--muted);font-size:12px">可推送告警清单（Alertmanager-ready · <code>labels{alertname,severity,monitor,key,status}</code> + <code>annotations</code> + 稳定 <code>fingerprint</code>，离线不发送，仅供对接方 POST 到 Alertmanager）</div>
      <div style="margin-top:6px">${taRows}</div>`;
    const cfgFileNote = cfg.configFile
      ? `<div class="muted" style="margin-bottom:6px">配置来源文件: <code>${esc(cfg.configFile)}</code>${cfg.configFileLoaded ? '' : '（未找到，已用默认/环境变量）'}</div>`
      : '';
    const worst = thHealth.summary.over ? 'over' : (thHealth.summary.warn ? 'warn' : 'ok');
    const cfgHtml = `
      <div class="muted" style="margin-bottom:8px">生效阈值 ${Object.keys(cfg.thresholds).length} 项 · 被覆盖 <b style="color:${cfg.count ? '#d29922' : '#3fb950'}">${cfg.count}</b> 项 · 阈值健康 <b style="color:${statusColorOf(worst)}">${thHealth.summary.ok}正常 / ${thHealth.summary.warn}关注 / ${thHealth.summary.over}超标 / ${thHealth.summary.na}无数据</b>（当前值 vs 阈值，红黄绿着色）</div>
      ${cfgFileNote}
      ${cfgRows}
      ${taHtml}`;

    return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OmniSense · 监控仪表盘</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--ink:#e7eaf0;--muted:#9aa3b2;--line:#262b36;--accent:#5b8cff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft Yahei",sans-serif;}
  .wrap{max-width:1040px;margin:0 auto;padding:32px 20px 56px;}
  header h1{margin:0 0 4px;font-size:22px;}
  header .gen{color:var(--muted);font-size:12px;}
  .status{display:inline-block;margin:14px 0;padding:8px 16px;border-radius:999px;font-weight:700;color:#0f1115;background:${statusColor(s.status)};}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0;}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;text-align:center;}
  .card .v{font-size:26px;font-weight:700;color:var(--accent);}
  .card .l{color:var(--muted);font-size:12px;margin-top:4px;}
  section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:18px;}
  section h2{margin:0 0 12px;font-size:15px;}
  ul{list-style:none;margin:0;padding:0;}
  li{padding:6px 0;border-bottom:1px solid var(--line);}
  li:last-child{border-bottom:0;}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;}
  code{color:var(--muted);font-size:12px;}
  .row{display:flex;align-items:center;gap:10px;padding:5px 0;}
  .row .lbl{width:150px;color:var(--muted);font-size:12px;}
  .row .val{width:46px;text-align:right;font-weight:700;}
  .th-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle;}
  .row .thr{width:auto;text-align:left;color:var(--muted);font-weight:400;margin-left:2px;font-size:12px;}
  .row .bar{flex:1;height:8px;background:var(--line);border-radius:6px;overflow:hidden;}
  .row .bar>span{display:block;height:100%;background:var(--accent);}
  .chip{display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:12px;}
  .kv{display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line);}
  .kv:last-child{border-bottom:0;}
  .muted{color:var(--muted);font-size:12px;}
  .ecards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;}
  .ecard{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;}
  .e-top{display:flex;align-items:center;gap:8px;margin-bottom:6px;}
  .e-dot{width:9px;height:9px;border-radius:50%;}
  .e-row{font-size:12px;padding:2px 0;}
  .cards3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;}
  .mini{background:var(--bg);border:1px solid var(--line);border-radius:10px;padding:12px;text-align:center;}
  .mini .v{font-size:22px;font-weight:700;color:var(--accent);}
  .mini .l{color:var(--muted);font-size:12px;}
  .al .badge{display:inline-block;min-width:54px;text-align:center;padding:1px 6px;border-radius:6px;font-size:11px;font-weight:700;color:#0f1115;}
  .badge.error{background:#f85149;}.badge.warning{background:#d29922;}.al.ok{color:var(--muted);}
  .al.error{color:#f85149;}.al.warning{color:#d29922;}
  .rdot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;}
  .rdot.ok{background:#3fb950;}.rdot.bad{background:#f85149;}
  footer{color:var(--muted);font-size:12px;margin-top:8px;}
  @media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr);}.cards3{grid-template-columns:1fr;}}
</style></head>
<body><div class="wrap">
  <header><h1>🩺 OmniSense · 监控仪表盘</h1>
    <div class="gen">生成时间 / Generated: ${esc(genTime)} · 零依赖静态页面，可离线打开</div></header>
  <div class="status">整体状态: ${esc(s.status)}</div>
  <div class="grid">
    <div class="card"><div class="v">${(s.organs && s.organs.count) || 0}</div><div class="l">器官数</div></div>
    <div class="card"><div class="v">${act.totalRuns || 0}</div><div class="l">运行轨迹</div></div>
    <div class="card"><div class="v">${act.successRate != null ? (act.successRate * 100).toFixed(0) + '%' : '—'}</div><div class="l">成功率</div></div>
    <div class="card"><div class="v">${act.inactiveHours != null ? act.inactiveHours + 'h' : '—'}</div><div class="l">距上次活动</div></div>
  </div>

  <section><h2>舰队健康 / Status Grid（引擎状态网格）</h2>
    <div style="margin-bottom:10px">${fleetHtml}</div>
    <div class="ecards">${gridHtml}</div>
  </section>

  <section><h2>延迟指标 / Latency（P50/P95/P99）</h2>${latHtml}</section>

  <section><h2>趋势 / Trends（随时间变化的指标基线 · sparkline）</h2>${trendHtml}</section>

  <section><h2>阈值配置 / Thresholds（可调告警阈值 · 来源可溯源 · 当前值 vs 阈值 红黄绿着色）</h2>${cfgHtml}</section>

  <section><h2>记忆状态 / Memory Health（四层 + 记忆专属指标）</h2>${memHtml}</section>

  <section><h2>工具管线健康 / Tool Pipeline Health（缓存 + 熔断 + 工具级延迟）</h2>${toolHtml}</section>

  <section><h2>器官状态 / Organs</h2><ul>${organHtml}</ul></section>

  <section><h2>活动 / Activity</h2>
    <div>引擎分布: ${engHtml}</div>
    <div style="margin-top:10px;color:var(--muted);font-size:12px">错误/完成分布(按引擎):</div>
    <div style="margin-top:6px">${errHtml}</div>
    <div style="margin-top:10px;color:var(--muted);font-size:12px">最近自驱(autopilot)轨迹:</div>
    <ul style="margin-top:6px">${(act.recentAutopilot || []).map(r => `<li>${esc(r.runId)} · 完成=${r.completed} · ${r.stepCount}步 · ${ms(r.durationMs)}</li>`).join('') || '<li class="muted">（暂无自驱轨迹）</li>'}</ul>
  </section>

  <section><h2>告警 / Alerts（${ (s.alerts || []).length } · 含异常检测）</h2><ul>${alertHtml}</ul></section>

  <section><h2>运行时间线 / Recent Runs</h2><ul>${runHtml}</ul></section>

  <footer>由监控器官 monitor 生成 · 复用 tracer(运行轨迹/延迟/工具级延迟) + memory(四层/记忆健康) + toolHealth(缓存/熔断) + 心跳式存活判定 + 异常检测 + 趋势基线(每次快照落盘轻量指标点，画随时间变化的 sparkline)；借鉴 LangSmith/Langfuse/CloudWatch GenAI 可观测三支柱、ClawHub 舰队健康、perfecxion 记忆专属指标、OpenLIT 工具可靠性(P50/P95/P99 与熔断开启)、Prometheus/Grafana 时序面板(histogram_quantile(p95) over time / 周环比回归)。</footer>
</div></body></html>`;
  }

  // ── 别名（统一委托命名）：让 omni.monitor.health / .alerts / .dashboard 与
  //     总线注册、METHOD_META、agentCard 的技能 id 一致（body.monitor('health') 等委派不再 undefined）。
  health() { return this.agentHealth(); }
  alerts(agent) { return this.allAlerts(agent); }
  dashboard(snap) { return this.renderDashboard(snap); }
  trendAnomalies() { return this._detectTrendAnomalies(); }
}

export { INACTIVE_MS, SPIKE_FACTOR };
