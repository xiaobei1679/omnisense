// scripts/ci/observer.mjs
// Observer Agent — an automated PR/change reviewer for openclaw-workspace.
//
// Pure, zero-key logic (no LLM needed) that enforces the repo's hard rules:
//   1. protected-path guard  — rejects commits that touch secret/private files
//   2. secret scan           — flags plaintext credentials / high-entropy tokens
//   3. syntax gate           — `node --check` on every .js/.mjs/.cjs in the change
//   4. agent-contract guard  — rejects agent output whose path escapes the repo
//                              or points at a file it must never edit (.env, config)
//
// Reused by: `make review`, the pre-commit hook, and (optionally) a future
// GitHub Actions workflow. The exported functions are unit-tested in
// tests/observer.test.mjs.
//
// CLI:
//   node scripts/ci/observer.mjs --diff            # review changed files (git)
//   node scripts/ci/observer.mjs --files a.js b.md # review an explicit list
//   node scripts/ci/observer.mjs --all             # review every tracked script
//   node scripts/ci/observer.mjs --contract-file x.json  # also review agent JSON

import { execFileSync, execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname } from 'node:path';

const ROOT = process.env.OBSERVER_ROOT
  ? resolve(process.env.OBSERVER_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ---------------------------------------------------------------------------
// Rule 1: protected paths (must never be committed to the public repo)
// ---------------------------------------------------------------------------
const EXACT_BANNED = new Set(['.env', 'config/openclaw.json', 'workspace/USER.md', 'USER.md']);
const SUFFIX_BANNED = ['.key']; // any *.key (mirrors .gitignore)
const DIR_BANNED_PREFIX = [
  'novel/', 'gbrain/', 'sessions/', '.openclaw/',
  'workspace/memory/', 'workspace/_协作基础设施_/', 'workspace/archive/',
  'workspace/_douyin_learnings_/', 'workspace/qclaw_项目中枢/', 'workspace/山海巨兽录_产出/',
  'workspace/每日热点/', 'workspace/每日热点共享池/', 'workspace/赛马共享池/',
  'workspace/团队配置/',
];
const FILE_BANNED_PREFIX = [
  'workspace/HEARTBEAT.md', 'workspace/IDENTITY.md', 'workspace/MEMORY.md',
  'workspace/MEMORY-RULES.md', 'workspace/MEMORY-PROFILE.md', 'workspace/MEMORY-STATUS.md',
];

export function isProtectedPath(f) {
  const p = String(f).replace(/\\/g, '/');
  if (EXACT_BANNED.has(p) || EXACT_BANNED.has(p.split('/').pop())) return true;
  if (SUFFIX_BANNED.some((s) => p.endsWith(s))) return true;
  if (DIR_BANNED_PREFIX.some((d) => p === d || p.startsWith(d) || p.includes('/' + d))) return true;
  if (FILE_BANNED_PREFIX.some((d) => p === d || p.endsWith('/' + d))) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Rule 2: secret scan
// ---------------------------------------------------------------------------
const SECRET_PREFIXES = [
  /(?:sk|rk)-[A-Za-z0-9_\-]{20,}/,
  /pk_(?:live|test)_[A-Za-z0-9_\-]{20,}/,
  /gh[pousr]_[A-Za-z0-9]{36,}/,
  /ghsa_[A-Za-z0-9]{36,}/,
  /AIza[0-9A-Za-z_\-]{35,}/,
  /ya29\.[0-9A-Za-z_\-]{30,}/,
  /xox[baprs]-[0-9A-Za-z\-]{10,}/,
  /AKIA[0-9A-Z]{16}/,
  /eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}/, // JWT
];
const SECRET_CONTEXT = /(key|token|secret|password|passwd|api[_-]?key|凭证|密钥|access[_-]?token|auth)/i;
const HIGH_ENTROPY = /(?:[A-Za-z0-9+/]{40,}|[0-9a-fA-F]{48,})/;
const PLACEHOLDER = /(your[-_ ]?(token|key|secret|password|api)|<[^>]+>|xxxx+|changeme|placeholder|replace[-_ ]?me|to[-_ ]?be[-_ ]?replaced|REPLACE_ME|\*{6,}|example)/i;

export function detectSecrets(text, { file = '' } = {}) {
  if (/\.example$/i.test(file) || /example/i.test(file)) return []; // templates may hold placeholders
  const findings = [];
  const seen = new Set();
  for (const line of String(text).split('\n')) {
    if (PLACEHOLDER.test(line)) continue; // obvious placeholder line — ignore
    for (const re of SECRET_PREFIXES) {
      const m = line.match(re);
      if (m) {
        const sig = 'prefix:' + m[0].slice(0, 10);
        if (!seen.has(sig)) { seen.add(sig); findings.push({ rule: 'secret-prefix', snippet: line.trim().slice(0, 80) }); }
      }
    }
    if (SECRET_CONTEXT.test(line)) {
      const m = line.match(HIGH_ENTROPY);
      if (m) {
        const sig = 'entropy:' + m[0].slice(0, 10);
        if (!seen.has(sig)) { seen.add(sig); findings.push({ rule: 'high-entropy', snippet: line.trim().slice(0, 80) }); }
      }
    }
  }
  return findings;
}

// ---------------------------------------------------------------------------
// Rule 3: syntax gate
// ---------------------------------------------------------------------------
const SCRIPT_RE = /\.(js|mjs|cjs)$/i;
const TEXT_RE = /\.(mjs|js|cjs|json|md|yml|yaml|ps1|sh|ts|txt|toml|env|example)$/i;

// ---------------------------------------------------------------------------
// Rule 4: agent-contract path safety
// ---------------------------------------------------------------------------
export function isPathSafe(p) {
  if (!p || typeof p !== 'string') return false;
  const np = p.replace(/\\/g, '/');
  if (np.startsWith('/') || /^[A-Za-z]:[\\/]/.test(np)) return false; // absolute
  if (np.startsWith('./') || np.startsWith('../')) return false;
  if (np.includes('..')) return false; // traversal
  if (np.includes('\0')) return false; // null byte
  if (np.trim() === '') return false;
  return true;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export function runReview({ files = [], contractJson = '', root = ROOT } = {}) {
  const violations = [];

  for (const f of files) {
    if (isProtectedPath(f)) {
      violations.push({ rule: 'protected-path', severity: 'error', file: f, detail: `touches a secret/private path that must not be committed: ${f}` });
    }
  }

  for (const f of files) {
    if (!TEXT_RE.test(f)) continue;
    // The test suite, eval harness, and example fixtures contain mock
    // credentials/keys by design — never flag them as real secrets.
    if (f.startsWith('tests/') || f.split('/').includes('tests')) continue;
    if (f.startsWith('scripts/eval/') || f.split('/').includes('examples')) continue;
    let text;
    try {
      text = readFileSync(resolve(root, f), 'utf8');
    } catch {
      continue; // binary or unreadable — skip (syntax gate still covers scripts)
    }
    const hits = detectSecrets(text, { file: f });
    for (const h of hits) {
      violations.push({ rule: 'secret', severity: 'error', file: f, detail: `[${h.rule}] ${h.snippet}` });
    }
  }

  for (const f of files) {
    if (!SCRIPT_RE.test(f)) continue;
    try {
      execFileSync(process.execPath, ['--check', resolve(root, f)], { stdio: 'pipe' });
    } catch (e) {
      const msg = (e.stderr || e.stdout || e.message || '').toString().split('\n')[0].trim();
      violations.push({ rule: 'syntax', severity: 'error', file: f, detail: msg || 'node --check failed' });
    }
  }

  if (contractJson && contractJson.trim()) {
    let blocks;
    try {
      blocks = JSON.parse(contractJson);
    } catch {
      const m = contractJson.match(/\[[\s\S]*\]/);
      blocks = m ? safeParse(m[0]) : null;
    }
    if (Array.isArray(blocks)) {
      for (const b of blocks) {
        if (!b || !b.path) continue;
        if (!isPathSafe(b.path) || isProtectedPath(b.path)) {
          violations.push({ rule: 'contract-path', severity: 'error', file: b.path, detail: `agent contract path is unsafe or targets a forbidden file: ${b.path}` });
        }
      }
    }
  }

  return { passed: violations.length === 0, violations };
}

function safeParse(s) {
  try { return JSON.parse(s); } catch { return null; }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
function repoScope() {
  // openclaw-workspace 被并入 OmniSense 单体仓库后，自身没有 .git。
  // 这里向上找到真正的 git 仓库根，并算出本子包在仓库里的相对子目录，
  // 后续 git 命令一律用 `git -C <root> ... -- <subdir>` 限定范围，
  // 避免越界审查父仓库（OmniSense）的 ESM 文件。
  try {
    const top = execSync('git rev-parse --show-toplevel', { cwd: ROOT, encoding: 'utf8' })
      .trim()
      .replace(/\\/g, '/');
    const sub = relative(top, ROOT).replace(/\\/g, '/');
    return { top, sub };
  } catch {
    return { top: ROOT.replace(/\\/g, '/'), sub: '' };
  }
}

// 把 git 返回的「仓库根相对路径」裁剪成本子包内的相对路径（去掉 subdir 前缀）
function stripSub(f, sub) {
  const nf = f.replace(/\\/g, '/');
  if (sub && (nf === sub || nf.startsWith(sub + '/'))) {
    return nf === sub ? '.' : nf.slice(sub.length + 1);
  }
  return nf;
}

function collectChanged() {
  const { top, sub } = repoScope();
  const pathspec = sub ? ` -- ${sub}` : '';
  const parts = [];
  for (const cmd of [
    `git -C "${top}" diff --name-only HEAD${pathspec}`,
    `git -C "${top}" diff --cached --name-only${pathspec}`,
    `git -C "${top}" ls-files --others --exclude-standard${pathspec}`,
  ]) {
    try {
      parts.push(execSync(cmd, { encoding: 'utf8' }));
    } catch {
      /* branch with no HEAD, or unrelated git error — ignore that source */
    }
  }
  return [...new Set(parts.join('\n').split('\n').filter(Boolean))].map((f) => stripSub(f, sub));
}
function collectAll() {
  const { top, sub } = repoScope();
  const pathspec = sub ? ` -- ${sub}` : '';
  return execSync(`git -C "${top}" ls-files${pathspec}`, { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .map((f) => stripSub(f, sub));
}

async function main() {
  const args = process.argv.slice(2);
  let files = [];
  let contractJson = '';
  if (args.includes('--all')) files = collectAll();
  else if (args.includes('--files')) {
    const i = args.indexOf('--files');
    files = args.slice(i + 1).filter((a) => !a.startsWith('--'));
  } else {
    files = collectChanged();
  }
  const ci = args.indexOf('--contract-file');
  if (ci !== -1) {
    try { contractJson = readFileSync(resolve(ROOT, args[ci + 1]), 'utf8'); } catch (e) { console.error('cannot read contract file:', e.message); }
  }

  const { passed, violations } = runReview({ files, contractJson, root: ROOT });
  const rel = (f) => relative(ROOT, resolve(ROOT, f)) || f;
  console.log(`\n🔍 Observer Agent — reviewed ${files.length} file(s)\n`);
  if (violations.length === 0) {
    console.log('✅ No rule violations found.\n');
    process.exit(0);
  }
  console.log(`❌ ${violations.length} violation(s):\n`);
  for (const v of violations) {
    console.log(`  [${v.severity.toUpperCase()}] ${v.rule} — ${rel(v.file)}`);
    console.log(`      ${v.detail}`);
  }
  console.log('');
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
