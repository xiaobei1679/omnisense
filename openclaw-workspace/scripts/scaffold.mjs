// scripts/scaffold.mjs
// Zero-dependency scaffolder: generate a starter skill or agent from a template.
// Lowers contribution friction — run it, fill in the blanks, open a PR.
//
// Usage:
//   node scripts/scaffold.mjs skill "My Skill"   -> examples/my-skill/SKILL.md + run.mjs
//   node scripts/scaffold.mjs agent "QA Bot"     -> examples/agent-qa-bot.md
//
// Programmatic API (exported for tests):
//   scaffold(type, rawName, opts) -> absolute path of the created file

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const REPO_ROOT = process.cwd();
const ALLOWED = new Set(['skill', 'agent']);

export function kebab(name) {
  // Keep every Unicode letter/number (Latin + CJK + accented + digits) so
  // non-English skill/agent names slug cleanly instead of collapsing to "".
  return name
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
}

function skillTemplate(slug, display) {
  return `# ${display}

> Short description of what this skill does and when to use it.

## When to use
- Describe the trigger scenarios.

## How it works
- Step-by-step logic.
- Reuse helpers from \`workspace/.learnings/scripts/lib/common.js\`.

## Example
\`\`\`bash
node run.mjs
\`\`\`

## Notes
- Keep it cross-platform. No \`2>nul\` / \`where\` / \`findstr\`.
- Every \`.js\` / \`.mjs\` must pass \`node --check\`.
`;
}

function skillRunTemplate(slug) {
  return `// examples/${slug}/run.mjs
// Starter entry for the "${slug}" skill. Edit freely.
export async function run(input = {}) {
  // TODO: implement skill logic here.
  return { ok: true, input };
}

// Run directly: node run.mjs
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  run({ args: process.argv.slice(2) }).then((r) => console.log(JSON.stringify(r)));
}
`;
}

function agentTemplate(slug, display) {
  return `# Agent: ${display}

## Role
- One-line responsibility.

## Model routing
- Which model / when to escalate.

## Task format (agent contract)
\`\`\`json
{"path":"relative/path","content":"<full new file content>"}
\`\`\`

## Notes
- Follow \`docs/AGENT_CONTRACT.md\`.
- Never edit \`config/openclaw.json\` or \`.env\`.
`;
}

export function scaffold(type, rawName, opts = {}) {
  if (!ALLOWED.has(type)) {
    throw new Error(`unknown type: ${type} (expected skill|agent)`);
  }
  if (!rawName || !rawName.trim()) {
    throw new Error('name is required');
  }
  const name = kebab(rawName);
  if (!name) {
    throw new Error('name produced an empty slug');
  }
  const root = opts.root || REPO_ROOT;

  let dir;
  let file;
  let content;
  if (type === 'skill') {
    dir = resolve(root, 'examples', name);
    file = resolve(dir, 'SKILL.md');
    content = skillTemplate(name, rawName.trim());
  } else {
    dir = resolve(root, 'examples');
    file = resolve(dir, `agent-${name}.md`);
    content = agentTemplate(name, rawName.trim());
  }

  // Safety: the resolved file must stay inside root.
  const rel = relative(root, file);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error('path escapes repo: ' + rel);
  }

  mkdirSync(dir, { recursive: true });
  writeFileSync(file, content);
  if (type === 'skill') {
    writeFileSync(resolve(dir, 'run.mjs'), skillRunTemplate(name));
  }
  return file;
}

// CLI entry
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const [type, name] = process.argv.slice(2);
  if (!type || !name) {
    console.error('Usage: node scripts/scaffold.mjs <skill|agent> <Name>');
    process.exit(1);
  }
  try {
    const out = scaffold(type, name);
    console.log(`✅ Created ${out}`);
  } catch (e) {
    console.error('scaffold failed:', e.message);
    process.exit(1);
  }
}
