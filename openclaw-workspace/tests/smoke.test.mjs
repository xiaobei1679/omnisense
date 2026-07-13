// tests/smoke.test.mjs
// Functional smoke tests for openclaw-workspace.
// Run with:  node --test tests/smoke.test.mjs
//
// These tests exercise REAL exported logic (no duplicated reimplementation):
//   - scripts/ci/check-syntax.mjs : every tracked script passes `node --check`
//   - scripts/agent/respond.mjs   : safePath() guards against escapes / secrets
//                                     parseFiles() parses the LLM fenced-JSON contract

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkAll } from '../scripts/ci/check-syntax.mjs';
import { safePath, parseFiles } from '../scripts/agent/respond.mjs';

test('all tracked scripts pass node --check', () => {
  const { total, failed } = checkAll();
  assert.ok(total > 0, 'expected at least one tracked script');
  assert.deepEqual(failed, [], `these scripts failed node --check:\n${failed.map((f) => f.file).join('\n')}`);
});

test('safePath rejects absolute paths', () => {
  assert.throws(() => safePath('/etc/passwd'), /invalid path/);
  assert.throws(() => safePath('C:\\\\Windows\\system32'), /invalid path/);
});

test('safePath rejects parent-directory escapes', () => {
  assert.throws(() => safePath('../secrets.txt'), /invalid path|escapes repo/);
  assert.throws(() => safePath('a/../../b'), /invalid path|escapes repo/);
});

test('safePath rejects forbidden secret files', () => {
  assert.throws(() => safePath('config/openclaw.json'), /forbidden path/);
  assert.throws(() => safePath('.env'), /forbidden path/);
});

test('safePath allows in-repo relative paths', () => {
  const full = safePath('scripts/agent/task.example.md');
  assert.ok(full && full.replace(/\\/g, '/').endsWith('scripts/agent/task.example.md'));
});

test('parseFiles parses fenced JSON array (agent contract)', () => {
  const text = '```json\n[{"path":"README.md","content":"x"}]\n```';
  const files = parseFiles(text);
  assert.deepEqual(files, [{ path: 'README.md', content: 'x' }]);
});

test('parseFiles throws on a non-array payload', () => {
  assert.throws(() => parseFiles('```json\n{"path":"x"}\n```'), /expected JSON array/);
});

test('parseFiles surfaces an explicit LLM refusal', () => {
  assert.throws(() => parseFiles('```json\n{"error":"unsafe"}\n```'), /LLM refused/);
});
