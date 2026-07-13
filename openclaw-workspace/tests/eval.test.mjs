// tests/eval.test.mjs
// Deterministic tests for the eval harness (scripts/eval/eval.mjs).
// These keep the "evaluation pillar" green in CI without any API key.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EVAL_CASES, runCases, similarity, compareBaseline } from '../scripts/eval/eval.mjs';

test('every deterministic eval case passes', () => {
  const { total, passed, failed } = runCases(EVAL_CASES);
  assert.equal(failed, 0, `${failed}/${total} cases failed`);
  assert.equal(passed, total);
});

test('router is deterministic', () => {
  const c = EVAL_CASES.find((x) => x.id === 'router-determinism');
  const r = c.evaluate();
  assert.equal(r.ok, true);
  assert.ok(r.value && typeof r.value === 'object');
});

test('router output obeys the agent-contract shape and only routes to known agents', () => {
  const c = EVAL_CASES.find((x) => x.id === 'router-contract-shape');
  assert.equal(c.evaluate().ok, true);
});

test('router decomposes a multi-step task into several clauses', () => {
  const c = EVAL_CASES.find((x) => x.id === 'router-decompose');
  assert.equal(c.evaluate().ok, true);
});

test('observer enforces protected-path guards', () => {
  const c = EVAL_CASES.find((x) => x.id === 'observer-protected-path');
  assert.equal(c.evaluate().ok, true);
});

test('observer detects a real secret but ignores placeholders', () => {
  const c = EVAL_CASES.find((x) => x.id === 'observer-secret-scan');
  assert.equal(c.evaluate().ok, true);
});

test('observer rejects an unsafe agent-contract path', () => {
  const c = EVAL_CASES.find((x) => x.id === 'observer-contract-safety');
  assert.equal(c.evaluate().ok, true);
});

test('scaffold normalizes names to safe kebab-case slugs', () => {
  const c = EVAL_CASES.find((x) => x.id === 'scaffold-kebab');
  assert.equal(c.evaluate().ok, true);
});

test('similarity returns 1 for identical text and 0 for disjoint text', () => {
  assert.equal(similarity('调研竞品 并撰写报告', '调研竞品 并撰写报告'), 1);
  assert.equal(similarity('调研竞品', 'deploy to staging'), 0);
});

test('compareBaseline reports no drift when baseline equals current', () => {
  const { results } = runCases(EVAL_CASES);
  const baseline = {};
  for (const r of results) baseline[r.id] = r.value;
  const cmp = compareBaseline(results, baseline);
  assert.equal(cmp.ok, true);
  assert.equal(cmp.drifts.length, 0);
});

test('compareBaseline flags drift when an output diverges', () => {
  const { results } = runCases(EVAL_CASES);
  const baseline = {};
  for (const r of results) baseline[r.id] = r.value;
  // Corrupt one baseline value to force a drift.
  baseline['router-determinism'] = { task: 'completely different task', intent: 'x' };
  const cmp = compareBaseline(results, baseline);
  assert.equal(cmp.ok, false);
  assert.ok(cmp.drifts.some((d) => d.id === 'router-determinism'));
});
