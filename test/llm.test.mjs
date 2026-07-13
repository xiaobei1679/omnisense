import test from 'node:test';
import assert from 'node:assert/strict';
import { builtin, extractJson, isConnError } from '../src/core/llm.mjs';

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

test('builtin 默认模型为 openclaw，runtime 初始为 null', () => {
  assert.equal(builtin.model, 'openclaw');
  assert.equal(builtin.runtime, null);
});
