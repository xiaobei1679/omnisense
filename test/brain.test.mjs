import test from 'node:test';
import assert from 'node:assert/strict';
import { Brain, synthesize } from '../src/modules/brain.mjs';

const fakeBus = () => ({
  register() {}, emit() {},
  // 与真实 Bus.recent 一致：返回事件对象数组 {event, payload, t}
  recent() { return (this._percepts || []).map(p => ({ payload: p })); },
});

test('synthesize 统计模态与高频话题', () => {
  const percepts = [
    { modality: 'visual-hot', topics: ['A', 'B', 'A'], fetchedAt: 1000 },
    { modality: 'visual-web', title: 'C', fetchedAt: 1500 },
    { modality: 'visual-hot', topics: ['A'], fetchedAt: 2000 },
  ];
  const syn = synthesize(percepts);
  assert.equal(syn.count, 3);
  assert.equal(syn.modalities['visual-hot'], 2);
  assert.equal(syn.modalities['visual-web'], 1);
  assert.deepEqual(syn.topTopics[0], 'A'); // A 出现 3 次，频次最高
  assert.ok(syn.recencyMs > 0);
});

test('synthesize 空输入安全', () => {
  const syn = synthesize([]);
  assert.equal(syn.count, 0);
  assert.deepEqual(syn.topTopics, []);
});

test('plan 基于感知给出下一步建议（离线）', () => {
  const bus = fakeBus();
  const brain = new Brain(bus, {}, { snapshot: () => ({ keys: [] }) });
  // 无任何感知 → 建议 observe
  const p1 = brain.plan('做点什么');
  assert.ok(p1.actions.includes('observe'));
  assert.ok(Array.isArray(p1.synopsis.topTopics));

  // 有热点感知 → 应不再建议 read-hot
  bus._percepts = [{ modality: 'visual-hot', topics: ['热点'], fetchedAt: 1 }];
  const p2 = brain.plan('');
  assert.ok(!p2.actions.includes('read-hot'));
});
