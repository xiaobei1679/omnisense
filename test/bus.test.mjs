import test from 'node:test';
import assert from 'node:assert/strict';
import { Bus, EVENTS } from '../src/core/bus.mjs';

test('on/emit 基础订阅与取消', () => {
  const b = new Bus();
  let got = null;
  const off = b.on('x', (p) => { got = p; });
  b.emit('x', { v: 1 });
  assert.deepEqual(got, { v: 1 });
  assert.equal(b.count('x'), 1);
  off();
  b.emit('x', { v: 2 });
  assert.deepEqual(got, { v: 1 }); // 取消后不再触发
  assert.equal(b.count('x'), 0);
});

test('once 只触发一次', () => {
  const b = new Bus();
  let n = 0;
  b.once('y', () => { n++; });
  b.emit('y'); b.emit('y');
  assert.equal(n, 1);
  assert.equal(b.count('y'), 0);
});

test('通配符 * 接收全部事件', () => {
  const b = new Bus();
  const seen = [];
  b.on('*', (p, e) => seen.push(e.event));
  b.emit('a'); b.emit('b');
  assert.deepEqual(seen, ['a', 'b']);
  assert.equal(b.count('*'), 1);
});

test('off 移除通配符订阅', () => {
  const b = new Bus();
  const fn = () => {};
  b.on('*', fn);
  assert.equal(b.count('*'), 1);
  b.off('*', fn);
  assert.equal(b.count('*'), 0);
});

test('listener 抛错不影响其他订阅者', () => {
  const b = new Bus();
  let safe = 0;
  b.on('e', () => { safe++; });
  b.on('e', () => { throw new Error('boom'); });
  b.emit('e');
  assert.equal(safe, 1);
});

test('register/command 指令分发', async () => {
  const b = new Bus();
  b.register('eyes', 'see', (p) => ({ saw: p.url }));
  const r = await b.command('eyes', 'see', { url: 'http://x' });
  assert.deepEqual(r, { saw: 'http://x' });
  await assert.rejects(() => b.command('eyes', 'missing'), /未注册指令/);
});

test('recent 按事件过滤', () => {
  const b = new Bus();
  b.emit(EVENTS.PERCEPT, { a: 1 });
  b.emit('other', { b: 2 });
  const percepts = b.recent(EVENTS.PERCEPT).map(e => e.payload);
  assert.deepEqual(percepts, [{ a: 1 }]);
});
