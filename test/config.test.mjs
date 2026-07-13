import test from 'node:test';
import assert from 'node:assert/strict';
import { readGatewayConfig, resetConfig, cfg } from '../src/core/config.mjs';

test('readGatewayConfig 返回对象（缺失/损坏均不抛）', () => {
  resetConfig();
  const d = readGatewayConfig();
  assert.ok(d && typeof d === 'object');
});

test('readGatewayConfig 结果被缓存（同一引用）', () => {
  resetConfig();
  const a = readGatewayConfig();
  const b = readGatewayConfig();
  assert.equal(a, b);
});

test('cfg 环境变量优先于默认值', () => {
  process.env.OMNI_TEST_X = 'from-env';
  try {
    assert.equal(cfg('OMNI_TEST_X', 'fb'), 'from-env');
    assert.equal(cfg('OMNI_TEST_UNSET', 'fallback'), 'fallback');
  } finally {
    delete process.env.OMNI_TEST_X;
  }
});
