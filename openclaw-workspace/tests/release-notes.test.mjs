// tests/release-notes.test.mjs
// Functional tests for the zero-dep release-notes generator.
// Run with:  node --test tests/release-notes.test.mjs
//
// These exercise REAL exported logic from scripts/release/notes.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findPublicSection,
  parseEntries,
  cleanTitle,
  extractEntries,
  formatReleaseNotes,
  buildRelease,
} from '../scripts/release/notes.mjs';

const SAMPLE = `# 更新日志

## openclaw-workspace 公开框架（仓库级更新）

### 2026-07-09（Adapter 适配层 · 特性级 · 本地，未推送）
- 完成 Adapter 层
- 新增 scripts/llm/adapter.mjs

### 2026-07-08（自主迭代 · 本地）
- 新增 check-syntax
- 新增 smoke 测试

## 2026-07-08

### 项目转向
- 内部项目内容（不应进入发布说明）
`;

test('findPublicSection returns the public section only', () => {
  const sec = findPublicSection(SAMPLE);
  assert.ok(sec, 'expected a public section');
  assert.ok(sec.includes('Adapter 适配层'), 'should include public entry');
  assert.ok(!sec.includes('项目转向'), 'should NOT include internal project section');
});

test('findPublicSection returns null when header is absent', () => {
  assert.equal(findPublicSection('# nothing here\n## other\n### 2026-07-09（x）'), null);
});

test('parseEntries extracts date/title/body in order', () => {
  const entries = parseEntries(findPublicSection(SAMPLE));
  assert.equal(entries.length, 2);
  assert.equal(entries[0].date, '2026-07-09');
  assert.equal(entries[1].date, '2026-07-08');
  assert.ok(entries[0].body.includes('scripts/llm/adapter.mjs'), 'body preserved');
});

test('cleanTitle strips the internal local-only marker', () => {
  assert.equal(cleanTitle('（Adapter 适配层 · 特性级 · 本地，未推送）'), 'Adapter 适配层 · 特性级');
  assert.equal(cleanTitle('（自主迭代 · 本地）'), '自主迭代');
  assert.equal(cleanTitle('plain title'), 'plain title');
});

test('extractEntries count limits to the top N', () => {
  const top1 = extractEntries(SAMPLE, { count: 1 });
  assert.equal(top1.length, 1);
  assert.equal(top1[0].date, '2026-07-09');
});

test('extractEntries since filters by date (ISO string compare)', () => {
  assert.equal(extractEntries(SAMPLE, { since: '2026-07-09' }).length, 1);
  assert.equal(extractEntries(SAMPLE, { since: '2026-07-08' }).length, 2);
  assert.equal(extractEntries(SAMPLE, { since: '2026-07-10' }).length, 0);
});

test('formatReleaseNotes is deterministic', () => {
  const entries = parseEntries(findPublicSection(SAMPLE));
  const a = formatReleaseNotes(entries, { version: 'v1.0.0' });
  const b = formatReleaseNotes(entries, { version: 'v1.0.0' });
  assert.equal(a, b);
  assert.ok(a.startsWith('# Release v1.0.0'));
});

test('buildRelease produces notes with version header', () => {
  const r = buildRelease(SAMPLE, { version: 'v1.2.3' });
  assert.equal(r.version, 'v1.2.3');
  assert.equal(r.date, '2026-07-09');
  assert.equal(r.entries.length, 2);
  assert.ok(r.notes.includes('Adapter 适配层'));
});

test('missing public section yields a graceful empty release', () => {
  const r = buildRelease('## 其它\n- 内部\n', { version: 'v0.0.0' });
  assert.equal(r.entries.length, 0);
  assert.ok(r.notes.includes('No framework changelog entries'));
});
