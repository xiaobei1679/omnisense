// 学习子系统（learning/src/eventBus.mjs）确定性单元测试：覆盖零依赖 pub/sub 总线。
// 全部离线、零网络、零外部依赖；只测纯逻辑（注册/派发/退订/异常隔离）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventBus } from '../learning/src/eventBus.mjs';

test('on/emit：注册的处理器收到 payload', () => {
  const bus = new EventBus();
  let got = null;
  bus.on('situation', (p) => { got = p; });
  bus.emit('situation', { attention: 'curse' });
  assert.deepEqual(got, { attention: 'curse' });
});

test('on 返回取消订阅函数，退订后不再触发', () => {
  const bus = new EventBus();
  let count = 0;
  const off = bus.on('x', () => { count++; });
  bus.emit('x');
  assert.equal(count, 1);
  off();
  bus.emit('x');
  assert.equal(count, 1); // 退订后不再调用
});

test('emit：多个处理器全部被调用', () => {
  const bus = new EventBus();
  const hits = [];
  bus.on('e', () => hits.push('a'));
  bus.on('e', () => hits.push('b'));
  bus.emit('e');
  assert.deepEqual(hits, ['a', 'b']);
});

test('emit：某处理器抛错被吞，其余处理器不受影响', () => {
  const bus = new EventBus();
  const hits = [];
  bus.on('e', () => { throw new Error('boom'); });
  bus.on('e', () => hits.push('ok'));
  assert.doesNotThrow(() => bus.emit('e'));
  assert.deepEqual(hits, ['ok']); // 第二个处理器仍执行
});

test('emit：无处理器时是安全 no-op', () => {
  const bus = new EventBus();
  assert.doesNotThrow(() => bus.emit('never-registered', { a: 1 }));
});

test('on：同一处理函数只注册一次（Set 去重，避免重复派发）', () => {
  const bus = new EventBus();
  let count = 0;
  const fn = () => { count++; };
  bus.on('e', fn);
  bus.on('e', fn); // 重复注册同一 fn
  bus.emit('e');
  assert.equal(count, 1); // Set 去重，只触发一次
});
