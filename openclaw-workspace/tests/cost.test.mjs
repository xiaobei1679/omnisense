// tests/cost.test.mjs — tests for scripts/llm/cost.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  estimateTokens,
  resolvePrice,
  costFor,
  tally,
  accumulate,
  readLedger,
} from '../scripts/llm/cost.mjs';

test('estimateTokens counts CJK ~1 each and Latin ~1 per 4 chars', () => {
  assert.equal(estimateTokens(''), 0);
  assert.equal(estimateTokens(null), 0);
  // 5 CJK chars -> 5 tokens
  assert.equal(estimateTokens('你好世界啊'), 5);
  // 8 ASCII letters (2 words of 4) -> 2 tokens
  assert.equal(estimateTokens('abcdefgh'), 2);
  // mixed: 3 CJK + 4-letter word -> 3 + 1 = 4
  assert.equal(estimateTokens('你好a bcd'), 4);
});

test('estimateTokens is deterministic', () => {
  const text = 'The quick 棕色 fox  jumps 越 over 篱 the 犬 lazy dog 猫。';
  assert.equal(estimateTokens(text), estimateTokens(text));
});

test('resolvePrice is alias- and case-insensitive and falls back to wildcard', () => {
  assert.equal(resolvePrice('GPT-4O-MINI').prompt, 0.00015);
  assert.equal(resolvePrice('4o-mini').prompt, 0.00015);
  assert.equal(resolvePrice('deepseek').prompt, 0.00027);
  assert.equal(resolvePrice('unknown-model').prompt, 0);
});

test('costFor computes prompt+completion cost', () => {
  const r = costFor({ model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500 });
  // prompt: 1000/1000*0.00015 = 0.00015 ; completion: 500/1000*0.0006 = 0.0003
  assert.ok(Math.abs(r.promptCost - 0.00015) < 1e-9);
  assert.ok(Math.abs(r.completionCost - 0.0003) < 1e-9);
  assert.ok(Math.abs(r.total - 0.00045) < 1e-9);
  assert.equal(r.known, true);
});

test('tally aggregates across entries by model', () => {
  const { totalCost, byModel } = tally([
    { model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 0 },
    { model: 'gpt-4o-mini', promptTokens: 0, completionTokens: 1000 },
    { model: 'ollama', promptTokens: 99999, completionTokens: 99999 },
  ]);
  // gpt-4o-mini: 0.00015 + 0.0006 = 0.00075 ; ollama: 0
  assert.ok(Math.abs(totalCost - 0.00075) < 1e-9);
  assert.ok(Math.abs(byModel['gpt-4o-mini'] - 0.00075) < 1e-9);
  assert.equal(byModel['ollama'], 0);
});

test('accumulate + readLedger round-trips through a JSONL ledger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cost-ledger-'));
  try {
    const ledger = join(dir, 'usage.jsonl');
    accumulate({ model: 'gpt-4o-mini', promptTokens: 1000, completionTokens: 500, note: 'test' }, ledger);
    accumulate({ model: 'ollama', promptTokens: 10, completionTokens: 10 }, ledger);
    assert.equal(existsSync(ledger), true);
    const rows = readLedger(ledger);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].model, 'gpt-4o-mini');
    assert.ok(rows[0].cost > 0);
    assert.equal(rows[1].model, 'ollama');
    assert.equal(rows[1].cost, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('accumulate returns null when no ledgerPath (stays pure/offline)', () => {
  assert.equal(accumulate({ model: 'gpt-4o-mini', promptTokens: 1, completionTokens: 1 }), null);
});
