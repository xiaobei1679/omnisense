// scripts/agent/router.mjs
// Router Agent — a deterministic task planner / router for openclaw-workspace.
//
// Pure, zero-key logic (no LLM needed). Given a natural-language task it:
//   1. classifies the dominant intent (research / coding / writing / review / data)
//   2. decomposes the task into clauses (one per step)
//   3. routes each clause to a specialist agent from a registry
//
// The exported functions are unit-tested in tests/router.test.mjs.
// The same module backs `make router` / `scripts/dev.sh router` and can be
// imported by an LLM-driven agent to pick which specialist should do what.
//
// CLI:
//   node scripts/agent/router.mjs --task "research X then write Y"
//   echo "task text" | node scripts/agent/router.mjs            # read stdin
//   node scripts/agent/router.mjs --task "..." --registry r.json

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = process.env.ROUTER_ROOT
  ? resolve(process.env.ROUTER_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Intent vocabulary
// ---------------------------------------------------------------------------
export const INTENTS = ['research', 'coding', 'writing', 'review', 'data', 'general'];

// Lowercase substring matches (works for both Latin and CJK; no \b needed).
const INTENT_KEYWORDS = {
  research: [
    'research', 'investigate', 'find', 'search', 'gather', 'survey', 'study',
    'explore', 'lookup', '调研', '研究', '查一下', '检索', '搜集', '资料', '了解现状', '分析现状',
  ],
  coding: [
    'code', 'build', 'implement', 'fix', 'bug', 'refactor', 'function', 'script',
    'program', 'develop', 'debug', '写代码', '实现', '开发', '编程', '修复', '重构', '函数', '脚本', '代码',
  ],
  writing: [
    'write', 'draft', 'compose', 'article', 'essay', 'novel', 'copy', 'document',
    'content', 'report', '文案', '文章', '小说', '写作', '创作', '报告', '文档', '草稿', '撰写',
  ],
  review: [
    'review', 'revise', 'audit', 'verify', 'inspect', 'proofread', '审查', '评审',
    '检查', '校验', '审核', '复查', '润色', '修改意见',
  ],
  data: [
    'data', 'dataset', 'csv', 'chart', 'graph', 'statistics', 'statistic', 'excel',
    '统计', '数据', '图表', '数据集', '报表', '分析数据',
  ],
};

// Keywords that strongly signal an intent (count double) — disambiguates ties
// such as "review the PR for bugs" (review wins over the weak 'bug' coding hit).
const STRONG = {
  research: new Set(['research', 'investigate', 'survey', '调研', '研究', '检索', '查一下', '分析现状', '了解现状']),
  coding: new Set(['code', 'build', 'implement', 'fix', 'refactor', 'program', 'develop', 'debug', '写代码', '实现', '开发', '编程', '修复', '重构', '代码']),
  writing: new Set(['write', 'draft', 'compose', 'article', 'essay', 'novel', '文案', '文章', '小说', '写作', '创作', '撰写']),
  review: new Set(['review', 'audit', 'verify', '审查', '评审', '审核', '复查', '润色']),
  data: new Set(['data', 'dataset', 'csv', 'chart', 'statistics', 'statistic', '统计', '数据', '图表', '数据集', '报表', '分析数据']),
};

// Default specialist registry. `intents` lists which intents the agent can take.
export const DEFAULT_REGISTRY = [
  { id: 'researcher', role: 'Research specialist', intents: ['research'] },
  { id: 'engineer', role: 'Software engineer', intents: ['coding'] },
  { id: 'writer', role: 'Content writer', intents: ['writing'] },
  { id: 'reviewer', role: 'Reviewer / QA', intents: ['review'] },
  { id: 'analyst', role: 'Data analyst', intents: ['data'] },
  { id: 'generalist', role: 'General assistant', intents: ['general'] },
];

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------
export function scoreIntent(text) {
  const t = String(text || '').toLowerCase();
  let best = 'general';
  let bestScore = 0;
  for (const intent of INTENTS) {
    if (intent === 'general') continue;
    let score = 0;
    for (const kw of INTENT_KEYWORDS[intent]) {
      if (t.includes(kw.toLowerCase())) score += STRONG[intent].has(kw.toLowerCase()) ? 2 : 1;
    }
    if (score > bestScore) {
      bestScore = score;
      best = intent;
    }
  }
  let confidence = 'low';
  if (bestScore >= 2) confidence = 'high';
  else if (bestScore === 1) confidence = 'medium';
  return { intent: best, score: bestScore, confidence };
}

export function classifyIntent(text) {
  return scoreIntent(text).intent;
}

// ---------------------------------------------------------------------------
// Decomposition
// ---------------------------------------------------------------------------
// Split a task into clauses on sentence terminators and step connectors.
// Covers both CJK (。．！？；) and ASCII (. ! ? ;) punctuation, plus step
// connectors in Chinese (并/然后/另外…) and English (then/and).
const CLAUSE_SPLIT = /[。．.；;！!？?\n]+|\s*(?:并且|然后|接着|另外|以及|还有|同时|并|then|and)\s*/i;

export function decompose(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  return t
    .split(CLAUSE_SPLIT)
    .map((c) => c.trim())
    .filter((c) => c.length >= 2);
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------
export function resolveAgent(intent, registry = DEFAULT_REGISTRY) {
  const list = Array.isArray(registry) ? registry : [];
  for (const a of list) {
    if (Array.isArray(a.intents) && a.intents.includes(intent)) return a.id;
  }
  // No specialist for this intent → fall back to the generalist if present.
  const gen = list.find((a) => Array.isArray(a.intents) && a.intents.includes('general'));
  return gen ? gen.id : 'general';
}

export function route(task, opts = {}) {
  const { registry = DEFAULT_REGISTRY, maxSubtasks = 8 } = opts;
  if (!task || String(task).trim() === '') {
    throw new Error('empty task: Router Agent needs a non-empty task string');
  }

  const clauses = decompose(task);
  if (clauses.length === 0) clauses.push(String(task).trim());

  const truncated = clauses.length > maxSubtasks;
  const used = truncated ? clauses.slice(0, maxSubtasks - 1) : clauses;

  const subtasks = used.map((clause, i) => {
    const intent = classifyIntent(clause);
    return { id: i + 1, intent, agent: resolveAgent(intent, registry), prompt: clause };
  });

  if (truncated) {
    const rest = clauses.slice(maxSubtasks - 1);
    subtasks.push({
      id: subtasks.length + 1,
      intent: 'general',
      agent: resolveAgent('general', registry),
      prompt: `(合并剩余 ${rest.length} 个步骤) ${rest.join('；')}`,
    });
  }

  // Primary intent = the first clause's intent (a task starts with its entry
  // step). If the first clause is too vague, fall back to the whole-task view.
  let primaryIntent = subtasks[0].intent;
  if (primaryIntent === 'general') primaryIntent = scoreIntent(task).intent;

  const primaryAgent = resolveAgent(primaryIntent, registry);
  const { confidence } = scoreIntent(task);
  const agentsUsed = [...new Set(subtasks.map((s) => s.agent))];

  return {
    task: String(task).trim(),
    intent: primaryIntent,
    primaryAgent,
    subtasks,
    confidence,
    fallback: primaryAgent === 'general',
    truncated,
    agentsUsed,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function loadRegistry(path) {
  try {
    const raw = readFileSync(resolve(ROOT, path), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : parsed.agents || parsed.registry || [];
  } catch (e) {
    console.error(`router: cannot read registry "${path}": ${e.message}`);
    process.exit(1);
  }
}

function readStdin() {
  // Synchronous read of all pending stdin (works for piped input).
  try {
    const { fd } = process.stdin;
    const buf = readFileSync(fd);
    return buf.toString('utf8');
  } catch {
    return '';
  }
}

async function main() {
  const args = process.argv.slice(2);
  let task = '';
  let registry = DEFAULT_REGISTRY;

  const ti = args.indexOf('--task');
  if (ti !== -1) task = args[ti + 1] || '';
  else if (!process.stdin.isTTY) task = readStdin();

  const ri = args.indexOf('--registry');
  if (ri !== -1) registry = loadRegistry(args[ri + 1]);

  try {
    const plan = route(task, { registry });
    console.log(JSON.stringify(plan, null, 2));
  } catch (e) {
    console.error(`router: ${e.message}`);
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
