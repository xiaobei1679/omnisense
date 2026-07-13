// Memory 单元测试：search() 大小写不敏感检索、store 与 notes 双域、limit 与边界。
// 使用系统临时目录避免污染仓库；不联网。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Memory, tokenize, bm25Score, recencyDecay, mmrRerank } from '../src/core/memory.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function freshMemory() {
  const dir = mkdtempSync(join(tmpdir(), 'omni-mem-test-'));
  return new Memory(join(dir, 'mem.json'));
}

test('search 大小写不敏感匹配 store key', () => {
  const mem = freshMemory();
  mem.remember('HotTopic', '台风相关');
  const r = mem.search('hottopic');
  assert.ok(r.some(h => h.type === 'store' && h.key === 'HotTopic'), '应匹配 key（大小写不敏感）');
});

test('search 匹配 store value', () => {
  const mem = freshMemory();
  mem.remember('news', '台风巴威实时路径引发关注');
  const r = mem.search('台风');
  assert.ok(r.some(h => h.type === 'store' && h.value.includes('台风')), '应匹配 value');
});

test('search 匹配 note 文本', () => {
  const mem = freshMemory();
  mem.note('用户今天关注了台风相关新闻', 'interest');
  const r = mem.search('台风');
  assert.ok(r.some(h => h.type === 'note' && h.text.includes('台风')), '应匹配 note');
});

test('search 空查询返回 []', () => {
  const mem = freshMemory();
  mem.remember('a', 'b');
  assert.deepEqual(mem.search(''), []);
  assert.deepEqual(mem.search('   '), []);
  assert.deepEqual(mem.search(null), []);
});

test('search 无匹配返回 []', () => {
  const mem = freshMemory();
  mem.remember('a', 'b');
  assert.deepEqual(mem.search('不存在的词xyz'), []);
});

test('search limit 生效（返回前 limit 条）', () => {
  const mem = freshMemory();
  for (let i = 0; i < 30; i++) mem.remember('item' + i, '匹配keyword的内容' + i);
  const r = mem.search('匹配keyword', 5);
  assert.equal(r.length, 5, '应恰好返回 limit 条');
  assert.equal(r[0].key, 'item0', '前 limit 应优先 store 顺序首项');
});

test('search 默认 limit 为 20', () => {
  const mem = freshMemory();
  for (let i = 0; i < 50; i++) mem.remember('k' + i, '公共关键词' + i);
  assert.equal(mem.search('公共关键词').length, 20);
});

test('search 综合：store 与 note 混合命中分别标记 type', () => {
  const mem = freshMemory();
  mem.remember('topic', '关于AI的讨论');
  mem.note('AI 将改变创作行业');
  const r = mem.search('AI');
  const types = new Set(r.map(h => h.type));
  assert.ok(types.has('store'), '应包含 store 命中');
  assert.ok(types.has('note'), '应包含 note 命中');
});

// ───────── v2 语义检索（BM25-lite）─────────
test('BM25 排序：更相关文档排在前（语义检索，零 key）', () => {
  const mem = freshMemory();
  mem.remember('a', '苹果手机发布新品 售价创新高');
  mem.remember('b', '香蕉营养丰富 适合运动后补充');
  mem.remember('c', '苹果公司财报 手机业务增长');
  const r = mem.search('苹果手机 发布', { topK: 1 });
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'a', '最相关应排第一');
  assert.ok(r[0].score > 0);
});

test('search 选项对象形式 topK/threshold 生效', () => {
  const mem = freshMemory();
  mem.remember('x', '机器学习模型训练方法');
  mem.remember('y', '今天天气晴朗适合出游');
  const r = mem.search('机器学习', { topK: 1, threshold: 0 });
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'x');
});

test('playbook 记忆可被检索且不因 hash 错配', () => {
  const mem = freshMemory();
  mem.remember('playbook:abcd1234', { goal: '抓取 example.com 并写入 a.txt', steps: [{ action: 'web_fetch', action_input: { url: 'https://example.com' } }] });
  mem.remember('fruit', '苹果很好吃');
  const r = mem.search('playbook', { topK: 5, includeNotes: false });
  assert.ok(r.some(h => h.key === 'playbook:abcd1234' && h.value.goal.includes('example.com')), '应检索到 playbook 记忆');
});

test('recallSimilar 别名返回相关性排序结果', () => {
  const mem = freshMemory();
  mem.remember('p1', '自动驾驶技术取得突破');
  mem.remember('p2', '咖啡冲泡技巧分享');
  const r = mem.recallSimilar('自动驾驶', 1);
  assert.equal(r[0].key, 'p1');
});

test('tokenize: 中英混合 + URL/路径作为实体 token + 过滤停用虚词', () => {
  const t = tokenize('抓取 https://example.com 并写入 a.txt');
  assert.ok(t.includes('example_com'), 'URL 应作为整体实体');
  assert.ok(t.includes('a_txt'), '文件路径应作为整体实体');
  assert.ok(t.includes('抓') && t.includes('写'), '中文按单字保留');
  assert.ok(!t.includes('并'), '停用虚词应被过滤');
});

test('bm25Score: 含查询词的文档得分 > 不含', () => {
  const qt = ['苹果', '手机'];
  const docHit = ['苹果', '手机', '发布'];
  const docMiss = ['香蕉', '营养'];
  const all = [docHit, docMiss];
  assert.ok(bm25Score(qt, docHit, all, 2) > bm25Score(qt, docMiss, all, 2));
});

// ───────── v3 深度检索：时间衰减 / 复用权重 / MMR 去冗余 ─────────
test('recencyDecay: 半衰期后≈0.5，越久越小，无时间戳为 0', () => {
  const now = 1_000_000_000_000, hl = 1000;
  assert.equal(recencyDecay(now, now, hl), 1, '当下应为 1');
  assert.ok(Math.abs(recencyDecay(now - 1000, now, hl) - 0.5) < 1e-9, '一个半衰期应≈0.5');
  assert.ok(recencyDecay(now - 2000, now, hl) < recencyDecay(now - 1000, now, hl), '越久越小');
  assert.equal(recencyDecay(0, now, hl), 0, '无时间戳应为 0');
});

test('时间衰减：相关度相同则更新的 playbook 排前', () => {
  const mem = freshMemory();
  const now = Date.now();
  mem.remember('playbook:old', { goal: '抓取新闻并写入文件', at: now - 30 * 24 * 3600 * 1000, hitCount: 0 });
  mem.remember('playbook:new', { goal: '抓取新闻并写入文件', at: now, hitCount: 0 });
  const r = mem.search('抓取新闻并写入文件', { topK: 2, now, wHit: 0 });
  assert.equal(r[0].key, 'playbook:new', '更新的记忆应排前');
  assert.ok(r[0].recency > r[1].recency, 'recency 应体现新旧差异');
});

test('复用权重：hitCount 高的 playbook 排前（同相关度、同时间）', () => {
  const mem = freshMemory();
  const now = Date.now();
  mem.remember('playbook:cold', { goal: '计算并写入文件', at: now, hitCount: 0 });
  mem.remember('playbook:hot', { goal: '计算并写入文件', at: now, hitCount: 10 });
  const r = mem.search('计算并写入文件', { topK: 2, now });
  assert.equal(r[0].key, 'playbook:hot', '高频复用打法应优先');
  assert.equal(r[0].hits, 10);
});

test('MMR 去冗余：diversity 开启时把近重复替换为多样结果', () => {
  const mem = freshMemory();
  mem.remember('dup1', '苹果手机发布新品售价高');
  mem.remember('dup2', '苹果手机发布新品售价高'); // 与 dup1 近乎重复
  mem.remember('diff', '苹果公司股价上涨市值增长');
  const diverse = mem.search('苹果', { topK: 2, diversity: 0.8 });
  assert.ok(diverse.map(d => d.key).includes('diff'), 'MMR 应引入多样化结果而非全是近重复');
});

test('mmrRerank: 纯函数对空输入安全，lambda=1 等价原序', () => {
  assert.deepEqual(mmrRerank([], 5), []);
  const scored = [
    { key: 'a', score: 3, tokens: ['x', 'y'] },
    { key: 'b', score: 2, tokens: ['x', 'y'] },
    { key: 'c', score: 1, tokens: ['z'] },
  ];
  const r = mmrRerank(scored, 3, 1); // 纯相关
  assert.deepEqual(r.map(x => x.key), ['a', 'b', 'c']);
});

test('向后兼容：无时间戳/无 hitCount 的 store 排序不受增强影响', () => {
  const mem = freshMemory();
  for (let i = 0; i < 5; i++) mem.remember('k' + i, '公共词内容' + i);
  const r = mem.search('公共词', 5);
  assert.equal(r[0].key, 'k0', '同分应保持插入顺序（稳定排序）');
  assert.equal(r.every(x => x.recency === 0 && x.hits === 0), true, '无时间戳/hitCount 应零加成');
});
