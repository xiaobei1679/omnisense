// watch 联网抓新热点 URL 并摘要 离线单测（node --test，不触网；用 stub 模拟联网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeNewTopics, synthesizeAgentGoal, runWatchTick } from '../src/core/watch.mjs';

test('summarizeNewTopics 对带 url 话题联网摘要(best-effort)', async () => {
  const omni = { summarizeWebsite: async (url) => ({ summary: '摘要:' + url.slice(0, 20), url }) };
  const topics = [{ title: '话题A', url: 'https://s.weibo.com/weibo?q=A' }];
  const out = await summarizeNewTopics(omni, topics, { maxWords: 30 });
  assert.equal(out.length, 1);
  assert.match(out[0].summary, /摘要/);
  assert.equal(out[0].url, 'https://s.weibo.com/weibo?q=A');
});

test('summarizeNewTopics 无 summarizeWebsite 时诚实标记', async () => {
  const out = await summarizeNewTopics({}, [{ title: 't', url: 'https://x.com' }]);
  assert.equal(out[0].error, 'summarizeWebsite 不可用');
});

test('summarizeNewTopics 单条失败不影响其余', async () => {
  const omni = {
    summarizeWebsite: async (url) => {
      if (url.includes('ok')) return { summary: '好' };
      throw new Error('抓取失败');
    },
  };
  const out = await summarizeNewTopics(omni, [
    { title: 'a', url: 'https://x.com/ok' },
    { title: 'b', url: 'https://x.com/bad' },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].summary, '好');
  assert.match(out[1].error, /抓取失败/);
});

test('synthesizeAgentGoal digest 模式附带新增热点摘要', () => {
  const g = synthesizeAgentGoal([{ title: 'A' }], null, {
    mode: 'digest', diff: { added: ['A'], removed: [] },
    summaries: [{ title: 'A', url: 'https://x.com', summary: '这是摘要' }],
  });
  assert.match(g, /新增热点摘要/);
  assert.match(g, /这是摘要/);
});

test('runWatchTick digest + summarizeNew 把摘要写入快照', async () => {
  const omni = {
    seeHotAll: async () => ({ topics: [{ title: '新话题', url: 'https://s.weibo.com/weibo?q=新话题' }], freq: {} }),
    sense: () => ({}),
    plan: () => ({ actions: [] }),
    act: async (goal) => ({ completed: true, usedLLM: false, reused: false, result: 'ok:' + goal }),
    summarizeWebsite: async (url) => ({ summary: '联网摘要:' + url }),
  };
  const snap = await runWatchTick(omni, { agent: true, agentMode: 'digest', summarizeNew: true, prevSig: undefined });
  assert.ok(snap.newSummaries.length >= 1, '应抓到新增热点摘要');
  assert.match(snap.newSummaries[0].summary, /联网摘要/);
  assert.ok(snap.agentAction.fired, 'digest 首轮应播种并写入');
});

test('runWatchTick summarizeNew 关闭时 newSummaries 为空', async () => {
  const omni = {
    seeHotAll: async () => ({ topics: [{ title: '新话题', url: 'https://x.com' }], freq: {} }),
    sense: () => ({}), plan: () => ({ actions: [] }),
    act: async () => ({ completed: true, usedLLM: false, reused: false, result: 'ok' }),
    summarizeWebsite: async () => ({ summary: 'x' }),
  };
  const snap = await runWatchTick(omni, { agent: true, agentMode: 'digest', summarizeNew: false, prevSig: undefined });
  assert.equal(snap.newSummaries.length, 0, '未开启 summarizeNew 不应联网');
});
