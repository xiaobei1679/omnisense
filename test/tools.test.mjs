// 工具执行器离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildDefaultTools, executeTool, safeCalc } from '../src/core/tools.mjs';

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
