#!/usr/bin/env node
// dashboard-data.js — 聚合所有面板数据到单个JSON
// 用法: node dashboard-data.js > dashboard/data.json

const fs = require('fs');
const path = require('path');

const LEARNINGS = path.join(__dirname, '..');
const WORKSPACE = path.resolve(LEARNINGS, '..');
const DASHBOARD = path.join(WORKSPACE, 'dashboard');

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return null; }
}

function readText(filePath) {
  try { return fs.readFileSync(filePath, 'utf-8'); }
  catch { return null; }
}

const data = {
  generated: new Date().toISOString(),
  panels: {}
};

// 1. 经验池
const expPool = readJson(path.join(LEARNINGS, 'shared-experience-pool.json'));
if (expPool) {
  const byStatus = { pending: 0, pushed: 0, forgotten: 0, pending_review: 0 };
  const byCategory = {};
  const experiences = expPool.experiences || [];
  experiences.forEach(e => {
    if (e.push_status === 'pushed') byStatus.pushed++;
    else if (e.push_status === 'pending_review') byStatus.pending_review++;
    else if (e.push_status === 'pending') byStatus.pending++;
    else if (e.forgotten_at) byStatus.forgotten++;
    else byStatus.pending++;

    const cat = e.category || '未分类';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
  });
  data.panels.experiencePool = {
    total: experiences.length,
    byStatus,
    byCategory,
    meta: expPool.meta || null
  };
}

// 2. 创作反馈
const feedback = readJson(path.join(LEARNINGS, 'creation-feedback.json'));
if (feedback) {
  const entries = feedback.entries || [];
  const satisfied = entries.filter(e => e.satisfied).length;
  const total = entries.length;
  const issueCategories = {};
  entries.forEach(e => {
    (e.issues || []).forEach(i => {
      const cat = i.category || '其他';
      issueCategories[cat] = (issueCategories[cat] || 0) + 1;
    });
  });
  data.panels.creationFeedback = {
    totalChapters: total,
    satisfied,
    satisfactionRate: total ? (satisfied / total * 100).toFixed(0) + '%' : 'N/A',
    issueCategories,
    patterns: feedback.patterns?.length || 0,
    recurringPatterns: (feedback.patterns || []).filter(p => (p.occurrences || p.example_count || 0) >= 2)
  };
} else {
  // No creation-feedback.json yet — use skill-evolution patterns as proxy
  data.panels.creationFeedback = {
    totalChapters: 0,
    satisfied: 0,
    satisfactionRate: 'N/A',
    issueCategories: {},
    patterns: 0,
    recurringPatterns: []
  };
}

// 3. Skill发现
const skillDisc = readJson(path.join(LEARNINGS, 'skill-discovery-state.json'));
if (skillDisc) {
  const discovered = skillDisc.discovered || [];
  data.panels.skillDiscovery = {
    lastScan: skillDisc.lastScan,
    pending: discovered.filter(t => t.status === 'pending_verification').length,
    verified: discovered.filter(t => t.status === 'verified').length,
    integrated: (skillDisc.integrated || []).length,
    rejected: (skillDisc.rejected || []).length,
    recent: (skillDisc.integrated || []).slice(-5)
  };
} else {
  data.panels.skillDiscovery = {
    lastScan: null,
    pending: 0,
    verified: 0,
    integrated: 0,
    rejected: 0,
    recent: []
  };
}

// 3.5 Skill自进化 (supplementary)
const skillEvo = readJson(path.join(LEARNINGS, 'skill-evolution-state.json'));
if (skillEvo) {
  data.panels.skillEvolution = {
    patterns: (skillEvo.patterns || []).map(p => ({
      id: p.id,
      pattern_key: p.pattern_key,
      category: p.category,
      example_count: p.example_count,
      risk: p.risk,
      status: p.status
    })),
    proposals: (skillEvo.proposals || []).map(p => ({
      id: p.id,
      pattern_key: p.pattern_key,
      risk: p.risk,
      status: p.status
    })),
    stats: skillEvo.stats || { total_detected: 0, total_proposed: 0, total_applied: 0, total_rejected: 0 }
  };
}

// 4. KBI追踪
const kbi = readJson(path.join(LEARNINGS, 'kbi-tracker.json'));
if (kbi) {
  // kbi-tracker.json uses entries as an object keyed by KI id
  const entriesObj = kbi.entries || {};
  const items = Object.entries(entriesObj).map(([id, v]) => ({
    id,
    title: v.note || v.appliedItems?.join('; ') || '',
    status: v.status,
    roi: v.roi
  }));
  data.panels.kbi = {
    total: items.length,
    applied: items.filter(i => i.status === 'applied').length,
    pending: items.filter(i => i.status === 'pending' || i.status === 'applying').length,
    discarded: items.filter(i => i.status === 'discarded' || i.status === 'expired' || i.status === 'below_threshold' || i.status === 'reference_only').length,
    lastScan: kbi.lastScan,
    items
  };
}

// 5. ERRORS & LEARNINGS统计
const errorsContent = readText(path.join(LEARNINGS, 'ERRORS.md'));
const learningsContent = readText(path.join(LEARNINGS, 'LEARNINGS.md'));
if (errorsContent !== null || learningsContent !== null) {
  const errDates = errorsContent ? (errorsContent.match(/\d{4}-\d{2}-\d{2}/g) || []) : [];
  const learnDates = learningsContent ? (learningsContent.match(/\d{4}-\d{2}-\d{2}/g) || []) : [];
  data.panels.knowledge = {
    errors: errDates.length,
    learnings: learnDates.length,
    recentErrors: errorsContent ? errorsContent.split('\n').filter(l => l.match(/2026-07-0\d/)).slice(-5) : [],
    recentLearnings: learningsContent ? learningsContent.split('\n').filter(l => l.match(/2026-07-0\d/)).slice(-5) : []
  };
}

// 6. 脚本统计
const scriptsDir = __dirname;
try {
  const scripts = fs.readdirSync(scriptsDir).filter(f => f.endsWith('.js'));
  data.panels.scripts = {
    total: scripts.length,
    totalSize: scripts.reduce((sum, f) => sum + fs.statSync(path.join(scriptsDir, f)).size, 0),
    list: scripts.map(s => ({ name: s, size: fs.statSync(path.join(scriptsDir, s)).size })).sort((a, b) => b.size - a.size)
  };
} catch (e) {
  data.panels.scripts = { total: 0, totalSize: 0, list: [] };
}

// 输出JSON (write directly to file to avoid Windows encoding issues)
const output = JSON.stringify(data, null, 2);
const outPath = path.join(DASHBOARD, 'data.json');
try {
  fs.mkdirSync(DASHBOARD, { recursive: true });
  fs.writeFileSync(outPath, output, 'utf-8');
  console.log('Dashboard data written to ' + outPath);
} catch (e) {
  console.error('Failed to write:', e.message);
  // Fallback to stdout
  process.stdout.write(Buffer.from(output, 'utf-8'));
}
