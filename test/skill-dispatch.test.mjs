// test/skill-dispatch.test.mjs
// 技能匹配与委派：基于 Agent Card 的能力发现闭环测试。
// 纯离线，不触网。验证 skillResolve 的关键词匹配正确性。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OmniSense } from '../src/index.mjs';

// skillResolve 是纯函数，无 io，不依赖外部实例
test('skillResolve 匹配计算相关目标 → hand.calc 排第一', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('计算 2+2');
  assert.ok(Array.isArray(r), '应返回数组');
  assert.ok(r.length > 0, '应匹配到至少一个技能');
  assert.equal(r[0].skill.id, 'hand.calc', 'hand.calc 应排第一（id "calc" 直接匹配）');
  assert.ok(r[0].score > 0, '评分应 > 0');
  assert.ok(r[0].matched.length > 0, '应有匹配词');
});

test('skillResolve 匹配思考目标 → brain.think 排第一', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('帮我深入思考推理一下这个问题');
  assert.ok(r.length > 0);
  assert.equal(r[0].skill.id, 'brain.think', 'brain.think 应排第一');
});

test('skillResolve 匹配看热搜目标 → eye.seeHotTopics 或 hot relate 排前', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('看今天的热搜');
  assert.ok(r.length > 0, '应匹配到技能');
  const topIds = r.map(s => s.skill.id);
  const matched = topIds.some(id => id.includes('hot'));
  assert.ok(matched, '应匹配到包含 hot 的技能');
});

test('skillResolve 匹配看网站 → eye.seeWebsite 或 hand.web_fetch 排前', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('看这个网站 https://example.com');
  assert.ok(r.length > 0);
  const topIds = r.map(s => s.skill.id);
  const matched = topIds.some(id => id === 'eye.seeWebsite' || id === 'hand.web_fetch');
  assert.ok(matched, '应匹配到 seeWebsite 或 web_fetch（两者都处理网址）');
});

test('skillResolve 匹配记忆回忆 → brain.recall 或 search 排前', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('回忆我上次说了什么');
  assert.ok(r.length > 0);
  const topIds = r.map(s => s.skill.id);
  const matched = topIds.some(id => id.includes('recall') || id.includes('search') || id.includes('remember'));
  assert.ok(matched, '应匹配到记忆相关技能');
});

test('skillResolve 匹配规划目标 → brain.plan 排第一', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('规划今天的工作');
  assert.ok(r.length > 0);
  assert.equal(r[0].skill.id, 'brain.plan', 'brain.plan 应排第一');
});

test('skillResolve 空输入返回空数组', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('');
  assert.deepEqual(r, []);
});

test('skillResolve 匹配不动的内容 → 合理结果（不是报错）', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('xyzunknownskill123');
  // 可能部分匹配到某些技能描述中含有的词，只要不抛异常即可
  assert.ok(Array.isArray(r));
});

test('skillResolve 匹配文件读写 → hand.read_file 或 hand.write_file 或 hand.list_dir 排前', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('读取文件 test.txt');
  assert.ok(r.length > 0);
  const topIds = r.map(s => s.skill.id);
  const matched = topIds.some(id => id.includes('read_file') || id.includes('write_file') || id.includes('list_dir'));
  assert.ok(matched, '应匹配到文件操作技能');
});

test('skillResolve 返回 top-3 上限', () => {
  const omni = OmniSense.create();
  const r = omni.skillResolve('看');
  assert.ok(r.length <= 3, '最多返回 3 个');
});
