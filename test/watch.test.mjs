import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runWatchTick, runWatch, signatureOf, synthesizeAgentGoal, diffTopics, titlesFromSig } from '../src/core/watch.mjs';
import { localPlan } from '../src/core/agent.mjs';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// 离线 fake omni：满足 watch 所需的 seeHotAll/sense/plan/(think)/remember
function fakeOmni() {
  return {
    _remembered: null,
    seeHotAll: async () => ({ topics: ['热点A', '热点B', '热点C'], source: 'all' }),
    sense: () => ({ topicCount: 3, topics: ['热点A', '热点B', '热点C'], modalities: ['visual-hot-aggregate'], lastUpdate: Date.now() }),
    plan: () => ({ goal: '', actions: ['read-web', 'remember'], synopsis: {} }),
    think: async () => ({ insight: 'test', confidence: 0.5 }),
    remember: function (k, v) { this._remembered = { k, v }; return v; },
  };
}

test('runWatchTick 单次快照结构正确（离线）', async () => {
  const omni = fakeOmni();
  const snap = await runWatchTick(omni);
  assert.equal(snap.hotCount, 3);
  assert.ok(snap.situation && snap.situation.topicCount === 3, 'situation 来自 sense()');
  assert.deepEqual(snap.plan.actions, ['read-web', 'remember']);
  assert.equal(snap.thought, null, '默认不思考');
});

test('runWatchTick enableThink 时调用 think', async () => {
  const omni = fakeOmni();
  const snap = await runWatchTick(omni, { enableThink: true });
  assert.ok(snap.thought && snap.thought.insight === 'test', 'thought 来自 think()');
});

test('runWatch 有限次数循环产出对应快照数（离线）', async () => {
  const omni = fakeOmni();
  const ticks = [];
  const res = await runWatch(omni, { interval: 1, maxTicks: 3, onTick: t => ticks.push(t) });
  assert.equal(res.total, 3);
  assert.equal(ticks.length, 3);
  assert.equal(ticks[0].tick, 1);
  assert.equal(ticks[2].tick, 3);
  assert.equal(res.stopped, true);
});

test('runWatch rememberLatest 将最新摘要写入记忆', async () => {
  const omni = fakeOmni();
  await runWatch(omni, { interval: 1, maxTicks: 1, rememberLatest: true });
  assert.ok(omni._remembered, '应调用 remember');
  assert.equal(omni._remembered.k, 'lastWatch');
  assert.match(omni._remembered.v, /hotCount/);
});

test('runWatch 在 think 抛错时优雅降级（不中断循环）', async () => {
  const omni = fakeOmni();
  omni.think = async () => { throw new Error('boom'); };
  const res = await runWatch(omni, { interval: 1, maxTicks: 2, enableThink: true });
  assert.equal(res.total, 2, '思考失败不应中断循环');
});

// ───────── watch → agent 自主编排 ─────────
// 可变热点的 fake omni：seeHotAll 返回 state.topics，act 记录调用并成功返回
function fakeOmniAgent(initial) {
  const state = { topics: initial };
  const acts = [];
  return {
    state,
    get _acts() { return acts; },
    seeHotAll: async () => ({ topics: state.topics.map(t => ({ title: t })), source: 'all' }),
    sense: () => ({ topicCount: state.topics.length, topics: state.topics }),
    plan: () => ({ goal: '', actions: ['read-web', 'remember'], synopsis: {} }),
    think: async () => ({ insight: 'test' }),
    remember: () => ({}),
    // 用闭包变量 acts 记录（不要用 this，箭头函数 this 不绑定对象）
    act: async (goal) => { acts.push(goal); return { completed: true, result: 'done', usedLLM: false }; },
  };
}

test('synthesizeAgentGoal 默认目标格式正确且离线可解析为 remember 步骤', () => {
  const goal = synthesizeAgentGoal([{ title: 'AI大会' }, { title: '新游发售' }, { title: '票房破纪录' }]);
  assert.match(goal, /^记住 watch_\d{4}-\d{2}-\d{2}=/);
  assert.match(goal, /AI大会/);
  const plan = localPlan(goal);
  assert.ok(plan && plan.length === 1 && plan[0].tool === 'memory_remember', '默认目标应离线可执行(写入记忆)');
});

test('runWatchTick agent 开启：首轮（无 prevSig）即播种并派发 act', async () => {
  const omni = fakeOmniAgent(['热点A', '热点B', '热点C']);
  const snap = await runWatchTick(omni, { agent: true, agentCooldownMs: 0 });
  assert.ok(snap.agentAction?.fired, '首轮应触发自主行动');
  assert.equal(snap.agentAction.reason, '首轮播种');
  assert.equal(omni._acts.length, 1, '应调用一次 act');
  assert.match(omni._acts[0], /^记住 watch_/);
});

test('runWatchTick agent 开启：热点无变化则不派发 act', async () => {
  const omni = fakeOmniAgent(['热点A', '热点B', '热点C']);
  const sig = signatureOf([{ title: '热点A' }, { title: '热点B' }, { title: '热点C' }]);
  const snap = await runWatchTick(omni, { agent: true, agentCooldownMs: 0, prevSig: sig });
  assert.equal(snap.agentAction?.fired, false, '无变化不应派发');
  assert.equal(snap.agentAction.reason, '热点无变化');
  assert.equal(omni._acts.length, 0, '不应调用 act');
});

test('runWatchTick agent 开启：热点变化则派发 act', async () => {
  const omni = fakeOmniAgent(['热点X', '热点Y', '热点Z']);
  const snap = await runWatchTick(omni, { agent: true, agentCooldownMs: 0, prevSig: signatureOf([{ title: '旧1' }, { title: '旧2' }]) });
  assert.ok(snap.agentAction?.fired, '变化应触发');
  assert.equal(snap.agentAction.reason, '检测到热点变化');
  assert.equal(omni._acts.length, 1);
});

test('runWatchTick agent 开启：冷却中虽变化也不派发', async () => {
  const omni = fakeOmniAgent(['新1', '新2']);
  const r1 = await runWatchTick(omni, { agent: true, agentCooldownMs: 100000 });
  assert.ok(r1.agentAction?.fired, '首轮播种');
  const r2 = await runWatchTick(omni, { agent: true, agentCooldownMs: 100000, prevSig: signatureOf([{ title: '旧' }]), prevAgentAt: r1.agentAction.at });
  assert.equal(r2.agentAction?.fired, false, '冷却中不应派发');
  assert.equal(r2.agentAction.reason, '冷却中');
});

test('runWatch agent 开启：循环内热点变化则累计 agentFired 并写入快照', async () => {
  const omni = fakeOmniAgent(['t1', 't2']);
  const res = await runWatch(omni, { interval: 1, maxTicks: 3, agent: true, agentCooldownMs: 0, onTick: () => {
    // 每轮改变热点，制造"变化"触发自主行动
    omni.state.topics = ['t' + (Math.random()), 't' + (Math.random())];
  } });
  assert.ok(res.agentFired >= 1, '至少应自主行动一次');
  assert.ok(res.ticks.every(t => t.agentAction), '每个快照应包含 agentAction 字段');
  assert.equal(omni._acts.length, res.agentFired, 'act 调用次数应与 agentFired 一致');
});

// ───────── 结构化差异检测 + 多模式自主行动 ─────────
test('diffTopics 正确识别新增与消失', () => {
  const d = diffTopics(['A', 'B', 'C'], ['B', 'C', 'D']);
  assert.deepEqual(d.added, ['D']);
  assert.deepEqual(d.removed, ['A']);
});

test('titlesFromSig 安全解析签名串', () => {
  const sig = JSON.stringify(['B', 'A', 'C']);
  assert.deepEqual(titlesFromSig(sig), ['B', 'A', 'C']);
  assert.deepEqual(titlesFromSig('不是json'), []);
});

test('synthesizeAgentGoal alert 模式：目标为告警记忆且含新增话题', () => {
  const goal = synthesizeAgentGoal([{ title: 'AI大会' }, { title: '新游发售' }], null, { mode: 'alert', diff: { added: ['AI大会', '新游发售'], removed: [] } });
  assert.match(goal, /^提醒 突变_\d{4}-\d{2}-\d{2}=AI大会、新游发售/);
  // alert 目标应离线可解析为 remember 步骤（提醒 已纳入本地规划器 remember 意图）
  const plan = localPlan(goal);
  assert.ok(plan && plan.length === 1 && plan[0].tool === 'memory_remember', 'alert 目标应离线可执行');
});

test('synthesizeAgentGoal digest 模式：目标为写入 markdown 摘要', () => {
  const goal = synthesizeAgentGoal([{ title: 'AI大会' }], null, { mode: 'digest', diff: { added: ['AI大会'], removed: ['旧闻'] } });
  assert.match(goal, /^写入 \.\/watch_digest_\d{4}-\d{2}-\d{2}\.md 内容: "/);
  // digest 目标应离线可解析为 write_file 步骤
  const plan = localPlan(goal);
  assert.ok(plan && plan.length === 1 && plan[0].tool === 'write_file', 'digest 目标应离线可执行(写文件)');
  assert.match(plan[0].args.path, /watch_digest_.*\.md$/);
  assert.match(plan[0].args.content, /AI大会/);
});

test('synthesizeAgentGoal 自定义模板支持 {added}{removed}{count} 占位', () => {
  const goal = synthesizeAgentGoal([{ title: 'X' }], '摘要({date}) 新增:{added} 消失:{removed} 共{count}条', { diff: { added: ['N'], removed: ['R'] } });
  assert.match(goal, /摘要\(\d{4}-\d{2}-\d{2}\) 新增:N 消失:R 共1条/);
});

test('runWatchTick 快照包含 diff（新增/消失）', async () => {
  const omni = fakeOmniAgent(['A', 'B']);
  const prev = signatureOf([{ title: 'A' }, { title: 'B' }, { title: 'C' }]); // C 将消失
  const snap = await runWatchTick(omni, { agent: false, prevSig: prev });
  assert.deepEqual(snap.diff.removed, ['C']);
  assert.deepEqual(snap.diff.added, []);
});

test('runWatchTick alert 模式：有变化但无新增话题 → 不派发(无新增话题)', async () => {
  const omni = fakeOmniAgent(['A', 'B']); // 相对 prev 仅少了 C（消失），无新增
  const prev = signatureOf([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
  const snap = await runWatchTick(omni, { agent: true, agentMode: 'alert', agentCooldownMs: 0, prevSig: prev });
  assert.equal(snap.agentAction?.fired, false, '无新增话题不应派发');
  assert.equal(snap.agentAction.reason, '无新增话题');
  assert.equal(omni._acts.length, 0);
});

test('runWatchTick alert 模式：有新增话题 → 派发告警目标', async () => {
  const omni = fakeOmniAgent(['A', 'B', 'D']); // D 为新增
  const prev = signatureOf([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
  const snap = await runWatchTick(omni, { agent: true, agentMode: 'alert', agentCooldownMs: 0, prevSig: prev });
  assert.ok(snap.agentAction?.fired, '有突变应触发');
  assert.match(snap.agentAction.goal, /^提醒 突变_/);
  assert.equal(omni._acts.length, 1);
});

test('runWatchTick digest 模式：变化即写入摘要文件目标', async () => {
  const omni = fakeOmniAgent(['X', 'Y', 'Z']);
  const prev = signatureOf([{ title: '旧' }]);
  const snap = await runWatchTick(omni, { agent: true, agentMode: 'digest', agentCooldownMs: 0, prevSig: prev });
  assert.ok(snap.agentAction?.fired, '变化应触发 digest');
  assert.match(snap.agentAction.goal, /^写入 \.\/watch_digest_/);
  assert.equal(snap.agentAction.mode, 'digest');
});
