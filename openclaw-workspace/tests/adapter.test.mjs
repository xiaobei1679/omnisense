// tests/adapter.test.mjs
// Tests for the LLM Adapter layer (scripts/llm/adapter.mjs).
// Covers provider resolution, URL building, header/auth, message normalization,
// config precedence, response parsing, and client construction. No network calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVIDERS,
  normalizeProviderName,
  resolveProvider,
  chatCompletionsUrl,
  buildHeaders,
  normalizeMessages,
  buildConfig,
  parseCompletion,
  createClient,
} from '../scripts/llm/adapter.mjs';

test('normalizeProviderName: aliases + empty default', () => {
  assert.equal(normalizeProviderName(''), 'openai');
  assert.equal(normalizeProviderName('GPT'), 'openai');
  assert.equal(normalizeProviderName('gpt'), 'openai');
  assert.equal(normalizeProviderName('Kimi'), 'moonshot');
  assert.equal(normalizeProviderName('dashscope'), 'qwen');
  assert.equal(normalizeProviderName('tongyi'), 'qwen');
  assert.equal(normalizeProviderName('local'), 'ollama');
  assert.equal(normalizeProviderName('unknown-xyz'), 'unknown-xyz');
});

test('resolveProvider: known returns id+config; unknown throws', () => {
  const p = resolveProvider('deepseek');
  assert.equal(p.id, 'deepseek');
  assert.equal(p.baseUrl, 'https://api.deepseek.com/v1');
  assert.equal(p.defaultModel, 'deepseek-chat');
  assert.throws(() => resolveProvider('nope'), /unknown provider/);
});

test('resolveProvider: case-insensitive via alias', () => {
  assert.equal(resolveProvider('DeepSeek').id, 'deepseek');
  assert.equal(resolveProvider('MOONSHOT').id, 'moonshot');
});

test('chatCompletionsUrl: strips trailing slash + appends path', () => {
  assert.equal(
    chatCompletionsUrl('https://api.openai.com/v1/'),
    'https://api.openai.com/v1/chat/completions'
  );
  assert.equal(
    chatCompletionsUrl('http://127.0.0.1:11434/v1'),
    'http://127.0.0.1:11434/v1/chat/completions'
  );
  assert.throws(() => chatCompletionsUrl(''), /empty baseUrl/);
});

test('buildHeaders: Bearer only when key present', () => {
  const noKey = buildHeaders('');
  assert.equal(noKey.Authorization, undefined);
  assert.equal(noKey['Content-Type'], 'application/json');
  const withKey = buildHeaders('sk-123');
  assert.equal(withKey.Authorization, 'Bearer sk-123');
  const extra = buildHeaders('k', { 'X-Test': '1' });
  assert.equal(extra['X-Test'], '1');
});

test('normalizeMessages: string + role objects; rejects bad role', () => {
  const out = normalizeMessages(['hi', { role: 'SYSTEM', content: 's' }, { role: 'user', content: 'u' }]);
  assert.deepEqual(out, [
    { role: 'user', content: 'hi' },
    { role: 'system', content: 's' },
    { role: 'user', content: 'u' },
  ]);
  assert.throws(() => normalizeMessages('not-array'), /expected array/);
  // missing role defaults to 'user' (valid); a genuinely bad role throws.
  assert.deepEqual(normalizeMessages([{ content: 'x' }]), [{ role: 'user', content: 'x' }]);
  assert.throws(() => normalizeMessages([{ role: 'poet', content: 'x' }]), /bad role/);
  assert.throws(() => normalizeMessages([123]), /invalid entry/);
  // null content stringifies to ''
  assert.equal(normalizeMessages([{ role: 'user', content: null }])[0].content, '');
});

test('buildConfig: explicit baseUrl overrides provider (legacy path)', () => {
  const cfg = buildConfig({
    provider: 'deepseek',
    baseUrl: 'https://my-proxy.example.com/v1',
    apiKeyEnv: 'LLM_API_KEY',
  });
  assert.equal(cfg.provider, 'custom');
  assert.equal(cfg.baseUrl, 'https://my-proxy.example.com/v1');
  assert.equal(cfg.model, 'gpt-4o-mini'); // default when no model given
  assert.equal(cfg.isLocal, false);
});

test('buildConfig: explicit baseUrl to ollama host is local, no key', () => {
  const cfg = buildConfig({ baseUrl: 'http://127.0.0.1:11434/v1' });
  assert.equal(cfg.isLocal, true);
  assert.equal(cfg.keyRequired, false);
});

test('buildConfig: default (no provider) == legacy OpenAI behavior', () => {
  const cfg = buildConfig({});
  assert.equal(cfg.provider, 'openai');
  assert.equal(cfg.baseUrl, 'https://api.openai.com/v1');
  assert.equal(cfg.model, 'gpt-4o-mini');
  assert.equal(cfg.isLocal, false);
});

test('buildConfig: ollama provider is local, empty key, not required', () => {
  const cfg = buildConfig({ provider: 'ollama' });
  assert.equal(cfg.provider, 'ollama');
  assert.equal(cfg.baseUrl, 'http://127.0.0.1:11434/v1');
  assert.equal(cfg.model, 'qwen2.5-coder:3b');
  assert.equal(cfg.apiKey, '');
  assert.equal(cfg.isLocal, true);
  assert.equal(cfg.keyRequired, false);
});

test('buildConfig: deepseek reads its own key env', () => {
  const prev = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'sk-deep-xyz';
  try {
    const cfg = buildConfig({ provider: 'deepseek' });
    assert.equal(cfg.baseUrl, 'https://api.deepseek.com/v1');
    assert.equal(cfg.model, 'deepseek-chat');
    assert.equal(cfg.apiKey, 'sk-deep-xyz');
    assert.equal(cfg.apiKeyEnv, 'DEEPSEEK_API_KEY');
    assert.equal(cfg.isLocal, false);
  } finally {
    if (prev === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = prev;
  }
});

test('buildConfig: explicit apiKey overrides env', () => {
  const prev = process.env.LLM_API_KEY;
  process.env.LLM_API_KEY = 'sk-from-env';
  try {
    const cfg = buildConfig({ provider: 'openai', apiKey: 'sk-explicit' });
    assert.equal(cfg.apiKey, 'sk-explicit');
  } finally {
    if (prev === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = prev;
  }
});

test('buildConfig: model override honored', () => {
  const cfg = buildConfig({ provider: 'qwen', model: 'qwen-max' });
  assert.equal(cfg.model, 'qwen-max');
  assert.equal(cfg.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
});

test('parseCompletion: extracts content; rejects malformed', () => {
  assert.equal(
    parseCompletion({ choices: [{ message: { content: 'hello' } }] }),
    'hello'
  );
  assert.equal(
    parseCompletion({ choices: [{ message: { content: '' } }] }),
    ''
  );
  assert.throws(() => parseCompletion(null), /empty response/);
  assert.throws(() => parseCompletion({}), /no choices/);
  assert.throws(
    () => parseCompletion({ choices: [{}] }),
    /no choices/
  );
});

test('createClient: returns bound client with correct endpoint/config', () => {
  const client = createClient({ provider: 'openai', apiKey: 'sk-x' });
  assert.equal(typeof client.chat, 'function');
  assert.equal(client.endpoint, 'https://api.openai.com/v1/chat/completions');
  assert.equal(client.config.provider, 'openai');
  assert.equal(client.config.apiKey, 'sk-x');
});

test('createClient: local provider needs no key to construct', () => {
  const client = createClient({ provider: 'ollama' });
  assert.equal(client.config.isLocal, true);
  assert.equal(typeof client.chat, 'function');
});

test('PROVIDERS catalog is complete + self-consistent', () => {
  const ids = Object.keys(PROVIDERS);
  for (const id of ids) {
    const p = PROVIDERS[id];
    assert.ok(p.baseUrl.startsWith('http'), `${id} bad baseUrl`);
    assert.ok(p.defaultModel, `${id} missing defaultModel`);
    assert.equal(typeof p.keyRequired, 'boolean', `${id} keyRequired`);
  }
  // All aliases resolve to a real provider.
  for (const alias of ['gpt', 'kimi', 'dashscope', 'silicon', 'local']) {
    assert.ok(PROVIDERS[normalizeProviderName(alias)], `alias ${alias} unresolved`);
  }
});
