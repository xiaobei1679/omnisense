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
import { EVENTS } from '../core/bus.mjs';
import { log } from '../core/logger.mjs';

const DEFAULT_METRIC_FILE = './.omni-health-metrics.json';
const INACTIVE_MS = 48 * 3600 * 1000;   // 48h 无产出即告警（兼容 health-observer）
const SPIKE_FACTOR = 2;                  // 失败率/延迟飙升至基线 2x 即告警
const MEM_STALE_MS = 7 * 86400000;       // 记忆记录 >7d 视为"陈旧"
const MEM_BULK_THRESHOLD = 20;           // 单次检查记忆层增长 ≥20 条 → 疑似批量注入
const LIVENESS_HEALTHY_MS = 3600000;     // <1h 视为活跃(healthy)
const LIVENESS_DEGRADED_MS = 86400000;   // 1h~24h 降级(degraded)，>24h 失联(down)

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

export class Monitor {
  constructor(bus, omni, opts = {}) {
    this.bus = bus;
    this.omni = omni;
    this.metricsFile = opts.metricsFile || DEFAULT_METRIC_FILE;
    // 记忆增长基线：内存缓存（检测更可靠、测试无文件污染），构造时若文件已有则载入以便跨进程延续。
    const seeded = this._loadMetrics();
    this._baseline = seeded._memBaseline || null;        // 稳定基线：供 memoryHealth.growth（自首次观察起的累计增长，仅首次建立）
    this._anomalyBase = seeded._anomalyBaseline || null; // 滑动基线：供 detectAnomalies 批量注入检测（每次检查后更新）
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
      const liveness = g.last ? (ageMs < LIVENESS_HEALTHY_MS ? 'healthy' : ageMs < LIVENESS_DEGRADED_MS ? 'degraded' : 'down') : 'unknown';
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
    let stale = 0;
    for (const n of notes) if (n.t && now - n.t > MEM_STALE_MS) stale++;
    for (const k of knowledge) if (k.at && now - k.at > MEM_STALE_MS) stale++;
    for (const s of skills) if (s.at && now - s.at > MEM_STALE_MS) stale++;
    const base = this._readBaseline();
    const growth = {};
    for (const k of ['memory', 'rule', 'skill', 'knowledge']) growth[k] = base ? (layers[k] - (base[k] || 0)) : 0;
    if (!this._baseline) this._saveBaseline(layers); // 仅首次建立稳定基线（不每次覆盖，否则 growth 恒为 0）
    return {
      layers, skillUtilization: Number(skillUtil.toFixed(2)), avgConfidence: avgConf,
      lowConfidence: lowConf, staleCount: stale, staleWindowDays: 7, growth, baseline: base,
    };
  }

  // ── ④ 异常检测（延迟突增 / 吞吐骤降 / 记忆批量注入 + 核心 4 信号在 checkAlerts）──
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
        if (p95a && p95r > p95a * SPIKE_FACTOR) {
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
        if (d >= MEM_BULK_THRESHOLD) {
          alerts.push({ level: 'warning', type: 'memory_bulk_injection', message: `记忆层 ${k} 自上次检查增长 ${d} 条（疑似批量注入）`, agent: 'memory' });
        }
      }
    }
    this._anomalyBase = this._currentLayers();
    this._saveAnomalyBaseline(this._anomalyBase);
    return alerts;
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
    return {
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
    if (la) {
      const hrs = (Date.now() - la) / 3600000;
      if (hrs > 48) alerts.push({ level: 'warning', type: 'inactive', message: `超过 48h 无运行产出（${Math.round(hrs)}h）`, agent: 'tracer' });
    } else {
      alerts.push({ level: 'warning', type: 'no_data', message: '尚无任何运行轨迹', agent: 'tracer' });
    }
    if (runs.length >= 5) {
      const baseRate = (runs.length - completed) / runs.length;
      const recent = runs.slice(-5);
      const recentRate = (recent.length - completedCount(recent)) / recent.length;
      if (baseRate > 0 && recentRate > baseRate * SPIKE_FACTOR) {
        alerts.push({
          level: 'warning', type: 'error_rate_spike',
          message: `近 5 次失败率 ${recentRate.toFixed(2)} 飙升至基线 ${baseRate.toFixed(2)} 的 ${(recentRate / baseRate).toFixed(1)}x`,
          agent: 'tracer',
        });
      }
    }

    const recorded = this._loadMetrics();
    const ids = agentId ? [agentId] : Object.keys(recorded).filter(k => k !== '_memBaseline');
    for (const id of ids) {
      const hist = recorded[id];
      if (!Array.isArray(hist) || !hist.length) continue;
      const last3 = hist.slice(-3);
      if (last3.length >= 3 && last3.every(m => (m.errors || 0) > 0)) {
        alerts.push({ level: 'error', type: 'consecutive_errors', message: `${id} 连续 3 次报错`, agent: id });
      }
      const lastM = hist[hist.length - 1];
      if (lastM && (Date.now() - new Date(lastM.ts).getTime()) / 3600000 > 48) {
        alerts.push({ level: 'warning', type: 'inactive', message: `${id} 超过 48h 无产出`, agent: id });
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

  <footer>由监控器官 monitor 生成 · 复用 tracer(运行轨迹/延迟/工具级延迟) + memory(四层/记忆健康) + toolHealth(缓存/熔断) + 心跳式存活判定 + 异常检测；借鉴 LangSmith/Langfuse/CloudWatch GenAI 可观测三支柱、ClawHub 舰队健康、perfecxion 记忆专属指标、OpenLIT 工具可靠性(工具级 P50/P95/P99 与熔断开启监测)。</footer>
</div></body></html>`;
  }

  // ── 别名（统一委托命名）：让 omni.monitor.health / .alerts / .dashboard 与
  //     总线注册、METHOD_META、agentCard 的技能 id 一致（body.monitor('health') 等委派不再 undefined）。
  health() { return this.agentHealth(); }
  alerts(agent) { return this.allAlerts(agent); }
  dashboard(snap) { return this.renderDashboard(snap); }
}

export { INACTIVE_MS, SPIKE_FACTOR };
