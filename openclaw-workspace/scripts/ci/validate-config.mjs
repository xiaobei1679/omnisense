// scripts/ci/validate-config.mjs
// Configuration-first quality gate: verifies the PUBLISHED template configs are
// well-formed so a fresh clone never silently misconfigures.
// Used by `make validate`, `scripts/dev.sh validate`, and CI.
import { readFileSync, existsSync, mkdirSync, appendFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Variables that MUST be documented in .env.example (names only; values are user-supplied).
const REQUIRED_ENV_VARS = ['USER_DATA_DIR', 'PROJECT_DIR', 'HOT_DIR', 'KNOWLEDGE_DIR'];

/**
 * Validate the published template configs under `root`.
 * @returns {{ ok: boolean, problems: string[] }}
 */
export function validateConfig(root = ROOT) {
  const problems = [];
  const check = (cond, msg) => { if (!cond) problems.push(msg); };

  // 1) .env.example must document the required variables.
  const envPath = resolve(root, '.env.example');
  check(existsSync(envPath), '.env.example is missing');
  if (existsSync(envPath)) {
    const txt = readFileSync(envPath, 'utf8');
    for (const v of REQUIRED_ENV_VARS) {
      check(txt.includes(`${v}=`), `.env.example is missing documented variable: ${v}`);
    }
  }

  // 2) config/openclaw.json.example must be valid JSON with a non-empty agents.list.
  const cfgPath = resolve(root, 'config/openclaw.json.example');
  check(existsSync(cfgPath), 'config/openclaw.json.example is missing');
  if (existsSync(cfgPath)) {
    let obj;
    try {
      obj = JSON.parse(readFileSync(cfgPath, 'utf8'));
    } catch (e) {
      problems.push(`config/openclaw.json.example is not valid JSON: ${e.message}`);
      obj = null;
    }
    if (obj) {
      const list = obj?.agents?.list;
      check(Array.isArray(list) && list.length > 0, 'config agents.list must be a non-empty array');
      if (Array.isArray(list)) {
        const ids = new Set();
        for (const a of list) {
          check(typeof a?.id === 'string' && a.id, `an agent entry is missing "id": ${JSON.stringify(a).slice(0, 60)}`);
          check(typeof a?.name === 'string' && a.name, `agent ${a?.id || '?'} is missing "name"`);
          if (typeof a?.id === 'string' && a.id) {
            check(!ids.has(a.id), `duplicate agent id: ${a.id}`);
            ids.add(a.id);
          }
        }
        check(ids.has('main'), 'agents.list should contain a "main" agent');
      }
    }
  }

  return { ok: problems.length === 0, problems };
}

// Run when executed directly.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const { ok, problems } = validateConfig(ROOT);
  if (!ok) {
    console.error('✗ Config validation failed:');
    for (const p of problems) console.error('  - ' + p);
    process.exit(1);
  }
  console.log('✓ Config validation passed');
}
