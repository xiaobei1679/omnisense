// Agent 健康可观测性系统
// 用法: node health-observer.js <action> [args]

const fs = require('fs');
const path = require('path');

const HEALTH_DIR = path.join(__dirname, '..', '..', '.health');
const METRICS_FILE = path.join(HEALTH_DIR, 'metrics.json');
const ALERTS_FILE = path.join(HEALTH_DIR, 'alerts.json');
const TREND_FILE = path.join(HEALTH_DIR, 'trend.json');

function ensureDir() { if (!fs.existsSync(HEALTH_DIR)) fs.mkdirSync(HEALTH_DIR, { recursive: true }); }
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } }
function writeJson(f, o) { fs.writeFileSync(f, JSON.stringify(o, null, 2), 'utf8'); }

// === Actions ===

function recordMetrics(agentId, metrics) {
  ensureDir();
  const ts = new Date().toISOString();
  const all = readJson(METRICS_FILE) || [];
  
  all.push({
    ts,
    agent: agentId,
    ...metrics
  });
  
  // Keep last 90 days
  const cutoff = new Date(Date.now() - 90 * 86400000).toISOString();
  const filtered = all.filter(m => m.ts >= cutoff);
  writeJson(METRICS_FILE, filtered);
  
  // Auto-detect issues
  checkAlerts(agentId, filtered);
  
  console.log(JSON.stringify({ ok: true, agent: agentId, recorded: metrics }));
}

function checkAlerts(agentId, history) {
  ensureDir();
  const alerts = readJson(ALERTS_FILE) || { alerts: [], resolved: [] };
  const agentHistory = history.filter(m => m.agent === agentId).slice(-10);

  // Check: 3 consecutive errors
  if (agentHistory.length >= 3) {
    const last3 = agentHistory.slice(-3);
    if (last3.every(m => m.errors > 0)) {
      addAlert(alerts, agentId, 'consecutive_errors', `连续3次任务报错`, 'error');
    }
  }

  // Check: no output in 48h
  if (agentHistory.length > 0) {
    const last = agentHistory[agentHistory.length - 1];
    const hoursSince = (Date.now() - new Date(last.ts).getTime()) / 3600000;
    if (hoursSince > 48) {
      addAlert(alerts, agentId, 'inactive', `超过48h无产出`, 'warning');
    }
  }

  // Check: token spike (>2x avg)
  if (agentHistory.length >= 5) {
    const avgTokens = agentHistory.slice(0, -1).reduce((s, m) => s + (m.tokens_total || 0), 0) / (agentHistory.length - 1);
    const lastTokens = agentHistory[agentHistory.length - 1].tokens_total || 0;
    if (avgTokens > 0 && lastTokens > avgTokens * 2) {
      addAlert(alerts, agentId, 'token_spike', `Token消耗飙升至均值${(lastTokens/avgTokens).toFixed(1)}x`, 'warning');
    }
  }

  writeJson(ALERTS_FILE, alerts);
}

function addAlert(alerts, agent, type, message, level) {
  const exists = alerts.alerts.find(a => a.agent === agent && a.type === type && !a.resolved_at);
  if (!exists) {
    alerts.alerts.push({
      agent,
      type,
      level,
      message,
      created_at: new Date().toISOString(),
      resolved_at: null
    });
  }
}

function listAlerts(filter) {
  const alerts = readJson(ALERTS_FILE);
  if (!alerts) { console.log(JSON.stringify({ ok: true, alerts: [] })); return; }
  
  let result = alerts.alerts;
  if (filter === 'active') result = result.filter(a => !a.resolved_at);
  else if (filter === 'error') result = result.filter(a => a.level === 'error' && !a.resolved_at);
  
  console.log(JSON.stringify({ ok: true, count: result.length, alerts: result }, null, 2));
}

function getAgentHealth(agentId) {
  const all = readJson(METRICS_FILE) || [];
  const agentHistory = all.filter(m => m.agent === agentId).slice(-20);
  
  if (agentHistory.length === 0) {
    console.log(JSON.stringify({ ok: true, agent: agentId, status: 'unknown', note: 'No metrics recorded' }));
    return;
  }

  const last = agentHistory[agentHistory.length - 1];
  const status = last.errors > 3 ? 'degraded' : last.errors > 0 ? 'warning' : 'healthy';
  
  // Activity score (0-100)
  const recent7 = agentHistory.filter(m => new Date(m.ts) > new Date(Date.now() - 7 * 86400000));
  const activityScore = Math.min(100, recent7.length * 20);
  
  // Error rate
  const errorRate = agentHistory.reduce((s, m) => s + (m.errors || 0), 0) / Math.max(1, agentHistory.length);

  console.log(JSON.stringify({
    ok: true,
    agent: agentId,
    status,
    activity_score: activityScore,
    recent_error_rate: errorRate.toFixed(2),
    last_active: last.ts,
    tokens_7d: recent7.reduce((s, m) => s + (m.tokens_total || 0), 0),
    tasks_7d: recent7.length,
    metrics_tail: agentHistory.slice(-5).map(m => ({ ts: m.ts, errors: m.errors || 0, tokens: m.tokens_total || 0 }))
  }, null, 2));
}

function getTeamHealth() {
  ensureDir();
  const all = readJson(METRICS_FILE) || [];
  const agents = [...new Set(all.map(m => m.agent))];
  
  const teamReport = {
    generated_at: new Date().toISOString(),
    agents_observed: agents.length,
    overall: 'healthy',
    agents: {}
  };

  agents.forEach(a => {
    const h = all.filter(m => m.agent === a).slice(-30);
    const recent7 = h.filter(m => new Date(m.ts) > new Date(Date.now() - 7 * 86400000));
    const errorRate = h.reduce((s, m) => s + (m.errors || 0), 0) / Math.max(1, h.length);
    
    let status = 'healthy';
    if (errorRate > 0.5) status = 'critical';
    else if (errorRate > 0.2) status = 'degraded';
    else if (recent7.length === 0 && h.length > 0) status = 'inactive';
    
    teamReport.agents[a] = {
      status,
      error_rate: errorRate.toFixed(2),
      tasks_7d: recent7.length,
      tokens_7d: recent7.reduce((s, m) => s + (m.tokens_total || 0), 0)
    };
  });

  const statuses = Object.values(teamReport.agents).map(a => a.status);
  if (statuses.includes('critical')) teamReport.overall = 'critical';
  else if (statuses.includes('degraded')) teamReport.overall = 'degraded';
  else if (statuses.every(s => s === 'inactive')) teamReport.overall = 'inactive';

  writeJson(TREND_FILE, { updated: new Date().toISOString(), report: teamReport });
  console.log(JSON.stringify(teamReport, null, 2));
}

// === CLI ===
const args = process.argv.slice(2);
const action = args[0];

if (action === 'record') {
  recordMetrics(args[1], JSON.parse(args[2] || '{}'));
} else if (action === 'agent') {
  getAgentHealth(args[1]);
} else if (action === 'team') {
  getTeamHealth();
} else if (action === 'alerts') {
  listAlerts(args[1] || 'active');
} else {
  console.log(JSON.stringify({
    ok: false,
    error: 'Unknown action',
    usage: {
      record: 'node health-observer.js record <agentId> \'{"tokens_total":10000,"errors":0}\'',
      agent: 'node health-observer.js agent <agentId>',
      team: 'node health-observer.js team',
      alerts: 'node health-observer.js alerts [active|error|all]'
    }
  }));
}
