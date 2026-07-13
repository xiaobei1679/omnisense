// scripts/dashboard.mjs
//
// Zero-dependency, self-contained **workspace-state dashboard** for the
// openclaw-workspace public template. Reuses the *concept* of the older
// `workspace/.learnings/scripts/dashboard-data.js`, but is fully
// DE-PERSONALIZED: it reports only FRAMEWORK-LEVEL state (agents, tests,
// scripts, docs, roadmap progress, quality-gate health) — never any personal
// project statistics. The old script read private files (experience pool,
// creation feedback, etc.); this one reads only published repo structure.
//
// Output: a single static HTML file with inline CSS/JS and NO external/CDN
// dependencies, so it opens offline in any browser. It is generated arti-
// fact (gitignored under .dashboard/), not committed source.
//
// API (pure, importable for tests):
//   parseRoadmap(text)   -> { done, inProgress, next, later, total }
//   countTestFiles(root) -> number
//   countScripts(root)   -> number
//   countDocs(root)      -> number
//   countPresets(root)   -> number
//   countConfigAgents(root) -> number
//   qualityGates(root)   -> [{ name, path, present }]
//   collectRepoState(root) -> aggregated state object
//   renderHtml(state)    -> HTML string (deterministic, self-contained)
//
// CLI:
//   node scripts/dashboard.mjs [root] [--out <file>] [--json]
//     root  defaults to cwd
//     --out writes the HTML here (default <root>/.dashboard/index.html)
//     --json prints the state as JSON instead of writing HTML

import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

// --- scanning helpers -------------------------------------------------------

function walkCount(dir, pred) {
  let count = 0;
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue;
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) count += walkCount(full, pred);
    else if (pred(entry)) count += 1;
  }
  return count;
}

function readRepoFile(root, rel) {
  try {
    return readFileSync(resolve(root, rel), 'utf8');
  } catch {
    return null;
  }
}

// Parse the roadmap markdown into per-section item counts.
// Matches the canonical headings (Done / In progress / Next / Later); the
// trailing emoji/decorations are ignored. Each `- ` bullet counts as one item.
export function parseRoadmap(text) {
  const t = String(text || '');
  const SECTION_KEYS = {
    Done: 'done',
    'In progress': 'inProgress',
    Next: 'next',
    Later: 'later',
  };
  const sections = { done: [], inProgress: [], next: [], later: [] };
  let cur = null;
  for (const line of t.split('\n')) {
    const h = line.match(/^##\s+(.*\S)\s*$/);
    if (h) {
      // Bare title = strip trailing emoji/decorations and parentheticals.
      const bare = h[1].replace(/[✅🚧🔜💡].*$/, '').replace(/\s*\(.*\)$/, '').trim();
      cur = Object.prototype.hasOwnProperty.call(SECTION_KEYS, bare) ? SECTION_KEYS[bare] : null;
      continue;
    }
    if (!cur) continue;
    if (/^\s*-\s+/.test(line)) sections[cur].push(line.trim());
  }
  const done = sections.done.length;
  const inProgress = sections.inProgress.length;
  const next = sections.next.length;
  const later = sections.later.length;
  return { done, inProgress, next, later, total: done + inProgress + next + later };
}

export function countTestFiles(root) {
  let entries = [];
  try {
    entries = readdirSync(resolve(root, 'tests'));
  } catch {
    return 0;
  }
  return entries.filter((f) => f.endsWith('.test.mjs')).length;
}

export function countScripts(root) {
  return walkCount(resolve(root, 'scripts'), (f) => f.endsWith('.js') || f.endsWith('.mjs'));
}

export function countDocs(root) {
  let entries = [];
  try {
    entries = readdirSync(resolve(root, 'docs'));
  } catch {
    return 0;
  }
  return entries.filter((f) => f.endsWith('.md')).length;
}

export function countPresets(root) {
  let entries = [];
  try {
    entries = readdirSync(resolve(root, 'examples', 'agents'));
  } catch {
    return 0;
  }
  return entries.filter((f) => f.endsWith('.md')).length;
}

export function countConfigAgents(root) {
  const raw = readRepoFile(root, 'config/openclaw.json.example');
  if (!raw) return 0;
  try {
    const cfg = JSON.parse(raw);
    const list = cfg && cfg.agents && Array.isArray(cfg.agents.list) ? cfg.agents.list : [];
    return list.length;
  } catch {
    return 0;
  }
}

// The five quality gates the "Reviewer specialist" and CI rely on.
const GATE_DEFS = [
  ['check-syntax', 'scripts/ci/check-syntax.mjs'],
  ['validate-config', 'scripts/ci/validate-config.mjs'],
  ['observer', 'scripts/ci/observer.mjs'],
  ['reviewer', 'scripts/ci/reviewer.mjs'],
  ['eval', 'scripts/eval/eval.mjs'],
];

export function qualityGates(root) {
  return GATE_DEFS.map(([name, rel]) => ({
    name,
    path: rel,
    present: readRepoFile(root, rel) !== null,
  }));
}

// Aggregate every framework-level metric into one state object.
export function collectRepoState(root) {
  const roadmapText = readRepoFile(root, 'ROADMAP.md') || '';
  return {
    generated: new Date().toISOString(),
    repo: basename(resolve(root)),
    agents: {
      presets: countPresets(root),
      configured: countConfigAgents(root),
    },
    tests: countTestFiles(root),
    scripts: countScripts(root),
    docs: countDocs(root),
    roadmap: parseRoadmap(roadmapText),
    gates: qualityGates(root),
  };
}

// --- HTML rendering (deterministic, self-contained) -------------------------

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pct(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}

export function renderHtml(state) {
  const s = state;
  const r = s.roadmap;
  const roadmapDonePct = pct(r.done, r.total);
  const gatesPresent = s.gates.filter((g) => g.present).length;
  const gatesTotal = s.gates.length;
  const genTime = new Date(s.generated).toLocaleString('zh-CN', { hour12: false });

  const cards = [
    { label: 'Agent 预设 / Presets', value: s.agents.presets, sub: `配置角色 ${s.agents.configured}` },
    { label: 'Tests', value: s.tests, sub: 'node:test' },
    { label: 'Scripts', value: s.scripts, sub: 'scripts/' },
    { label: 'Docs', value: s.docs, sub: 'docs/' },
  ];

  const cardHtml = cards
    .map(
      (c) => `
      <div class="card">
        <div class="card-value">${c.value}</div>
        <div class="card-label">${esc(c.label)}</div>
        <div class="card-sub">${esc(c.sub)}</div>
      </div>`
    )
    .join('');

  const gateHtml = s.gates
    .map(
      (g) => `
      <li class="gate ${g.present ? 'ok' : 'miss'}">
        <span class="dot">${g.present ? '✓' : '✕'}</span>
        <code>${esc(g.name)}</code>
        <span class="gate-path">${esc(g.path)}</span>
      </li>`
    )
    .join('');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>openclaw-workspace · Dashboard</title>
<style>
  :root { --bg:#0f1115; --panel:#171a21; --ink:#e7eaf0; --muted:#9aa3b2;
          --accent:#5b8cff; --ok:#3fb950; --miss:#f85149; --line:#262b36; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
         font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft Yahei",sans-serif; }
  .wrap { max-width:960px; margin:0 auto; padding:32px 20px 56px; }
  header h1 { margin:0 0 4px; font-size:22px; }
  header .gen { color:var(--muted); font-size:12px; }
  .grid { display:grid; grid-template-columns:repeat(4,1fr); gap:14px; margin:24px 0; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:12px;
          padding:18px 16px; text-align:center; }
  .card-value { font-size:30px; font-weight:700; color:var(--accent); }
  .card-label { margin-top:6px; font-size:13px; }
  .card-sub { color:var(--muted); font-size:11px; margin-top:2px; }
  section { background:var(--panel); border:1px solid var(--line); border-radius:12px;
            padding:18px 20px; margin-bottom:18px; }
  section h2 { margin:0 0 14px; font-size:15px; color:var(--ink); }
  .bar { height:10px; background:var(--line); border-radius:6px; overflow:hidden; margin:8px 0 4px; }
  .bar > span { display:block; height:100%; background:var(--accent); }
  .roadmap-row { display:flex; justify-content:space-between; color:var(--muted); font-size:12px; }
  .gates { list-style:none; margin:0; padding:0; }
  .gate { display:flex; align-items:center; gap:10px; padding:7px 0; border-bottom:1px solid var(--line); }
  .gate:last-child { border-bottom:0; }
  .dot { width:18px; height:18px; border-radius:50%; display:inline-flex; align-items:center;
         justify-content:center; font-size:11px; font-weight:700; color:#0f1115; }
  .gate.ok .dot { background:var(--ok); }
  .gate.miss .dot { background:var(--miss); }
  .gate code { color:var(--ink); }
  .gate-path { color:var(--muted); font-size:11px; margin-left:auto; }
  footer { color:var(--muted); font-size:12px; margin-top:8px; }
  footer code { color:var(--ink); }
  @media (max-width:640px){ .grid{ grid-template-columns:repeat(2,1fr);} }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>openclaw-workspace · 框架状态仪表盘</h1>
    <div class="gen">生成时间 / Generated: ${esc(genTime)} · 仓库 / Repo: ${esc(s.repo)}</div>
  </header>

  <div class="grid">${cardHtml}</div>

  <section>
    <h2>路线图进度 / Roadmap</h2>
    <div class="roadmap-row"><span>已完成 Done</span><span>${r.done} / ${r.total} (${roadmapDonePct}%)</span></div>
    <div class="bar"><span style="width:${roadmapDonePct}%"></span></div>
    <div class="roadmap-row" style="margin-top:10px">
      <span>进行中 In&nbsp;progress: <b style="color:var(--ink)">${r.inProgress}</b></span>
      <span>Next: <b style="color:var(--ink)">${r.next}</b> · Later: <b style="color:var(--ink)">${r.later}</b></span>
    </div>
  </section>

  <section>
    <h2>质量门禁 / Quality Gates (${gatesPresent}/${gatesTotal})</h2>
    <ul class="gates">${gateHtml}</ul>
  </section>

  <footer>
    由 <code>make dashboard</code> 生成（零依赖、纯静态、可离线打开）。仅展示框架级状态，不含任何个人项目数据。
  </footer>
</div>
</body>
</html>
`;
}

// --- CLI --------------------------------------------------------------------

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);
  let root = process.cwd();
  let out = resolve(root, '.dashboard', 'index.html');
  let asJson = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') asJson = true;
    else if (a === '--out') out = resolve(args[++i] || out);
    else if (!a.startsWith('--')) root = resolve(a);
  }
  const state = collectRepoState(root);
  const gatesPresent = state.gates.filter((g) => g.present).length;
  const gatesTotal = state.gates.length;
  if (asJson) {
    process.stdout.write(JSON.stringify(state, null, 2) + '\n');
    process.exit(0);
  }
  const html = renderHtml(state);
  try {
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, html, 'utf8');
  } catch (e) {
    console.error('failed to write dashboard:', e.message);
    process.exit(1);
  }
  console.log(`Dashboard written to ${out}`);
  console.log(
    JSON.stringify(
      {
        repo: state.repo,
        agents: state.agents,
        tests: state.tests,
        scripts: state.scripts,
        docs: state.docs,
        roadmap: state.roadmap,
        gates: `${gatesPresent}/${gatesTotal}`,
      },
      null,
      2
    )
  );
}
