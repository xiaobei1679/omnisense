// 集成冒烟测试：integrations/openclaw 桥接层（离线、确定性、不触网）
// 验证 OmniSense 七器官桥接能真正驱动 src/body.mjs 的真实实现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { runOrgan } from '../integrations/openclaw/omni-body.mjs';
import { runGoal } from '../integrations/openclaw/omnisense-bridge.mjs';
import { ORGANS, listOrgans } from '../integrations/openclaw/index.mjs';

test('hand calc：离线确定性计算', async () => {
  const r = await runOrgan('hand', ['calc', '{"expression":"2+2"}']);
  assert.equal(r.ok, true);
  assert.equal(r.output.result, 4);
});

test('hand calc：支持函数与常量', async () => {
  const r = await runOrgan('hand', ['calc', '{"expression":"sqrt(16)+pi"}']);
  assert.equal(r.ok, true);
  assert.ok(Math.abs(r.output.result - (4 + Math.PI)) < 1e-9);
});

test('hand 未知工具：优雅返回错误（不抛进程异常）', async () => {
  const r = await runOrgan('hand', ['no_such_tool', '{}']);
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});

test('perceive：离线聚合环境不抛错', async () => {
  const r = await runOrgan('perceive');
  assert.ok(r && typeof r === 'object');
});

test('describe：返回八器官（七器官 + 监控）清单', async () => {
  const r = await runOrgan('describe');
  assert.equal(r.length, 8);
  const keys = r.map(o => o.key);
  for (const k of ['eye', 'ear', 'mouth', 'brain', 'hand', 'perceive', 'foot', 'monitor']) {
    assert.ok(keys.includes(k), '缺少器官: ' + k);
  }
});

test('live：离线跑 1 轮生命循环不挂起', async () => {
  const r = await runOrgan('live', ['{"ticks":1}']);
  assert.equal(r.ticks, 1);
  assert.equal(r.trace.length, 1);
});

test('runGoal：感知→思考→动手 返回 trace（离线）', async () => {
  const r = await runGoal('记录一条集成测试记忆', { useLLM: false });
  assert.equal(r.goal, '记录一条集成测试记忆');
  assert.ok(r.trace, '应有 trace');
  // 感知必须已 await 解析，不能是未决 Promise
  assert.ok(!(r.trace.perceive instanceof Promise), 'trace.perceive 不能是未决 Promise');
  assert.ok(r.trace.perceive, '应已感知');
  assert.ok('think' in r.trace, 'trace 应含 think');
});

test('barrel index：导出八器官（七器官 + 监控）清单且不被外部篡改', () => {
  assert.deepEqual(ORGANS, ['eye', 'ear', 'mouth', 'brain', 'hand', 'perceive', 'foot', 'monitor']);
  const copy = listOrgans();
  copy.push('hacked');
  assert.equal(ORGANS.length, 8, '原常量不应被 listOrgans 返回值影响');
});
