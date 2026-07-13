// tests/roles.test.mjs
// Verify the agent role preset loader and the bundled presets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseMeta,
  validateRole,
  loadRole,
  loadRoles,
  getRole
} from '../scripts/agent/roles.mjs';

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REAL_DIR = resolve(process.cwd(), 'examples', 'agents');

test('parseMeta extracts key/value lines', () => {
  const meta = parseMeta('id: reviewer\nname: 审核专员\nskills: a, b , c\n');
  assert.equal(meta.id, 'reviewer');
  assert.equal(meta.name, '审核专员');
  assert.equal(meta.skills, 'a, b , c');
});

test('validateRole rejects missing fields', () => {
  assert.equal(validateRole({}).ok, false);
  assert.equal(validateRole({ id: 'x' }).ok, false);
  assert.equal(validateRole({ id: 'x', name: 'n' }).ok, false);
  assert.equal(validateRole({ id: 'x', name: 'n', description: 'd' }).ok, false);
  const ok = validateRole({ id: 'x', name: 'n', description: 'd', body: 'b' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.errors, []);
});

test('validateRole rejects bad id format', () => {
  const r = validateRole({ id: 'Bad ID', name: 'n', description: 'd', body: 'b' });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /id format/);
});

test('loadRole parses meta block and body', () => {
  const dir = resolve(process.cwd(), '.tmp-roles-test');
  mkdirSync(dir, { recursive: true });
  try {
    const file = resolve(dir, 'reviewer.md');
    writeFileSync(
      file,
      '# Agent Role: Reviewer\n\n<!-- role-meta\nid: reviewer\nname: 审核专员\ndescription: 守住契约与质量门\nskills: observer, router\n-->\n\n## System prompt\nYou are the Reviewer.\n'
    );
    const role = loadRole(file);
    assert.equal(role.id, 'reviewer');
    assert.equal(role.name, '审核专员');
    assert.equal(role.description, '守住契约与质量门');
    assert.deepEqual(role.skills, ['observer', 'router']);
    assert.match(role.body, /You are the Reviewer/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRole handles a missing meta block as invalid', () => {
  const dir = resolve(process.cwd(), '.tmp-roles-test2');
  mkdirSync(dir, { recursive: true });
  try {
    const file = resolve(dir, 'bad.md');
    writeFileSync(file, '# No meta\n\njust text');
    const role = loadRole(file);
    assert.equal(validateRole(role).ok, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadRoles over real presets: all valid and unique ids', () => {
  const { roles, errors, duplicateIds } = loadRoles(REAL_DIR);
  assert.ok(roles.length >= 7, `expected >=7 presets, got ${roles.length}`);
  assert.deepEqual(errors, [], `preset errors: ${errors.join(' | ')}`);
  assert.deepEqual(duplicateIds, [], `duplicate ids: ${duplicateIds.join(',')}`);
  for (const r of roles) {
    assert.ok(ID_RE.test(r.id), `bad id format: ${r.id}`);
    assert.ok(r.body.trim().length > 0, `empty body for ${r.id}`);
  }
});

test('getRole returns the correct preset or null', () => {
  const role = getRole(REAL_DIR, 'reviewer');
  assert.ok(role, 'reviewer preset should exist');
  assert.equal(role.id, 'reviewer');
  assert.equal(getRole(REAL_DIR, 'does-not-exist'), null);
});
