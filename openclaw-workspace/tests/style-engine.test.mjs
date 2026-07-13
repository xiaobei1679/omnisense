// tests/style-engine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, RULES } from '../workspace/.learnings/scripts/style-engine.mjs';

test('RULES is a non-empty table of {id, severity, message, suggestion}', () => {
  assert.ok(Array.isArray(RULES) && RULES.length >= 1);
  for (const r of RULES) {
    assert.equal(typeof r.id, 'string');
    assert.ok(['error', 'warn'].includes(r.severity));
    assert.equal(typeof r.message, 'string');
    assert.equal(typeof r.suggestion, 'string');
  }
});

test('analyze flags greeting-filler and fails (error severity)', () => {
  const r = analyze('很高兴为你介绍这个零依赖文风自检模块，它能帮智能体自查输出。');
  const ids = r.issues.map((i) => i.rule);
  assert.ok(ids.includes('greeting-filler'));
  assert.equal(r.passed, false);
  assert.equal(r.counts.error, 1);
  assert.ok(r.score < 100);
});

test('analyze flags ai-buzzwords (warn severity)', () => {
  const r = analyze('值得注意的是，简而言之，这个方案不言而喻地优秀，毋庸置疑。');
  const ids = r.issues.map((i) => i.rule);
  assert.ok(ids.includes('ai-buzzword'));
});

test('analyze flags hollow-boast buzzwords', () => {
  const r = analyze('我们用底层逻辑赋能业务，打造一站式闭环，形成组合拳。');
  const ids = r.issues.map((i) => i.rule);
  assert.ok(ids.includes('hollow-boast'));
});

test('analyze flags over-long sentences', () => {
  const longOne =
    '本模块的设计目标是为框架内的所有智能体提供一个完全离线、零依赖、确定性的文风自检能力，使得任何输出在落库之前都能先经过一轮可复用的质量规则扫描与评分。';
  const r = analyze(longOne);
  const ids = r.issues.map((i) => i.rule);
  assert.ok(ids.includes('long-sentence'));
});

test('analyze passes clean, direct prose (no issues)', () => {
  const r = analyze('直接说结论：本模块零依赖，可离线运行，供智能体自查文风。');
  assert.equal(r.issues.length, 0);
  assert.equal(r.passed, true);
  assert.equal(r.score, 100);
});

test('analyze is deterministic (same input -> same report)', () => {
  const a = analyze('值得注意的是，这个方案毋庸置疑地优秀。');
  const b = analyze('值得注意的是，这个方案毋庸置疑地优秀。');
  assert.deepEqual(a, b);
});

test('analyze tolerates empty / non-string input', () => {
  assert.equal(analyze('').issues.length, 0);
  assert.equal(analyze(null).passed, true);
  assert.equal(analyze(undefined).score, 100);
});
