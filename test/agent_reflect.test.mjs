// Agent 自我反思（reflect）单测——全部离线，不触网。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reflect } from '../src/core/agent.mjs';

// 构造最小 omni（记忆桩）
function fakeOmni(extra = {}) {
  const notes = [];
  return {
    memory: {
      note: (text, tag) => { notes.push({ text, tag }); return true; },
      notes,
    },
    ...extra,
  };
}

const failedTrace = [
  { step: 1, action: 'web_fetch', action_input: { url: 'https://x.com' }, observation: { ok: false, error: 'ENOTFOUND' } },
  { step: 2, action: 'web_fetch', action_input: { url: 'https://x.com' }, observation: { ok: false, error: 'ENOTFOUND' } },
];
const successReusedTrace = [
  { step: 1, action: 'calc', action_input: { expression: '2+2' }, observation: { ok: true, output: { expression: '2+2', result: 4 } } },
  { step: 2, action: 'write_file', action_input: { path: 'r.txt', content: '4' }, observation: { ok: true, output: { ok: true, path: 'r.txt', bytes: 1 } } },
];

test('offline 反思：失败轨迹产出 failure 教训且模式为 offline', async () => {
  const omni = fakeOmni();
  const r = await reflect(omni, { goal: '抓取 x', trace: failedTrace, completed: false, usedLLM: false, reused: false });
  assert.equal(r.enabled, true);
  assert.equal(r.mode, 'offline');
  assert.ok(r.lessons.some(l => l.type === 'failure' && l.text.includes('web_fetch')), '应包含 web_fetch 失败教训');
  assert.ok(r.lessons.some(l => l.type === 'open'), '未完成应给出 open 教训');
  assert.equal(r.note, true, '教训应写入记忆');
  assert.ok(omni.memory.notes.length > 0);
});

test('offline 反思：成功+复用轨迹产出 success 教训', async () => {
  const omni = fakeOmni();
  const r = await reflect(omni, { goal: '算 2+2 写入 r', trace: successReusedTrace, completed: true, usedLLM: false, reused: true });
  assert.equal(r.mode, 'offline');
  assert.ok(r.lessons.some(l => l.type === 'success' && l.text.includes('playbook')), '应包含复用成功教训');
});

test('LLM 反思：models.chat 可用时走 llm 模式并采纳模型产出', async () => {
  const omni = fakeOmni({
    models: {
      chat: async () => JSON.stringify([
        { type: 'failure', text: '网络重试策略缺失' },
        { type: 'info', text: '该任务可离线完成' },
      ]),
    },
  });
  const r = await reflect(omni, { goal: '抓取 x', trace: failedTrace, completed: false });
  assert.equal(r.mode, 'llm', '应走 LLM 模式');
  assert.equal(r.lessons.length, 2, '应采纳模型给出的 2 条');
  assert.equal(r.lessons[0].text, '网络重试策略缺失');
});

test('LLM 反思失败：chat 抛错时退回离线启发式且不抛异常', async () => {
  const omni = fakeOmni({
    models: { chat: async () => { throw new Error('BUILTIN_UNAVAILABLE'); } },
  });
  const r = await reflect(omni, { goal: '抓取 x', trace: failedTrace, completed: false });
  assert.equal(r.fallback, true, '应标记已退回离线');
  assert.equal(r.mode, 'offline');
  assert.ok(r.lessons.some(l => l.type === 'failure'), '离线启发式仍应产出 failure 教训');
});

test('LLM 反思返回非数组：退回离线结果', async () => {
  const omni = fakeOmni({ models: { chat: async () => '不是合法 JSON 数组' } });
  const r = await reflect(omni, { goal: '抓取 x', trace: failedTrace, completed: false });
  assert.equal(r.mode, 'offline');
  assert.ok(r.lessons.length > 0);
});

test('reflect:false（remember=false）时不写记忆笔记', async () => {
  const omni = fakeOmni();
  const r = await reflect(omni, { goal: '抓取 x', trace: failedTrace, completed: false, remember: false });
  assert.equal(r.note, false, 'remember=false 不应写笔记');
  assert.equal(omni.memory.notes.length, 0);
});

test('无记忆时反思不抛异常（纯计算，enabled 但 note=false）', async () => {
  const r = await reflect({}, { goal: '抓取 x', trace: failedTrace, completed: false });
  assert.equal(r.enabled, true);
  assert.equal(r.note, false);
  assert.ok(r.lessons.some(l => l.type === 'failure'));
});
