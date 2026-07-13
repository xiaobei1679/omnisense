// Agent 内核离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent, localPlan, recallContext, makeLLMReasoner } from '../src/core/agent.mjs';
import { safeCalc } from '../src/core/tools.mjs';
import { Memory } from '../src/core/memory.mjs';

// 最小 fake omni：带可落盘的记忆桩（remember 键记入 _keys 便于断言 playbook 沉淀）
function makeOmni() {
  const store = {};
  const notes = [];
  const _keys = [];
  return {
    _keys,
    memory: {
      remember: (k, v) => { store[k] = v; _keys.push(k); return v; },
      note: (t) => notes.push(t),
      search: (q) => Object.entries(store).filter(([k, v]) => String(k).includes(q) || String(v).includes(q)).map(([k, v]) => ({ key: k, value: v })),
      recall: (k) => store[k],
    },
  };
}

test('localPlan: 计算目标拆出 calc 步骤', () => {
  const p = localPlan('帮我计算 2+2 等于多少');
  assert.ok(p && p.length === 1 && p[0].tool === 'calc');
  assert.equal(p[0].args.expression, '2+2');
});

test('localPlan: 抓取+写入拆出两步且含 {prev} 链式', () => {
  const p = localPlan('抓取 https://example.com 并写入 /tmp/x.txt');
  assert.ok(p && p.length === 2);
  assert.equal(p[0].tool, 'web_fetch');
  assert.equal(p[1].tool, 'write_file');
  assert.equal(p[1].args.content, '{prev}');
});

test('localPlan: 无法解析的目标返回 null', () => {
  assert.equal(localPlan('帮我写一首关于春天的诗'), null);
});

test('runAgent 本地规划器离线完成计算目标', async () => {
  const omni = makeOmni();
  const r = await runAgent(omni, { goal: '计算 2+2', useLLM: false });
  assert.equal(r.completed, true);
  assert.equal(r.usedLLM, false);
  assert.match(String(r.result), /4/);
  // playbook 沉淀
  assert.ok(omni._keys.some(k => k.startsWith('playbook:')));
});

test('runAgent 本地规划器完成 抓取+写入 多步任务', async () => {
  const omni = makeOmni();
  const dir = mkdtempSync(join(tmpdir(), 'omni-agent-'));
  const dst = join(dir, 'out.txt');
  // 自定义工具：web_fetch 桩返回固定内容，write_file 用真实 fs
  const tools = [
    { name: 'web_fetch', description: 'fetch', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async ({ url }) => ({ title: 'Example', text: 'Example Domain body' }) },
    { name: 'write_file', description: 'write', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async ({ path, content }) => { writeFileSync(path, String(content)); return { ok: true, path, bytes: String(content).length }; } },
  ];
  const r = await runAgent(omni, { goal: `抓取 https://example.com 并写入 ${dst}`, useLLM: false, tools });
  assert.equal(r.completed, true);
  const written = readFileSync(dst, 'utf8');
  assert.ok(written.includes('Example'), '写入内容应包含上一步抓取的标题');
  rmSync(dir, { recursive: true, force: true });
});

test('runAgent ReAct 闭环：注入 reasoner 驱动 calc→final', async () => {
  const omni = makeOmni();
  let calls = 0;
  const reasoner = async (goal, history) => {
    calls++;
    if (history.length === 0) return { thought: '先算一下', action: 'calc', action_input: { expression: '2+2' } };
    return { thought: '已拿到结果', action: null, final_answer: '结果是4' };
  };
  const r = await runAgent(omni, { goal: '计算 2+2', reasoner });
  assert.equal(r.usedLLM, true);
  assert.equal(r.completed, true);
  assert.equal(r.steps.length, 2); // 1次工具 + 1次 final
  assert.equal(r.result, '结果是4');
  assert.ok(calls >= 2);
});

test('runAgent ReAct 每步二次经验召回：观察触发的经验并入 experienceHints', async () => {
  // 记忆桩：目标文本本身搜不到，但观察文本(Example Domain)能召回一条历史经验
  const store = {};
  const memory = {
    remember: (k, v) => { store[k] = v; return v; },
    note: () => {},
    recall: (k) => store[k],
    search: (q) => String(q).includes('Example Domain')
      ? [{ type: 'note', text: '[agent-experience] 曾处理过 Example Domain 页面，标题提取可靠', score: 0.9 }]
      : [],
  };
  const omni = { memory };
  const tools = [
    { name: 'web_fetch', description: 'fetch', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async () => ({ title: 'Example', text: 'Example Domain body' }) },
  ];
  // 第一步 fetch，第二步 final；第二步应已拿到"上一步观察召回的经验"
  const reasoner = async (goal, history, stepCtx) => {
    if (history.length === 0) return { thought: '先抓取', action: 'web_fetch', action_input: { url: 'https://example.com' } };
    return { thought: '已拿到', action: null, final_answer: 'ok:' + (stepCtx ? 'hasStepCtx' : 'noStepCtx') };
  };
  const r = await runAgent(omni, { goal: '抓取 example.com', reasoner, tools });
  assert.equal(r.completed, true);
  // 初始目标召回为空，仅"每步二次召回"会注入这条经验 → 证明二次召回已生效
  assert.ok(r.experienceHints.some(t => t.includes('Example Domain')), '观察触发的二次经验应并入 experienceHints');
  assert.match(String(r.result), /hasStepCtx/);
});

test('runAgent reasoner 不可用(AGENT_DRIVE)时诚实降级到本地规划器', async () => {
  const omni = makeOmni();
  const reasoner = async () => { throw new Error('AGENT_DRIVE'); };
  const r = await runAgent(omni, { goal: '计算 3*3', reasoner, useLLM: true });
  assert.equal(r.usedLLM, false);   // 已转本地
  assert.equal(r.completed, true);
  assert.match(String(r.result), /9/);
});

test('runAgent 两路都失败：诚实告知无法完成，绝不伪造成功', async () => {
  const omni = makeOmni();
  const r = await runAgent(omni, { goal: '写一首关于星空的诗', useLLM: false });
  assert.equal(r.completed, false);
  assert.match(String(r.result), /诚实降级|无法/);
});

// ───────── v2 通用意图分解 / 越用越强 ─────────
test('localPlan: 复合目标 计算+写入 拆两步', () => {
  const p = localPlan('计算 3*7 并写入 r.txt');
  assert.ok(p && p.length === 2);
  assert.equal(p[0].tool, 'calc');
  assert.equal(p[0].args.expression, '3*7');
  assert.equal(p[1].tool, 'write_file');
  assert.equal(p[1].args.path, 'r.txt');
  assert.equal(p[1].args.content, '{prev}');
});

test('localPlan: 复合目标 读文件+写入（复制）拆两步', () => {
  const p = localPlan('读 src.txt 并写入 dst.txt');
  assert.ok(p && p.length === 2);
  assert.equal(p[0].tool, 'read_file');
  assert.equal(p[1].tool, 'write_file');
  assert.equal(p[1].args.content, '{prev}');
});

test('runAgent 本地规划器完成 计算+写入 复合目标', async () => {
  const omni = makeOmni();
  const written = {};
  const tools = [
    { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => ({ result: safeCalc(expression) }) },
    { name: 'write_file', description: 'w', parameters: {}, run: async ({ path, content }) => { written[path] = content; return { ok: true, path }; } },
  ];
  const r = await runAgent(omni, { goal: '计算 3*7 并写入 r.txt', useLLM: false, tools });
  assert.equal(r.completed, true);
  assert.match(String(written['r.txt']), /21/);
});

test('runAgent 越用越强：高相似目标直接复用历史 playbook（参数迁移）', async () => {
  const omni = makeOmni();
  // 模拟"上次已完成过"沉淀的打法
  omni.memory.remember('playbook:abc', {
    goal: '抓取 https://example.com 并写入 a.txt',
    steps: [
      { action: 'web_fetch', action_input: { url: 'https://example.com' } },
      { action: 'write_file', action_input: { path: 'a.txt', content: '{prev}' } },
    ],
    at: Date.now(),
  });
  const written = {};
  const tools = [
    { name: 'web_fetch', description: 'f', parameters: {}, run: async ({ url }) => ({ title: 'ExampleOrg', text: 'body' }) },
    { name: 'write_file', description: 'w', parameters: {}, run: async ({ path, content }) => { written[path] = content; return { ok: true, path }; } },
  ];
  const r = await runAgent(omni, { goal: '抓取 https://example.org 并写入 b.txt', useLLM: false, tools });
  assert.equal(r.completed, true);
  assert.equal(r.reused, true, '应标记复用 playbook');
  assert.ok(r.playbookScore >= 0.5, '应达到高相似阈值');
  assert.notEqual(written['b.txt'], undefined, '参数应迁移到新路径 b.txt');
  assert.match(String(written['b.txt']), /ExampleOrg/, '内容应来自新抓取');
});

test('runAgent 复用后 hitCount 累积到被复用的 playbook', async () => {
  const omni = makeOmni();
  omni.memory.remember('playbook:abc', {
    goal: '抓取 https://example.com 并写入 a.txt',
    steps: [{ action: 'web_fetch', action_input: { url: 'https://example.com' } }, { action: 'write_file', action_input: { path: 'a.txt', content: '{prev}' } }],
    at: Date.now(), hitCount: 0,
  });
  const tools = [
    { name: 'web_fetch', description: 'f', parameters: {}, run: async () => ({ title: 'X', text: 'y' }) },
    { name: 'write_file', description: 'w', parameters: {}, run: async () => ({ ok: true }) },
  ];
  await runAgent(omni, { goal: '抓取 https://example.org 并写入 b.txt', useLLM: false, tools });
  const pb = omni.memory.recall('playbook:abc');
  assert.equal(pb.hitCount, 1, '复用应使被复用 playbook 的 hitCount+1');
  assert.equal(pb.reused, true);
});

test('runAgent 越用越强：计算+写入 复用后落盘是最新表达式（模板未被静态值覆盖）', async () => {
  // 复现真实沉淀路径（之前会把已解析的静态内容存进 playbook，导致复用写出陈旧值）—— 验证已修复
  const omni = makeOmni();
  const written = {};
  const tools = [
    { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => ({ expression, result: safeCalc(expression) }) },
    { name: 'write_file', description: 'w', parameters: {}, run: async ({ path, content }) => { written[path] = content; return { ok: true, path }; } },
  ];
  // ① 首轮沉淀 playbook（100/4）
  const r1 = await runAgent(omni, { goal: '计算 100/4 并写入 r.txt', useLLM: false, tools });
  assert.equal(r1.reused, false);
  assert.match(String(written['r.txt']), /100\/4/, '首轮落盘应包含 100/4');
  // ② 第二轮高相似复用 → 参数迁移到 200/8
  for (const k of Object.keys(written)) delete written[k];
  const r2 = await runAgent(omni, { goal: '计算 200/8 并写入 r.txt', useLLM: false, tools });
  assert.equal(r2.reused, true, '应复用历史 playbook');
  assert.match(String(written['r.txt']), /200\/8/, '复用后落盘必须是新表达式 200/8');
  assert.doesNotMatch(String(written['r.txt']), /100\/4/, '复用后不应残留旧表达式 100/4');
  // ③ 第三轮再次复用 → 模板未被前一次覆盖，仍写最新值 300/6
  for (const k of Object.keys(written)) delete written[k];
  const r3 = await runAgent(omni, { goal: '计算 300/6 并写入 r.txt', useLLM: false, tools });
  assert.equal(r3.reused, true, '第三轮仍应复用');
  assert.match(String(written['r.txt']), /300\/6/, '第三次复用仍应写最新表达式，证明模板未被静态值覆盖');
});

// ───────── 记忆经验召回（v3 地基 → 推理上层闭环）─────────
test('recallContext: 召回相关经验、排除 playbook', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-memtest-'));
  try {
    const mem = new Memory(join(dir, 'mem.json'));
    mem.note('经验: 计算并写入结果是常见任务 → 工具序列[calc, write_file]', 'agent-experience');
    mem.remember('playbook:xyz', { goal: '计算 100/4 并写入 r.txt', steps: [{ action: 'calc', action_input: { expression: '100/4' } }], at: Date.now() });
    const ctx = recallContext('计算 200/8 并写入文件', mem, 3);
    assert.ok(ctx.items.length >= 1, '应召回至少一条经验');
    assert.ok(ctx.items.some(it => it.text.includes('工具序列')), '应召回经验笔记');
    assert.ok(!ctx.items.some(it => String(it.key || '').startsWith('playbook:')), '不应把 playbook 当作经验');
    assert.match(ctx.ctxText, /工具序列/);
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});

test('makeLLMReasoner: 把召回经验注入 system 上下文', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-memtest-'));
  try {
    const mem = new Memory(join(dir, 'mem.json'));
    mem.note('经验: 抓取网页并写入文件是常见组合 → 工具序列[web_fetch, write_file]', 'agent-experience');
    const exp = recallContext('抓取 example.com 并写入 a.txt', mem, 3);
    let captured = null;
    const omni = { models: { chat: async (msgs) => { captured = msgs; return '{}'; } } };
    const tools = [{ name: 'web_fetch', description: 'f', parameters: {} }, { name: 'write_file', description: 'w', parameters: {} }];
    const reasoner = makeLLMReasoner(omni, tools, null, exp);
    await reasoner('抓取 example.com 并写入 a.txt', []);
    assert.ok(captured && captured[0]?.role === 'system', '首条消息应为 system');
    assert.match(captured[0].content, /已知相关经验/, 'system 应含经验注入段');
    assert.match(captured[0].content, /web_fetch, write_file/, '经验文本应进入上下文');
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});

test('runAgent: 完成后沉淀经验笔记(agent-experience)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-memtest-'));
  try {
    const omni = { memory: new Memory(join(dir, 'mem.json')) };
    const tools = [
      { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => ({ expression, result: safeCalc(expression) }) },
      { name: 'write_file', description: 'w', parameters: {}, run: async () => ({ ok: true }) },
    ];
    const r = await runAgent(omni, { goal: '计算 3*7 并写入 r.txt', useLLM: false, tools });
    assert.equal(r.completed, true);
    const expNotes = omni.memory.notes.filter(n => n.tag === 'agent-experience');
    assert.ok(expNotes.length >= 1, '应沉淀一条经验笔记');
    assert.match(expNotes[0].text, /工具序列\[calc, write_file\]/, '经验笔记应记录工具序列');
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});

test('runAgent: 预置相关经验时，返回 experienceHints 含该经验', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-memtest-'));
  try {
    const omni = { memory: new Memory(join(dir, 'mem.json')) };
    omni.memory.note('经验: 计算并写入结果是常见任务 → 工具序列[calc, write_file]', 'agent-experience');
    const tools = [
      { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => ({ result: safeCalc(expression) }) },
      { name: 'write_file', description: 'w', parameters: {}, run: async () => ({ ok: true }) },
    ];
    const r = await runAgent(omni, { goal: '计算 5+5 并写入 out.txt', useLLM: false, tools });
    assert.equal(r.completed, true);
    assert.ok(Array.isArray(r.experienceHints), '应返回 experienceHints 数组');
    assert.ok(r.experienceHints.some(h => h.includes('工具序列')), 'hints 应包含召回的相关经验');
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch {} }
});

test('runAgent 二次召回影响本地规划器：经验工具序列让不可正则解析的目标也能执行', async () => {
  const store = {};
  const notes = [];
  const memory = {
    remember: (k, v) => { store[k] = v; return v; },
    note: (t, tag) => notes.push({ t, tag, text: t }),
    recall: (k) => store[k],
    // 经验检索：目标含 example.com 时命中那条经验笔记（含 工具序列[...]）
    search: (q) => {
      const out = [];
      if (String(q).includes('example.com')) out.push({ type: 'note', text: '经验: 示例网 example.com → 工具序列[web_fetch, write_file]' });
      return out;
    },
  };
  const omni = { memory };
  const dir = mkdtempSync(join(tmpdir(), 'omni-hint-'));
  const dst = join(dir, 'out.txt');
  // 目标含 URL + .txt 路径，但故意不含"抓取/写入"动词 → 正则 localPlan 返回 null，须靠经验工具序列重建步骤
  const goal = `https://example.com 然后 ${dst}`;
  const tools = [
    { name: 'web_fetch', description: 'f', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async ({ url }) => ({ title: 'Example', text: 'Example Domain body' }) },
    { name: 'write_file', description: 'w', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
      run: async ({ path, content }) => { writeFileSync(path, String(content)); return { ok: true, path, bytes: String(content).length }; } },
  ];
  const r = await runAgent(omni, { goal, useLLM: false, tools });
  assert.equal(r.completed, true, '经验工具序列应驱动规划器完成 抓取+写入');
  const written = readFileSync(dst, 'utf8');
  assert.ok(written.includes('Example'), '应写入抓取到的内容');
  rmSync(dir, { recursive: true, force: true });
});

