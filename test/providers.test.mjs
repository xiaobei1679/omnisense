import test from 'node:test';
import assert from 'node:assert/strict';
import { Models } from '../src/providers/index.mjs';

test('Models 默认无 key 时 _has 为 false', () => {
  delete process.env.LLM_KEY;
  const m = new Models();
  assert.equal(m._has(m.llm), false);
});

test('Models 配置 LLM_KEY 后 _has 为 true', () => {
  const prev = process.env.LLM_KEY;
  process.env.LLM_KEY = 'sk-real-key';
  try {
    const m = new Models();
    assert.equal(m._has(m.llm), true);
    // VLM/TTS 缺省回退到 LLM key
    assert.equal(m._has(m.vlm), true);
  } finally {
    if (prev === undefined) delete process.env.LLM_KEY; else process.env.LLM_KEY = prev;
  }
});

test('Models 哨兵值 sk-your-key-here 视为未配置', () => {
  const m = new Models();
  m.llm.key = 'sk-your-key-here';
  assert.equal(m._has(m.llm), false);
});

test('summarize 空文本立即返回空串（离线）', async () => {
  const m = new Models();
  assert.equal(await m.summarize(''), '');
});

test('summarize 在 driver 模式抛出 AGENT_DRIVE（离线，不触网）', async () => {
  const prev = process.env.OMNI_RUNTIME;
  process.env.OMNI_RUNTIME = 'driver'; // 强制 driver 模式，确保走 AGENT_DRIVE 分支（不触网）
  const m = new Models();
  try {
    await assert.rejects(() => m.summarize('hello world'), /AGENT_DRIVE/);
  } finally {
    if (prev === undefined) delete process.env.OMNI_RUNTIME; else process.env.OMNI_RUNTIME = prev;
  }
});
