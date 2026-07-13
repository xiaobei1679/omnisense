#!/usr/bin/env node
// skill-evolution.js v1.0 — Skill自进化机制
// 用法:
//   node skill-evolution.js scan [--days N] [--min-score 4] — 扫描成功Spec模式
//   node skill-evolution.js propose --spec-id <id>                         — 生成Skill升级提案
//   node skill-evolution.js apply --proposal-id <id> [--auto]             — 应用提案（--auto仅低风险）
//   node skill-evolution.js stats                                           — 进化统计

const fs = require('fs');
const path = require('path');

const EVO_PATH = path.join(__dirname, '..', 'skill-evolution-state.json');
const SPEC_PATTERNS_PATH = path.join(__dirname, '..', 'spec-patterns.json');

// === Risk classification ===
const RISK_LEVELS = {
  low: { auto_apply: true, need_review: false },
  medium: { auto_apply: false, need_review: true },
  high: { auto_apply: false, need_review: true, require_user: true }
};

function loadEvoState() {
  if (!fs.existsSync(EVO_PATH)) {
    const initial = {
      version: '1.0',
      created: new Date().toISOString(),
      patterns: [],
      proposals: [],
      applied: [],
      stats: { total_detected: 0, total_proposed: 0, total_applied: 0, total_rejected: 0 }
    };
    fs.writeFileSync(EVO_PATH, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  return JSON.parse(fs.readFileSync(EVO_PATH, 'utf-8'));
}

function saveEvoState(state) {
  fs.writeFileSync(EVO_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function loadSpecPatterns() {
  if (!fs.existsSync(SPEC_PATTERNS_PATH)) return [];
  return JSON.parse(fs.readFileSync(SPEC_PATTERNS_PATH, 'utf-8'));
}

function classifyRisk(pattern) {
  if (pattern.success_count < 3) return 'high';
  if (pattern.success_count < 5) return 'medium';
  if (pattern.affected_skills && pattern.affected_skills.length > 1) return 'medium';
  return 'low';
}

// === Scan: detect successful Spec patterns ===
function cmdScan(args) {
  const days = parseInt(args.days) || 14;
  const minScore = parseInt(args['min-score']) || 4;

  const evo = loadEvoState();
  const specPatterns = loadSpecPatterns();

  // Discover patterns from task results / learnings
  const poolPath = path.join(__dirname, '..', 'shared-experience-pool.json');
  let expEntries = [];
  if (fs.existsSync(poolPath)) {
    const pool = JSON.parse(fs.readFileSync(poolPath, 'utf-8'));
    expEntries = pool.experiences || [];
  }

  // Group experiences by category to find patterns
  const byPattern = {};
  for (const e of expEntries) {
    const key = `${e.category}:${e.task_type}`;
    if (!byPattern[key]) byPattern[key] = { category: e.category, task_type: e.task_type, count: 0, examples: [] };
    byPattern[key].count++;
    byPattern[key].examples.push(e.learning);
  }

  // Existing spec patterns
  for (const sp of specPatterns) {
    const key = `${sp.category}:${sp.task_type}`;
    if (!byPattern[key]) byPattern[key] = { category: sp.category, task_type: sp.task_type, count: 0, examples: [] };
    byPattern[key].count += sp.score || 0;
    byPattern[key].success_count = sp.success_count || 0;
  }

  // Detect new patterns (category appears >= minScore times)
  const newPatterns = [];
  for (const [key, data] of Object.entries(byPattern)) {
    const effectiveCount = data.success_count || data.count;
    if (effectiveCount >= minScore) {
      const existing = evo.patterns.find(p => p.pattern_key === key);
      if (!existing) {
        const ts = Date.now().toString(36);
        const rnd = Math.random().toString(36).slice(2, 6);
        const pattern = {
          id: 'sp-' + ts + '-' + rnd,
          pattern_key: key,
          category: data.category,
          task_type: data.task_type,
          example_count: effectiveCount,
          sample_learnings: data.examples.slice(0, 3),
          detected_at: new Date().toISOString(),
          risk: classifyRisk({ success_count: effectiveCount }),
          affected_skills: inferAffectedSkills(data.category, data.task_type),
          status: 'detected'
        };
        newPatterns.push(pattern);
      }
    }
  }

  // Add new patterns to state
  for (const np of newPatterns) {
    evo.patterns.push(np);
  }
  evo.stats.total_detected += newPatterns.length;
  saveEvoState(evo);

  // Report
  const pending = evo.patterns.filter(p => p.status === 'detected');
  console.log(JSON.stringify({
    ok: true,
    new_detected: newPatterns.length,
    total_pending: pending.length,
    patterns: pending.map(p => ({
      id: p.id,
      key: p.pattern_key,
      examples: p.example_count,
      risk: p.risk,
      skills: p.affected_skills
    }))
  }, null, 2));
}

function inferAffectedSkills(category, taskType) {
  const mapping = {
    '开篇': ['tomato-novelist', 'novel-creator'],
    '悬念': ['tomato-novelist'],
    '对话': ['tomato-novelist', 'drama-scriptwriter'],
    '描写': ['tomato-novelist'],
    '节奏': ['tomato-novelist', 'outline-designer'],
    '审核': ['content-reviewer'],
    '设定': ['worldbuilding-architect'],
    '去AI味': ['tomato-novelist', 'content-reviewer'],
    '番茄': ['novel-hotcatcher', 'tomato-novelist'],
    '视觉': ['visual-producer'],
    '视频': ['video-editor', 'visual-producer'],
    '营销': ['marketing-operator']
  };
  const skills = mapping[category] || ['general'];
  if (taskType === 'chapter-review' && !skills.includes('content-reviewer')) skills.push('content-reviewer');
  return skills;
}

// === Propose: generate skill upgrade proposal ===
function cmdPropose(args) {
  const specId = args['spec-id'];
  if (!specId) {
    console.error('用法: node skill-evolution.js propose --spec-id <id>');
    process.exit(1);
  }

  const evo = loadEvoState();
  const pattern = evo.patterns.find(p => p.id === specId);
  if (!pattern) {
    console.error(`错误: 找不到Spec模式 ${specId}`);
    process.exit(1);
  }

  if (pattern.risk === 'high') {
    console.log(JSON.stringify({
      ok: false,
      reason: '高风险模式，需用户手动确认后才能生成提案',
      pattern: pattern.pattern_key,
      risk: 'high'
    }));
    process.exit(0);
  }

  // Build proposal
  const proposalId = 'prop-' + Date.now().toString(36);
  const proposal = {
    id: proposalId,
    pattern_id: specId,
    pattern_key: pattern.pattern_key,
    category: pattern.category,
    target_skills: pattern.affected_skills,
    risk: pattern.risk,
    auto_apply: pattern.risk === 'low',
    sample_learnings: pattern.sample_learnings,
    proposed_at: new Date().toISOString(),
    status: pattern.risk === 'low' ? 'auto_approved' : 'pending_review',
    // Suggested Skill update content
    spec_content: generateSpecContent(pattern)
  };

  evo.proposals.push(proposal);
  pattern.status = 'proposed';
  evo.stats.total_proposed++;
  saveEvoState(evo);

  console.log(JSON.stringify({
    ok: true,
    proposal_id: proposalId,
    risk: pattern.risk,
    auto_apply: proposal.auto_apply,
    target_skills: pattern.affected_skills,
    spec_preview: proposal.spec_content.slice(0, 200) + '…',
    next_step: proposal.auto_apply
      ? '低风险自动应用。运行: node skill-evolution.js apply --proposal-id ' + proposalId + ' --auto'
      : '中等风险需审核。运行: node skill-evolution.js apply --proposal-id ' + proposalId
  }, null, 2));
}

function generateSpecContent(pattern) {
  const learnings = pattern.sample_learnings || [];
  const summary = learnings.join('；');

  return `# Spec升级: ${pattern.category} — ${pattern.pattern_key}

## 来源
基于 ${pattern.example_count} 次成功执行的Spec模式。

## 核心经验
${learnings.map((l, i) => `${i + 1}. ${l}`).join('\n')}

## 建议操作
将此经验嵌入 ${(pattern.affected_skills || ['unknown']).join(', ')} Skill的提示词/任务模板中。

## 风险等级
${pattern.risk}

## 自动检测时间
${pattern.detected_at}`;
}

// === Apply: execute proposal ===
function cmdApply(args) {
  const proposalId = args['proposal-id'];
  const autoMode = args['auto'] === true;

  if (!proposalId) {
    console.error('用法: node skill-evolution.js apply --proposal-id <id> [--auto]');
    process.exit(1);
  }

  const evo = loadEvoState();
  const proposal = evo.proposals.find(p => p.id === proposalId);
  if (!proposal) {
    console.error(`错误: 找不到提案 ${proposalId}`);
    process.exit(1);
  }

  if (proposal.status === 'applied') {
    console.log(JSON.stringify({ ok: false, reason: '提案已应用，跳过' }));
    process.exit(0);
  }
  if (proposal.status === 'rejected') {
    console.log(JSON.stringify({ ok: false, reason: '提案已被拒绝，跳过' }));
    process.exit(0);
  }

  // Risk gate
  if (proposal.risk === 'high' && autoMode) {
    console.log(JSON.stringify({ ok: false, reason: '高风险提案不可自动应用，需用户确认' }));
    process.exit(0);
  }
  // 风险闸门：高风险禁止自动应用（需用户确认）。自动应用仅限低风险；中风险须人工审核后显式执行单次 apply。

  // Apply
  proposal.status = 'applied';
  proposal.applied_at = new Date().toISOString();

  // Mark pattern as applied
  const pattern = evo.patterns.find(p => p.id === proposal.pattern_id);
  if (pattern) pattern.status = 'applied';

  // Record applied entry
  evo.applied.push({
    proposal_id: proposal.id,
    pattern_key: proposal.pattern_key,
    target_skills: proposal.target_skills,
    applied_at: proposal.applied_at,
    risk: proposal.risk
  });
  evo.stats.total_applied++;

  saveEvoState(evo);

  console.log(JSON.stringify({
    ok: true,
    proposal_id: proposal.id,
    applied: true,
    target_skills: proposal.target_skills,
    note: 'Spec模式已固化。下次使用对应Skill时自动引用此经验。需手动更新Skill文件或将经验嵌入任务模板。'
  }, null, 2));
}

function cmdApplyAll(args) {
  const dryRun = args['dry-run'] || false;
  const evo = loadEvoState();
  // 仅自动应用低风险提案（与 RISK_LEVELS.medium.auto_apply=false 及文档"仅低风险自动应用"一致）
  const pending = evo.proposals.filter(p => p.status === 'pending_review' && p.risk === 'low');
  if (pending.length === 0) {
    console.log(JSON.stringify({ ok: true, applied: 0, message: '没有符合自动应用条件的提案' }));
    return;
  }
  if (dryRun) {
    console.log(JSON.stringify({
      ok: true, dry_run: true,
      candidates: pending.map(p => ({ id: p.id, pattern_key: p.pattern_key, risk: p.risk, target_skills: p.target_skills }))
    }, null, 2));
    return;
  }
  const results = [];
  for (const p of pending) {
    p.status = 'applied';
    p.applied_at = new Date().toISOString();
    const pat = evo.patterns.find(x => x.id === p.pattern_id);
    if (pat) pat.status = 'applied';
    evo.applied.push({ proposal_id: p.id, pattern_key: p.pattern_key, target_skills: p.target_skills, applied_at: p.applied_at, risk: p.risk });
    evo.stats.total_applied++;
    results.push({ id: p.id, pattern_key: p.pattern_key, target_skills: p.target_skills });
  }
  saveEvoState(evo);
  console.log(JSON.stringify({ ok: true, applied: results.length, items: results }, null, 2));
}

function cmdStats() {
  const evo = loadEvoState();
  const pending = evo.patterns.filter(p => p.status === 'detected');
  const proposed = evo.patterns.filter(p => p.status === 'proposed');
  const applied = evo.patterns.filter(p => p.status === 'applied');

  console.log(JSON.stringify({
    ok: true,
    stats: evo.stats,
    patterns: { detected: pending.length, proposed: proposed.length, applied: applied.length },
    proposals: evo.proposals.filter(p => p.status === 'pending_review').length + ' pending review',
    recent_applied: evo.applied.slice(-5).reverse()
  }, null, 2));
}

// === Args parser ===
const rawArgs = process.argv.slice(2);
const cmd = rawArgs[0];
const args = {};
for (let i = 1; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) {
    const key = rawArgs[i].replace('--', '');
    if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
      args[key] = rawArgs[i + 1];
      i++;
    } else {
      args[key] = true;
    }
  }
}

switch (cmd) {
  case 'scan': return cmdScan(args);
  case 'propose': return cmdPropose(args);
  case 'apply': return cmdApply(args);
  case 'apply-all': return cmdApplyAll(args);
  case 'stats': return cmdStats();
  default:
    console.log('skill-evolution.js v1.0 — Skill自进化机制');
    console.log('  scan [--days N] [--min-score 4]  — 扫描成功Spec模式');
    console.log('  propose --spec-id <id>             — 生成Skill升级提案');
    console.log('  apply --proposal-id <id> [--auto]  — 应用提案');
    console.log('  apply-all [--dry-run]       — 自动应用所有低风险提案');
    console.log('  stats                               — 进化统计');
    process.exit(0);
}
