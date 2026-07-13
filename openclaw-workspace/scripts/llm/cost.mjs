// scripts/llm/cost.mjs
//
// Zero-dependency token estimation + cost tracking for LLM calls.
//
// Design basis (external research, 2026-07):
// - Token/cost control is a universal concern across 2026 agent frameworks
//   (see "Agent Token 优化完全指南", daoyuly.cn, 2026-04). A framework that
//   runs LLMs should give operators a way to *see* cost without pulling in a
//   tokenizer dependency (tiktoken/bpe) that would break the zero-dep rule.
// - This module provides a deterministic, offline token ESTIMATE (clearly
//   labelled as an estimate, not exact), a configurable provider price table,
//   and an optional JSONL ledger so repeated runs can be tallied locally.
//
// Honesty note: the price table below is an ILLUSTRATIVE snapshot of public
// list prices as of 2026-07. Prices change; override by passing your own
// `prices` map to `costFor` / `resolvePrice`. Numbers are USD per 1K tokens.

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Approximate public list prices (USD per 1,000 tokens). Keys are lowercased
// model id aliases. `*` matches any unknown model at zero cost (so cost is
// explicit-null rather than silently guessed).
export const DEFAULT_PRICES = {
  'gpt-4o-mini': { prompt: 0.00015, completion: 0.0006 },
  'gpt-4o': { prompt: 0.0025, completion: 0.01 },
  'gpt-4-turbo': { prompt: 0.01, completion: 0.03 },
  'deepseek-chat': { prompt: 0.00027, completion: 0.0011 },
  'deepseek-reasoner': { prompt: 0.00055, completion: 0.00219 },
  'qwen-plus': { prompt: 0.0008, completion: 0.0008 },
  'qwen-max': { prompt: 0.002, completion: 0.006 },
  'moonshot-v1-8k': { prompt: 0.0012, completion: 0.0012 },
  'moonshot-v1-32k': { prompt: 0.0024, completion: 0.0024 },
  'ollama': { prompt: 0, completion: 0 }, // local, no API cost
  '*': { prompt: 0, completion: 0 },
};

// Alias mapping for common shorthand.
const ALIASES = {
  'gpt-4o-mini': 'gpt-4o-mini',
  '4o-mini': 'gpt-4o-mini',
  'gpt-4o': 'gpt-4o',
  '4o': 'gpt-4o',
  'deepseek': 'deepseek-chat',
  'deepseek-chat': 'deepseek-chat',
  'deepseek-reasoner': 'deepseek-reasoner',
  'qwen-plus': 'qwen-plus',
  'qwen-max': 'qwen-max',
  'kimi': 'moonshot-v1-8k',
  'moonshot': 'moonshot-v1-8k',
  'moonshot-v1-8k': 'moonshot-v1-8k',
};

// Resolve a model id (case-insensitive, alias-aware) to a price entry.
// Returns null when no entry and no wildcard (should not happen with '*' default).
export function resolvePrice(model, prices = DEFAULT_PRICES) {
  if (!model) return prices['*'] || null;
  const key = String(model).trim().toLowerCase();
  const table = prices || DEFAULT_PRICES;
  if (table[key]) return table[key];
  const aliased = ALIASES[key];
  if (aliased && table[aliased]) return table[aliased];
  return table['*'] || null;
}

// Deterministic, dependency-free token ESTIMATE.
// Heuristic (clearly an estimate, not exact BPE):
//   - Each CJK codepoint ~= 1 token.
//   - Each run of non-CJK "word" characters ~= ceil(len / 4) tokens
//     (mirrors how GPT-class tokenizers compress English ~4 chars/token).
// Returns an integer >= 0.
export function estimateTokens(text) {
  if (!text || typeof text !== 'string') return 0;
  const cjkRe = /[一-鿿㐀-䶿]/g;
  const cjk = (text.match(cjkRe) || []).length;
  const nonCjk = text.replace(cjkRe, ' ');
  const words = nonCjk.split(/\s+/).filter(Boolean);
  let latin = 0;
  for (const w of words) {
    latin += Math.max(1, Math.ceil(w.length / 4));
  }
  return cjk + latin;
}

// Compute cost for a call. Returns:
//   { model, priceKey, promptTokens, completionTokens,
//     promptCost, completionCost, total, known } or null if price unknown.
// `known` is false when the model is unknown AND no wildcard is present
// (effectively always true here because '*' is in the default table; kept for
// callers who pass a custom table without a wildcard).
export function costFor({ model, promptTokens = 0, completionTokens = 0, prices } = {}) {
  const price = resolvePrice(model, prices);
  if (!price) return null;
  const p = Number(promptTokens) || 0;
  const c = Number(completionTokens) || 0;
  const promptCost = (p / 1000) * price.prompt;
  const completionCost = (c / 1000) * price.completion;
  return {
    model: String(model || ''),
    priceKey: model ? (String(model).trim().toLowerCase()) : '*',
    promptTokens: p,
    completionTokens: c,
    promptCost,
    completionCost,
    total: promptCost + completionCost,
    known: true,
  };
}

// Tally a set of { model, promptTokens, completionTokens } entries into a
// single cost summary. Returns { totalCost, byModel: { model: total } }.
export function tally(entries, prices) {
  const byModel = {};
  let totalCost = 0;
  for (const e of Array.isArray(entries) ? entries : []) {
    const r = costFor({ model: e.model, promptTokens: e.promptTokens, completionTokens: e.completionTokens, prices });
    if (!r) continue;
    totalCost += r.total;
    byModel[r.model] = (byModel[r.model] || 0) + r.total;
  }
  return { totalCost, byModel };
}

// Append one usage record to a JSONL ledger (only if ledgerPath is provided).
// Each line is a flat JSON object. Returns the written object, or null when
// no ledgerPath (so callers can stay pure / offline in tests).
export function accumulate(entry, ledgerPath) {
  if (!ledgerPath) return null;
  const rec = {
    ts: entry.ts || new Date().toISOString(),
    model: entry.model || '',
    promptTokens: Number(entry.promptTokens) || 0,
    completionTokens: Number(entry.completionTokens) || 0,
    cost: entry.cost != null ? entry.cost : (costFor({ model: entry.model, promptTokens: entry.promptTokens, completionTokens: entry.completionTokens }) || {}).total || 0,
    note: entry.note || '',
  };
  try {
    appendFileSync(ledgerPath, JSON.stringify(rec) + '\n', 'utf8');
  } catch {
    return null;
  }
  return rec;
}

// Read a JSONL ledger back into an array of records (empty if missing).
export function readLedger(ledgerPath) {
  if (!ledgerPath || !existsSync(ledgerPath)) return [];
  let raw = '';
  try {
    raw = readFileSync(ledgerPath, 'utf8');
  } catch {
    return [];
  }
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t));
    } catch {
      // skip malformed lines
    }
  }
  return out;
}

// ---- CLI ----

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
function printHelp() {
  console.log('LLM token/cost tracker (estimates; no tokenizer dependency).');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/llm/cost.mjs --estimate "some text"');
  console.log('  node scripts/llm/cost.mjs --cost --model gpt-4o-mini --prompt 1000 --completion 500');
  console.log('  node scripts/llm/cost.mjs --models');
}

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--estimate')) {
    const idx = args.indexOf('--estimate');
    const text = args[idx + 1] || '';
    console.log(JSON.stringify({ chars: text.length, estimatedTokens: estimateTokens(text) }));
  } else if (args.includes('--cost')) {
    const get = (k) => {
      const i = args.indexOf(k);
      return i !== -1 ? args[i + 1] : undefined;
    };
    const model = get('--model') || 'gpt-4o-mini';
    const prompt = Number(get('--prompt') || 0);
    const completion = Number(get('--completion') || 0);
    const r = costFor({ model, promptTokens: prompt, completionTokens: completion });
    console.log(JSON.stringify(r, null, 2));
  } else if (args.includes('--models')) {
    console.log('Known price entries (illustrative, USD per 1K tokens):');
    for (const [k, v] of Object.entries(DEFAULT_PRICES)) {
      console.log(`  ${k.padEnd(20)} prompt=$${v.prompt}  completion=$${v.completion}`);
    }
  } else {
    printHelp();
  }
}
