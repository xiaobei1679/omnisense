// scripts/evolve/ingest.mjs
//
// Neutral "collected-info -> framework improvement" bridge for openclaw-workspace.
//
// Why this exists:
//   The daily creative-material analysis (小说/漫剧/音乐/独立游戏 等中立调研) and
//   any other collected insight live outside the framework as local data. This
//   script turns those raw insights into *framework-level* improvement proposals
//   (prompt templates / skills / agent-role presets / QA heuristics / docs) that a
//   human reviewer or the autonomous agent can apply to the repo. It never writes
//   project content — it only distills reusable, project-agnostic proposals.
//
// Insight file contract (any neutral markdown):
//   # <Title>                              <- H1 = proposal title
//   <!-- insight-meta
//   tags: prompt, qa                       <- comma list; drives classification
//   source: AI创作日报/2026-07-09          <- optional origin
//   -->
//   ... free-form body (the actual insight / lesson learned) ...
//
// Usage:
//   node scripts/evolve/ingest.mjs [dir]            -> print proposals as JSON
//   node scripts/evolve/ingest.mjs [dir] --write     -> also write .md into ./insights-out
//
// Programmatic API (exported for tests):
//   parseInsight(content) -> { title, tags, source, body }
//   slugify(s) -> kebab-id
//   classifyInsight(insight) -> category
//   toProposal(insight) -> { id, category, title, summary, suggestedPath, action }
//   ingestDir(dir) -> { proposals, errors }
//   renderProposal(p) -> markdown string

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const META_RE = /<!--\s*insight-meta\s*([\s\S]*?)\s*-->/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Category -> default landing path inside the (neutral) framework.
const CATEGORY_PATH = {
  'prompt-template': 'examples/agents/<id>.md',
  'agent-role': 'examples/agents/<id>.md',
  skill: 'examples/<id>/SKILL.md',
  'qa-heuristic': 'workspace/.learnings/scripts/style-engine.mjs (append rule)',
  doc: 'docs/<id>.md',
  other: 'examples/notes/<id>.md'
};

const TAG_TO_CATEGORY = {
  prompt: 'prompt-template',
  prompts: 'prompt-template',
  role: 'agent-role',
  agent: 'agent-role',
  skill: 'skill',
  skills: 'skill',
  qa: 'qa-heuristic',
  style: 'qa-heuristic',
  'ai-tone': 'qa-heuristic',
  doc: 'doc',
  docs: 'doc'
};

// Stable short hash (base36) for de-duplicating mixed-script ids.
function hash6(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

// Turn arbitrary text into a stable, **ASCII** kebab id (framework ids are
// `[a-z0-9-]+` only). CJK / mixed titles get a stable hash suffix so ids stay
// unique and machine-safe.
export function slugify(s) {
  const lower = String(s || '').toLowerCase();
  const ascii = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (!ascii) return `insight-${hash6(lower)}`;
  const base = ascii.slice(0, 40);
  return /[^\x00-\xff]/.test(lower) ? `${base}-${hash6(lower)}` : base;
}

// Parse a raw insight markdown file into structured fields. Never throws.
export function parseInsight(content) {
  const raw = String(content || '');
  const lines = raw.split('\n');
  let title = 'Untitled insight';
  let startBody = 0;
  // First H1 becomes the title.
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#\s+(.+?)\s*$/);
    if (m) {
      title = m[1].trim();
      startBody = i + 1;
      break;
    }
  }
  const metaBlock = raw.match(META_RE);
  const meta = {};
  if (metaBlock) {
    for (const ln of metaBlock[1].split('\n')) {
      const idx = ln.indexOf(':');
      if (idx === -1) continue;
      const k = ln.slice(0, idx).trim().toLowerCase();
      const v = ln.slice(idx + 1).trim();
      if (k) meta[k] = v;
    }
  }
  const tags = (meta.tags || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const source = meta.source || '';
  const body = lines.slice(startBody).join('\n').replace(META_RE, '').trim();
  return { title, tags, source, body };
}

// Classify an insight into one of the framework-improvement categories.
export function classifyInsight(insight) {
  const tags = (insight && insight.tags) || [];
  for (const t of tags) {
    if (TAG_TO_CATEGORY[t]) return TAG_TO_CATEGORY[t];
  }
  const blob = `${insight.title} ${insight.body || ''}`.toLowerCase();
  // English keywords (word-boundary safe).
  if (/\b(prompt|system prompt|咒语)\b/.test(blob)) return 'prompt-template';
  if (/\b(role|agent)\b/.test(blob)) return 'agent-role';
  if (/\b(skill)\b/.test(blob)) return 'skill';
  if (/\b(ai.?tone|style)\b/.test(blob)) return 'qa-heuristic';
  if (/\b(doc|readme|wiki)\b/.test(blob)) return 'doc';
  // CJK keywords (no \b — CJK chars are not \w, so use includes).
  if (blob.includes('提示词') || blob.includes('咒语')) return 'prompt-template';
  if (blob.includes('角色') || blob.includes('人设') || blob.includes('agent')) return 'agent-role';
  if (blob.includes('技能') || blob.includes('工具')) return 'skill';
  if (blob.includes('ai腔') || blob.includes('节奏') || blob.includes('质检') || blob.includes('文风')) return 'qa-heuristic';
  if (blob.includes('文档')) return 'doc';
  return 'other';
}

// Turn a parsed insight into a structured, framework-level improvement proposal.
export function toProposal(insight) {
  const base = parseInsight(typeof insight === 'string' ? insight : '');
  const data = typeof insight === 'string' ? base : { ...base, ...insight };
  const category = classifyInsight(data);
  const id = slugify(data.title);
  const summary = (data.body || '').slice(0, 280).replace(/\s+/g, ' ').trim();
  const suggestedPath = (CATEGORY_PATH[category] || CATEGORY_PATH.other).replace(
    '<id>',
    id
  );
  const action =
    category === 'qa-heuristic'
      ? '由审核员/质量诊断官评估后，将规则追加进 style-engine.js（保持零依赖）'
      : `由审核员确认后，按 ${suggestedPath} 落地为可复用模板（去项目化、纯框架级）`;
  return {
    id,
    category,
    title: data.title,
    summary,
    source: data.source || '',
    suggestedPath,
    action
  };
}

// Ingest every *.md insight in a directory. Never throws.
export function ingestDir(dir) {
  const proposals = [];
  const errors = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return { proposals, errors: [`cannot read dir: ${dir}`] };
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const file = resolve(dir, entry);
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    let content;
    try {
      content = readFileSync(file, 'utf8');
    } catch (e) {
      errors.push(`${entry}: ${e.message}`);
      continue;
    }
    const insight = parseInsight(content);
    if (!insight.body && !insight.title) {
      errors.push(`${entry}: empty insight`);
      continue;
    }
    proposals.push(toProposal(insight));
  }
  return { proposals, errors };
}

// Render a single proposal as a neutral markdown card.
export function renderProposal(p) {
  return [
    `## 提案 ${p.id} · ${p.category}`,
    '',
    `- **标题**：${p.title}`,
    `- **类别**：${p.category}`,
    p.source ? `- **来源**：${p.source}` : null,
    `- **建议落点**：${p.suggestedPath}`,
    `- **动作**：${p.action}`,
    '',
    `**摘要**：${p.summary || '(无)'}`,
    ''
  ]
    .filter((l) => l !== null)
    .join('\n');
}

// CLI
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const args = process.argv.slice(2);
  const write = args.includes('--write');
  const dirArg = args.find((a) => !a.startsWith('--'));
  const dir =
    dirArg ||
    process.env.OPENCLAW_INSIGHTS_DIR ||
    resolve(process.cwd(), 'insights');
  const { proposals, errors } = ingestDir(dir);
  if (write) {
    const out = resolve(process.cwd(), 'insights-out');
    mkdirSync(out, { recursive: true });
    for (const p of proposals) {
      writeFileSync(resolve(out, `${p.id}.md`), renderProposal(p), 'utf8');
    }
  }
  console.log(
    JSON.stringify({ dir, count: proposals.length, proposals, errors }, null, 2)
  );
  if (errors.length) process.exit(1);
}
