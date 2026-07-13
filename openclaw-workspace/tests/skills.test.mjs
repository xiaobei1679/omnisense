// tests/skills.test.mjs — tests for scripts/skills/registry.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  parseSkillsFromFiles,
  validateSkill,
  getSkill,
  filterByCategory,
  listValid,
  discoverSkills,
} from '../scripts/skills/registry.mjs';

const SAMPLE = `---
name: sample-skill
description: 示例技能（模板）。触发词：示例、sample、demo。
category: demo
---
# Sample Skill
body text
`;

test('parseFrontmatter extracts name/description/category and body', () => {
  const { data, body } = parseFrontmatter(SAMPLE);
  assert.equal(data.name, 'sample-skill');
  assert.match(data.description, /示例技能/);
  assert.equal(data.category, 'demo');
  assert.match(body, /# Sample Skill/);
});

test('parseFrontmatter returns empty data when no frontmatter', () => {
  const { data, body } = parseFrontmatter('just text, no frontmatter');
  assert.deepEqual(data, {});
  assert.match(body, /just text/);
});

test('parseSkillsFromFiles parses and flags missing fields', () => {
  const skills = parseSkillsFromFiles([
    { path: 'a/SKILL.md', content: SAMPLE },
    { path: 'b/SKILL.md', content: '# no frontmatter at all' },
    { path: 'c/SKILL.md', content: '---\nname: only-name\n---\n' },
  ]);
  assert.equal(skills.length, 3);
  assert.equal(skills[0].name, 'sample-skill');
  assert.equal(skills[0].valid, true);
  assert.equal(skills[1].valid, false);
  assert.ok(skills[1].errors.includes('missing required frontmatter field: name'));
  assert.equal(skills[2].valid, false);
  assert.ok(skills[2].errors.includes('missing required frontmatter field: description'));
});

test('validateSkill enforces lowercase slug convention', () => {
  const ok = validateSkill({ name: 'my-skill', description: 'does things' });
  assert.equal(ok.valid, true);
  const bad = validateSkill({ name: 'My Skill!', description: 'x' });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => /lowercase slug/.test(e)));
});

test('getSkill is case-insensitive', () => {
  const skills = parseSkillsFromFiles([{ path: 'a/SKILL.md', content: SAMPLE }]);
  assert.equal(getSkill('SAMPLE-SKILL', skills).name, 'sample-skill');
  assert.equal(getSkill('nope', skills), null);
});

test('filterByCategory matches category', () => {
  const skills = parseSkillsFromFiles([{ path: 'a/SKILL.md', content: SAMPLE }]);
  assert.equal(filterByCategory('demo', skills).length, 1);
  assert.equal(filterByCategory('other', skills).length, 0);
});

test('listValid drops invalid records', () => {
  const skills = parseSkillsFromFiles([
    { path: 'a/SKILL.md', content: SAMPLE },
    { path: 'b/SKILL.md', content: 'no frontmatter' },
  ]);
  assert.equal(listValid(skills).length, 1);
});

test('discoverSkills walks a dir and finds SKILL.md files', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-test-'));
  try {
    writeFileSync(join(root, 'SKILL.md'), SAMPLE, 'utf8');
    const nested = join(root, 'sub', 'deep');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'SKILL.md'), '---\nname: nested-skill\ndescription: deep one\ncategory: demo\n---\n', 'utf8');
    const skills = discoverSkills(root);
    assert.equal(skills.length, 2);
    const names = skills.map((s) => s.name).sort();
    assert.deepEqual(names, ['nested-skill', 'sample-skill']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('discoverSkills respects maxDepth', () => {
  const root = mkdtempSync(join(tmpdir(), 'skills-depth-'));
  try {
    const deep = join(root, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'SKILL.md'), '---\nname: too-deep\ndescription: x\n---\n', 'utf8');
    const skills = discoverSkills(root, { maxDepth: 2 });
    assert.equal(skills.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
