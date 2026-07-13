import test from 'node:test';
import assert from 'node:assert/strict';
import { TtlCache, CircuitBreaker } from '../src/core/breaker.mjs';

test('TtlCache 命中/未命中/过期', () => {
  const c = new TtlCache(50);
  assert.equal(c.get('k'), undefined);
  c.set('k', 'v');
  assert.equal(c.get('k'), 'v');
  assert.equal(c.has('k'), true);
});

test('TtlCache 过期后返回 undefined', async () => {
  const c = new TtlCache(20);
  c.set('k', 'v');
  await new Promise(r => setTimeout(r, 40));
  assert.equal(c.get('k'), undefined);
});

test('TtlCache clear', () => {
  const c = new TtlCache(99999);
  c.set('a', 1); c.set('b', 2);
  c.clear();
  assert.equal(c.get('a'), undefined);
  assert.equal(c.get('b'), undefined);
});

test('CircuitBreaker 默认关闭，达到阈值后开启', () => {
  const cb = new CircuitBreaker(3, 1000);
  assert.equal(cb.open, false);
  cb.fail(); cb.fail();
  assert.equal(cb.open, false);
  cb.fail();
  assert.equal(cb.open, true);
});

test('CircuitBreaker 任意一次成功后复位', () => {
  const cb = new CircuitBreaker(2, 1000);
  cb.fail();           // 1
  assert.equal(cb.open, false);
  cb.success();
  assert.equal(cb.fails, 0);
  cb.fail();           // 1 again
  assert.equal(cb.open, false);
});

test('CircuitBreaker 冷却后自动关闭', async () => {
  const cb = new CircuitBreaker(1, 30);
  cb.fail();
  assert.equal(cb.open, true);
  await new Promise(r => setTimeout(r, 45));
  assert.equal(cb.open, false);
});
