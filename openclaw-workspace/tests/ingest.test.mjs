// tests/ingest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  slugify,
  parseInsight,
  classifyInsight,
  toProposal,
  ingestDir,
  renderProposal
} from '../scripts/evolve/ingest.mjs';

test('slugify: lowercases, strips punctuation, kebabizes (ASCII-safe ids)', () => {
  assert.equal(slugify('AI Writing Pacing'), 'ai-writing-pacing');
  assert.equal(slugify('  Hello World!  '), 'hello-world');
  assert.match(slugify('!!!'), /^insight-[a-z0-9]+$/); // fallback prefix when empty
  // Framework ids are ASCII kebab: CJK / mixed titles still yield a stable ASCII id.
  assert.match(slugify('写作的节奏控制'), /^[a-z0-9-]+$/);
  assert.match(slugify('去AI味的节奏控制'), /^[a-z0-9-]+$/);
});

test('parseInsight: extracts H1 title', () => {
  const i = parseInsight('# 一个好用的提示词结构\n正文内容');
  assert.equal(i.title, '一个好用的提示词结构');
  assert.ok(i.body.includes('正文内容'));
});

test('parseInsight: parses insight-meta tags + source', () => {
  const md = [
    '# 标题',
    '<!-- insight-meta',
    'tags: prompt, qa',
    'source: AI创作日报/2026-07-09',
    '-->',
    'body here'
  ].join('\n');
  const i = parseInsight(md);
  assert.deepEqual(i.tags, ['prompt', 'qa']);
  assert.equal(i.source, 'AI创作日报/2026-07-09');
  assert.ok(i.body.includes('body here'));
});

test('parseInsight: tolerates missing meta', () => {
  const i = parseInsight('no heading just text');
  assert.equal(i.title, 'Untitled insight');
  assert.deepEqual(i.tags, []);
});

test('classifyInsight: tag-driven categories', () => {
  assert.equal(classifyInsight({ tags: ['skill'], title: 'x', body: '' }), 'skill');
  assert.equal(classifyInsight({ tags: ['role'], title: 'x', body: '' }), 'agent-role');
  assert.equal(classifyInsight({ tags: ['doc'], title: 'x', body: '' }), 'doc');
});

test('classifyInsight: keyword fallback', () => {
  assert.equal(
    classifyInsight({ tags: [], title: '提示词模板', body: 'system prompt' }),
    'prompt-template'
  );
  assert.equal(
    classifyInsight({ tags: [], title: '节奏诊断', body: 'ai腔检测' }),
    'qa-heuristic'
  );
  assert.equal(classifyInsight({ tags: [], title: '随便聊聊', body: '今天天气' }), 'other');
});

test('toProposal: shapes a framework-level proposal', () => {
  const p = toProposal('# 去AI味的节奏控制\n<!-- insight-meta\ntags: qa\n-->\n保持短句');
  assert.match(p.id, /^[a-z0-9-]+$/);
  assert.equal(p.category, 'qa-heuristic');
  assert.equal(p.title, '去AI味的节奏控制');
  assert.ok(p.suggestedPath.includes('style-engine'));
  assert.ok(p.action.includes('审核员'));
});

test('toProposal: prompt-template suggests agents path', () => {
  const p = toProposal('# 写作助手提示词\ntags: prompt');
  assert.equal(p.category, 'prompt-template');
  assert.ok(p.suggestedPath.includes('examples/agents'));
});

test('renderProposal: renders a neutral markdown card', () => {
  const p = toProposal('# 标题\ntags: doc\n来源: test');
  const md = renderProposal(p);
  assert.ok(md.includes('## 提案'));
  assert.ok(md.includes(p.id));
  assert.ok(md.includes(p.suggestedPath));
});

test('ingestDir: reads all .md and produces proposals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ingest-'));
  try {
    writeFileSync(
      join(dir, 'a.md'),
      '# 提示词\n<!-- insight-meta\ntags: prompt\n-->\nbody'
    );
    writeFileSync(
      join(dir, 'b.md'),
      '# 技能\n<!-- insight-meta\ntags: skill\n-->\nbody'
    );
    writeFileSync(join(dir, 'ignore.txt'), 'not markdown');
    const { proposals, errors } = ingestDir(dir);
    assert.equal(proposals.length, 2);
    assert.equal(proposals[0].category, 'prompt-template');
    assert.equal(proposals[1].category, 'skill');
    assert.equal(errors.length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('ingestDir: reports error on missing dir', () => {
  const { proposals, errors } = ingestDir('/no/such/dir/xyz');
  assert.equal(proposals.length, 0);
  assert.ok(errors.length >= 1);
});
