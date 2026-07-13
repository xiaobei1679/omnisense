// 工具执行器离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDefaultTools, executeTool, safeCalc, toolCacheStats, clearToolCache, toolBreakerStatus, resetToolBreakers } from '../src/core/tools.mjs';

const fakeOmni = { memory: { store: {}, search(q){ return Object.entries(this.store).filter(([k,v])=>k.includes(q)||String(v).includes(q)).map(([k,v])=>({key:k,value:v})); }, remember(k,v){ this.store[k]=v; return v; } } };

test('safeCalc 基础运算', () => {
  assert.equal(safeCalc('2+2'), 4);
  assert.equal(safeCalc('10/4'), 2.5);
  assert.equal(safeCalc('2^10'), 1024);
  assert.equal(safeCalc('(1+2)*3'), 9);
});

test('safeCalc 数学函数与常量', () => {
  assert.equal(safeCalc('sqrt(16)'), 4);
  assert.ok(Math.abs(safeCalc('pi') - Math.PI) < 1e-9);
  assert.ok(Math.abs(safeCalc('sin(0)') - 0) < 1e-9);
  assert.equal(safeCalc('max(3,7,2)'), 7);
});

test('safeCalc 拒绝任意代码执行/非法输入', () => {
  assert.throws(() => safeCalc('constructor.constructor("return 1")()'));
  assert.throws(() => safeCalc('process.exit(1)'));
  assert.throws(() => safeCalc('1+'));
  assert.throws(() => safeCalc('foo(1)'));
});

test('calc 工具经 executeTool 执行', async () => {
  const tools = buildDefaultTools(fakeOmni);
  const r = await executeTool(tools, 'calc', { expression: 'sqrt(144)+1' });
  assert.equal(r.ok, true);
  assert.equal(r.output.result, 13);
});

test('now 工具返回时间', async () => {
  const tools = buildDefaultTools(fakeOmni);
  const r = await executeTool(tools, 'now', {});
  assert.equal(r.ok, true);
  assert.ok(typeof r.output.iso === 'string' && r.output.iso.includes('T'));
});

test('read_file / write_file 真实读写', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-tools-'));
  const f = join(dir, 'a.txt');
  const tools = buildDefaultTools(fakeOmni);
  const w = await executeTool(tools, 'write_file', { path: f, content: 'hello-omni' });
  assert.equal(w.ok, true);
  const rd = await executeTool(tools, 'read_file', { path: f });
  assert.equal(rd.ok, true);
  assert.equal(rd.output.content, 'hello-omni');
  rmSync(dir, { recursive: true, force: true });
});

test('write_file 的 {prev} 链式替换', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-tools-'));
  const src = join(dir, 's.txt');
  const dst = join(dir, 'd.txt');
  const tools = buildDefaultTools(fakeOmni);
  await executeTool(tools, 'write_file', { path: src, content: 'SRC' });
  // 模拟本地规划器链路：先 read 得到 prev，再 write 用 {prev}
  const rd = await executeTool(tools, 'read_file', { path: src });
  const w = await executeTool(tools, 'write_file', { path: dst, content: 'prev=' + (rd.output?.content || 'X') });
  assert.equal(w.ok, true);
  const check = await executeTool(tools, 'read_file', { path: dst });
  assert.equal(check.output.content, 'prev=SRC');
  rmSync(dir, { recursive: true, force: true });
});

test('memory_remember / memory_search 经工具', async () => {
  const tools = buildDefaultTools(fakeOmni);
  const r = await executeTool(tools, 'memory_remember', { key: 'city', value: '上海' });
  assert.equal(r.ok, true);
  const s = await executeTool(tools, 'memory_search', { query: 'city' });
  assert.equal(s.output.hits.length, 1);
  assert.equal(s.output.hits[0].value, '上海');
});

test('未知工具 / 未启用 shell 返回错误而非崩溃', async () => {
  // 1) allowShell=false 时 shell 工具根本不存在 → 未知工具
  const tools = buildDefaultTools(fakeOmni, { allowShell: false });
  const bad = await executeTool(tools, 'nope', {});
  assert.equal(bad.ok, false);
  const sh = await executeTool(tools, 'shell', { command: 'echo hi' });
  assert.equal(sh.ok, false);

  // 2) 工具存在但 executeTool 未授权 → 明确"未启用"
  const toolsShell = buildDefaultTools(fakeOmni, { allowShell: true });
  const sh2 = await executeTool(toolsShell, 'shell', { command: 'echo hi' }, { allowShell: false });
  assert.equal(sh2.ok, false);
  assert.match(sh2.error, /未启用/);
});

test('executeTool 对声明 cacheTtl 的工具做命中缓存（不重复执行）', async () => {
  clearToolCache();
  let calls = 0;
  // 仿网络工具：声明 cacheTtl，第二次同参数应命中缓存、不再执行
  const tools = [{ name: 'myfetch', description: 'x', parameters: {}, cacheTtl: 60000, run: async ({ url }) => { calls++; return { url, n: calls }; } }];
  const a = await executeTool(tools, 'myfetch', { url: 'https://x.com/a' });
  const b = await executeTool(tools, 'myfetch', { url: 'https://x.com/a' });
  assert.equal(calls, 1, '第二次应命中缓存、不再执行');
  assert.equal(b.cached, true);
  assert.deepEqual(a.output, b.output, '命中缓存返回同一结果');
  const c = await executeTool(tools, 'myfetch', { url: 'https://x.com/b' });
  assert.equal(calls, 2, '不同参数应是新键、重新执行');
  assert.equal(c.cached, undefined);
  const stats = toolCacheStats();
  assert.equal(stats.size, 2);
});

test('executeTool 对声明 circuit 的工具做熔断（连续失败达阈值后短路）', async () => {
  resetToolBreakers();
  let calls = 0;
  const tools = [{ name: 'flaky', description: 'x', parameters: {}, circuit: true, run: async () => { calls++; throw new Error('boom'); } }];
  // 默认阈值 3：前 3 次失败仍会调用
  await executeTool(tools, 'flaky', {});
  await executeTool(tools, 'flaky', {});
  await executeTool(tools, 'flaky', {});
  assert.equal(calls, 3);
  // 第 4 次：熔断开启，直接短路（绝不反复超时拖垮流水线）
  const r = await executeTool(tools, 'flaky', {});
  assert.equal(calls, 3, '熔断后不应再执行');
  assert.equal(r.circuitOpen, true);
  const st = toolBreakerStatus().find(b => b.name === 'flaky');
  assert.ok(st && st.open === true, '熔断状态应可被查询');
});

test('executeTool 熔断器在成功后复位', async () => {
  resetToolBreakers();
  let calls = 0, fail = true;
  const tools = [{ name: 'halflaky', description: 'x', parameters: {}, circuit: true, run: async () => { calls++; if (fail) throw new Error('nope'); return { ok: true }; } }];
  await executeTool(tools, 'halflaky', {}); // fail 1
  await executeTool(tools, 'halflaky', {}); // fail 2
  fail = false;
  const r = await executeTool(tools, 'halflaky', {}); // success → 复位
  assert.equal(r.ok, true);
  const st = toolBreakerStatus().find(b => b.name === 'halflaky');
  assert.ok(st && st.open === false && st.fails === 0, '成功后熔断应复位');
});

test('executeTool 未声明 cacheTtl/circuit 的默认工具行为不变（含 calc）', async () => {
  clearToolCache(); resetToolBreakers();
  const tools = buildDefaultTools(fakeOmni);
  const r = await executeTool(tools, 'calc', { expression: '2+3' });
  assert.equal(r.ok, true);
  assert.equal(r.output.result, 5);
  assert.equal(r.cached, undefined);
  assert.equal(r.circuitOpen, undefined);
});
