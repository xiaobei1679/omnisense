// scripts/agent/roles.mjs
// Zero-dependency loader for reusable agent role presets.
// Lowers contribution friction: clone a preset, fill in the blanks, wire it
// into config/openclaw.json — instead of designing a role from scratch.
//
// Preset contract (examples/agents/<id>.md):
//   # Agent Role: <Display Name>          <- human title (H1)
//
//   <!-- role-meta
//   id: <kebab-id>                         <- required, [a-z0-9]+(?:-[a-z0-9]+)*
//   name: <display name>                   <- required
//   description: <one line>                <- required
//   skills: a, b, c                         <- optional, comma-separated
//   -->
//
//   ... the rest is the system-prompt / guidance body (markdown) ...
//
// Usage:
//   node scripts/agent/roles.mjs [dir]     -> list roles as JSON
//
// Programmatic API (exported for tests):
//   parseMeta(block) -> { key: value, ... }
//   validateRole(role) -> { ok, errors }
//   loadRole(file) -> { id, name, description, skills, body, file }
//   loadRoles(dir) -> { roles, errors, duplicateIds }
//   getRole(dir, id) -> role | null

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const META_RE = /<!--\s*role-meta\s*([\s\S]*?)\s*-->/;
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// Parse the `key: value` lines inside the role-meta block.
export function parseMeta(block) {
  const meta = {};
  if (!block) return meta;
  for (const raw of block.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (key) meta[key] = val;
  }
  return meta;
}

// Structural validation used by the loader and by tests.
export function validateRole(role) {
  const errors = [];
  if (!role) return { ok: false, errors: ['role is null'] };
  if (!role.id) errors.push('missing id');
  else if (!ID_RE.test(role.id)) errors.push(`invalid id format: ${role.id}`);
  if (!role.name) errors.push('missing name');
  if (!role.description) errors.push('missing description');
  if (typeof role.body !== 'string' || !role.body.trim()) {
    errors.push('empty body (system prompt)');
  }
  return { ok: errors.length === 0, errors };
}

// Load a single preset file into a structured role object.
export function loadRole(file) {
  const raw = readFileSync(file, 'utf8');
  const m = raw.match(META_RE);
  const meta = m ? parseMeta(m[1]) : {};
  const body = raw.replace(META_RE, '').trim();
  const skills = (meta.skills || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    id: meta.id || '',
    name: meta.name || '',
    description: meta.description || '',
    skills,
    body,
    file
  };
}

// Load every *.md preset in a directory, collecting parse/validation errors
// and any duplicate ids. Never throws — returns structured results instead.
export function loadRoles(dir) {
  const roles = [];
  const errors = [];
  const ids = new Set();
  const duplicateIds = [];
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return { roles, errors: [`cannot read dir: ${dir}`], duplicateIds };
  }
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const file = resolve(dir, entry);
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    let role;
    try {
      role = loadRole(file);
    } catch (e) {
      errors.push(`${entry}: ${e.message}`);
      continue;
    }
    const v = validateRole(role);
    if (!v.ok) errors.push(`${entry}: ${v.errors.join('; ')}`);
    if (role.id) {
      if (ids.has(role.id)) duplicateIds.push(role.id);
      else ids.add(role.id);
    }
    roles.push(role);
  }
  return { roles, errors, duplicateIds };
}

// Find a single preset by id, or null.
export function getRole(dir, id) {
  const { roles } = loadRoles(dir);
  return roles.find((r) => r.id === id) || null;
}

// CLI: list roles (id / name / description / skills) as JSON.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir =
    process.argv[2] ||
    process.env.QCLAW_PRESETS_DIR ||
    resolve(process.cwd(), 'examples', 'agents');
  const { roles, errors, duplicateIds } = loadRoles(dir);
  const summary = roles.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    skills: r.skills
  }));
  console.log(
    JSON.stringify(
      { dir, count: roles.length, roles: summary, errors, duplicateIds },
      null,
      2
    )
  );
  if (errors.length || duplicateIds.length) process.exit(1);
}
