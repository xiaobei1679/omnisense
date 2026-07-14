import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { builtin, extractJson, isConnError, resetBuiltin } from '../src/core/llm.mjs';
import { resetConfig, CONFIG_PATH } from '../src/core/config.mjs';

test('extractJson 去 code fence 解析', () => {
  const t = '```json\n{"a":1}\n```';
  assert.deepEqual(extractJson(t), { a: 1 });
});

test('extractJson 取首个对象块（含前后噪声）', () => {
  const t = '好的，结果：{"insight":"x","confidence":0.8} 完毕';
  assert.deepEqual(extractJson(t), { insight: 'x', confidence: 0.8 });
});

test('extractJson 解析失败回退原文本', () => {
  assert.equal(extractJson('not json'), 'not json');
});

test('isConnError 识别连接错误', () => {
  assert.equal(isConnError(new Error('fetch failed')), true);
  assert.equal(isConnError(Object.assign(new Error('refused'), { cause: { code: 'ECONNREFUSED' } })), true);
  assert.equal(isConnError(new Error('something else')), false);
});

test('builtin 默认模型在无 OMNI_MODEL 时取网关配置或回退 openclaw', () => {
  delete process.env.OMNI_MODEL;
  resetConfig();
  resetBuiltin();
  const cfgModel = existsSync(CONFIG_PATH)
    ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))?.gateway?.model
    : undefined;
  assert.equal(builtin.model, cfgModel || 'openclaw');
  assert.equal(builtin.runtime, null);
  resetConfig();
  resetBuiltin();
});

test('resolveModel 读取网关配置文件显式 model（gateway.model）', () => {
  delete process.env.OMNI_MODEL;
  resetConfig();
  resetBuiltin();
  // 读取默认网关配置文件中的 gateway.model（仅当配置文件存在且含 model 时断言）
  const expected = existsSync(CONFIG_PATH)
    ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))?.gateway?.model
    : undefined;
  if (expected) assert.equal(builtin.model, expected); // 应返回网关引脚模型
  resetConfig();
  resetBuiltin();
});

test('chat 主模型连接失败时回退到探测到的其他可用模型', async () => {
  const base = 'http://fake-gw/v1';
  process.env.OMNI_GATEWAY_BASE = base;
  delete process.env.OMNI_MODEL;
  delete process.env.OMNI_RUNTIME; // 让 ensureRuntime 走真实探测
  // 重置内核缓存，确保走本测试的 mock
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).endsWith('/models')) {
      return new Response(
        JSON.stringify({ object: 'list', data: [{ id: 'bad-model' }, { id: 'good-model' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    }
    if (String(url).endsWith('/chat/completions')) {
      const body = JSON.parse(opts.body);
      if (body.model === 'bad-model') {
        // 模拟真实环境的连接级失败（Ollama 上某模型在 /v1/chat/completions 不可用）
        const e = new Error('fetch failed');
        e.cause = { code: 'ECONNREFUSED' };
        throw e;
      }
      const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'hello' } }] }) + '\n\ndata: [DONE]\n\n';
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }
    return new Response('', { status: 404 });
  };

  try {
    resetBuiltin(); // 清模块级缓存，确保走本测试的 mock
    const out = await builtin.chat([{ role: 'user', content: 'hi' }]);
    assert.equal(out, 'hello'); // 主模型 bad-model 失败 → 回退 good-model 成功
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.OMNI_GATEWAY_BASE;
    resetBuiltin();
  }
});
