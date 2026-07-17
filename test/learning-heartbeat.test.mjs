// learning/src/heartbeat.mjs 行为单测（零依赖、离线、不触网）
// 覆盖内置 Learner 为替身，避免真实联网 git clone；只验证心跳引擎的调度/去重/上限/降级逻辑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Heartbeat } from '../learning/src/heartbeat.mjs';

// 静默 runOnce 内的 console.log，保证测试输出干净
const _log = console.log;
console.log = () => {};

function fakeBus() {
  const handlers = {};
  return {
    _events: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, payload) {
      this._events.push({ ev, payload });
      for (const fn of handlers[ev] || []) fn(payload);
    },
  };
}

function fakeMemory(learnings = []) {
  return {
    learnings: [...learnings],
    openGaps: () => [],
    addLearning(l) { this.learnings.push(l); },
    persist() {},
  };
}

// 替身 Learner：fail=true 抛错模拟联网失败；fixed=true 时每次返回同一 repoUrl（用于跨周期去重断言）
function makeLearner({ fail = false, fixed = false } = {}) {
  const calls = [];
  return {
    calls,
    learn: async (arg, topic) => {
      calls.push({ arg, topic });
      if (fail) throw new Error('network down');
      const n = fixed ? 1 : calls.length;
      return { repo: 'r' + n, repoUrl: 'https://x/' + n, topic: 't', techniques: ['a' + n] };
    },
  };
}

test('learn 抛错优雅降级：learned=0 且照常发 heartbeat-done（不冒泡）', async () => {
  const bus = fakeBus();
  const h = new Heartbeat(bus, fakeMemory(), { maxPerCycle: 2 });
  h.learner = makeLearner({ fail: true });
  const learned = await h.runOnce();
  assert.equal(learned, 0);
  assert.equal(bus._events.filter((e) => e.ev === 'learned').length, 0);
  const done = bus._events.find((e) => e.ev === 'heartbeat-done');
  assert.ok(done, 'heartbeat-done 事件应发出');
  assert.equal(done.payload.learned, 0);
  assert.equal(h.memory.learnings.length, 0);
});

test('新源计入 learned + 发 learned 事件 + heartbeat-done 带真实计数', async () => {
  const bus = fakeBus();
  const h = new Heartbeat(bus, fakeMemory()); // maxPerCycle 默认 2
  h.learner = makeLearner();
  const learned = await h.runOnce();
  assert.ok(learned >= 1 && learned <= 2, 'learned 应在 [1, maxPerCycle] 区间');
  assert.equal(bus._events.filter((e) => e.ev === 'learned').length, learned);
  const done = bus._events.find((e) => e.ev === 'heartbeat-done');
  assert.equal(done.payload.learned, learned);
  assert.equal(h.memory.learnings.length, learned, 'addLearning 应等次数入库');
});

test('跨周期去重：memory 已含同 repoUrl → 跳过重复，learned=0', async () => {
  const bus = fakeBus();
  const h = new Heartbeat(bus, fakeMemory([{ repo: 'r1', repoUrl: 'https://x/1' }]));
  h.learner = makeLearner({ fixed: true }); // 每次 learn 都返回 https://x/1 → 与已学命中，全部跳过
  const learned = await h.runOnce();
  assert.equal(learned, 0);
  assert.equal(bus._events.filter((e) => e.ev === 'learned').length, 0);
});

test('maxPerCycle 上限生效：仅学习前 N 个源，learn 不再多调', async () => {
  const bus = fakeBus();
  const h = new Heartbeat(bus, fakeMemory(), { maxPerCycle: 1 });
  const learner = makeLearner();
  h.learner = learner;
  const learned = await h.runOnce();
  assert.equal(learned, 1, '受 maxPerCycle=1 限制只学 1 项');
  assert.equal(learner.calls.length, 1, '其余源因已达上限被 continue 跳过，learn 不再调用');
  assert.equal(bus._events.filter((e) => e.ev === 'learned').length, 1);
});

test('openGaps 含 belief 缺口被过滤：不阻断心跳周期', async () => {
  const bus = fakeBus();
  const mem = fakeMemory();
  mem.openGaps = () => [{ modality: 'belief', entity: 'E', desc: 'd', confidence: 0.2 }];
  const h = new Heartbeat(bus, mem);
  h.learner = makeLearner();
  const learned = await h.runOnce();
  assert.ok(learned >= 0);
  assert.ok(bus._events.find((e) => e.ev === 'heartbeat-done'), 'belief 缺口不应导致周期崩溃');
});

test('startHourly 启动定时器、stop 幂等安全（不残留常驻定时器）', () => {
  const bus = fakeBus();
  const h = new Heartbeat(bus, fakeMemory());
  h.startHourly();
  assert.ok(h.interval != null, 'startHourly 应建立定时器');
  assert.equal(typeof h.interval.unref, 'function');
  h.stop();                          // 第一次 stop：清除定时器
  assert.doesNotThrow(() => h.stop(), '二次 stop 应幂等安全，不抛错');
});

console.log = _log;
