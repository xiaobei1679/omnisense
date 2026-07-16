// 学习子系统（learning/）纯函数单测：覆盖 relations.mjs 与 nlp.mjs 的确定性纯函数。
// 全部离线、零副作用、零网络；对齐 index.mjs 真实演示语料，保证断言可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonRelation, relationKind } from '../learning/src/relations.mjs';
import {
  tokenizeSentences,
  extractEntities,
  extractTriples,
  detectThemes,
  THEME_LEXICON,
} from '../learning/src/nlp.mjs';

// ───────────────────────── relations.mjs ─────────────────────────

test('canonRelation 把动词形态归一到规范关系', () => {
  assert.equal(canonRelation('cause'), 'causes');
  assert.equal(canonRelation('caused'), 'causes');
  assert.equal(canonRelation('CAUSE'), 'causes'); // 大小写不敏感
  assert.equal(canonRelation('killed'), 'prevents'); // 同义归并
  assert.equal(canonRelation('contain'), 'contains');
  assert.equal(canonRelation('contained'), 'contained'); // 过去分词独立规范形
  assert.equal(canonRelation('xyzzy'), null); // 未知动词 → null
});

test('relationKind 区分 causal / relational / other', () => {
  assert.equal(relationKind('causes'), 'causal');
  assert.equal(relationKind('prevents'), 'causal');
  assert.equal(relationKind('not_causes'), 'causal'); // 否定因果边仍属因果类（仅用于矛盾检测）
  assert.equal(relationKind('discovered'), 'relational');
  assert.equal(relationKind('is'), 'relational');
  assert.equal(relationKind('foobar'), 'other');
});

// ───────────────────────── nlp.mjs ─────────────────────────

test('tokenizeSentences 按句末标点切分', () => {
  const s = tokenizeSentences('Hello world. How are you? Fine!');
  assert.deepEqual(s, ['Hello world.', ' How are you?', ' Fine!']);
  assert.equal(tokenizeSentences('').length, 1); // 空串不崩，返回含原串的单元素
  assert.equal(tokenizeSentences('无标点文本').length, 1);
});

test('extractEntities 抽大写实词并过滤停用词', () => {
  const ents = extractEntities('Elara discovered the hidden library. Dorian warned Elara.');
  assert.ok(ents.includes('Elara'));
  assert.ok(ents.includes('Dorian'));
  assert.ok(!ents.includes('The')); // 停用词被滤
  assert.ok(!ents.includes('Hidden')); // Hidden 不在文本（被 the 吃掉）
});

test('extractTriples 从演示叙事抽因果三元组并检测否定', () => {
  const narrative =
    'Rain caused flood. Storm caused flood. Flood caused hunger. ' +
    'Fire prevented hunger. Fire caused hunger. ' +
    'The potion caused the curse. The potion did not cause the curse.';
  const triples = extractTriples(narrative);
  assert.equal(triples.length, 7); // 每句一三元组，去重后 7 条
  assert.deepEqual(triples[0], { subj: 'Rain', rel: 'causes', obj: 'flood', kind: 'causal', tense: 'past', negated: false });
  // 肯定因果
  const pos = triples.filter((t) => t.subj === 'potion' && t.rel === 'causes');
  assert.equal(pos.length, 1);
  // 否定式矛盾："did not cause" → not_causes，且 negated=true
  const neg = triples.filter((t) => t.subj === 'potion' && t.rel === 'not_causes');
  assert.equal(neg.length, 1);
  assert.equal(neg[0].negated, true);
  assert.equal(neg[0].kind, 'causal');
  // 防止类（prevents）也归因果
  const prev = triples.filter((t) => t.rel === 'prevents');
  assert.equal(prev.length, 1);
  assert.equal(prev[0].subj, 'Fire');
});

test('extractTriples 去重（同 subj/rel/obj 只留一条）', () => {
  const triples = extractTriples('Rain caused flood. Rain caused flood. Rain caused flood.');
  assert.equal(triples.length, 1);
});

test('detectThemes 依词表识别主题', () => {
  const themes = detectThemes('The curse can drive a protagonist to flee. A potion caused the curse. Fire feared the terror.');
  assert.ok(themes.includes('恐惧')); // curse/feared/terror 命中
  assert.deepEqual(detectThemes('The cat sat on the mat quietly.'), []); // 中性文本 → 空
});

test('THEME_LEXICON 含基础主题词表', () => {
  assert.ok(THEME_LEXICON['记忆']);
  assert.ok(THEME_LEXICON['死亡'].includes('killed'));
});
