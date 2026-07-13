// 监控器官（Monitor）—— 统一观测 Agent 状态 / 记忆 / 多种状态检测
// ─────────────────────────────────────────────────────────────────────────────
// 把散落在 openclaw-workspace 的 health-observer.js / dashboard.mjs / observer.mjs
// 升格为 OmniSense 内核的一等公民（第 8 器官）：
//   1) 复用 tracer（autopilot / agent 运行轨迹）做 Agent 状态与活动检测
//   2) 复用 memory 四层（Memory/Rule/Skill/Knowledge）做记忆状态检测
//   3) 兼容 health-observer.js 的 record / alert 思想：连续失败 / 48h 无产出 / 失败率飙升
//   4) 生成零依赖静态 HTML 仪表盘（可视化：器官 / 记忆层 / 活动 / 告警）
// 设计原则（与框架一致）：零新增依赖、文件落盘、绝不阻断主流程、离线可跑、诚实降级。
import { writeFileSync, readFileSync, existsSync, renameSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { EVENTS } from '../core/bus.mjs';
import { log } from '../core/logger.mjs';

const DEFAULT_METRIC_FILE = './.omni-health-metrics.json';
const INACTIVE_MS = 48 * 3600 * 1000; // 48h 无产出即告警
const SPIKE_FACTOR = 2;               // 失败率飙升至基线 2x 即告警

function completedCount(runs) {
  return runs.filter(r => r.completed).length;
}
function lastActiveAt(runs) {
  const last = runs.length ? runs[runs.length - 1] : null;
  return last ? (last.finishedAt || last.startedAt || 0) : 0;
}

export class Monitor {
  constructor(bus, omni, opts = {}) {
    this.bus = bus;
    this.omni = omni;
    this.metricsFile = opts.metricsFile || DEFAULT_METRIC_FILE;
    this._wire();
  }

  _wire() {
    this.bus.register('monitor', 'snapshot', () => this.snapshot());
    this.bus.register('monitor', 'health', () => this.agentHealth());
    this.bus.register('monitor', 'alerts', () => this.checkAlerts());
    this.bus.register('monitor', 'dashboard', () => this.renderDashboard());
    this.bus.register('monitor', 'recordMetric', p => this.recordMetric(p && p.agent, p && p.metrics));
    this.bus.register('monitor', 'checkAlerts', p => this.checkAlerts(p && p.agent));
  }

  // ── 数据来源 ──
  _tracerRuns() {
    try { return (this.omni && this.omni.tracer && this.omni.tracer.runs) || []; }
    catch { return []; }
  }

  // ── 统一状态快照（可视化监控的核心数据）──
  snapshot() {
    const mem = this.omni && this.omni.memory;
    const memory = (mem && mem.layerSnapshot) ? mem.layerSnapshot() : null;
    const tracer = this.omni && this.omni.tracer;
    const runs = this._tracerRuns();
    const total = runs.length;
    const completed = completedCount(runs);
    const autopilot = (tracer && tracer.findRunsByGoal)
      ? tracer.findRunsByGoal('autopilot', { limit: 5 }) : [];
    const la = lastActiveAt(runs);
    const alerts = this.checkAlerts();
    const organs = (this.omni && this.omni.body && this.omni.body.describe)
      ? this.omni.body.describe().map(o => ({ key: o.key, name: o.name, methods: o.methods.length }))
      : [];
    return {
      generatedAt: new Date().toISOString(),
      status: alerts.some(a => a.level === 'error') ? 'degraded'
            : alerts.length ? 'warning' : 'healthy',
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
      alerts,
    };
  }

  _engineBreakdown(runs) {
    const m = {};
    for (const r of runs) m[r.engine] = (m[r.engine] || 0) + 1;
    return m;
  }

  // ── Agent 健康（基于 tracer 运行轨迹）──
  agentHealth() {
    const runs = this._tracerRuns();
    const total = runs.length;
    const completed = completedCount(runs);
    const la = lastActiveAt(runs);
    const errorRate = total ? Number(((total - completed) / total).toFixed(3)) : 0;
    const status = errorRate > 0.5 ? 'critical' : errorRate > 0.2 ? 'degraded' : 'healthy';
    return {
      ok: true,
      status,
      totalRuns: total,
      completedRuns: completed,
      errorRate,
      lastActiveAt: la ? new Date(la).toISOString() : null,
      inactiveHours: la ? Math.round((Date.now() - la) / 3600000) : null,
    };
  }

  // ── 多种状态检测（告警引擎）──
  // 信号来源：
  //   A) tracer 运行轨迹（autopilot/agent）：连续失败 / 48h 无产出 / 失败率飙升
  //   B) 兼容 health-observer.js 的 recordMetric：按 agentId 记录 errors，连续报错告警
  checkAlerts(agentId) {
    const runs = this._tracerRuns();
    const alerts = [];
    const completed = completedCount(runs);

    // A1) 连续失败：最近 3 次 run 都未完成
    const tail = runs.slice(-3);
    if (tail.length >= 3 && tail.every(r => !r.completed)) {
      alerts.push({ level: 'error', type: 'consecutive_failures', message: '连续 3 次运行未完成', agent: 'tracer' });
    }
    // A2) 48h 无产出 / 无数据
    const la = lastActiveAt(runs);
    if (la) {
      const hrs = (Date.now() - la) / 3600000;
      if (hrs > 48) alerts.push({ level: 'warning', type: 'inactive', message: `超过 48h 无运行产出（${Math.round(hrs)}h）`, agent: 'tracer' });
    } else {
      alerts.push({ level: 'warning', type: 'no_data', message: '尚无任何运行轨迹', agent: 'tracer' });
    }
    // A3) 失败率飙升：最近 5 次失败率 > 全部历史失败率 2x
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

    // B) 兼容 health-observer.js：已 recordMetric 的 agent 告警
    const recorded = this._loadMetrics();
    const ids = agentId ? [agentId] : Object.keys(recorded);
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

  // ── 兼容 health-observer.js 的指标记录（可选，给外部 agent 上报用）──
  recordMetric(agentId, metrics = {}) {
    if (!agentId) return { ok: false, error: '需要 agentId' };
    const all = this._loadMetrics();
    all[agentId] = all[agentId] || [];
    all[agentId].push({ ts: new Date().toISOString(), ...metrics });
    // 保留近 90 天
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
  _saveJson(file, obj) {
    try {
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(obj, null, 2));
      renameSync(tmp, file);
    } catch { /* 落盘失败静默：监控不应影响主流程 */ }
  }

  // ── 可视化：零依赖静态 HTML 仪表盘 ──
  renderDashboard(snapshot = this.snapshot()) {
    const s = snapshot;
    const genTime = new Date(s.generatedAt).toLocaleString('zh-CN', { hour12: false });
    const statusColor = s.status === 'degraded' ? '#f85149' : s.status === 'warning' ? '#d29922' : '#3fb950';
    const esc = (x) => String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const pct = (p, w) => (w ? Math.round((p / w) * 100) : 0);

    const organHtml = (s.organs && s.organs.items || []).map(o =>
      `<li><span class="dot"></span><b>${esc(o.name)}</b> <code>${esc(o.key)}</code> · ${o.methods} 项能力</li>`).join('') || '<li>（无器官）</li>';

    const mem = s.memory || {};
    const memRows = [
      ['Memory 记忆键', mem.memory ? mem.memory.keys : 0],
      ['Memory 事实', mem.memory ? mem.memory.facts : 0],
      ['Memory 笔记', mem.memory ? mem.memory.notes : 0],
      ['Rule 规则', mem.rule],
      ['Skill 技能', mem.skill],
      ['Knowledge 知识', mem.knowledge],
    ];
    const memMax = Math.max(1, ...memRows.map(r => r[1] || 0));
    const memHtml = memRows.map(r =>
      `<div class="row"><span class="lbl">${esc(r[0])}</span><span class="val">${r[1] || 0}</span>
        <span class="bar"><span style="width:${pct(r[1] || 0, memMax)}%"></span></span></div>`).join('');

    const act = s.activity || {};
    const engHtml = Object.entries(act.engineBreakdown || {}).map(([k, v]) =>
      `<span class="chip">${esc(k)}: ${v}</span>`).join(' ') || '<span class="chip">（无）</span>';
    const autoHtml = (act.recentAutopilot || []).map(r =>
      `<li>${esc(r.runId)} · 完成=${r.completed} · ${r.stepCount}步 · ${r.durationMs}ms</li>`).join('') || '<li>（暂无自驱轨迹）</li>';

    const alertHtml = (s.alerts || []).length
      ? s.alerts.map(a => `<li class="al ${a.level}"><span class="badge ${a.level}">${a.level}</span> ${esc(a.message)} <code>${esc(a.agent)}</code></li>`).join('')
      : '<li class="ok">✓ 一切正常</li>';

    return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>OmniSense · 监控仪表盘</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--ink:#e7eaf0;--muted:#9aa3b2;--line:#262b36;--accent:#5b8cff;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft Yahei",sans-serif;}
  .wrap{max-width:960px;margin:0 auto;padding:32px 20px 56px;}
  header h1{margin:0 0 4px;font-size:22px;}
  header .gen{color:var(--muted);font-size:12px;}
  .status{display:inline-block;margin:14px 0;padding:8px 16px;border-radius:999px;font-weight:700;color:#0f1115;background:${statusColor};}
  .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:18px 0;}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;text-align:center;}
  .card .v{font-size:28px;font-weight:700;color:var(--accent);}
  .card .l{color:var(--muted);font-size:12px;margin-top:4px;}
  section{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:18px 20px;margin-bottom:18px;}
  section h2{margin:0 0 12px;font-size:15px;}
  ul{list-style:none;margin:0;padding:0;}
  li{padding:6px 0;border-bottom:1px solid var(--line);}
  li:last-child{border-bottom:0;}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--accent);margin-right:8px;}
  code{color:var(--muted);font-size:12px;}
  .row{display:flex;align-items:center;gap:10px;padding:6px 0;}
  .row .lbl{width:140px;color:var(--muted);font-size:12px;}
  .row .val{width:40px;text-align:right;font-weight:700;}
  .row .bar{flex:1;height:8px;background:var(--line);border-radius:6px;overflow:hidden;}
  .row .bar>span{display:block;height:100%;background:var(--accent);}
  .chip{display:inline-block;margin:2px 4px 2px 0;padding:3px 8px;border:1px solid var(--line);border-radius:6px;color:var(--muted);font-size:12px;}
  .al .badge{display:inline-block;min-width:54px;text-align:center;padding:1px 6px;border-radius:6px;font-size:11px;font-weight:700;color:#0f1115;}
  .badge.error{background:#f85149;}.badge.warning{background:#d29922;}.al.ok{color:var(--muted);}
  .al.error{color:#f85149;}.al.warning{color:#d29922;}
  footer{color:var(--muted);font-size:12px;margin-top:8px;}
  @media(max-width:640px){.grid{grid-template-columns:repeat(2,1fr);}}
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

  <section><h2>器官状态 / Organs</h2><ul>${organHtml}</ul></section>

  <section><h2>记忆状态 / Memory Layers（四层）</h2>${memHtml}</section>

  <section><h2>活动 / Activity</h2>
    <div>引擎分布: ${engHtml}</div>
    <div style="margin-top:10px;color:var(--muted);font-size:12px">最近自驱(autopilot)轨迹:</div>
    <ul style="margin-top:6px">${autoHtml}</ul>
  </section>

  <section><h2>告警 / Alerts（${ (s.alerts || []).length }）</h2><ul>${alertHtml}</ul></section>

  <footer>由监控器官 monitor 生成 · 复用 tracer(运行轨迹) + memory(四层) + 兼容 health-observer 指标记录。</footer>
</div></body></html>`;
  }

  // ── 别名（统一委托命名）：让 omni.monitor.health / .alerts / .dashboard 与
  //     总线注册、METHOD_META、agentCard 的技能 id 一致（body.monitor('health') 等委派不再 undefined）。
  health() { return this.agentHealth(); }
  alerts(agent) { return this.checkAlerts(agent); }
  dashboard(snap) { return this.renderDashboard(snap); }
}

export { INACTIVE_MS, SPIKE_FACTOR };
