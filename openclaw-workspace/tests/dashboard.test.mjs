// tests/dashboard.test.mjs
// Verify the framework-level workspace dashboard generator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseRoadmap,
  countTestFiles,
  countScripts,
  countDocs,
  countPresets,
  countConfigAgents,
  qualityGates,
  collectRepoState,
  renderHtml,
} from '../scripts/dashboard.mjs';

// 子包根目录（基于本文件位置，与启动 cwd 无关）：dashboard 的计数函数期望 root=openclaw-workspace。
const ROOT = fileURLToPath(new URL('..', import.meta.url));

test('parseRoadmap counts bullets per section (emoji headings ignored)', () => {
  const md = [
    '# Roadmap',
    '',
    '## Done ✅',
    '- item A',
    '- item B',
    '- item C',
    '',
    '## In progress 🚧',
    '- wip 1',
    '',
    '## Next 🔜 (high value, low risk)',
    '- next 1',
    '- next 2',
    '',
    '## Later 💡',
    '- later 1',
    '',
    '## How to contribute',
    '- not counted',
  ].join('\n');
  const r = parseRoadmap(md);
  assert.equal(r.done, 3);
  assert.equal(r.inProgress, 1);
  assert.equal(r.next, 2);
  assert.equal(r.later, 1);
  assert.equal(r.total, 7);
});

test('parseRoadmap handles missing sections gracefully', () => {
  const r = parseRoadmap('## Done ✅\n- only one\n');
  assert.equal(r.done, 1);
  assert.equal(r.inProgress, 0);
  assert.equal(r.next, 0);
  assert.equal(r.later, 0);
  assert.equal(r.total, 1);
});

test('parseRoadmap tolerates empty / null input', () => {
  assert.deepEqual(parseRoadmap(''), { done: 0, inProgress: 0, next: 0, later: 0, total: 0 });
  assert.deepEqual(parseRoadmap(null), { done: 0, inProgress: 0, next: 0, later: 0, total: 0 });
});

test('countTestFiles finds real test files', () => {
  const n = countTestFiles(ROOT);
  assert.ok(n >= 8, `expected >=8 test files, got ${n}`);
});

test('countScripts finds .js/.mjs under scripts/', () => {
  const n = countScripts(ROOT);
  assert.ok(n >= 10, `expected >=10 scripts, got ${n}`);
});

test('countDocs finds docs markdown', () => {
  const n = countDocs(ROOT);
  assert.ok(n >= 4, `expected >=4 docs, got ${n}`);
});

test('countPresets finds bundled agent role presets', () => {
  const n = countPresets(ROOT);
  assert.ok(n >= 6, `expected >=6 presets, got ${n}`);
});

test('countConfigAgents reads config example list', () => {
  const n = countConfigAgents(ROOT);
  assert.ok(n >= 6, `expected >=6 configured agents, got ${n}`);
});

test('qualityGates reports the five framework gates', () => {
  const gates = qualityGates(ROOT);
  assert.equal(gates.length, 5);
  const names = gates.map((g) => g.name);
  for (const want of ['check-syntax', 'validate-config', 'observer', 'reviewer', 'eval']) {
    assert.ok(names.includes(want), `missing gate ${want}`);
  }
  assert.ok(gates.every((g) => g.present), 'all gates should be present');
});

test('collectRepoState aggregates framework-level metrics (no personal data)', () => {
  const s = collectRepoState(ROOT);
  assert.equal(typeof s.repo, 'string');
  assert.ok(s.repo.length > 0);
  assert.equal(s.agents.presets, countPresets(ROOT));
  assert.equal(s.tests, countTestFiles(ROOT));
  assert.equal(s.docs, countDocs(ROOT));
  assert.equal(s.roadmap.total, s.roadmap.done + s.roadmap.inProgress + s.roadmap.next + s.roadmap.later);
  // JSON serializable
  assert.doesNotThrow(() => JSON.stringify(s));
});

test('renderHtml is deterministic and self-contained', () => {
  const s = collectRepoState(ROOT);
  const a = renderHtml(s);
  const b = renderHtml(s);
  assert.equal(a, b, 'rendering must be deterministic');
  assert.match(a, /<!doctype html>/i);
  assert.match(a, /openclaw-workspace/);
  // no external CDN / network dependency
  assert.doesNotMatch(a, /https?:\/\/(cdn|unpkg|jsdelivr|fonts\.googleapis)/i);
  // contains the live counts
  assert.match(a, new RegExp(String(s.tests)));
});

test('renderHtml escapes repo name to avoid HTML injection', () => {
  const s = { generated: new Date().toISOString(), repo: '<img src=x onerror=alert(1)>',
    agents: { presets: 1, configured: 2 }, tests: 3, scripts: 4, docs: 5,
    roadmap: { done: 1, inProgress: 0, next: 0, later: 0, total: 1 },
    gates: [{ name: 'x', path: 'p', present: true }] };
  const html = renderHtml(s);
  assert.doesNotMatch(html, /<img src=x/);
  assert.match(html, /&lt;img/);
});
