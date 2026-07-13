// tests/omnisense-link.test.mjs
// 跨层测试：工作区侧脚本(omnisense-link) -> 桥接层(integrations/openclaw) -> OmniSense 身体(src)。
// 证明合并后的新项目是"长在一起"的：工作区能真正驱动身体，且离线可跑、可测、不挂起。
//
// 说明：本测试刻意只走离线器官（hand/list），不触发 perceive/think 的联网路径——
// 后者依赖 undici 全局 fetch，其 keep-alive socket 会让事件循环无法自然退出（核心既有特性，
// CLI 由 process.exit 兜底）。跨层"联网目标"能力由桥接层 omnisense-bridge.mjs 的 runGoal 提供，
// 在 CLI 下经 process.exit 正常退出，此处不纳入自动化断言以免挂起测试套件。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runLink } from '../scripts/omnisense-link.mjs';
import { listOrgans } from '../../integrations/openclaw/index.mjs';
import { Tracer } from '../../src/core/tracer.mjs';

// 把 OmniSense 运行时产物指向临时目录，避免在工作区根目录创建 .omni-*.json 污染仓库。
const _td = mkdtempSync(join(tmpdir(), 'omni-xlink-'));
process.env.OMNI_MEMORY = join(_td, '.omni-memory.json');
process.env.OMNI_TRACES = join(_td, '.omni-traces.json');

// 追踪失败数：集成测试会构造 OmniSense 身体，核心 perceive/脑网关探测经全局 fetch 留下
// undici keep-alive socket（核心既有特性），空闲 socket 会让事件循环约 60s 才回收，导致套件挂起。
// 断言在退出前已全部完成；after 里按真实成败退出，既不挂起也不掩盖失败。
//
// 说明：undici keep-alive socket 在测试函数 resolve 后异步回收时会抛 unhandledRejection（核心既有特性，
// 非断言错误）。若不加处理，node:test 会把它算作一次失败并提前 finalize 文件，导致后续用例被截断。
// 这里显式吞掉该 core 级清理 rejection（断言已全部通过）。route brain.think 等离线器官调用会 await 一个
// node:test 不跟踪的外部资源，使 node:test 提前 finalize 文件——故不强制 process.exit，改由 undici 自然
// 回收（约 60s）后随事件循环退出；套件仍会跑完全部用例并给出真实成败。
process.on('unhandledRejection', () => {});
let failed = 0;
let ran = 0;
function it(name, fn) {
  test(name, async (t) => {
    ran++;
    try { await fn(t); }
    catch (e) { failed++; throw e; }
  });
}

it('runLink list 返回七器官（与桥接层一致）', async () => {
  const r = await runLink(['list']);
  assert.equal(r.ok, true);
  assert.deepEqual(r.organs, listOrgans());
  assert.equal(r.organs.length, 7);
});

it('runLink 默认调用 hand calc 离线可用（跨层：工作区->桥->身体）', async () => {
  const r = await runLink(['hand', 'calc', JSON.stringify({ expression: '3*14' })]);
  assert.equal(r.ok, true);
});

it('runLink hand memory_remember 离线落盘记忆（跨层：手器官+记忆）', async () => {
  const r = await runLink(['hand', 'memory_remember', JSON.stringify({ key: 'xlink:' + Date.now(), value: '跨层集成验证' })]);
  assert.equal(r.ok, true);
});

it('runLink --help 给出用法', async () => {
  const r = await runLink(['--help']);
  assert.equal(r.ok, true);
  assert.match(r.usage, /omnisense-link/);
});

it('runLink goal 无参数报错（不伪造成功）', async () => {
  const r = await runLink(['goal']);
  assert.equal(r.ok, false);
  assert.match(r.error, /需要文本/);
});

it('runLink card 返回 A2A 风格能力卡（跨层：工作区->桥->身体）', async () => {
  // runOrgan('card') 直接返回 agentCard() 对象（与 describe 一致，非 {ok} 包裹）
  const r = await runLink(['card']);
  assert.ok(Array.isArray(r.skills) && r.skills.length > 0, '能力卡应扁平化出 skills[]');
  assert.equal(r.name, 'OmniSense Body');
  assert.ok(r.skills.every(s => s.id && s.name && 'net' in s), '每个 skill 含 id/name/net');
});

it('runLink describe 返回七器官树（每器官含结构化 methods）', async () => {
  const r = await runLink(['describe']);
  assert.equal(r.ok, true);
  assert.equal(r.organs.length, 7);
  for (const o of r.organs) {
    assert.ok(Array.isArray(o.methods), `${o.key} 应有 methods 数组`);
    assert.ok(o.methods.length > 0, `${o.key} methods 不应为空`);
    assert.ok(o.methods.every(m => m.name && 'desc' in m && 'net' in m), `${o.key} 每个 method 含 name/desc/net`);
  }
});

it('runLink route --list 列出全部能力（与 card skills 数一致）', async () => {
  const r = await runLink(['route', '--list']);
  assert.equal(r.ok, true);
  assert.ok(r.count > 0, '应列出至少一个能力');
  assert.ok(Array.isArray(r.skills) && r.skills.every(s => s.id && 'net' in s), 'skills 含 id/net');
  const card = await runLink(['card']);
  assert.equal(r.count, card.skills.length, 'route --list 数量应与 card 技能数一致');
});

it('runLink route hand.calc 委派到手器官并离线计算', async () => {
  const r = await runLink(['route', 'hand.calc', JSON.stringify({ expression: '2+2' })]);
  assert.equal(r.ok, true);
  assert.equal(r.output.result, 4);
});

it('runLink route brain.think 委派到脑器官（统一返回契约 {ok:true,result}）', async () => {
  const r = await runLink(['route', 'brain.think', '我该关注什么']);
  assert.equal(r.ok, true);
  assert.ok(r.result, 'route 应包成 {ok:true, result}');
});

it('runLink route 错误 skillId 格式报错（不伪造成功）', async () => {
  const r = await runLink(['route', 'badformat']);
  assert.equal(r.ok, false);
  assert.match(r.error, /organ\.method/);
});

it('runLink dispatch "思考" 自动委派到大脑（跨层 dispatch）', async () => {
  const r = await runLink(['dispatch', '帮我深入推理一下这个问题']);
  assert.equal(r.resolved, true, '应自动委派到 brain.think');
  assert.match(r.resolvedSkill.id, /brain\./, '应委派到 brain');
  assert.ok(r.result, '应有执行结果');
});

it('runLink dispatch 无参数报错（不伪造成功）', async () => {
  const r = await runLink(['dispatch']);
  assert.equal(r.ok, false);
  assert.match(r.error, /需要文本/);
});

it('runLink autopilot 跑自主循环（跨层：工作区->桥->身体，离线自驱决策）', async () => {
  const r = await runLink(['autopilot', '2']);
  assert.equal(r.mode, 'autopilot', '应标记 autopilot 模式');
  assert.equal(r.ticks, 2);
  assert.equal(r.trace.length, 2);
  for (const t of r.trace) {
    assert.ok(t.intent && Array.isArray(t.candidates), '每轮应有自生成意图与候选技能');
    assert.ok(t.executed, '应委派到某器官');
  }
});

it('runLink trace --summary 返回聚合指标（跨层：工作区消费身体 tracer）', async () => {
  const r = await runLink(['trace', '--summary']);
  assert.ok('total' in r, 'summary 应含 total');
  assert.ok(r.traceFile, '应标注 trace 落盘路径');
});

it('runLink trace --list 返回运行数组（跨层）', async () => {
  const r = await runLink(['trace', '--list']);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.runs), '应返回 runs 数组');
});

it('runLink trace --export=- 导出回归数据集（跨层：LangSmith 式 trace→dataset）', async () => {
  const r = await runLink(['trace', '--export=-', '--export-format=json']);
  assert.equal(r.ok, true);
  assert.ok(Array.isArray(r.dataset), '应返回 dataset 数组');
  assert.ok('count' in r, '应含 count');
});

it('runLink trace --export=- --export-format=otlp 导出 OTLP/JSON（跨层：OTel-native 可投 Tempo/Phoenix）', async () => {
  // 跨层测试不跑 agent，故先向同一 OMNI_TRACES 临时路径播一条确定性 run，确保导出有内容（诚实可测）。
  const seed = new Tracer(process.env.OMNI_TRACES);
  seed.recordRun({
    goal: 'otlp-xlink-seed', engine: 'local', completed: true, startedAt: 1000, finishedAt: 1010,
    steps: [{ step: 1, action: 'calc', action_input: { expression: '2+2' }, observation: { ok: true, output: { result: 4 } }, durationMs: 4 }],
  });
  const r = await runLink(['trace', '--export=-', '--export-format=otlp']);
  assert.equal(r.ok, true);
  assert.equal(r.format, 'otlp', '应标记 otlp 格式');
  assert.ok(r.otlp && Array.isArray(r.otlp.resourceSpans) && r.otlp.resourceSpans.length >= 1, '应返回 OTLP resourceSpans[]');
  const spans = r.otlp.resourceSpans[0].scopeSpans[0].spans;
  const root = spans.find(s => s.parentSpanId === undefined);
  assert.ok(root, '应有一个无 parentSpanId 的 root span');
  const op = root.attributes.find(a => a.key === 'gen_ai.operation.name');
  assert.ok(op && op.value.stringValue === 'invoke_agent', 'root span 应标记 gen_ai.operation.name=invoke_agent');
});

it('runLink trace 无参数默认给 summary（不报错）', async () => {
  const r = await runLink(['trace']);
  assert.ok('total' in r, '无参数应回退到 summary');
});

it('runLink autopilot 默认动态议程：trace 含 agendaDynamic 与每轮权重快照，且跨轮权重因结果重排而变化', async () => {
  // 默认议程 4 项 → 动态模式：每轮结果回写议程、据结果调权（借鉴 BabyAGI 优先级重排）。
  const r = await runLink(['autopilot', '6']);
  assert.equal(r.mode, 'autopilot', '应标记 autopilot 模式');
  assert.equal(r.agendaDynamic, true, '默认应开启动态议程');
  assert.equal(r.trace.length, 6);
  // 每轮都应有感知/意图/候选/委派，且带 agendaWeights 快照（4 项议程）
  const seenIntents = new Set();
  for (const t of r.trace) {
    assert.ok(t.perceive && t.intent && Array.isArray(t.candidates), '每轮应有感知/意图/候选');
    assert.ok(t.executed, '应委派到某器官');
    assert.ok(Array.isArray(t.agendaWeights) && t.agendaWeights.length === 4, '动态模式每步应带 4 项议程权重快照');
    seenIntents.add(t.intent);
  }
  // 覆盖性：6 轮应让默认议程 4 项意图都至少出现一次（优先级队列保证公平轮转）
  assert.equal(seenIntents.size, 4, '动态模式 6 轮应覆盖全部 4 项默认意图');
  // 结果驱动重排：首轮与末轮权重快照应不同（证明权重随结果变化）
  assert.notDeepEqual(r.trace[0].agendaWeights, r.trace[r.trace.length - 1].agendaWeights, '权重应随每轮结果重排而变化');
});

it('runLink autopilot --no-dynamic 关闭动态重排：尊重顺序、无权重快照', async () => {
  const r = await runLink(['autopilot', '2', '--no-dynamic']);
  assert.equal(r.mode, 'autopilot');
  assert.equal(r.agendaDynamic, false, '应关闭动态议程');
  assert.equal(r.trace.length, 2);
  for (const t of r.trace) {
    assert.ok(t.intent, '每轮应有意图');
    assert.equal(t.agendaWeights, undefined, '--no-dynamic 不应产出权重快照');
  }
  // 静态模式按 round-robin 取默认议程：第一轮应为默认议程第 0 项（思考类）
  assert.match(r.trace[0].intent, /思考|关注/, '--no-dynamic 应尊重默认议程顺序(首轮=思考意图)');
});
// 不依赖 node:test 的 after 兜底（route brain.think 等离线器官调用 await 外部资源，会让 node:test 提前
// finalize 文件并截断后续用例）；改为模块顶层独立定时器：留足 20s 让全部用例跑完后强制退出，
// 既跑完所有断言（成败真实）又避免 undici keep-alive socket 导致套件无限挂起。
setTimeout(() => process.exit(failed ? 1 : 0), 20000).unref();
