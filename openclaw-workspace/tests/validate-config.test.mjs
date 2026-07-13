// tests/validate-config.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateConfig } from '../scripts/ci/validate-config.mjs';

function makeRoot(files) {
  const root = mkdtempSync(join(tmpdir(), 'cfg-test-'));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    mkdirSync(dirnameSafe(p), { recursive: true });
    writeFileSync(p, content);
  }
  return root;
}
// tiny safe dirname that tolerates already-created parents
import { dirname } from 'node:path';
function dirnameSafe(p) { return dirname(p); }

test('passes for a well-formed template', () => {
  const root = makeRoot({
    '.env.example': 'USER_DATA_DIR=\nPROJECT_DIR=\nHOT_DIR=\nKNOWLEDGE_DIR=\n',
    'config/openclaw.json.example': JSON.stringify({
      agents: { list: [{ id: 'main', name: '主控' }, { id: 'reviewer', name: '审核' }] },
    }),
  });
  try {
    const { ok, problems } = validateConfig(root);
    assert.equal(ok, true, 'expected ok=true, got: ' + JSON.stringify(problems));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when .env.example misses a required var', () => {
  const root = makeRoot({
    '.env.example': 'USER_DATA_DIR=\nPROJECT_DIR=\n',
    'config/openclaw.json.example': JSON.stringify({ agents: { list: [{ id: 'main', name: '主控' }] } }),
  });
  try {
    const { ok, problems } = validateConfig(root);
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.includes('HOT_DIR')), 'should report missing HOT_DIR');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when config JSON is invalid', () => {
  const root = makeRoot({
    '.env.example': 'USER_DATA_DIR=\nPROJECT_DIR=\nHOT_DIR=\nKNOWLEDGE_DIR=\n',
    'config/openclaw.json.example': '{ not valid json',
  });
  try {
    const { ok, problems } = validateConfig(root);
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.toLowerCase().includes('json')), 'should report JSON error');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('fails when agents.list is empty or missing main', () => {
  const root = makeRoot({
    '.env.example': 'USER_DATA_DIR=\nPROJECT_DIR=\nHOT_DIR=\nKNOWLEDGE_DIR=\n',
    'config/openclaw.json.example': JSON.stringify({ agents: { list: [{ id: 'x', name: 'X' }] } }),
  });
  try {
    const { ok, problems } = validateConfig(root);
    assert.equal(ok, false);
    assert.ok(problems.some((p) => p.includes('main')), 'should require a main agent');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
