// tests/adapter-client.test.mjs
// Integration-style tests for the adapter's network layer (createClient).
//
// These are Tier-1 "stub fakes" (per Tian Pan, "Dependency Injection for AI:
// Mocking Model Calls Without Losing Test Fidelity", 2026-04-16): they do NOT
// hit a real LLM, but the fake fetch ASSERTS the real request contract — the
// exact endpoint URL, the auth header presence, and the request body shape —
// so a green test still predicts production behavior instead of lying about it.
//
// No network calls. The fetch implementation is injected via opts.fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, chatCompletionsUrl } from '../scripts/llm/adapter.mjs';

// Build a fake `fetch` that records the request and returns a controllable
// Response-like object (ok / status / headers.get / json / text).
function makeFakeFetch(opts = {}) {
  const {
    calls = [],
    content = 'hello from fake',
    ok = true,
    status = 200,
    contentLength = 0,
    failFirst = 0,
    latency = 0,
  } = opts;
  let attempts = 0;
  const fakeFetch = async function (url, init) {
    calls.push({ url, init });
    if (failFirst > 0 && attempts < failFirst) {
      attempts += 1;
      const err = new Error('simulated transient network error');
      err.cause = { code: 'ECONNRESET' };
      throw err;
    }
    attempts += 1;
    if (latency) await new Promise((r) => setTimeout(r, latency));
    const body = { choices: [{ message: { content } }] };
    return {
      ok,
      status,
      headers: {
        get: (k) =>
          String(k).toLowerCase() === 'content-length'
            ? String(contentLength)
            : null,
      },
      async json() {
        return body;
      },
      async text() {
        return JSON.stringify(body);
      },
    };
  };
  fakeFetch.calls = calls;
  return fakeFetch;
}

test('createClient: injected fetch is used instead of global fetch', async () => {
  const calls = [];
  const fake = makeFakeFetch({ calls });
  const client = createClient({ provider: 'openai', apiKey: 'sk-test-123' }, { fetch: fake });
  assert.equal(client.fetchImpl, fake, 'injected fetch should be exposed on the client');
  const out = await client.chat('sys', 'usr');
  assert.equal(out, 'hello from fake');
  assert.equal(calls.length, 1, 'fake fetch should have been called exactly once');
});

test('createClient: hits the exact chat/completions endpoint (contract)', async () => {
  const calls = [];
  const fake = makeFakeFetch({ calls });
  const client = createClient({ provider: 'deepseek', apiKey: 'sk-test-123' }, { fetch: fake });
  await client.chat('s', 'u');
  assert.equal(calls[0].url, 'https://api.deepseek.com/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  // Endpoint helper agrees with what was actually called.
  assert.equal(calls[0].url, chatCompletionsUrl('https://api.deepseek.com/v1'));
});

test('createClient: Bearer auth header added only when a key is present', async () => {
  // With key → Authorization present.
  const withKey = makeFakeFetch({ calls: [] });
  const c1 = createClient({ provider: 'openai', apiKey: 'sk-test-123' }, { fetch: withKey });
  await c1.chat('s', 'u');
  assert.equal(withKey.calls[0].init.headers.Authorization, 'Bearer sk-test-123');

  // Local Ollama (no key) → no Authorization header at all.
  const noKey = makeFakeFetch({ calls: [] });
  const c2 = createClient({ provider: 'ollama' }, { fetch: noKey });
  await c2.chat('s', 'u');
  assert.equal(noKey.calls[0].init.headers.Authorization, undefined);
  assert.equal(noKey.calls[0].init.headers['Content-Type'], 'application/json');
});

test('createClient: request body carries model, temperature, and normalized messages', async () => {
  const calls = [];
  const fake = makeFakeFetch({ calls });
  const client = createClient(
    { provider: 'qwen', model: 'qwen-max', apiKey: 'sk-test-123' },
    { fetch: fake, temperature: 0.1 }
  );
  await client.chat('SYSTEM PROMPT', 'USER INPUT');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, 'qwen-max');
  assert.equal(body.temperature, 0.1);
  assert.deepEqual(body.messages, [
    { role: 'system', content: 'SYSTEM PROMPT' },
    { role: 'user', content: 'USER INPUT' },
  ]);
});

test('createClient: default temperature is 0.2', async () => {
  const calls = [];
  const fake = makeFakeFetch({ calls });
  const client = createClient({ provider: 'openai', apiKey: 'sk-test-123' }, { fetch: fake });
  await client.chat('s', 'u');
  assert.equal(JSON.parse(calls[0].init.body).temperature, 0.2);
});

test('createClient: parses assistant content from a real-shaped response', async () => {
  const fake = makeFakeFetch({ content: '```json\n[{"path":"x"}]\n```' });
  const client = createClient({ provider: 'ollama' }, { fetch: fake });
  const out = await client.chat('s', 'u');
  assert.equal(out, '```json\n[{"path":"x"}]\n```');
});

test('createClient: non-ok HTTP status throws with status in message', async () => {
  const fake = makeFakeFetch({ ok: false, status: 401, content: 'invalid key' });
  const client = createClient({ provider: 'openai', apiKey: 'sk-test-123' }, { fetch: fake });
  await assert.rejects(
    () => client.chat('s', 'u'),
    /LLM HTTP 401/
  );
});

test('createClient: response larger than maxBytes is rejected', async () => {
  // content-length header lies huge; body parse would still succeed, but the
  // size guard must trip first.
  const fake = makeFakeFetch({ contentLength: 3 * 1024 * 1024 });
  const client = createClient(
    { provider: 'openai', apiKey: 'sk-test-123' },
    { fetch: fake, maxBytes: 2 * 1024 * 1024 }
  );
  await assert.rejects(
    () => client.chat('s', 'u'),
    /too large/
  );
});

test('createClient: retries transient errors then succeeds (plumbing)', async () => {
  const calls = [];
  const fake = makeFakeFetch({ calls, failFirst: 1 });
  const client = createClient(
    { provider: 'openai', apiKey: 'sk-test-123' },
    { fetch: fake, retries: 1, timeoutMs: 1000 }
  );
  const out = await client.chat('s', 'u');
  assert.equal(out, 'hello from fake');
  assert.equal(calls.length, 2, 'should have retried once then succeeded');
  assert.equal(calls[0].url, calls[1].url, 'retry hits the same endpoint');
});

test('createClient: exhausted retries re-throws the last error', async () => {
  const calls = [];
  // failFirst beyond available retries (retries=1 → at most 2 attempts).
  const fake = makeFakeFetch({ calls, failFirst: 5 });
  const client = createClient(
    { provider: 'openai', apiKey: 'sk-test-123' },
    { fetch: fake, retries: 1, timeoutMs: 1000 }
  );
  await assert.rejects(() => client.chat('s', 'u'), /transient/);
  assert.equal(calls.length, 2, 'should have stopped after retries exhausted');
});

test('createClient: returns a bound, callable client for every known provider', async () => {
  for (const id of ['openai', 'deepseek', 'qwen', 'moonshot', 'siliconflow', 'ollama']) {
    const calls = [];
    const fake = makeFakeFetch({ calls });
    const client = createClient({ provider: id }, { fetch: fake });
    assert.equal(typeof client.chat, 'function');
    const out = await client.chat('s', 'u');
    assert.equal(out, 'hello from fake');
    assert.equal(calls.length, 1);
  }
});
