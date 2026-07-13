// tests/scaffold.test.mjs
// Covers the exported scaffold() / kebab() logic in scripts/scaffold.mjs.
// Uses a throwaway temp root so the repo's examples/ is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scaffold, kebab } from '../scripts/scaffold.mjs';

function tmpRoot() {
  return mkdtempSync(join(tmpdir(), 'scaffold-test-'));
}

test('kebab normalizes mixed-case and spaces', () => {
  assert.equal(kebab('My Skill'), 'my-skill');
  assert.equal(kebab('  QA Bot  '), 'qa-bot');
  assert.equal(kebab('Hello_World-99!'), 'hello-world-99');
  assert.equal(kebab('---a---'), 'a');
});

test('kebab returns empty string for purely non-alphanumeric input', () => {
  assert.equal(kebab('!!!'), '');
  assert.equal(kebab('   '), '');
});

test('scaffold throws when name yields an empty slug', () => {
  const root = tmpRoot();
  try {
    assert.throws(() => scaffold('skill', '!!!', { root }), /empty slug/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scaffold skill creates SKILL.md + run.mjs', () => {
  const root = tmpRoot();
  try {
    const out = scaffold('skill', 'My Skill', { root });
    assert.equal(out, join(root, 'examples', 'my-skill', 'SKILL.md'));
    assert.ok(existsSync(out), 'SKILL.md exists');
    assert.ok(existsSync(join(root, 'examples', 'my-skill', 'run.mjs')), 'run.mjs exists');
    const md = readFileSync(out, 'utf8');
    assert.match(md, /# My Skill/, 'title uses display name');
    assert.match(md, /node --check/, 'cross-platform note present');
    const run = readFileSync(join(root, 'examples', 'my-skill', 'run.mjs'), 'utf8');
    assert.match(run, /export async function run/, 'run.mjs exports run()');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scaffold agent creates agent-<slug>.md', () => {
  const root = tmpRoot();
  try {
    const out = scaffold('agent', 'QA Bot', { root });
    assert.equal(out, join(root, 'examples', 'agent-qa-bot.md'));
    assert.ok(existsSync(out), 'agent file exists');
    const md = readFileSync(out, 'utf8');
    assert.match(md, /# Agent: QA Bot/, 'agent title present');
    assert.match(md, /AGENT_CONTRACT/, 'points to contract doc');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scaffold rejects unknown type', () => {
  const root = tmpRoot();
  try {
    assert.throws(() => scaffold('widget', 'X', { root }), /unknown type/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scaffold rejects empty name', () => {
  const root = tmpRoot();
  try {
    assert.throws(() => scaffold('skill', '   ', { root }), /name is required/);
    assert.throws(() => scaffold('skill', '', { root }), /name is required/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scaffold rejects a root-escape attempt', () => {
  // A crafted slug cannot escape the root because we build paths from a
  // controlled prefix; verify the safety guard by abusing an absolute-ish name.
  const root = tmpRoot();
  try {
    // '..' segments are stripped by kebab(), so the safest assertion is that
    // the produced file is always inside root.
    const out = scaffold('agent', '.. back .. door', { root });
    assert.ok(out.startsWith(root), 'output stays inside root: ' + out);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
