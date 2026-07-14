// 工具执行器离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDefaultTools, executeTool, safeCalc, toolCacheStats, clearToolCache, toolBreakerStatus, resetToolBreakers, setToolCachePersistence, toolCachePersistence, persistToolCache, clearToolCachePersistence } from '../src/core/tools.mjs';

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

// ───────────────────── 工具级缓存/熔断 落盘持久化（跨重启续命） ─────────────────────
// 设计：默认不落盘；setToolCachePersistence(file) 启用并载入磁盘 JSON；每次 set/success/fail/clear/reset 自动落盘。
const readPersist = (file) => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };
const freshCacheTool = () => [{ name: 'pf', description: 'x', parameters: {}, cacheTtl: 60000, run: async ({ url }) => ({ url, n: 1 }) }];

test('setToolCachePersistence 启用/关闭 + status 反映', () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-persist-'));
  const file = join(dir, 'c.json');
  let st = setToolCachePersistence(file, { load: true });
  assert.equal(st.enabled, true);
  assert.equal(typeof st.file, 'string');
  assert.equal(toolCachePersistence().enabled, true);
  st = setToolCachePersistence(null);
  assert.equal(st.enabled, false);
  assert.equal(toolCachePersistence().enabled, false);
  rmSync(dir, { recursive: true, force: true });
});

test('缓存写入后落盘文件含该条目（disk 留存）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-persist-'));
  const file = join(dir, 'c.json');
  setToolCachePersistence(file, { load: true });
  clearToolCache();
  const tools = freshCacheTool();
  await executeTool(tools, 'pf', { url: 'https://x.com/a' });
  const data = readPersist(file);
  assert.ok(data && data.caches.pf, '磁盘文件应含 pf 缓存');
  assert.equal(data.caches.pf.entries.length, 1, '应落盘 1 条缓存');
  assert.equal(data.caches.pf.entries[0][1].v.url, 'https://x.com/a');
  clearToolCachePersistence();
  rmSync(dir, { recursive: true, force: true });
});

test('模拟重启：清空内存→重新载入→条目恢复（落盘跨重启续命）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-persist-'));
  const file = join(dir, 'c.json');
  // 1) 启用 + 播种
  setToolCachePersistence(file, { load: true });
  clearToolCache(); resetToolBreakers();
  const tools = freshCacheTool();
  await executeTool(tools, 'pf', { url: 'https://x.com/a' });
  assert.equal(toolCacheStats().size, 1, '内存应有 1 条');
  // 2) 模拟进程重启：先关持久化（保留内存）→ 清空内存 → 再启用载入
  setToolCachePersistence(null);
  clearToolCache(); resetToolBreakers();
  assert.equal(toolCacheStats().size, 0, '内存已清空');
  setToolCachePersistence(file, { load: true });
  // 3) 重新载入后条目应恢复
  assert.equal(toolCacheStats().size, 1, '从磁盘重新载入应恢复 1 条');
  assert.equal(toolCachePersistence().loaded, true, '应标记为已载入');
  clearToolCachePersistence();
  rmSync(dir, { recursive: true, force: true });
});

test('熔断状态跨重启保留（冷却期继续短路）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-persist-'));
  const file = join(dir, 'b.json');
  setToolCachePersistence(file, { load: true });
  resetToolBreakers();
  const tools = [{ name: 'bf', description: 'x', parameters: {}, circuit: true, run: async () => { throw new Error('boom'); } }];
  await executeTool(tools, 'bf', {});
  await executeTool(tools, 'bf', {});
  await executeTool(tools, 'bf', {});
  // 第 4 次应熔断短路
  const r = await executeTool(tools, 'bf', {});
  assert.equal(r.circuitOpen, true, '应已熔断');
  // 模拟重启：关→清空→重载入
  setToolCachePersistence(null);
  resetToolBreakers();
  setToolCachePersistence(file, { load: true });
  const st = toolBreakerStatus().find(b => b.name === 'bf');
  assert.ok(st && st.open === true, '重启后熔断仍应处于开启（冷却期续命）');
  clearToolCachePersistence();
  rmSync(dir, { recursive: true, force: true });
});

test('clearToolCachePersistence 清空内存与磁盘', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'omni-persist-'));
  const file = join(dir, 'c.json');
  setToolCachePersistence(file, { load: true });
  clearToolCache();
  await executeTool(freshCacheTool(), 'pf', { url: 'https://x.com/a' });
  assert.ok(readPersist(file)?.caches?.pf, '落盘前应有数据');
  const st = clearToolCachePersistence();
  assert.equal(toolCacheStats().size, 0, '内存已清');
  assert.equal(st.deleted, true, '磁盘文件应被清空');
  const afterData = readPersist(file);
  assert.ok(afterData && Object.keys(afterData.caches || {}).length === 0, '磁盘缓存应为空');
  rmSync(dir, { recursive: true, force: true });
});
