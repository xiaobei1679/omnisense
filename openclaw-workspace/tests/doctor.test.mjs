// tests/doctor.test.mjs
// Offline unit tests for the pre-flight environment check (`scripts/doctor.mjs`).
// No real git / node / shell is touched — every I/O boundary is injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkNode,
  checkGit,
  checkShell,
  checkEnvFiles,
  checkConfigFiles,
  checkLLMBackend,
  checkGates,
  runDoctor,
} from '../scripts/doctor.mjs';

test('checkNode: ok when >= required major', () => {
  const r = checkNode({ nodeVersion: '20.11.0' });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'info');
  assert.match(r.message, /Node v20/);
});

test('checkNode: error when below required major', () => {
  const r = checkNode({ nodeVersion: '16.14.0' });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
});

test('checkGit: ok when version command returns', () => {
  const r = checkGit({ execGit: () => 'git version 2.45.0' });
  assert.equal(r.ok, true);
  assert.match(r.message, /git version 2\.45/);
});

test('checkGit: error when command missing', () => {
  const r = checkGit({ execGit: () => { throw new Error('not found'); } });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
});

test('checkShell: ok when bash available', () => {
  const r = checkShell({ probe: (cmd) => cmd.startsWith('bash') });
  assert.equal(r.ok, true);
  assert.match(r.message, /bash/);
});

test('checkShell: ok when pwsh available', () => {
  const r = checkShell({ probe: (cmd) => cmd.startsWith('pwsh') });
  assert.equal(r.ok, true);
  assert.match(r.message, /pwsh/);
});

test('checkShell: error when neither available', () => {
  const r = checkShell({ probe: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
});

test('checkEnvFiles: info when .env present', () => {
  const r = checkEnvFiles({ exists: (p) => p === '.env' });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'info');
});

test('checkEnvFiles: warn when only .env.example present', () => {
  const r = checkEnvFiles({ exists: (p) => p === '.env.example' });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'warn');
});

test('checkEnvFiles: error when both missing', () => {
  const r = checkEnvFiles({ exists: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
});

test('checkConfigFiles: warn when only example present', () => {
  const r = checkConfigFiles({ exists: (p) => p === 'config/openclaw.json.example' });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'warn');
});

test('checkConfigFiles: error when both missing', () => {
  const r = checkConfigFiles({ exists: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
});

test('checkLLMBackend: info for local Ollama provider', () => {
  const r = checkLLMBackend({ env: { LLM_PROVIDER: 'ollama' } });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'info');
});

test('checkLLMBackend: info for remote baseUrl', () => {
  const r = checkLLMBackend({ env: { LLM_BASE_URL: 'https://api.openai.com/v1' } });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'info');
});

test('checkLLMBackend: warn when nothing set', () => {
  const r = checkLLMBackend({ env: {} });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'warn');
});

test('checkGates: info when all present', () => {
  const r = checkGates({
    exists: (p) => p.startsWith('scripts/ci/') || p.startsWith('scripts/eval/'),
  });
  assert.equal(r.ok, true);
  assert.equal(r.severity, 'info');
});

test('checkGates: error when a gate missing', () => {
  const r = checkGates({ exists: () => false });
  assert.equal(r.ok, false);
  assert.equal(r.severity, 'error');
  assert.match(r.message, /missing gate scripts/);
});

test('runDoctor: ok (no error-severity failures)', () => {
  const opts = {
    nodeVersion: '20.0.0',
    execGit: () => 'git version 2.45.0',
    probe: (cmd) => cmd.startsWith('bash'),
    exists: (p) => p !== 'scripts/ci/reviewer.mjs' ? true : true, // all present
    env: { LLM_PROVIDER: 'ollama' },
  };
  const { results, ok } = runDoctor(opts);
  assert.equal(results.length, 7);
  assert.equal(ok, true);
});

test('runDoctor: not ok (error-severity failure blocks)', () => {
  const opts = {
    nodeVersion: '16.0.0', // below minimum -> error
    execGit: () => 'git version 2.45.0',
    probe: (cmd) => cmd.startsWith('bash'),
    exists: () => true,
    env: { LLM_PROVIDER: 'ollama' },
  };
  const { ok } = runDoctor(opts);
  assert.equal(ok, false);
});

test('runDoctor: warn does not block', () => {
  const opts = {
    nodeVersion: '20.0.0',
    execGit: () => 'git version 2.45.0',
    probe: (cmd) => cmd.startsWith('bash'),
    exists: (p) => p === '.env.example' || p.startsWith('config/openclaw.json') || p.startsWith('scripts/'),
    env: {}, // no LLM backend -> warn only
  };
  const { ok, results } = runDoctor(opts);
  assert.equal(ok, true);
  assert.ok(results.some((r) => r.severity === 'warn'));
});

test('runDoctor: deterministic / serializable', () => {
  const opts = {
    nodeVersion: '20.0.0',
    execGit: () => 'git version 2.45.0',
    probe: (cmd) => cmd.startsWith('bash'),
    exists: () => true,
    env: { LLM_PROVIDER: 'ollama' },
  };
  const a = JSON.stringify(runDoctor(opts));
  const b = JSON.stringify(runDoctor(opts));
  assert.equal(a, b);
});
