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
import { runLink } from '../scripts/omnisense-link.mjs';
import { listOrgans } from '../../integrations/openclaw/index.mjs';

// 追踪失败数：集成测试会构造 OmniSense 身体，核心 perceive/脑网关探测经全局 fetch 留下
// undici keep-alive socket（核心既有特性），空闲 socket 会让事件循环约 60s 才回收，导致套件挂起。
// 断言在退出前已全部完成；after 里按真实成败退出，既不挂起也不掩盖失败。
let failed = 0;
function it(name, fn) {
  test(name, async (t) => {
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

after(() => process.exit(failed ? 1 : 0));
