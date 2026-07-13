import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMultiAgent, planSubtasks, classifyRole, splitClauses, filterTools, scheduleBatches, ROLES } from '../src/core/agents.mjs';
import { safeCalc } from '../src/core/tools.mjs';

// ───────── 协调器离线拆解 ─────────
test('splitClauses: 任务级连接词拆分，不拆动作级 并/且', () => {
  const g = '抓取 https://x.com 并写入 a.txt，然后计算 100/4 并写入 b.txt';
  const cs = splitClauses(g);
  assert.equal(cs.length, 2, '应拆成 2 个子句');
  assert.match(cs[0], /抓取/);
  assert.match(cs[1], /计算/);
});

test('classifyRole: 抓取类 → researcher，计算类 → analyst，写类 → writer，校验类 → critic', () => {
  assert.equal(classifyRole('抓取 https://x.com 并写入 a.txt'), 'researcher');
  assert.equal(classifyRole('计算 100/4 并写入 b.txt'), 'analyst');
  assert.equal(classifyRole('生成报告写入 b.txt'), 'writer');
  assert.equal(classifyRole('校验 a.txt 是否正确'), 'critic');
});

test('classifyRole: 不在 allowedRoles 内时回退到 allowedRoles[0]', () => {
  assert.equal(classifyRole('抓取 x', ['analyst', 'writer']), 'analyst');
  assert.equal(classifyRole('随便一句话', ['writer']), 'writer');
});

test('planSubtasks: 复合目标拆成有序角色子任务', () => {
  const sub = planSubtasks('抓取 https://x.com 并写入 a.txt，然后计算 100/4 并写入 b.txt');
  assert.equal(sub.length, 2);
  assert.equal(sub[0].role, 'researcher');
  assert.equal(sub[1].role, 'analyst');
});

test('planSubtasks: 限定 roles 时只产出启用角色', () => {
  const sub = planSubtasks('抓取 x 并写入 a，然后生成报告写入 b', ['researcher', 'writer']);
  assert.deepEqual(sub.map(s => s.role), ['researcher', 'writer']);
});

// ───────── 工具集过滤（角色能力边界）─────────
test('filterTools: 角色工具集限定生效', () => {
  const all = [{ name: 'web_fetch' }, { name: 'calc' }, { name: 'write_file' }];
  const got = filterTools(all, ROLES.analyst.tools);
  assert.ok(got.find(t => t.name === 'calc'), 'analyst 应有 calc');
  assert.ok(!got.find(t => t.name === 'web_fetch'), 'analyst 不应有 web_fetch');
});

// ───────── 多 agent 离线整体运行 ─────────
// 构造 fake omni（含记忆桩）+ 注入 fake 工具，验证协调器 → 子 agent → 黑板 全链路
function fakeOmniMulti() {
  const written = {};
  return {
    written,
    memory: { search: () => [], recall: () => null, remember: () => {}, note: () => {} },
    seeHotAll: async () => ({ topics: [] }),
  };
}
function fakeTools(omni) {
  return [
    { name: 'web_fetch', description: 'f', parameters: {}, run: async ({ url }) => ({ title: 'T:' + url, text: 'body' }) },
    { name: 'read_file', description: 'r', parameters: {}, run: async ({ path }) => ({ path, content: omni.written[path] || 'EMPTY' }) },
    { name: 'write_file', description: 'w', parameters: {}, run: async ({ path, content }) => { omni.written[path] = String(content ?? ''); return { ok: true, path, bytes: String(content ?? '').length }; } },
    { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => ({ expression, result: safeCalc(expression) }) },
    { name: 'list_dir', description: 'l', parameters: {}, run: async () => ({ entries: [] }) },
    { name: 'memory_search', description: 'ms', parameters: {}, run: async () => ({ hits: [] }) },
    { name: 'memory_remember', description: 'mr', parameters: {}, run: async ({ key, value }) => ({ ok: true, key }) },
    { name: 'now', description: 'n', parameters: {}, run: async () => ({ iso: new Date().toISOString() }) },
    { name: 'hot_topics', description: 'h', parameters: {}, run: async () => ({ topics: [] }) },
    { name: 'summarize_url', description: 's', parameters: {}, run: async ({ url }) => ({ url, summary: 'x' }) },
  ];
}

test('runMultiAgent 离线：复合目标拆成 researcher+analyst 分别完成，黑板有产出', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, {
    goal: '抓取 https://x.com 并写入 ./a.txt，然后计算 100/4 并写入 ./b.txt',
    tools: fakeTools(omni),
    useLLM: false,
  });
  assert.equal(res.subtasks.length, 2, '应有两个子任务');
  assert.deepEqual(res.subtasks.map(s => s.role), ['researcher', 'analyst']);
  assert.equal(res.allCompleted, true, '两个子任务都应完成');
  assert.equal(res.completed, true);
  assert.equal(omni.written['./a.txt'], '{"title":"T:https://x.com","text":"body"}', 'researcher 应写入抓取正文');
  assert.match(omni.written['./b.txt'], /25/, 'analyst 应写入 100/4=25');
  assert.equal(Object.keys(res.blackboard).length, 2, '黑板应记录两个子 agent 结果');
});

test('runMultiAgent 诚实：某子任务失败 → 整体 completed 为真(其他完成) 但 allCompleted 为假', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, {
    // 第二个子任务 1/0 会触发 safeCalc 抛"结果非有限数" → 该子 agent 失败
    goal: '计算 2+2 并写入 ./ok.txt，然后校验 1/0 并写入 ./bad.txt',
    tools: fakeTools(omni),
    useLLM: false,
  });
  assert.equal(res.completed, true, '至少一个子任务完成则整体有产出');
  assert.equal(res.allCompleted, false, '存在失败子任务则 allCompleted 应为假');
  const failed = res.subtasks.find(s => !s.completed);
  assert.ok(failed, '应存在一个失败子任务');
  assert.match(String(failed.result), /失败|非有限/, '失败子任务结果应说明原因');
  assert.match(omni.written['./ok.txt'], /4/, '成功子任务仍应落盘（含 2+2=4）');
});

test('runMultiAgent 诚实降级：无法拆解时给出说明而非崩溃', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, { goal: '   ', tools: fakeTools(omni) });
  assert.equal(res.subtasks.length, 0);
  assert.equal(res.completed, false);
  assert.match(String(res.result), /诚实降级|拆解/);
});

// ───────── 并行调度与协调器（本次升级）─────────
// 并发验证用的 fake：记录"同时运行"的工具数峰值(maxActive>=2 即证明真正并发)
function fakeOmniParallel() {
  const written = {};
  return {
    written,
    active: 0,
    maxActive: 0,
    memory: { search: () => [], recall: () => null, remember: () => {}, note: () => {} },
    seeHotAll: async () => ({ topics: [] }),
  };
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
function fakeToolsParallel(omni) {
  const bump = () => { omni.active++; if (omni.active > omni.maxActive) omni.maxActive = omni.active; };
  const drop = () => { omni.active--; };
  return [
    { name: 'web_fetch', description: 'f', parameters: {}, run: async ({ url }) => { bump(); await sleep(15); drop(); return { title: 'T:' + url, text: 'body' }; } },
    { name: 'read_file', description: 'r', parameters: {}, run: async ({ path }) => { bump(); await sleep(15); drop(); return { path, content: omni.written[path] || 'EMPTY' }; } },
    { name: 'write_file', description: 'w', parameters: {}, run: async ({ path, content }) => { bump(); await sleep(15); drop(); omni.written[path] = String(content ?? ''); return { ok: true, path, bytes: String(content ?? '').length }; } },
    { name: 'calc', description: 'c', parameters: {}, run: async ({ expression }) => { bump(); await sleep(15); drop(); return { expression, result: safeCalc(expression) }; } },
    { name: 'list_dir', description: 'l', parameters: {}, run: async () => { bump(); await sleep(15); drop(); return { entries: [] }; } },
    { name: 'memory_search', description: 'ms', parameters: {}, run: async () => { bump(); await sleep(15); drop(); return { hits: [] }; } },
    { name: 'memory_remember', description: 'mr', parameters: {}, run: async ({ key, value }) => { bump(); await sleep(15); drop(); return { ok: true, key }; } },
    { name: 'now', description: 'n', parameters: {}, run: async () => { bump(); await sleep(15); drop(); return { iso: new Date().toISOString() }; } },
    { name: 'hot_topics', description: 'h', parameters: {}, run: async () => { bump(); await sleep(15); drop(); return { topics: [] }; } },
    { name: 'summarize_url', description: 's', parameters: {}, run: async ({ url }) => { bump(); await sleep(15); drop(); return { url, summary: 'x' }; } },
  ];
}

test('scheduleBatches: 合成类子句归入 synthesis 批，其余为 worker', () => {
  const sub = planSubtasks('抓取 https://x.com 并写入 a.txt，然后汇总以上并写入 s.txt，同时计算 1+1 并写入 b.txt');
  const { workers, synthesis } = scheduleBatches(sub);
  assert.equal(workers.length, 2, '应有两个 worker(抓取/计算)');
  assert.equal(synthesis.length, 1, '应有一个 synthesis(汇总)');
  assert.equal(sub[synthesis[0]].role, 'writer', '汇总子句应分派到 writer');
});

test('runMultiAgent 并行：独立子任务真正并发执行(非串行等待)', async () => {
  const omni = fakeOmniParallel();
  const res = await runMultiAgent(omni, {
    goal: '抓取 https://x.com 并写入 ./a.txt，然后计算 100/4 并写入 ./b.txt',
    tools: fakeToolsParallel(omni),
    useLLM: false,
    parallel: true,
  });
  assert.ok(omni.maxActive >= 2, `两个 worker 应真正并发(maxActive=${omni.maxActive} 应>=2)`);
  assert.equal(res.parallelWorkers, 2, '并行 worker 数应为 2');
  assert.equal(res.batches, 1, '无合成子任务时应只有 1 个批(全 worker)');
  assert.equal(res.coordinatorMode, 'deterministic', '未注入协调器应为确定性');
});

test('runMultiAgent 协调器：注入 coordinator 时其输出成为最终 result', async () => {
  const omni = fakeOmniMulti();
  let calledWith = null;
  const coordinator = async ({ goal, subtasks, blackboard }) => {
    calledWith = { goal, subtaskCount: subtasks.length, boardKeys: Object.keys(blackboard).length };
    return `综合汇报: 完成 ${subtasks.filter(s => s.completed).length}/${subtasks.length} 项`;
  };
  const res = await runMultiAgent(omni, {
    goal: '抓取 https://x.com 并写入 ./a.txt，然后计算 100/4 并写入 ./b.txt',
    tools: fakeTools(omni),
    useLLM: false,
    coordinator,
  });
  assert.ok(calledWith, 'coordinator 应被调用');
  assert.equal(calledWith.subtaskCount, 2);
  assert.equal(calledWith.boardKeys, 2);
  assert.match(res.result, /综合汇报/);
  assert.equal(res.coordinatorMode, 'injected');
});

test('runMultiAgent 并行+合成：synthesis 子句把综合结果写入目标文件', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, {
    goal: '抓取 https://x.com 并写入 ./a.txt，然后计算 100/4 并写入 ./b.txt，然后汇总以上并写入 ./s.txt',
    tools: fakeTools(omni),
    useLLM: false,
  });
  assert.ok(omni.written['./s.txt'], 'synthesis 子句应写入 s.txt');
  assert.match(omni.written['./s.txt'], /https:\/\/x\.com|100\/4/, '综合内容应引用 worker 子任务(含其目标)');
  assert.equal(res.batches, 2, '应有 2 批(worker 批 + synthesis 批)');
});

test('runMultiAgent parallel:false 串行兜底：仍正确完成且标记 parallelWorkers=1', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, {
    goal: '抓取 https://x.com 并写入 ./a.txt，然后计算 100/4 并写入 ./b.txt',
    tools: fakeTools(omni),
    useLLM: false,
    parallel: false,
  });
  assert.equal(res.allCompleted, true);
  assert.equal(res.parallelWorkers, 1);
  assert.match(omni.written['./b.txt'], /25/);
});

test('runMultiAgent 默认确定性综合：result 含「多 Agent 协作完成」', async () => {
  const omni = fakeOmniMulti();
  const res = await runMultiAgent(omni, {
    goal: '计算 2+2 并写入 ./ok.txt，然后生成报告写入 ./r.txt',
    tools: fakeTools(omni),
    useLLM: false,
  });
  assert.match(String(res.result), /多 Agent 协作完成/);
  assert.equal(res.coordinatorMode, 'deterministic');
});
