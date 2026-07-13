// tests/reviewer.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runReviewer, verdict, formatReport, runCheck } from '../scripts/ci/reviewer.mjs';

test('verdict() is true only when all checks pass', () => {
  assert.equal(verdict([{ passed: true }, { passed: true }]), true);
  assert.equal(verdict([{ passed: true }, { passed: false }]), false);
  assert.equal(verdict([]), true);
});

test('formatReport marks PASS/FAIL clearly', () => {
  const pass = formatReport({ passed: true, checks: [{ name: 'x', passed: true }] });
  assert.match(pass, /VERDICT: PASS/);
  const fail = formatReport({ passed: false, checks: [{ name: 'x', passed: false }] });
  assert.match(fail, /VERDICT: FAIL/);
});

test('runCheck captures pass/fail of a shell command', () => {
  const ok = runCheck('echo-ok', 'node -e "process.exit(0)"');
  assert.equal(ok.passed, true);
  const bad = runCheck('false-cmd', 'node -e "process.exit(1)"');
  assert.equal(bad.passed, false);
  assert.equal(bad.output.length >= 0, true);
});

test('runReviewer returns a structured verdict and passes on a clean green repo', () => {
  // skipTests avoids re-shelling the full suite from inside `node --test`
  // (which would recurse). The three deterministic gates below must be green
  // on the current working tree.
  const result = runReviewer({ skipTests: true });
  assert.equal(typeof result.passed, 'boolean');
  assert.ok(Array.isArray(result.checks));
  assert.ok(result.checks.length >= 3);
  const names = result.checks.map((c) => c.name);
  for (const n of ['syntax-check', 'config-validate', 'observer-gate']) {
    assert.ok(names.includes(n), `missing check: ${n}`);
  }
  assert.equal(result.passed, true, 'reviewer should pass on a clean green repo');
});
