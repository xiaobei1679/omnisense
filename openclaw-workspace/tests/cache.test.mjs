// tests/cache.test.mjs — tests for scripts/llm/cache.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRequest, cacheKey, lookup, store, withCache, stats } from '../scripts/llm/cache.mjs';

// In-memory fs shim so the cache is fully offline-testable (no real disk).
function memfs() {
  const files = new Map();
  return {
    existsSync: (p) => files.has(p),
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error('ENOENT');
      return files.get(p);
    },
    writeFileSync: (p, c) => {
      files.set(p, String(c));
    },
    mkdirSync: () => {},
    _files: files,
  };
}

const LEDGER = '/mem/llm-cache.json';

test('canonicalRequest normalizes to {role,content} and lowercases provider/model', () => {
  const req = canonicalRequest([{ role: 'User', content: '  hi  ' }], { provider: 'OpenAI', model: 'GPT-4O' });
  assert.deepEqual(req, {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: undefined,
    maxTokens: undefined,
    topP: undefined,
    messages: [{ role: 'user', content: 'hi' }],
  });
});

test('cacheKey is deterministic and identical for equivalent requests', () => {
  const a = [{ role: 'user', content: 'hello' }];
  const b = [{ role: 'user', content: 'hello' }];
  assert.equal(cacheKey(a, { model: 'gpt-4o' }), cacheKey(b, { model: 'gpt-4o' }));
});

test('cacheKey differs by model, temperature, and message content', () => {
  const m = [{ role: 'user', content: 'x' }];
  const k1 = cacheKey(m, { model: 'gpt-4o' });
  const k2 = cacheKey(m, { model: 'gpt-4o-mini' });
  const k3 = cacheKey(m, { model: 'gpt-4o', temperature: 0.2 });
  const k4 = cacheKey(m, { model: 'gpt-4o', temperature: 0.8 });
  const k5 = cacheKey([{ role: 'user', content: 'y' }], { model: 'gpt-4o' });
  const all = new Set([k1, k2, k3, k4, k5]);
  assert.equal(all.size, 5);
});

test('lookup miss then store then lookup hit round-trips the value', () => {
  const m = [{ role: 'user', content: 'ping' }];
  const opts = { ledgerPath: LEDGER, fs: memfs(), model: 'gpt-4o' };
  assert.equal(lookup(m, opts).hit, false);
  store(m, { completion: 'pong' }, opts);
  const hit = lookup(m, opts);
  assert.equal(hit.hit, true);
  assert.deepEqual(hit.value, { completion: 'pong' });
  assert.equal(hit.meta.hits, 0);
});

test('withCache invokes callLLM once, then serves hit from cache', async () => {
  const m = [{ role: 'user', content: 'repeat' }];
  const opts = { ledgerPath: LEDGER, fs: memfs(), model: 'gpt-4o' };
  let calls = 0;
  const callLLM = async () => {
    calls += 1;
    return { completion: 'cached-or-not' };
  };
  const cached = withCache(callLLM, opts);
  const r1 = await cached(m, {});
  assert.equal(r1.cached, false);
  assert.equal(calls, 1);
  const r2 = await cached(m, {});
  assert.equal(r2.cached, true);
  assert.equal(calls, 1); // second call did NOT hit the LLM
  assert.deepEqual(r2.response, { completion: 'cached-or-not' });
});

test('stats reports entry count and accumulated hits', async () => {
  const fs = memfs();
  const opts = { ledgerPath: LEDGER, fs, model: 'gpt-4o' };
  store([{ role: 'user', content: 'a' }], '1', opts);
  store([{ role: 'user', content: 'b' }], '2', opts);
  const cached = withCache(async () => 'x', opts);
  await cached([{ role: 'user', content: 'a' }], {}); // hit -> bump
  await cached([{ role: 'user', content: 'a' }], {}); // hit -> bump
  await cached([{ role: 'user', content: 'b' }], {}); // hit -> bump
  const s = stats(LEDGER, fs);
  assert.equal(s.entries, 2);
  assert.equal(s.totalHits, 3);
});

test('ttlMs: a fresh entry hits, an aged entry is a miss (expired)', () => {
  const m = [{ role: 'user', content: 'ttl' }];
  const fs = memfs();
  const base = { ledgerPath: LEDGER, fs, model: 'gpt-4o' };
  store(m, 'v', base); // stored with real ISO ts (~now)
  // ttl disabled -> always hits regardless of age
  assert.equal(lookup(m, { ...base }).hit, true);
  // now far in the future, short ttl -> expired -> miss
  const future = Date.now() + 10 * 60 * 1000; // +10 min
  const expired = lookup(m, { ...base, ttlMs: 1000, now: () => future });
  assert.equal(expired.hit, false);
  assert.equal(expired.meta && expired.meta.expired, true);
  // same age but generous ttl -> still a hit
  assert.equal(lookup(m, { ...base, ttlMs: 60 * 60 * 1000, now: () => future }).hit, true);
});

test('maxEntries: exceeding the cap evicts the oldest entry', () => {
  const fs = memfs();
  const opts = { ledgerPath: LEDGER, fs, model: 'gpt-4o', maxEntries: 2 };
  // Inject a strictly increasing clock so eviction order is deterministic.
  let t = 1_000_000_000_000;
  const tick = () => (t += 60_000); // +1 min each store
  store([{ role: 'user', content: 'k1' }], '1', { ...opts, now: tick });
  store([{ role: 'user', content: 'k2' }], '2', { ...opts, now: tick });
  store([{ role: 'user', content: 'k3' }], '3', { ...opts, now: tick }); // over cap -> evict oldest
  const s = stats(LEDGER, fs);
  assert.equal(s.entries, 2, 'ledger must be capped at maxEntries');
  // k3 (newest) must survive; k1 (oldest) must be gone.
  assert.equal(lookup([{ role: 'user', content: 'k3' }], opts).hit, true);
  assert.equal(lookup([{ role: 'user', content: 'k1' }], opts).hit, false);
});
