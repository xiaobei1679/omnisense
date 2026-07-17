// 学习子系统记忆中枢（learning/src/memoryHub.mjs）纯函数单测。
// 全覆盖知识图谱引擎的确定性逻辑：实体/边去重、跨模态关联、
// 因果链正/反向推导（依赖 IS_CAUSAL）、开放缺口。
// 全部离线、零网络、零副作用：传 persistPath=null 避免任何 fs 落盘。
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryHub } from '../learning/src/memoryHub.mjs';
import { CAUSAL, RELATIONAL, NEG_CAUSAL, IS_CAUSAL } from '../learning/src/relations.mjs';

const hub = () => new MemoryHub(null);

// ───────────────────────── 关系集合不变量（被 forwardChain 依赖） ─────────────────────────

test('IS_CAUSAL 与 CAUSAL 等价，且不含否定因果边', () => {
  assert.deepEqual([...IS_CAUSAL].sort(), [...CAUSAL].sort());
  for (const r of NEG_CAUSAL) assert.ok(!IS_CAUSAL.has(r), `否定边 ${r} 不应进因果链`);
});

test('CAUSAL 与 RELATIONAL 互斥（避免边被双重归类）', () => {
  for (const r of CAUSAL) assert.ok(!RELATIONAL.has(r), `关系 ${r} 同时出现在 CAUSAL/RELATIONAL`);
});

// ───────────────────────── 实体与命名空间 ─────────────────────────

test('addEntity 累积模态与作品命名空间，回读正确', () => {
  const h = hub();
  h.addEntity('Foo', 'person', 'visual', 'WorkA');
  h.addEntity('Foo', 'person', 'audio', 'WorkB'); // 同实体二次出现 → 模态并集 + 作品追加
  const e = h.entities.get('Foo');
  assert.deepEqual([...e.modalities].sort(), ['audio', 'visual']);
  assert.deepEqual([...h.entityWorks('Foo')].sort(), ['WorkA', 'WorkB']);
  assert.equal(e.mentions, 2);
});

test('entityWorks 未知实体返回空 Set', () => {
  assert.equal(new MemoryHub(null).entityWorks('Nope').size, 0);
});

// ───────────────────────── 边图去重 ─────────────────────────

test('addEdge 按 (from|rel|to|modality|source) 去重', () => {
  const h = hub();
  h.addEdge('A', 'causes', 'B', { modality: 'visual', source: 'eye' });
  h.addEdge('A', 'causes', 'B', { modality: 'visual', source: 'eye' }); // 完全相同 → 忽略
  assert.equal(h.edges.length, 1);
});

test('addEdge 不同来源/模态视为不同边', () => {
  const h = hub();
  h.addEdge('A', 'causes', 'B', { modality: 'visual', source: 'eye' });
  h.addEdge('A', 'causes', 'B', { modality: 'audio', source: 'ear' });
  assert.equal(h.edges.length, 2);
});

// ───────────────────────── 跨模态关联 ─────────────────────────

test('crossModalLinks 仅返回同时具 visual+audio 的实体', () => {
  const h = hub();
  h.addEntity('Foo', 'person', 'visual');
  h.addEntity('Foo', 'person', 'audio'); // Foo 跨模态
  h.addEntity('Bar', 'person', 'visual'); // Bar 单模态
  assert.deepEqual(h.crossModalLinks(), ['Foo']);
});

// ───────────────────────── 邻居查询 ─────────────────────────

test('neighbors 按 from/to 拆分出边与入边', () => {
  const h = hub();
  h.addEdge('A', 'causes', 'B');
  h.addEdge('C', 'causes', 'B');
  const n = h.neighbors('B');
  assert.deepEqual(n.out, []);
  assert.equal(n.inc.length, 2);
  assert.ok(n.inc.every((e) => e.to === 'B'));
});

// ───────────────────────── 因果链推导（causalOnly 只走 IS_CAUSAL） ─────────────────────────

test('forwardChain causalOnly 仅沿正向因果边传播，跳过 RELATIONAL', () => {
  const h = hub();
  h.addEdge('A', 'causes', 'B');     // 因果
  h.addEdge('B', 'causes', 'C');     // 因果
  h.addEdge('B', 'discovered', 'D'); // 关联，不进因果链
  h.addEdge('D', 'causes', 'E');     // 因果但挂在不传播节点下
  const chain = h.forwardChain('A', 2, true);
  assert.deepEqual(chain, ['A', 'B', 'C']); // D/E 被排除
});

test('backwardChain causalOnly 反向溯源到根因', () => {
  const h = hub();
  h.addEdge('X', 'causes', 'A');
  h.addEdge('A', 'causes', 'B');
  h.addEdge('B', 'causes', 'C');
  const chain = h.backwardChain('C', 3, true);
  assert.deepEqual(chain, ['C', 'B', 'A', 'X']);
});

test('forwardChain causalOnly=false 也走关联边（含 RELATIONAL）', () => {
  const h = hub();
  h.addEdge('A', 'causes', 'B');
  h.addEdge('B', 'discovered', 'D');
  const chain = h.forwardChain('A', 2, false);
  assert.ok(chain.includes('D')); // 非因果模式允许关联传播
});

// ───────────────────────── 开放缺口 ─────────────────────────

test('openGaps 报告单模态实体与低置信度信念', () => {
  const h = hub();
  h.addEntity('Bar', 'person', 'visual'); // 仅单模态
  h.addBelief({ belief: '假设土地会反噬', confidence: 0.3 }); // 低置信
  const gaps = h.openGaps();
  assert.ok(gaps.some((g) => g.entity === 'Bar' && g.reason === '单模态'));
  assert.ok(gaps.some((g) => g.reason === '低置信度'));
});

test('recordGap 按实体去重，不重复记录', () => {
  const h = hub();
  h.recordGap('Z', 'visual');
  h.recordGap('Z', 'audio'); // 同实体再次 → 忽略
  assert.equal(h.gaps.length, 1);
  assert.equal(h.gaps[0].status, 'open');
});
