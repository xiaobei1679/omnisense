// tests/permissions.test.mjs
// Zero-dependency tests for scripts/security/permissions.mjs (per-tool ladder).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LADDER,
  LEVELS,
  normalizeTool,
  classifyTool,
  isAllowed,
  resolvePolicy,
  listRules,
} from '../scripts/security/permissions.mjs';

// A tiny custom ladder for specificity / tie / default behaviour.
const CUSTOM = {
  default: 'allow',
  rules: [
    { tool: 'git:push', level: 'deny', category: 'esc', reason: 'no push' },
    { tool: 'git:push:tags', level: 'allow', category: 'rel', reason: 'tags ok' },
    { tool: 'fs', level: 'ask', category: 'io', reason: 'fs ask' },
    { tool: 'fs:read', level: 'allow', category: 'io', reason: 'read ok' },
    { tool: 'dupe:a', level: 'allow', category: 'x', reason: 'permissive' },
    { tool: 'dupe:a', level: 'deny', category: 'x', reason: 'restrictive' },
  ],
};

test('normalizeTool lowercases, trims and turns spaces into separators', () => {
  assert.equal(normalizeTool('  Git Push  Force '), 'git:push:force');
  assert.equal(normalizeTool('FS::READ'), 'fs:read');
  assert.equal(normalizeTool(''), '');
  assert.equal(normalizeTool(null), '');
});

test('LEVELS are ordered most-restrictive first', () => {
  assert.deepEqual(LEVELS, ['deny', 'ask', 'allow']);
});

test('cardinal repo rules are hard denies', () => {
  assert.equal(classifyTool('git:push', DEFAULT_LADDER), 'deny');
  assert.equal(classifyTool('git:push:force', DEFAULT_LADDER), 'deny');
  assert.equal(classifyTool('repo:commit:main', DEFAULT_LADDER), 'deny');
  assert.equal(classifyTool('secret:read', DEFAULT_LADDER), 'deny');
});

test('prefix match: git:push also denies git:push:force', () => {
  // Default ladder: only a 'git:push' rule exists; it must cover sub-tools by prefix.
  assert.equal(classifyTool('git:push:force', DEFAULT_LADDER), 'deny');
  assert.equal(classifyTool('git:push:origin:main', DEFAULT_LADDER), 'deny');
});

test('ask level for escalation / network / exec tools', () => {
  for (const t of ['git:remote', 'git:fetch', 'git:pull', 'network:egress', 'shell:exec', 'fs:write']) {
    assert.equal(classifyTool(t, DEFAULT_LADDER), 'ask', `expected ask for ${t}`);
  }
});

test('allow level for safe local flows', () => {
  assert.equal(classifyTool('repo:commit:local', DEFAULT_LADDER), 'allow');
  assert.equal(classifyTool('fs:read', DEFAULT_LADDER), 'allow');
});

test('specificity wins: longer allow overrides shorter deny', () => {
  // 'git:push' is deny, but 'git:push:tags' (more specific) is allow.
  assert.equal(classifyTool('git:push:tags', CUSTOM), 'allow');
});

test('tie on specificity broken by severity (deny beats allow)', () => {
  // Two equal-length 'dupe:a' rules: deny must win over allow.
  assert.equal(classifyTool('dupe:a', CUSTOM), 'deny');
});

test('unknown tool falls back to ladder.default', () => {
  assert.equal(classifyTool('totally:unknown:tool', CUSTOM), 'allow');
  assert.equal(classifyTool('never:seen', DEFAULT_LADDER), 'ask');
});

test('empty / non-string tool falls back to default', () => {
  assert.equal(classifyTool('', CUSTOM), 'allow');
  assert.equal(classifyTool(undefined, DEFAULT_LADDER), 'ask');
});

test('isAllowed is true only for allow', () => {
  assert.equal(isAllowed('repo:commit:local', DEFAULT_LADDER), true);
  assert.equal(isAllowed('git:push', DEFAULT_LADDER), false);
  assert.equal(isAllowed('fs:write', DEFAULT_LADDER), false);
});

test('resolvePolicy returns structured metadata including matched rule', () => {
  const p = resolvePolicy('git:push', DEFAULT_LADDER);
  assert.equal(p.tool, 'git:push');
  assert.equal(p.level, 'deny');
  assert.equal(p.category, 'escalation');
  assert.equal(p.matched, 'git:push');
  assert.equal(p.defaulted, false);
  assert.match(p.reason, /never push/i);
});

test('resolvePolicy returns the most-specific matched rule (prefix)', () => {
  const p = resolvePolicy('git:push:force', DEFAULT_LADDER);
  assert.equal(p.level, 'deny');
  assert.equal(p.matched, 'git:push:force');
  assert.match(p.reason, /force-push/i);
});

test('resolvePolicy flags defaulted when no rule matches', () => {
  const p = resolvePolicy('weird:tool', DEFAULT_LADDER);
  assert.equal(p.level, 'ask');
  assert.equal(p.matched, null);
  assert.equal(p.category, null);
  assert.equal(p.defaulted, true);
});

test('listRules returns a copy of all default rules', () => {
  const rules = listRules(DEFAULT_LADDER);
  assert.ok(rules.length >= 10);
  // mutation of the returned copy must not affect the module default
  rules.push({ tool: 'x', level: 'allow' });
  assert.notEqual(listRules(DEFAULT_LADDER).length, rules.length);
});

test('deterministic: same input yields same level', () => {
  const a = classifyTool('git:pull', DEFAULT_LADDER);
  const b = classifyTool('GIT:PULL', DEFAULT_LADDER);
  assert.equal(a, b);
  assert.equal(a, 'ask');
});
