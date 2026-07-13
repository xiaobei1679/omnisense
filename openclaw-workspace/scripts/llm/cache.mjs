// scripts/llm/cache.mjs
//
// Zero-dependency LLM response cache (prompt caching).
//
// Design basis (external GitHub / web research, 2026-07-09 round 2):
// - Prompt caching is a first-class cost/latency optimization across 2026
//   agent frameworks: messkan/prompt-cache ("Cut LLM costs by up to 80%") and
//   karthyick/prompt-cache (decorator-based semantic cache), plus design
//   write-ups yuanchaofa.com "Agent 系统中的 Prompt Caching 设计" and
//   xirain.github.io "LLM Agent Prompt Cache 深入浅出". The shared core idea:
//   an identical (provider, model, sampling, messages) request yields an
//   identical completion, so cache the response keyed by a deterministic hash
//   of the request.
// - This module is dependency-free (no Redis, no tiktoken). It stores a JSON
//   map { key -> { value, ts, hits } } in a caller-supplied ledger file and is
//   offline-testable by injecting an in-memory fs shim.
// - Complements scripts/llm/cost.mjs (cost tracking) and the existing retry
//   hardening in respond.mjs: cache removes redundant spend; retry/breaker
//   remove transient failure.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_LEDGER = '.cache/llm-cache.json';

// Deterministic canonical serialization of a request.
// Only fields that affect the completion are hashed: provider, model, the
// sampling params (temperature / maxTokens / topP), and the messages. Messages
// are reduced to { role, content } with content trimmed. Stable key order keeps
// the JSON string stable across Node versions (undefined keys are dropped).
export function canonicalRequest(messages, opts = {}) {
  const normMsgs = Array.isArray(messages)
    ? messages.map((m) => ({
        role: String((m && m.role) || '').toLowerCase(),
        content: String(m && m.content != null ? m.content : '').trim(),
      }))
    : [];
  return {
    provider: String(opts.provider || '').toLowerCase(),
    model: String(opts.model || '').toLowerCase(),
    temperature: opts.temperature != null ? Number(opts.temperature) : undefined,
    maxTokens: opts.maxTokens != null ? Number(opts.maxTokens) : undefined,
    topP: opts.topP != null ? Number(opts.topP) : undefined,
    messages: normMsgs,
  };
}

// Hash a request into a stable cache key (hex sha256).
export function cacheKey(messages, opts = {}) {
  const json = JSON.stringify(canonicalRequest(messages, opts));
  return createHash('sha256').update(json, 'utf8').digest('hex');
}

// Build a tiny store around an injectable fs. Defaults to node:fs.
function makeStore(ledgerPath, fsImpl) {
  const injected = !!fsImpl;
  const fs = fsImpl || { readFileSync, writeFileSync, existsSync, mkdirSync };
  function readAll() {
    if (!ledgerPath || !fs.existsSync(ledgerPath)) return {};
    try {
      const txt = fs.readFileSync(ledgerPath, 'utf8');
      const parsed = JSON.parse(txt);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  function writeAll(map) {
    if (!ledgerPath) return false;
    try {
      const dir = dirname(ledgerPath);
      if (dir && dir !== '.') fs.mkdirSync(dir, { recursive: true });
      const json = JSON.stringify(map);
      // Atomic write on the real fs (temp file + rename) so an overlapping run
      // (e.g. the hourly auto-iter racing a manual run) or a crash mid-write
      // can't corrupt the ledger or expose a torn read. Injected fs shims
      // (tests) have no renameSync, so fall back to a direct write there.
      if (!injected) {
        const tmp = `${ledgerPath}.tmp`;
        fs.writeFileSync(tmp, json, 'utf8');
        renameSync(tmp, ledgerPath);
      } else {
        fs.writeFileSync(ledgerPath, json, 'utf8');
      }
      return true;
    } catch {
      return false;
    }
  }
  return { readAll, writeAll };
}

// Look up a cached response. Returns { hit, key, value, meta }.
//   opts.ttlMs  (optional): entries older than this are treated as a MISS. This
//     bounds staleness so an undesired/failed generation can be regenerated on a
//     later retry instead of being frozen forever. Library default = no expiry
//     (0/undefined) to stay backward-compatible; the production caller
//     (respond.mjs) sets a concrete TTL.
//   opts.now    (optional): injectable clock (default Date.now) for tests.
export function lookup(messages, opts = {}) {
  const key = cacheKey(messages, opts);
  const ledgerPath = opts.ledgerPath || DEFAULT_LEDGER;
  const { readAll } = makeStore(ledgerPath, opts.fs);
  const map = readAll();
  const entry = map[key];
  if (!entry) return { hit: false, key, value: undefined, meta: null };
  const ttlMs = opts.ttlMs != null ? Number(opts.ttlMs) : 0;
  if (ttlMs > 0) {
    const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now();
    const tsMs = Date.parse(entry.ts || '');
    if (Number.isFinite(tsMs) && nowMs - tsMs > ttlMs) {
      return { hit: false, key, value: undefined, meta: { expired: true, ts: entry.ts } };
    }
  }
  return { hit: true, key, value: entry.value, meta: { ts: entry.ts, hits: entry.hits } };
}

// Store a response under the request key. Returns the key.
//   opts.maxEntries (optional): cap the ledger size; when exceeded, evict the
//     oldest entries (by ts). Bounds unbounded growth (each entry can hold a
//     full LLM response). Library default = unlimited (0/undefined); the
//     production caller (respond.mjs) sets a concrete cap.
export function store(messages, value, opts = {}) {
  const key = cacheKey(messages, opts);
  const ledgerPath = opts.ledgerPath || DEFAULT_LEDGER;
  const { readAll, writeAll } = makeStore(ledgerPath, opts.fs);
  const map = readAll();
  // opts.now (optional): injectable clock (ms) for deterministic tests; the
  // stored ts is ISO-8601 so eviction/TTL comparisons stay human-readable.
  const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now();
  map[key] = { value, ts: new Date(nowMs).toISOString(), hits: 0 };
  const maxEntries = opts.maxEntries != null ? Number(opts.maxEntries) : 0;
  if (maxEntries > 0) {
    const keys = Object.keys(map);
    if (keys.length > maxEntries) {
      keys
        .map((k) => [k, Date.parse(map[k].ts || '') || 0])
        .sort((a, b) => a[1] - b[1]) // oldest first
        .slice(0, keys.length - maxEntries)
        .forEach(([k]) => {
          delete map[k];
        });
    }
  }
  writeAll(map);
  return key;
}

// High-level helper: wrap a callLLM function with caching.
//   callLLM: async (messages, opts) => response
// Returns async (messages, opts) => { response, cached, key }
// On a cache hit the wrapped function is NOT invoked and `cached: true`.
// The cache key merges cacheOpts (defaults like model/provider/sampling and
// the ledger/fs wiring) with the per-call opts, so a request is cached under
// exactly the parameters that produced its completion.
export function withCache(callLLM, cacheOpts = {}) {
  const ledgerPath = cacheOpts.ledgerPath || DEFAULT_LEDGER;
  const fsImpl = cacheOpts.fs;
  return async function cachedCall(messages, opts = {}) {
    const eff = { ...cacheOpts, ...opts, ledgerPath, fs: fsImpl };
    const hit = lookup(messages, eff);
    if (hit.hit) {
      // best-effort hit counter bump
      try {
        const { readAll, writeAll } = makeStore(ledgerPath, fsImpl);
        const map = readAll();
        if (map[hit.key]) {
          map[hit.key].hits = (map[hit.key].hits || 0) + 1;
          writeAll(map);
        }
      } catch {
        /* non-fatal */
      }
      return { response: hit.value, cached: true, key: hit.key };
    }
    const response = await callLLM(messages, opts);
    store(messages, response, eff);
    return { response, cached: false, key: hit.key };
  };
}

// Stats for a ledger: { entries, totalHits }.
export function stats(ledgerPath = DEFAULT_LEDGER, fsImpl) {
  const { readAll } = makeStore(ledgerPath, fsImpl);
  const map = readAll();
  const keys = Object.keys(map);
  let totalHits = 0;
  for (const k of keys) totalHits += map[k].hits || 0;
  return { entries: keys.length, totalHits };
}

// ---- CLI ----
const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
function printHelp() {
  console.log('LLM response cache (prompt caching; zero dependency).');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/llm/cache.mjs --messages \'[{"role":"user","content":"hi"}]\' [--model gpt-4o-mini] [--provider openai] [--temperature 0.2]');
  console.log('  node scripts/llm/cache.mjs --stats [<ledgerPath>]');
}

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--stats')) {
    const i = args.indexOf('--stats');
    const ledger = args[i + 1] || DEFAULT_LEDGER;
    console.log(JSON.stringify(stats(ledger)));
  } else if (args.includes('--messages')) {
    const i = args.indexOf('--messages');
    let messages;
    try {
      messages = JSON.parse(args[i + 1] || '[]');
    } catch {
      console.error('invalid JSON for --messages');
      process.exit(2);
    }
    const modelIdx = args.indexOf('--model');
    const providerIdx = args.indexOf('--provider');
    const tempIdx = args.indexOf('--temperature');
    const maxIdx = args.indexOf('--maxTokens');
    const topIdx = args.indexOf('--topP');
    const opts = {
      model: modelIdx !== -1 ? args[modelIdx + 1] : undefined,
      provider: providerIdx !== -1 ? args[providerIdx + 1] : undefined,
      temperature: tempIdx !== -1 ? Number(args[tempIdx + 1]) : undefined,
      maxTokens: maxIdx !== -1 ? Number(args[maxIdx + 1]) : undefined,
      topP: topIdx !== -1 ? Number(args[topIdx + 1]) : undefined,
    };
    console.log(cacheKey(messages, opts));
  } else {
    printHelp();
  }
}
