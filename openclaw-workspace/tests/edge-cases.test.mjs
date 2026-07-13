// tests/edge-cases.test.mjs
// Extended edge-case tests for openclaw-workspace core logic.
// Run with:  node --test tests/edge-cases.test.mjs
//
// Covers:
//   - safePath: empty input, dot-only, deep nesting, Unicode, Windows edge cases
//   - parseFiles: empty array, multi-file, non-standard fence formats, whitespace

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safePath, parseFiles } from '../scripts/agent/respond.mjs';

// ── safePath edge cases ──────────────────────────────────────────────

test('safePath rejects empty string', () => {
  assert.throws(() => safePath(''), /invalid path/);
});

test('safePath rejects null / undefined', () => {
  assert.throws(() => safePath(null), /invalid path/);
  assert.throws(() => safePath(undefined), /invalid path/);
});

test('safePath rejects dot-only path (would resolve to repo root)', () => {
  assert.throws(() => safePath('.'), /path escapes repo|invalid path/);
});

test('safePath rejects deeply nested parent escape', () => {
  assert.throws(
    () => safePath('a/b/c/../../../../../etc/passwd'),
    /invalid path|escapes repo/
  );
});

test('safePath rejects path with null bytes', () => {
  assert.throws(() => safePath('foo\x00bar'), /invalid path/);
});

test('safePath accepts normal nested paths', () => {
  const r1 = safePath('workspace/.learnings/scripts/lib/common.js');
  const r2 = safePath('docs/AGENT_CONTRACT.md');
  assert.ok(r1 && r1.replace(/\\/g, '/').endsWith('workspace/.learnings/scripts/lib/common.js'));
  assert.ok(r2 && r2.replace(/\\/g, '/').endsWith('docs/AGENT_CONTRACT.md'));
});

test('safePath accepts paths with hyphens and dots (non-escape)', () => {
  const r = safePath('QUICKSTART.md');
  assert.ok(r && r.replace(/\\/g, '/').endsWith('QUICKSTART.md'));
});

test('safePath normalises Windows backslashes in rejection', () => {
  // Backslash-only absolute path should be caught as absolute
  assert.throws(() => safePath('\\Windows\\system32'), /invalid path/);
});

// ── parseFiles edge cases ────────────────────────────────────────────

test('parseFiles parses empty JSON array', () => {
  const files = parseFiles('```json\n[]\n```');
  assert.deepEqual(files, []);
});

test('parseFiles parses multi-file payload', () => {
  const text =
    '```json\n' +
    '[{"path":"a.js","content":"console.log(1)"},{"path":"b.md","content":"# hi"}]' +
    '\n```';
  const files = parseFiles(text);
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'a.js');
  assert.equal(files[0].content, 'console.log(1)');
  assert.equal(files[1].path, 'b.md');
  assert.equal(files[1].content, '# hi');
});

test('parseFiles handles fence without json lang hint', () => {
  const text = '```\n[{"path":"x","content":"y"}]\n```';
  const files = parseFiles(text);
  assert.deepEqual(files, [{ path: 'x', content: 'y' }]);
});

test('parseFiles handles raw JSON without fences', () => {
  // When there's no fence at all, parseFiles falls back to parsing the whole text
  const files = parseFiles('[{"path":"raw","content":"data"}]');
  assert.deepEqual(files, [{ path: 'raw', content: 'data' }]);
});

test('parseFiles throws on completely empty content', () => {
  assert.throws(() => parseFiles(''), /empty or blank|unexpected|JSON/i);
});

test('parseFiles throws on garbage text outside and inside fences', () => {
  assert.throws(() => parseFiles('not json at all'), /unexpected|JSON/i);
});
