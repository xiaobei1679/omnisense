// 多 Agent LLM 智能拆解离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMultiAgent, planSubtasks, planSubtasksSmart, ROLES } from '../src/core/agents.mjs';

test('planSubtasksSmart 注入 decompose 优先使用', async () => {
  const decompose = async () => [{ role: 'researcher', goal: '抓取X' }, { role: 'writer', goal: '写报告' }];
  const sub = await planSubtasksSmart({ models: null }, '随便目标', ['researcher', 'writer'], { decompose });
  assert.equal(sub.length, 2);
  assert.equal(sub[0].role, 'researcher');
  assert.equal(sub[1].goal, '写报告');
});

test('planSubtasksSmart decompose 抛错时退回离线拆解', async () => {
  const decompose = async () => { throw new Error('boom'); };
  const sub = await planSubtasksSmart({}, '计算 2+2 并写入 a.txt', undefined, { decompose });
  assert.ok(sub.length >= 1, '应退回离线拆解');
  assert.ok(sub.every(s => ROLES[s.role]), '退回结果角色必须合法');
});

test('planSubtasksSmart 无 decompose 无模型时走离线拆解', async () => {
  const sub = await planSubtasksSmart({}, '抓取 https://x.com 然后 计算 2+2', undefined, {});
  assert.equal(sub.length, 2, '离线拆解应按连接词拆成两句');
});

test('runMultiAgent 注入 decompose 时走智能拆解', async () => {
  const omni = { memory: { note() {} }, models: {} };
  const tools = [
    { name: 'calc', description: 'c', parameters: { type: 'object', properties: { expression: { type: 'string' } }, required: ['expression'] },
      run: async ({ expression }) => ({ expression, result: expression === '2+2' ? 4 : NaN }) },
    { name: 'write_file', description: 'w', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async ({ path, content }) => ({ ok: true, path }) },
  ];
  const decompose = async () => [{ role: 'analyst', goal: '计算 2+2' }];
  const r = await runMultiAgent(omni, { goal: '某复合目标', roles: ['analyst'], useLLM: false, tools, decompose });
  assert.equal(r.completed, true);
  assert.equal(r.subtasks.length, 1);
  assert.equal(r.subtasks[0].role, 'analyst');
});

test('runMultiAgent 默认(无 decompose/无模型)仍走离线拆解', async () => {
  const omni = { memory: { note() {} } };
  const sub = await runMultiAgent(omni, { goal: '抓取 https://x.com 然后 计算 2+2', roles: ['researcher', 'analyst'], useLLM: false, tools: [] });
  assert.equal(sub.subtasks.length, 2);
  assert.equal(sub.coordinatorMode, 'deterministic');
});
