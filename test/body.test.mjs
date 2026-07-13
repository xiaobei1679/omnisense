// 身体（Body）测试：七器官委托 + 手(hand) + 生命循环(live)
// 全部离线、确定性，无真实联网。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Body, ORGANS } from '../src/body.mjs';

// 最小 fake omni：仅覆盖 Body 用到的器官委托 + live 用到的 think/act
function fakeOmni() {
  return {
    eyes: { seeWebsite: async (u) => ({ url: u }) },
    ears: { listenFeedback: async (t) => ({ heard: t }) },
    mouth: { speak: async (t) => ({ said: t }) },
    brain: { think: async () => ({ insight: 'x' }), act: async () => ({ completed: true, result: 'did' }) },
    perception: { sense: () => ({ topics: ['a', 'b'], topicCount: 2 }) },
  };
}

test('ORGANS 含七器官且与模块文件名对应', () => {
  const keys = ORGANS.map(o => o.key);
  assert.deepEqual(keys, ['eye', 'ear', 'mouth', 'brain', 'hand', 'perceive', 'foot']);
  const mods = ORGANS.map(o => o.module);
  for (const m of ['eyes', 'ears', 'mouth', 'brain', 'tools', 'perception', 'watch']) {
    assert.ok(mods.includes(m), `七器官应含模块 ${m}`);
  }
});

test('describe 返回 7 器官且各自带能力列表', () => {
  const body = new Body(fakeOmni());
  const d = body.describe();
  assert.equal(d.length, 7);
  for (const o of d) {
    assert.ok(Array.isArray(o.methods) && o.methods.length > 0, `器官 ${o.key} 应有能力列表`);
  }
});

test('器官委托：eye/ear/mouth/brain/perceive 转发到对应模块', async () => {
  const body = new Body(fakeOmni());
  const e = await body.eye('seeWebsite', 'http://x');
  assert.equal(e.url, 'http://x');
  const a = await body.ear('listenFeedback', 'hi');
  assert.equal(a.heard, 'hi');
  const m = await body.mouth('speak', 'yo');
  assert.equal(m.said, 'yo');
  const b = await body.brain('think');
  assert.equal(b.insight, 'x');
  const p = body.perceive();
  assert.equal(p.topicCount, 2);
});

test('手 hand：calc 离线真算；未知工具诚实报错', async () => {
  const body = new Body(fakeOmni());
  const r1 = await body.hand('calc', { expression: '2+2' });
  assert.equal(r1.ok, true);
  assert.equal(r1.output.result, 4);
  const r2 = await body.hand('nope', {});
  assert.equal(r2.ok, false);
  assert.match(r2.error, /未知工具/);
});

test('手 handList 返回内置工具名', () => {
  const body = new Body(fakeOmni());
  const names = body.handList().map(t => t.name);
  for (const n of ['web_fetch', 'read_file', 'write_file', 'calc', 'now', 'memory_remember', 'hot_topics']) {
    assert.ok(names.includes(n), `应含工具 ${n}`);
  }
});

test('生命循环 live 跑 2 轮不抛错，trace 完整', async () => {
  const body = new Body(fakeOmni());
  const res = await body.live({ ticks: 2 });
  assert.equal(res.ticks, 2);
  assert.equal(res.trace.length, 2);
  for (const t of res.trace) {
    assert.ok(t.perceive && t.think && t.act, '每轮应有 perceive/think/act');
    assert.equal(t.act.completed, true);
  }
});
