// tests/observer.test.mjs
// Covers the exported Observer Agent logic in scripts/ci/observer.mjs.
// Uses a throwaway temp root so nothing in the real repo is touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { isProtectedPath, isPathSafe, detectSecrets, runReview } from '../scripts/ci/observer.mjs';

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'observer-test-'));
}

// --- Rule 1: protected paths -------------------------------------------------
test('isProtectedPath flags secret/private files', () => {
  assert.equal(isProtectedPath('.env'), true);
  assert.equal(isProtectedPath('config/openclaw.json'), true);
  assert.equal(isProtectedPath('workspace/USER.md'), true);
  assert.equal(isProtectedPath('novel/secret.md'), true);
  assert.equal(isProtectedPath('gbrain/vec.bin'), true);
  assert.equal(isProtectedPath('sessions/run.json'), true);
});

test('isProtectedPath allows framework files and templates', () => {
  assert.equal(isProtectedPath('config/openclaw.json.example'), false);
  assert.equal(isProtectedPath('.env.example'), false);
  assert.equal(isProtectedPath('examples/sample-skill/SKILL.md'), false);
  assert.equal(isProtectedPath('workspace/.learnings/scripts/lib/common.js'), false);
});

// --- Rule 4: path safety -----------------------------------------------------
test('isPathSafe rejects traversal / absolute / null-byte', () => {
  assert.equal(isPathSafe('../etc/passwd'), false);
  assert.equal(isPathSafe('/abs/path'), false);
  assert.equal(isPathSafe('C:/Users/x'), false);
  assert.equal(isPathSafe('a/../../b'), false);
  assert.equal(isPathSafe('ok/relative/path'), true);
});

// --- Rule 2: secrets ---------------------------------------------------------
test('detectSecrets flags a real credential prefix', () => {
  const hits = detectSecrets('token=ghp_1234567890abcdefghijklmnopqrstuvwxyz', { file: 'a.js' });
  assert.ok(hits.length >= 1);
  assert.equal(hits[0].rule, 'secret-prefix');
});

test('detectSecrets ignores .example templates', () => {
  const hits = detectSecrets('token=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', { file: 'config/openclaw.json.example' });
  assert.equal(hits.length, 0);
});

test('detectSecrets ignores obvious placeholder lines', () => {
  const hits = detectSecrets('const TOKEN = "your-token-here";', { file: 'a.js' });
  assert.equal(hits.length, 0);
});

// --- Orchestrator: runReview -------------------------------------------------
test('runReview fails on a protected path', () => {
  const root = tmpRoot();
  try {
    const { passed, violations } = runReview({ files: ['.env'], root });
    assert.equal(passed, false);
    assert.ok(violations.some((v) => v.rule === 'protected-path'), JSON.stringify(violations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runReview fails on a syntax error', () => {
  const root = tmpRoot();
  try {
    mkdirSync(join(root, 'examples'), { recursive: true });
    writeFileSync(join(root, 'examples', 'bad.mjs'), 'const = ;\n'); // syntax error
    const { passed, violations } = runReview({ files: ['examples/bad.mjs'], root });
    assert.equal(passed, false);
    assert.ok(violations.some((v) => v.rule === 'syntax'), JSON.stringify(violations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runReview fails on an unsafe agent-contract path', () => {
  const root = tmpRoot();
  try {
    const contract = JSON.stringify([{ path: '../../etc/passwd', content: 'x' }]);
    const { passed, violations } = runReview({ files: [], contractJson: contract, root });
    assert.equal(passed, false);
    assert.ok(violations.some((v) => v.rule === 'contract-path'), JSON.stringify(violations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runReview fails when a contract targets a forbidden file', () => {
  const root = tmpRoot();
  try {
    const contract = JSON.stringify([{ path: '.env', content: 'SECRET=1' }]);
    const { passed, violations } = runReview({ files: [], contractJson: contract, root });
    assert.equal(passed, false);
    assert.ok(violations.some((v) => v.rule === 'contract-path'), JSON.stringify(violations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runReview passes a clean change set', () => {
  const root = tmpRoot();
  try {
    mkdirSync(join(root, 'examples'), { recursive: true });
    writeFileSync(join(root, 'examples', 'good.mjs'), 'export const x = 1;\n');
    mkdirSync(join(root, 'docs'), { recursive: true });
    writeFileSync(join(root, 'docs', 'ok.md'), '# ok\n');
    const contract = JSON.stringify([{ path: 'examples/good.mjs', content: 'export const x = 2;\n' }]);
    const { passed, violations } = runReview({ files: ['examples/good.mjs', 'docs/ok.md'], contractJson: contract, root });
    assert.equal(passed, true, JSON.stringify(violations));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
