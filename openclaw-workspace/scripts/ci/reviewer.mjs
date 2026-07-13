// scripts/ci/reviewer.mjs
//
// Automated "reviewer specialist" (专员审核): runs a battery of deterministic,
// zero-key quality checks and returns a pass/fail verdict. Safe for CI and for
// the 30-minute auto-iteration automation — only when this reports PASS may the
// automation `git push origin main`.
//
// Checks (all must pass):
//   1. syntax-check    — every tracked script passes `node --check`
//   2. config-validate — published template configs validate
//   3. functional-tests— full `node --test tests/*.test.mjs` suite is green
//   4. observer-gate   — no protected-path / secret / syntax / contract violations
//
// Exit code: 0 = PASS (safe to update), 1 = FAIL (do NOT push).
//
// Usage:
//   node scripts/ci/reviewer.mjs                # run all checks, print human report
//   node scripts/ci/reviewer.mjs --json         # emit JSON verdict (for automation)
//   node scripts/ci/reviewer.mjs --skip-tests   # skip the (slow) test run

import { execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
// process.execPath is the node binary running this script; normalize to forward
// slashes so it is safe inside a shell command on both Git Bash and Windows.
const NODE = process.execPath.replace(/\\/g, '/');

function run(cmd) {
  try {
    const out = execSync(cmd, {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { ok: true, out: out || '' };
  } catch (err) {
    const out = (err.stdout || '') + (err.stderr || '');
    return { ok: false, out };
  }
}

// Run a single named check; capture exit status and a tail of its output.
export function runCheck(name, cmd) {
  const r = run(cmd);
  return { name, passed: r.ok, output: r.out.trim().slice(-800) };
}

// Pure: a verdict is PASS only when every check passed.
export function verdict(checks) {
  return checks.every((c) => c.passed);
}

// Run the full reviewer battery. `skipTests` avoids re-shelling the test suite
// (used by the test file so it never recurses inside `node --test`).
export function runReviewer({ skipTests = false } = {}) {
  const checks = [];
  checks.push(runCheck('syntax-check', `"${NODE}" scripts/ci/check-syntax.mjs`));
  checks.push(runCheck('config-validate', `"${NODE}" scripts/ci/validate-config.mjs`));
  if (!skipTests) {
    checks.push(runCheck('functional-tests', `"${NODE}" --test tests/*.test.mjs`));
  }
  checks.push(runCheck('observer-gate', `"${NODE}" scripts/ci/observer.mjs --diff`));
  const passed = verdict(checks);
  return { passed, checks, timestamp: new Date().toISOString() };
}

// Pure: render a human-readable report.
export function formatReport(result) {
  const lines = ['# Reviewer verdict (专员审核)', ''];
  for (const c of result.checks) {
    lines.push(`${c.passed ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!c.passed) lines.push(`   ${(c.output || '').replace(/\n/g, '\n   ')}`);
  }
  const failed = result.checks.filter((c) => !c.passed).length;
  lines.push('');
  lines.push(
    result.passed
      ? 'VERDICT: PASS — 审核通过，可以更新（git push）'
      : `VERDICT: FAIL — ${failed} 项未通过，禁止推送`,
  );
  return lines.join('\n');
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
if (isMain) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const skipTestsFlag = args.includes('--skip-tests');
  const result = runReviewer({ skipTests: skipTestsFlag });
  if (asJson) {
    process.stdout.write(JSON.stringify(result) + '\n');
  } else {
    process.stdout.write(formatReport(result) + '\n');
  }
  process.exit(result.passed ? 0 : 1);
}
