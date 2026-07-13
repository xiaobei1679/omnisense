// scripts/skills/registry.mjs
//
// Zero-dependency skill registry / discovery layer.
//
// Design basis (external research, 2026-07 GitHub multi-agent topic landscape):
// - "Skills" are a first-class primitive in the leading 2026 frameworks:
//   deer-flow (bytedance), ruflo, CowAgent, MemOS, PraisonAI all ship a
//   skills / skill-reuse layer. A framework that only has agent ROLES but no
//   SKILL registry makes reuse frictionful. This module closes that gap:
//   it discovers SKILL.md files, parses their frontmatter, validates them,
//   and lets an agent look a skill up by name or category.
// - Kept zero-dependency and pure where possible so it is CI-testable offline
//   (mirrors the repo's existing `scripts/security/permissions.mjs` design).
//
// Scope guardrails (AGENTS.md hard rules):
// - No hardcoded absolute paths. Discovery walks a caller-supplied root.
// - No secrets, no personal data. Skills are framework artifacts only.
// - Does NOT replace the static CI gates (observer/reviewer) — it is a runtime
//   discovery aid an agent can call before deciding to invoke a skill.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// ---- Frontmatter parsing (minimal YAML: top-level `key: value` only) ----

// Split a SKILL.md into { data, body }. Returns data={} when no frontmatter.
// `data` values are strings (stripped of surrounding quotes). Only the first
// `---` ... `---` block at the top is treated as frontmatter.
export function parseFrontmatter(text) {
  if (typeof text !== 'string') return { data: {}, body: '' };
  const body = text;
  const fmMatch = body.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!fmMatch) return { data: {}, body };
  const fmBlock = fmMatch[1];
  const data = {};
  for (const rawLine of fmBlock.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) data[key] = val;
  }
  return { data, body: body.slice(fmMatch[0].length) };
}

// ---- Pure skill parsing from raw file contents (testable, no fs) ----

// `files` is an array of { path, content }. Returns an array of skill records:
// { name, description, category, path, valid, errors }.
// Records missing a `name` or `description` are still returned but flagged invalid.
export function parseSkillsFromFiles(files) {
  if (!Array.isArray(files)) return [];
  const out = [];
  for (const f of files) {
    const content = f && f.content != null ? String(f.content) : '';
    const { data } = parseFrontmatter(content);
    const name = (data.name || '').trim();
    const description = (data.description || '').trim();
    const category = (data.category || 'general').trim();
    const errors = [];
    if (!name) errors.push('missing required frontmatter field: name');
    if (!description) errors.push('missing required frontmatter field: description');
    out.push({
      name,
      description,
      category,
      path: f && f.path ? f.path : '',
      valid: errors.length === 0,
      errors,
    });
  }
  return out;
}

// ---- Validation ----

// Validate one skill record. Returns { valid, errors }.
export function validateSkill(skill) {
  const errors = [];
  if (!skill || typeof skill !== 'object') {
    return { valid: false, errors: ['skill is not an object'] };
  }
  if (!skill.name || !String(skill.name).trim()) {
    errors.push('missing required frontmatter field: name');
  }
  if (!skill.description || !String(skill.description).trim()) {
    errors.push('missing required frontmatter field: description');
  }
  // name should be a safe slug (lowercase, digits, hyphens) per sample-skill convention
  const nm = String(skill.name || '');
  if (nm && !/^[a-z0-9][a-z0-9-]*$/.test(nm)) {
    errors.push('name should be a lowercase slug (a-z0-9 and hyphens)');
  }
  return { valid: errors.length === 0, errors };
}

// ---- Query helpers (pure) ----

// Return the first skill whose name matches (case-insensitive). null if none.
export function getSkill(name, skills) {
  if (!name || !Array.isArray(skills)) return null;
  const target = String(name).trim().toLowerCase();
  return skills.find((s) => (s.name || '').toLowerCase() === target) || null;
}

// Return skills whose category matches (case-insensitive). Empty array if none.
export function filterByCategory(category, skills) {
  if (!category || !Array.isArray(skills)) return [];
  const cat = String(category).trim().toLowerCase();
  return skills.filter((s) => (s.category || 'general').toLowerCase() === cat);
}

// Return only valid skills.
export function listValid(skills) {
  return Array.isArray(skills) ? skills.filter((s) => s.valid) : [];
}

// ---- Filesystem discovery (thin fs wrapper over the pure parser) ----

// Recursively walk `rootDir` for files named exactly `SKILL.md`, up to `maxDepth`
// (default 4) to avoid scanning unexpectedly huge trees. Returns skill records.
// `rootDir` is resolved relative to cwd if not absolute.
export function discoverSkills(rootDir, { maxDepth = 4, skillFileName = 'SKILL.md' } = {}) {
  const root = resolve(String(rootDir || '.'));
  const out = [];
  const walk = (dir, depth) => {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        // Skip noisy / ignored trees for speed and safety.
        if (ent.name === 'node_modules' || ent.name === '.git' || ent.name === '.workbuddy') continue;
        walk(full, depth + 1);
      } else if (ent.isFile() && ent.name === skillFileName) {
        let content = '';
        try {
          content = readFileSync(full, 'utf8');
        } catch {
          content = '';
        }
        const skills = parseSkillsFromFiles([{ path: relative(root, full), content }]);
        if (skills[0]) out.push(skills[0]);
      }
    }
  };
  walk(root, 0);
  return out;
}

// ---- CLI ----

const isMain = import.meta.url === pathToFileURL(process.argv[1] || '').href;
function printHelp() {
  console.log('Skill registry — discover & validate SKILL.md files.');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/skills/registry.mjs --scan <dir>   # discover skills under <dir> (default: examples)');
  console.log('  node scripts/skills/registry.mjs --list <dir>   # list only valid skills');
  console.log('  node scripts/skills/registry.mjs --get <name> <dir>');
}

if (isMain) {
  const args = process.argv.slice(2);
  const scanIdx = args.indexOf('--scan');
  const listIdx = args.indexOf('--list');
  const getIdx = args.indexOf('--get');
  const scanDir = scanIdx !== -1 ? args[scanIdx + 1] : listIdx !== -1 ? args[listIdx + 1] : 'examples';
  if (getIdx !== -1) {
    const name = args[getIdx + 1];
    const dir = args[getIdx + 2] || 'examples';
    const skills = discoverSkills(dir);
    const hit = getSkill(name, skills);
    console.log(JSON.stringify(hit || null, null, 2));
  } else if (listIdx !== -1 || scanIdx !== -1) {
    const skills = discoverSkills(scanDir);
    const valid = listValid(skills);
    for (const s of valid) {
      const nm = (s.name || '').padEnd(22);
      const cat = (s.category || 'general').padEnd(12);
      console.log(`${nm} [${cat}] ${s.path}  ${s.description}`);
    }
    const invalidCount = skills.length - valid.length;
    console.log(`\n${valid.length} valid skill(s)${invalidCount ? `, ${invalidCount} invalid (skipped)` : ''}.`);
  } else {
    printHelp();
  }
}
