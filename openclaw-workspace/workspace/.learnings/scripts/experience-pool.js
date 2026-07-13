#!/usr/bin/env node
// experience-pool.js v2.0 — 子Agent共享经验池（含置信度/来源追溯/过期/遗忘）
// 用法:
//   node experience-pool.js add --agent <name> --learning "<text>" [--category <cat>] [--tags t1,t2] [--task <type>] [--confidence 0.7] [--source "<ref>"] [--ttl-days 90]
//   node experience-pool.js list [--agent <name>] [--category <cat>] [--status <pending|pushed|forgotten>] [--limit N]
//   node experience-pool.js push --id <exp-id> [--target agent1,agent2]
//   node experience-pool.js query "<keyword>" [--limit N]
//   node experience-pool.js stats
//   node experience-pool.js cleanup --days N
//   node experience-pool.js forget --id <exp-id> [--reason "<text>"]
//   node experience-pool.js expire  — 清理超过TTL的经验

const fs = require('fs');
const path = require('path');

const POOL_PATH = path.join(__dirname, '..', 'shared-experience-pool.json');
const MAX_EXPERIENCES = 1000;

// === Confidence defaults by source type ===
const CONFIDENCE_DEFAULTS = {
  user_direct: 1.0,
  agent_extracted: 0.7,
  model_inferred: 0.5,
};

// === Agent → category mapping for auto-routing ===
const AGENT_CATEGORIES = {
  'novel-creator': ['technique', 'platform', '开篇', '悬念', '对话', '描写', '设定', '节奏'],
  'novel-hotcatcher': ['platform', 'trend', '爆款', '番茄', '热点'],
  'outline-designer': ['structure', '节奏', '冲突', '大纲', '伏笔'],
  'content-reviewer': ['质量', '审核', '标准', '规范'],
  'worldbuilding-architect': ['设定', '世界观', '力量体系', '命名', '地理'],
  'visual-producer': ['视觉', '视频', '图像', '提示词'],
  'video-editor': ['视频', '剪辑', '后期'],
  'drama-scriptwriter': ['剧本', '对话', '冲突'],
  'marketing-operator': ['营销', '平台', '分发', '封面'],
};

function loadPool() {
  if (!fs.existsSync(POOL_PATH)) {
    const initial = {
      experiences: [],
      meta: {
        created: new Date().toISOString(),
        version: '2.0',
        total_pushed: 0,
        total_expired: 0,
        total_forgotten: 0,
      },
    };
    fs.writeFileSync(POOL_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  const raw = fs.readFileSync(POOL_PATH, 'utf-8');
  const pool = JSON.parse(raw);
  // Auto-upgrade from v1.0
  if (!pool.meta.version || pool.meta.version < '2.0') {
    pool.meta.version = '2.0';
    pool.meta.total_expired = pool.meta.total_expired || 0;
    pool.meta.total_forgotten = pool.meta.total_forgotten || 0;
    for (const e of pool.experiences) {
      if (e.confidence === undefined) e.confidence = CONFIDENCE_DEFAULTS.agent_extracted;
      if (!e.source_ref) e.source_ref = '(migrated)';
      if (e.ttl_days === undefined) e.ttl_days = 90;
    }
    savePool(pool);
  }
  return pool;
}

function savePool(pool) {
  if (pool.experiences.length > MAX_EXPERIENCES) {
    // Prefer to drop old pushed/expired ones first
    const keepPriority = (e) => {
      if (e.forgotten_at) return 0;
      if (e.expired_at) return 1;
      if (e.push_status === 'pushed') return 2;
      return 3; // pending
    };
    pool.experiences.sort((a, b) => keepPriority(a) - keepPriority(b) || new Date(a.created_at) - new Date(b.created_at));
    pool.experiences = pool.experiences.slice(-MAX_EXPERIENCES);
  }
  fs.writeFileSync(POOL_PATH, JSON.stringify(pool, null, 2), 'utf-8');
}

function generateId() {
  const rnd = Math.floor(Math.random() * 10000).toString(36).padStart(3, '0');
  return 'exp-' + Date.now().toString(36) + '-' + rnd;
}

function inferTargetAgents(category, tags) {
  const targets = new Set();
  for (const [agent, cats] of Object.entries(AGENT_CATEGORIES)) {
    for (const c of cats) {
      if (category === c || (tags && tags.some(t => c.includes(t) || t.includes(c)))) {
        targets.add(agent);
        break;
      }
    }
  }
  return targets.size > 0 ? [...targets] : ['all'];
}

// === Conflict detection: same category + overlapping tags → check key facts ===
function detectConflict(pool, entry) {
  const recent = pool.experiences.filter(e => {
    if (e.forgotten_at || e.expired_at) return false;
    if (e.id === entry.id) return false;
    const ageDays = (Date.now() - new Date(e.created_at).getTime()) / 86400000;
    if (ageDays > 30) return false;
    return e.category === entry.category && e.tags.some(t => entry.tags.includes(t));
  });

  for (const existing of recent) {
    // CJK-aware overlap: for Chinese, use 2-char sliding window; for space-separated, use word matching
    const isCJK = /[\u3400-\u9fff\uf900-\ufaff]/.test(entry.learning);
    let overlapRatio;
    if (isCJK) {
      // 2-char sliding window overlap on entry's characters
      const entryChars = entry.learning.replace(/\s+/g, '').split('');
      const existingChars = existing.learning.replace(/\s+/g, '').split('');
      const windows = new Set();
      for (let i = 0; i < entryChars.length - 1; i++) windows.add(entryChars[i] + entryChars[i + 1]);
      let overlap = 0;
      for (let i = 0; i < existingChars.length - 1; i++) {
        if (windows.has(existingChars[i] + existingChars[i + 1])) overlap++;
      }
      overlapRatio = overlap / Math.max(windows.size, 1);
    } else {
      const entryWords = entry.learning.split(/\s+/);
      const existingWords = existing.learning.split(/\s+/);
      const overlapWords = entryWords.filter(w => existingWords.some(ew => ew.includes(w) || w.includes(ew))).length;
      overlapRatio = overlapWords / Math.max(entryWords.length, 1);
    }
    if (overlapRatio > 0.3) {
      return {
        conflict: true,
        existing_id: existing.id,
        existing_confidence: existing.confidence,
        existing_learning: existing.learning.slice(0, 100),
        overlap_ratio: Math.round(overlapRatio * 100) / 100,
      };
    }
  }
  return { conflict: false };
}

// === COMMANDS ===

function cmdAdd(args) {
  const agent = args.agent;
  const category = args.category || 'general';
  const learning = args.learning;
  const tags = args.tags ? args.tags.split(',').map(t => t.trim()) : [];
  const taskType = args.task || 'unknown';
  const confidence = args.confidence ? parseFloat(args.confidence) : CONFIDENCE_DEFAULTS.agent_extracted;
  const sourceRef = args.source || '(unspecified)';
  const ttlDays = args['ttl-days'] ? parseInt(args['ttl-days']) : 90;

  if (!agent || !learning) {
    console.error('用法: node experience-pool.js add --agent <name> --learning "<text>" [--confidence 0.7] [--source "<ref>"] [--ttl-days 90]');
    process.exit(1);
  }

  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    console.error('置信度必须在 0-1 之间');
    process.exit(1);
  }

  const pool = loadPool();
  const targets = inferTargetAgents(category, tags);

  const entry = {
    id: generateId(),
    source_agent: agent,
    task_type: taskType,
    category,
    learning,
    tags,
    target_agents: targets,
    created_at: new Date().toISOString(),
    confidence,
    source_ref: sourceRef,
    ttl_days: ttlDays,
    push_status: 'pending',
    push_history: [],
    needs_human_review: confidence < 0.6,
  };

  // Conflict detection
  const conflict = detectConflict(pool, entry);
  if (conflict.conflict) {
    entry.conflict_warning = conflict;
    if (confidence <= (conflict.existing_confidence || 0.7)) {
      entry.push_status = 'pending_review';
      entry.needs_human_review = true;
    }
  }

  pool.experiences.push(entry);
  savePool(pool);
  console.log(JSON.stringify({
    ok: true, id: entry.id, targets, confidence, ttl_days: ttlDays,
    source: sourceRef, needs_human_review: entry.needs_human_review,
    conflict: conflict.conflict ? conflict : undefined,
  }));
}

function cmdList(args) {
  const pool = loadPool();
  let filtered = pool.experiences.filter(e => !e.forgotten_at && !e.expired_at);

  if (args.agent) filtered = filtered.filter(e => e.source_agent === args.agent);
  if (args.category) filtered = filtered.filter(e => e.category === args.category);
  if (args.status) filtered = filtered.filter(e => e.push_status === args.status);

  const limit = parseInt(args.limit) || 20;
  filtered = filtered.slice(-limit).reverse();

  const result = filtered.map(e => ({
    id: e.id,
    agent: e.source_agent,
    category: e.category,
    learning: e.learning.slice(0, 80) + (e.learning.length > 80 ? '…' : ''),
    status: e.push_status,
    targets: e.target_agents,
    confidence: e.confidence,
    source: e.source_ref,
    ttl_days: e.ttl_days,
    created: e.created_at,
    needs_review: e.needs_human_review || false,
  }));

  console.log(JSON.stringify({ ok: true, count: result.length, total: pool.experiences.length, items: result }, null, 2));
}

function cmdPush(args) {
  const expId = args.id;
  const targetList = args.target ? args.target.split(',').map(t => t.trim()) : null;

  if (!expId) {
    console.error('用法: node experience-pool.js push --id <exp-id> [--target agent1,agent2]');
    process.exit(1);
  }

  const pool = loadPool();
  const entry = pool.experiences.find(e => e.id === expId && !e.forgotten_at && !e.expired_at);
  if (!entry) {
    console.error(`错误: 找不到经验 ${expId}`);
    process.exit(1);
  }

  if (entry.needs_human_review) {
    console.log(JSON.stringify({
      ok: false,
      error: '需要人工审核',
      id: expId,
      confidence: entry.confidence,
      reason: '置信度低于0.6或存在冲突',
    }));
    return;
  }

  const targets = targetList || entry.target_agents;
  entry.push_status = 'pushed';
  entry.push_history.push({
    pushed_to: targets,
    pushed_at: new Date().toISOString(),
  });
  pool.meta.total_pushed = (pool.meta.total_pushed || 0) + 1;
  savePool(pool);

  console.log(JSON.stringify({ ok: true, id: expId, pushed_to: targets, learning: entry.learning }));
}

function cmdQuery(args) {
  const keyword = args._[0] || '';
  if (!keyword) {
    console.error('用法: node experience-pool.js query "<keyword>" [--limit N]');
    process.exit(1);
  }

  const pool = loadPool();
  const kw = keyword.toLowerCase();
  const limit = parseInt(args.limit) || 10;

  const matches = pool.experiences
    .filter(e => {
      if (e.forgotten_at || e.expired_at) return false;
      return e.learning.toLowerCase().includes(kw) || e.tags.some(t => t.toLowerCase().includes(kw));
    })
    .sort((a, b) => b.confidence - a.confidence || new Date(b.created_at) - new Date(a.created_at))
    .slice(0, limit);

  const result = matches.map(e => ({
    id: e.id,
    agent: e.source_agent,
    category: e.category,
    learning: e.learning,
    tags: e.tags,
    status: e.push_status,
    confidence: e.confidence,
    source: e.source_ref,
    ttl_days: e.ttl_days,
    created: e.created_at,
  }));

  console.log(JSON.stringify({ ok: true, query: keyword, count: result.length, items: result }, null, 2));
}

function cmdStats() {
  const pool = loadPool();

  const active = pool.experiences.filter(e => !e.forgotten_at && !e.expired_at);
  const byAgent = {};
  const byCategory = {};
  const byStatus = {};
  const reviewQueue = [];

  for (const e of active) {
    byAgent[e.source_agent] = (byAgent[e.source_agent] || 0) + 1;
    byCategory[e.category] = (byCategory[e.category] || 0) + 1;
    byStatus[e.push_status] = (byStatus[e.push_status] || 0) + 1;
    if (e.needs_human_review) reviewQueue.push({ id: e.id, confidence: e.confidence, source_agent: e.source_agent });
  }

  const confidenceDist = {};
  for (const e of active) {
    const bucket = Math.floor(e.confidence * 10) / 10;
    confidenceDist[bucket.toFixed(1)] = (confidenceDist[bucket.toFixed(1)] || 0) + 1;
  }

  console.log(JSON.stringify({
    ok: true,
    total: active.length,
    total_all: pool.experiences.length,
    total_pushed: pool.meta.total_pushed,
    total_expired: pool.meta.total_expired || 0,
    total_forgotten: pool.meta.total_forgotten || 0,
    by_agent: byAgent,
    by_category: byCategory,
    by_status: byStatus,
    confidence_distribution: confidenceDist,
    needs_human_review: reviewQueue.length,
    review_queue: reviewQueue.slice(0, 10),
    created: pool.meta.created,
  }, null, 2));
}

function cmdCleanup(args) {
  const days = parseInt(args.days) || 90;
  const cutoff = Date.now() - days * 86400000;

  const pool = loadPool();
  const before = pool.experiences.length;
  pool.experiences = pool.experiences.filter(e => {
    if (e.forgotten_at) return true; // keep forgotten for grace period
    return e.push_status !== 'pushed' || new Date(e.created_at).getTime() > cutoff;
  });
  const removed = before - pool.experiences.length;
  savePool(pool);

  console.log(JSON.stringify({ ok: true, removed, remaining: pool.experiences.length, older_than_days: days }));
}

function cmdForget(args) {
  const expId = args.id;
  const reason = args.reason || '(未指定原因)';

  if (!expId) {
    console.error('用法: node experience-pool.js forget --id <exp-id> [--reason "<text>"]');
    process.exit(1);
  }

  const pool = loadPool();
  const entry = pool.experiences.find(e => e.id === expId);
  if (!entry) {
    console.error(`错误: 找不到经验 ${expId}`);
    process.exit(1);
  }

  // Soft delete: mark forgotten, keep for 30-day grace period
  entry.forgotten_at = new Date().toISOString();
  entry.forgotten_reason = reason;
  entry.forgotten_grace_until = new Date(Date.now() + 30 * 86400000).toISOString();
  pool.meta.total_forgotten = (pool.meta.total_forgotten || 0) + 1;
  savePool(pool);

  console.log(JSON.stringify({
    ok: true, id: expId, forgotten: true,
    grace_until: entry.forgotten_grace_until,
    reason,
  }));
}

function cmdExpire() {
  const pool = loadPool();
  const now = Date.now();
  let expired = 0;

  for (const e of pool.experiences) {
    if (e.expired_at || e.forgotten_at) continue;
    if (!e.ttl_days || e.ttl_days <= 0) continue;

    const created = new Date(e.created_at).getTime();
    const expiresAt = created + e.ttl_days * 86400000;

    if (now > expiresAt) {
      // Check if recently confirmed (last_seen_at within TTL window)
      if (e.last_seen_at) {
        const lastSeen = new Date(e.last_seen_at).getTime();
        if (now - lastSeen < e.ttl_days * 86400000) {
          // Still active, refresh TTL
          continue;
        }
      }
      e.expired_at = new Date().toISOString();
      expired++;
    }
  }

  pool.meta.total_expired = (pool.meta.total_expired || 0) + expired;
  savePool(pool);

  console.log(JSON.stringify({ ok: true, expired, total_expired: pool.meta.total_expired }));
}

function cmdPushAll(args) {
  // Auto-push all qualified pending experiences (confidence >= 0.7, no review needed)
  const minConfidence = args['min-confidence'] ? parseFloat(args['min-confidence']) : 0.7;
  const dryRun = args['dry-run'] || false;

  const pool = loadPool();
  const pending = pool.experiences.filter(e => {
    if (e.forgotten_at || e.expired_at) return false;
    if (e.push_status === 'pushed' || e.push_status === 'pending_review') return false;
    if (e.confidence < minConfidence) return false;
    if (e.needs_human_review) return false;
    return e.push_status === 'pending';
  });

  if (pending.length === 0) {
    console.log(JSON.stringify({ ok: true, pushed: 0, message: '没有符合条件的待推送经验' }));
    return;
  }

  if (dryRun) {
    console.log(JSON.stringify({
      ok: true,
      dry_run: true,
      candidates: pending.map(e => ({
        id: e.id, agent: e.source_agent, category: e.category,
        confidence: e.confidence, learning: e.learning.slice(0, 60),
        targets: e.target_agents
      }))
    }, null, 2));
    return;
  }

  const results = [];
  for (const entry of pending) {
    entry.push_status = 'pushed';
    entry.push_history.push({
      pushed_to: entry.target_agents,
      pushed_at: new Date().toISOString(),
      auto: true,
      method: 'push-all',
    });
    pool.meta.total_pushed = (pool.meta.total_pushed || 0) + 1;
    results.push({ id: entry.id, category: entry.category, targets: entry.target_agents });
  }

  savePool(pool);

  console.log(JSON.stringify({
    ok: true,
    pushed: results.length,
    items: results
  }, null, 2));
}

function cmdTouch(args) {
  // Update last_seen_at for an experience (extends TTL)
  const expId = args.id;
  if (!expId) {
    console.error('用法: node experience-pool.js touch --id <exp-id>');
    process.exit(1);
  }

  const pool = loadPool();
  const entry = pool.experiences.find(e => e.id === expId && !e.forgotten_at);
  if (!entry) {
    console.error(`错误: 找不到经验 ${expId}`);
    process.exit(1);
  }

  entry.last_seen_at = new Date().toISOString();
  if (entry.expired_at) {
    entry.expired_at = null; // resurrect if expired
  }
  savePool(pool);
  console.log(JSON.stringify({ ok: true, id: expId, touched: true }));
}

// === ARGS PARSER ===
const rawArgs = process.argv.slice(2);
const cmd = rawArgs[0];
const args = { _: [] };

for (let i = 1; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) {
    const key = rawArgs[i].replace('--', '');
    if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
      args[key] = rawArgs[i + 1];
      i++;
    } else {
      args[key] = true;
    }
  } else {
    args._.push(rawArgs[i]);
  }
}

switch (cmd) {
  case 'add': cmdAdd(args); break;
  case 'list': cmdList(args); break;
  case 'push': cmdPush(args); break;
  case 'push-all': cmdPushAll(args); break;
  case 'query': cmdQuery(args); break;
  case 'stats': cmdStats(); break;
  case 'cleanup': cmdCleanup(args); break;
  case 'forget': cmdForget(args); break;
  case 'expire': cmdExpire(); break;
  case 'touch': cmdTouch(args); break;
  default:
    console.log('experience-pool.js v2.0 — 子Agent共享经验池（含置信度/来源追溯/过期/遗忘）');
    console.log('  add      — 添加新经验 [--confidence 0.7] [--source "<ref>"] [--ttl-days 90]');
    console.log('  list     — 列出经验 [--status pending|pushed|pending_review]');
    console.log('  push     — 推送单条经验到目标Agent');
    console.log('  push-all — 自动推送所有合格pending经验（conf≥0.7，无需人工审核）[--dry-run] [--min-confidence 0.7]');
    console.log('  query    — 关键词搜索（按置信度排序）');
    console.log('  stats    — 统计信息（含置信度分布、审核队列）');
    console.log('  cleanup  — 清理旧记录');
    console.log('  forget   — 软删除经验（30天回收期）');
    console.log('  expire   — 清理超过TTL的经验');
    console.log('  touch    — 刷新TTL（标记活跃）');
    process.exit(0);
}
