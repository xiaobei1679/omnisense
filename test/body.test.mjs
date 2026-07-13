// 身体（Body）测试：七器官委托 + 手(hand) + 生命循环(live)
// 全部离线、确定性，无真实联网。
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Body, ORGANS } from '../src/body.mjs';
import { Tracer } from '../src/core/tracer.mjs';

// 最小 fake omni：仅覆盖 Body 用到的器官委托 + live 用到的 think/act
function fakeOmni() {
  return {
    eyes: { seeWebsite: async (u) => ({ url: u }) },
    ears: { listenFeedback: async (t) => ({ heard: t }) },
    mouth: { speak: async (t) => ({ said: t }) },
    brain: {
      think: async () => ({ insight: 'x' }),
      act: async () => ({ completed: true, result: 'did' }),
      remember: async (k) => ({ remembered: k }),
      plan: async () => ({ actions: [] }),
      recall: async (k) => ({ recalled: k }),
    },
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

test('describe 每个能力是 {name,desc,net} 对象（A2A Agent Card 风格）', () => {
  const body = new Body(fakeOmni());
  const d = body.describe();
  const eye = d.find(o => o.key === 'eye');
  assert.ok(Array.isArray(eye.methods) && eye.methods.length > 0);
  for (const m of eye.methods) {
    assert.ok(typeof m.name === 'string' && m.name.length > 0, '能力需有 name');
    assert.ok('net' in m, '能力需含 net 字段（诚实标注联网）');
  }
});

test('agentCard 扁平化全部能力为 skills[]（id/name/description/tags/net，唯一 id）', () => {
  const body = new Body(fakeOmni());
  const card = body.agentCard();
  assert.equal(card.schema, 'omnisense-agent-card/1.0');
  assert.equal(card.name, 'OmniSense Body');
  assert.ok(card.version && /^\d+\.\d+\.\d+$/.test(card.version), 'version 应为 semver');
  assert.ok(Array.isArray(card.skills) && card.skills.length > 0);
  const ids = new Set(card.skills.map(s => s.id));
  assert.equal(ids.size, card.skills.length, 'skill id 应唯一');
  for (const s of card.skills) {
    assert.ok(s.id && s.name && s.description, 'skill 需含 id/name/description');
    assert.ok(Array.isArray(s.tags) && s.tags.length > 0, 'skill 需含 tags');
    assert.ok('net' in s, 'skill 需含 net 字段（诚实标注联网）');
  }
  // 至少含一个联网能力（眼）与一个离线能力（脑.think）
  assert.ok(card.skills.some(s => s.net), '应含联网能力');
  assert.ok(card.skills.some(s => !s.net), '应含离线能力');
  assert.ok(ids.has('eye.seeWebsite') && ids.has('brain.think'));
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

test('生命循环 live --no-autopilot 跑 2 轮不抛错，trace 完整（legacy 写死步骤）', async () => {
  const body = new Body(fakeOmni());
  const res = await body.live({ ticks: 2, autopilot: false });
  assert.equal(res.ticks, 2);
  assert.equal(res.mode, 'live', 'legacy 模式应标记 live');
  assert.equal(res.trace.length, 2);
  for (const t of res.trace) {
    assert.ok(t.perceive && t.think && t.act, '每轮应有 perceive/think/act');
    assert.equal(t.act.completed, true);
  }
});

test('生命循环 live 默认 autopilot 自驱：每拍身体自决定、委派动作器官（非退化感知）', async () => {
  const body = new Body(fakeOmni());
  const res = await body.live({ ticks: 3 });
  assert.equal(res.ticks, 3);
  assert.equal(res.mode, 'live(autopilot)', '默认应标记为 autopilot 自驱');
  assert.equal(res.trace.length, 3);
  for (const t of res.trace) {
    assert.ok(t.perceive, '每轮应感知');
    assert.ok(t.intent, '每轮应有自生成意图');
    assert.ok(Array.isArray(t.candidates) && t.candidates.length > 0, '应基于能力卡产出候选技能');
    assert.ok(t.executed && !t.executed.startsWith('perceive.sense'), '应委派到动作器官(非退化感知)');
    const isAction = t.executed.startsWith('brain.') || t.executed.startsWith('mouth.') || t.executed.startsWith('ear.');
    assert.ok(isAction, '默认议程应委派到会做事的器官(脑/嘴/耳，离线、零网络)');
  }
});

test('自主循环 autopilot 跑 3 轮离线自驱：每轮用能力卡决策并委派非 hand 器官', async () => {
  const body = new Body(fakeOmni());
  const res = await body.autopilot({ ticks: 3 });
  assert.equal(res.mode, 'autopilot', '应标记 autopilot 模式');
  assert.equal(res.ticks, 3);
  assert.equal(res.trace.length, 3);
  for (const t of res.trace) {
    assert.ok(t.perceive, '每轮应感知');
    assert.ok(t.intent, '每轮应有自生成意图');
    assert.ok(Array.isArray(t.candidates) && t.candidates.length > 0, '应基于能力卡产出候选技能');
    assert.ok(t.executed && !t.executed.startsWith('perceive.sense'), '应委派到能力卡选中的行动器官(非退化感知)');
    const isAction = t.executed.startsWith('brain.') || t.executed.startsWith('mouth.') || t.executed.startsWith('ear.');
    assert.ok(isAction, '默认议程应委派到会做事的器官(脑/嘴/耳，离线、零网络)');
    assert.ok('result' in t, '应有执行结果');
  }
});

test('自主循环 autopilot 自定义议程可用且离线耐受（hand 技能自动跳过降级）', async () => {
  const body = new Body(fakeOmni());
  // 议程里放一个只会命中 hand 的意图，验证命中 hand 时降级而非报错
  const res = await body.autopilot({ ticks: 2, agenda: ['用计算器算一下 2+2', '思考一下当前环境'] });
  assert.equal(res.ticks, 2);
  // 第一轮意图命中 hand.calc → 降级到 perceive.sense；第二轮命中动作器官 → 正常委派
  assert.equal(res.trace[0].executed, 'perceive.sense');
  assert.equal(res.trace[0].fallback, 'matched-hand-needs-args');
  const ok2 = res.trace[1].executed.startsWith('brain.') || res.trace[1].executed.startsWith('mouth.') || res.trace[1].executed.startsWith('ear.');
  assert.ok(ok2, '第二轮应委派到会做事的器官(脑/嘴/耳)，而非退化感知');
});

test('自主循环 autopilot 默认开启动态议程：结果驱动重排，4+ 轮覆盖全部默认意图且权重随结果变化', async () => {
  const body = new Body(fakeOmni());
  const res = await body.autopilot({ ticks: 6 });
  assert.equal(res.mode, 'autopilot');
  assert.equal(res.agendaDynamic, true, '默认议程应开启动态重排');
  assert.equal(res.trace.length, 6);
  // 每步都带 agendaWeights 快照（4 项默认意图）
  const seen = new Set();
  for (const t of res.trace) {
    assert.ok(Array.isArray(t.agendaWeights) && t.agendaWeights.length === 4, '动态模式每步应带 4 项议程权重快照');
    assert.ok(t.executed && !t.executed.startsWith('perceive.sense'), '默认议程应委派到动作器官(非退化感知)');
    seen.add(t.intent);
  }
  // 覆盖性：6 轮应让 4 项默认意图都至少出现一次（优先级队列保证公平轮转）
  assert.equal(seen.size, 4, '动态模式 6 轮应覆盖全部 4 项默认意图');
  // 结果驱动重排：首轮与末轮权重快照应不同（证明权重随每轮结果变化）
  assert.notDeepEqual(res.trace[0].agendaWeights, res.trace[5].agendaWeights, '权重应随每轮结果重排而变化');
});

test('自主循环 autopilot --no-dynamic 关闭动态重排：尊重默认顺序、无权重快照', async () => {
  const body = new Body(fakeOmni());
  const res = await body.autopilot({ ticks: 2, dynamic: false });
  assert.equal(res.agendaDynamic, false, '应关闭动态议程');
  assert.equal(res.trace.length, 2);
  for (const t of res.trace) {
    assert.equal(t.agendaWeights, undefined, '关闭动态不应产出权重快照');
    assert.ok(t.executed && !t.executed.startsWith('perceive.sense'), '仍应委派到动作器官');
  }
  // 静态模式按 round-robin 取默认议程：第一轮应为默认议程第 0 项（思考类）
  assert.match(res.trace[0].intent, /思考|关注/, '静态模式应尊重默认议程顺序(首轮=思考意图)');
});

test('自主循环 autopilot recordTrace:true 把每轮自驱决策落盘为 engine=autopilot 的 trace（可观测性闭环）', async () => {
  const td = mkdtempSync(join(tmpdir(), 'omni-ap-trace-'));
  const omni = fakeOmni();
  omni.tracer = new Tracer(join(td, '.omni-traces.json'));
  const body = new Body(omni);
  const res = await body.autopilot({ ticks: 2, recordTrace: true });
  assert.equal(res.trace.length, 2);
  const runs = omni.tracer.findRunsByGoal('autopilot');
  assert.ok(runs.length >= 1, '应至少记录一条 autopilot trace');
  assert.equal(runs[0].engine, 'autopilot', 'trace 应标记 autopilot 引擎');
  assert.ok(runs[0].goal.startsWith('autopilot: '), 'goal 应带 autopilot: 前缀（含自生成意图）');
});

test('自主循环 autopilot recordTrace 默认关闭（opt-in，避免无谓写盘）', async () => {
  const td = mkdtempSync(join(tmpdir(), 'omni-ap-notrace-'));
  const omni = fakeOmni();
  omni.tracer = new Tracer(join(td, '.omni-traces.json'));
  const body = new Body(omni);
  await body.autopilot({ ticks: 2 });
  const runs = omni.tracer.findRunsByGoal('autopilot');
  assert.equal(runs.length, 0, '默认 recordTrace 关闭，不应落盘 trace（可观测性为显式 opt-in）');
});

