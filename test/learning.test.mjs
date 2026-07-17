// 学习子系统（learning/）纯函数单测：覆盖 relations.mjs 与 nlp.mjs 的确定性纯函数。
// 全部离线、零副作用、零网络；对齐 index.mjs 真实演示语料，保证断言可复现。
import test from 'node:test';
import assert from 'node:assert/strict';
import { canonRelation, relationKind, CAUSAL, NEG_CAUSAL, RELATIONAL, VERB_FORMS, IS_CAUSAL } from '../learning/src/relations.mjs';
import {
  tokenizeSentences,
  extractEntities,
  extractTriples,
  detectThemes,
  THEME_LEXICON,
} from '../learning/src/nlp.mjs';
import {
  Learner,
  allSources,
  CURATED,
  LOCAL_FALLBACK,
  stripNoise,
  extractCodeExamples,
  distillTechniques,
} from '../learning/src/learner.mjs';

const learner = new Learner();

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

// ── 2026-07-17 迭代补强：固定由专用测试暴露的 2 个真实 bug + 集合不变量 ──
test('canonRelation: 非字符串/空输入优雅返回 null（不抛 TypeError）', () => {
  assert.equal(canonRelation(undefined), null);
  assert.equal(canonRelation(null), null);
  assert.equal(canonRelation(''), null);
  assert.equal(canonRelation(42), null, '数字等非字符串输入应返回 null 而非崩溃');
});

test('canonRelation: 基础形态 find 也归 discovered（召回补全）', () => {
  assert.equal(canonRelation('find'), 'discovered');
  assert.equal(canonRelation('found'), 'discovered');
  assert.equal(canonRelation('finds'), 'discovered');
});

test('relations 集合不变量: CAUSAL/RELATIONAL 互斥且 NEG_CAUSAL 独立', () => {
  for (const v of NEG_CAUSAL) assert.ok(!CAUSAL.has(v), `NEG_CAUSAL 的 ${v} 不应混入 CAUSAL`);
  for (const v of RELATIONAL) assert.ok(!CAUSAL.has(v), `RELATIONAL 的 ${v} 不应混入 CAUSAL`);
  assert.ok(CAUSAL.has('causes') && RELATIONAL.has('discovered'));
});

test('VERB_FORMS 由 VERB_MAP 派生且按长度降序；IS_CAUSAL 引用 CAUSAL', () => {
  assert.ok(Array.isArray(VERB_FORMS) && VERB_FORMS.length > 0);
  for (let i = 1; i < VERB_FORMS.length; i++) {
    assert.ok(VERB_FORMS[i - 1].length >= VERB_FORMS[i].length, '应按长度降序');
  }
  assert.equal(IS_CAUSAL, CAUSAL, 'IS_CAUSAL 应直接引用 CAUSAL（因果链仅正向边）');
  for (const v of NEG_CAUSAL) assert.ok(!IS_CAUSAL.has(v), `否定边 ${v} 不应进入因果链`);
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

// ───────────────────────── learner.mjs（学渊引擎） ─────────────────────────

test('pickFor 按意图路由到正确的能力源（see/listen/think/talk）', () => {
  assert.equal(learner.pickFor('see the image and describe it').mapsTo, 'see');
  assert.equal(learner.pickFor('transcribe audio speech').mapsTo, 'listen');
  assert.equal(learner.pickFor('think about the graph logic').mapsTo, 'think');
  assert.equal(learner.pickFor('talk to the user dialogue').mapsTo, 'talk');
});

test('pickFor 观测意图落到 observe 源（含 LOCAL_FALLBACK）', () => {
  const s = learner.pickFor('monitor metrics 监控指标 dashboard');
  assert.ok(s);
  assert.equal(s.mapsTo, 'observe');
});

test('pickFor 无关意图返回 null（诚实降级，不瞎匹配）', () => {
  assert.equal(learner.pickFor('今天天气不错'), null);
  assert.equal(learner.pickFor(''), null);
});

test('CURATED / LOCAL_FALLBACK 来源完整性', () => {
  assert.ok(CURATED.length >= 4);
  for (const c of CURATED) {
    assert.ok(['see', 'listen', 'think', 'talk', 'observe'].includes(c.mapsTo), `非法 mapsTo: ${c.mapsTo}`);
    assert.ok(c.repo || c.localDir, '源需有 repo 或 localDir');
  }
  for (const l of LOCAL_FALLBACK) {
    assert.ok(l.dir, `回退源 ${l.name} 缺 dir`);
    assert.ok(['see', 'think'].includes(l.mapsTo));
  }
});

test('allSources 合并 CURATED 与 sources.json（无扩展源时仅 CURATED）', () => {
  const all = allSources();
  assert.ok(all.length >= CURATED.length);
  // 已知 CURATED 项必在合并结果中
  const seeItem = CURATED.find((c) => c.mapsTo === 'see');
  assert.ok(all.includes(seeItem));
});

test('stripNoise 清除 markdown 图片/链接/HTML/裸 URL', () => {
  const dirty = '![shield](https://badge.io/x.png) 见[文档](https://ex.com/d) <b>粗</b> 访问 https://site.com 完';
  const clean = stripNoise(dirty);
  assert.ok(!clean.includes('!['));          // 图片语法移除
  assert.ok(!clean.includes('https://'));     // 裸 URL 移除
  assert.ok(!clean.includes('<b>'));          // HTML 移除
  assert.ok(clean.includes('文档'));          // 链接文字保留
  assert.ok(clean.includes('粗'));            // HTML 文字保留
});

test('extractCodeExamples 抽取围栏代码块首行', () => {
  const corpus = '示例:\n```js\nconst x = await fetch(url);\n```\n\n```python\nprint("hi")\n```';
  const ex = extractCodeExamples(corpus);
  assert.ok(ex.length >= 1);
  assert.ok(ex[0].includes('const x ='));
  assert.ok(ex.some((e) => e.includes('print(')));
});

test('distillTechniques 抽技术行 + 代码示例 + 去重 + 上限', () => {
  const corpus = [
    '# 标题行（应被排除）',
    'We use a hybrid architecture with middleware and async pipelines to process streams.',
    'The framework provides tokenization and supports ontology extraction via REST API.',
    'The framework provides tokenization and supports ontology extraction via REST API.', // 重复
    '> 引用块（应被排除）',
    '```js\nconst t = tokenizer.encode(text);\n```',
  ].join('\n');
  const techs = distillTechniques(corpus);
  assert.ok(techs.length >= 2);
  assert.ok(techs.length <= 10);
  // 去重：重复行只出现一次
  assert.equal(techs.filter((t) => t.includes('hybrid architecture')).length, 1);
  // 代码示例被纳入
  assert.ok(techs.some((t) => t.includes('tokenizer.encode') || t.startsWith('代码示例')));
});
