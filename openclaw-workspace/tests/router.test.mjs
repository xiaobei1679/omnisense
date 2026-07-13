// tests/router.test.mjs
// Covers the exported Router Agent logic in scripts/agent/router.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INTENTS, classifyIntent, scoreIntent, decompose, resolveAgent, route, DEFAULT_REGISTRY,
} from '../scripts/agent/router.mjs';

// --- Intent classification ------------------------------------------------
test('classifyIntent recognises research', () => {
  assert.equal(classifyIntent('research the market size and competitors'), 'research');
  assert.equal(classifyIntent('调研一下行业现状'), 'research');
});

test('classifyIntent recognises coding', () => {
  assert.equal(classifyIntent('implement a login function in node'), 'coding');
  assert.equal(classifyIntent('修复这个 bug 并重构脚本'), 'coding');
});

test('classifyIntent recognises writing', () => {
  assert.equal(classifyIntent('write a blog post about cats'), 'writing');
  assert.equal(classifyIntent('写一篇小说开篇章节'), 'writing');
});

test('classifyIntent recognises review', () => {
  assert.equal(classifyIntent('review the pull request for bugs'), 'review');
  assert.equal(classifyIntent('审查这份文档并润色'), 'review');
});

test('classifyIntent recognises data', () => {
  assert.equal(classifyIntent('analyze the sales data and make a chart'), 'data');
  assert.equal(classifyIntent('统计数据集并生成报表'), 'data');
});

test('classifyIntent falls back to general', () => {
  assert.equal(classifyIntent('hello there'), 'general');
  assert.equal(classifyIntent(''), 'general');
  assert.equal(classifyIntent('   '), 'general');
});

test('scoreIntent reports confidence bands', () => {
  assert.equal(scoreIntent('hello').confidence, 'low'); // no keyword
  assert.equal(scoreIntent('update the document').confidence, 'medium'); // one weak keyword
  assert.equal(scoreIntent('write a post').confidence, 'high'); // one strong keyword
  const s = scoreIntent('research the market and write a report');
  assert.ok(['high', 'medium'].includes(s.confidence));
  assert.ok(s.score >= 1);
});

// --- Decomposition ---------------------------------------------------------
test('decompose splits on sentence terminators and connectors', () => {
  assert.deepEqual(decompose('先调研市场。然后写文章'), ['先调研市场', '写文章']);
  assert.deepEqual(decompose('research the topic. then write the article'),
    ['research the topic', 'write the article']);
  assert.equal(decompose('').length, 0);
});

// --- Resolve agent --------------------------------------------------------
test('resolveAgent picks the specialist and falls back to generalist', () => {
  assert.equal(resolveAgent('research', DEFAULT_REGISTRY), 'researcher');
  assert.equal(resolveAgent('coding', DEFAULT_REGISTRY), 'engineer');
  const custom = [{ id: 'writer', role: 'w', intents: ['writing'] }];
  assert.equal(resolveAgent('coding', custom), 'general'); // no coding agent
});

// --- Routing ---------------------------------------------------------------
test('route returns a well-formed plan', () => {
  const plan = route('调研竞品并写一份报告');
  assert.equal(typeof plan.task, 'string');
  assert.ok(INTENTS.includes(plan.intent));
  assert.equal(typeof plan.primaryAgent, 'string');
  assert.ok(Array.isArray(plan.subtasks));
  assert.ok(['high', 'medium', 'low'].includes(plan.confidence));
  assert.equal(typeof plan.fallback, 'boolean');
  assert.equal(typeof plan.truncated, 'boolean');
  assert.ok(Array.isArray(plan.agentsUsed));
});

test('route decomposes a multi-step task and assigns agents', () => {
  const plan = route('调研市场规模。然后撰写分析报告');
  assert.ok(plan.subtasks.length >= 2, JSON.stringify(plan.subtasks));
  assert.equal(plan.subtasks[0].agent, 'researcher');
  assert.equal(plan.subtasks[1].agent, 'writer');
  assert.equal(plan.primaryAgent, 'researcher'); // research appears first
});

test('route throws on an empty task', () => {
  assert.throws(() => route(''), /empty task/);
  assert.throws(() => route('   '), /empty task/);
});

test('route honours a custom registry (fallback to general)', () => {
  const custom = [{ id: 'writer', role: 'w', intents: ['writing'] }];
  const plan = route('fix the broken login function', { registry: custom });
  assert.equal(plan.primaryAgent, 'general'); // no coding agent → generalist
  assert.equal(plan.fallback, true);
});

test('route truncates very long task lists at maxSubtasks', () => {
  const long = 'step one. step two. step three. step four. step five.';
  const plan = route(long, { maxSubtasks: 3 });
  assert.equal(plan.truncated, true);
  assert.ok(plan.subtasks.length <= 3);
  // The final merged subtask carries the remaining steps.
  assert.ok(plan.subtasks[plan.subtasks.length - 1].prompt.includes('合并剩余'));
});

test('route is deterministic for the same input', () => {
  const a = route('调研市场并写报告并做数据图表');
  const b = route('调研市场并写报告并做数据图表');
  assert.deepEqual(a, b);
});
