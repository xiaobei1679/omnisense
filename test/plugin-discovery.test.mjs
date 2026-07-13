// 工具自发现（插件）冒烟测试：验证 src/tools/ 下的 .mjs 模块被自动注册为 hand 工具。
// 离线、确定性、不触网。
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDefaultTools, executeTool, toolSpecs } from '../src/core/tools.mjs';

test('内置插件 hash 被自动发现并在 handList 中可见', () => {
  const tools = buildDefaultTools({ memory: null });
  const names = toolSpecs(tools).map(t => t.name);
  assert.ok(names.includes('hash'), 'hash 插件应被自动发现，实际: ' + names.join(','));
});

test('插件 hash 可离线执行并返回正确 SHA-256', async () => {
  const tools = buildDefaultTools({ memory: null });
  const r = await executeTool(tools, 'hash', { text: 'abc' });
  assert.equal(r.ok, true);
  assert.equal(r.output.algo, 'sha256');
  // SHA-256("abc")
  assert.equal(
    r.output.digest,
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('未知插件名不影响内置工具，且 executeTool 对未知工具返回 ok:false', async () => {
  const tools = buildDefaultTools({ memory: null });
  assert.ok(toolSpecs(tools).some(t => t.name === 'calc'), '内置 calc 应仍在');
  const r = await executeTool(tools, 'no_such_plugin', {});
  assert.equal(r.ok, false);
  assert.match(r.error, /未知工具/);
});
