// scripts/ci/check-syntax.mjs
// Canonical syntax checker for openclaw-workspace.
// Reused by: GitHub Actions (node-check.yml), `make check`, and tests/smoke.test.mjs.
//
// Scans all tracked *.js / *.mjs / *.cjs (excluding node_modules / .git) and runs
// `node --check` on each. Exits non-zero if any file fails.

import { execFileSync, execSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function collectScripts() {
  const out = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(js|mjs|cjs)$/i.test(f))
    .filter((f) => !f.includes('node_modules') && !f.startsWith('.git/'));
  return out;
}

export function checkAll() {
  const files = collectScripts();
  const failed = [];
  for (const f of files) {
    const abs = resolve(ROOT, f);
    try {
      execFileSync(process.execPath, ['--check', abs], { stdio: 'pipe' });
    } catch (e) {
      failed.push({ file: f, error: (e.stderr || e.message || '').toString().trim() });
    }
  }
  return { total: files.length, failed };
}

// Run when executed directly.
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const { total, failed } = checkAll();
  if (failed.length === 0) {
    console.log(`✅ All ${total} tracked scripts pass node --check.`);
    process.exit(0);
  }
  console.error(`❌ ${failed.length}/${total} scripts failed node --check:`);
  for (const f of failed) console.error(`  - ${f.file}\n${f.error}`);
  process.exit(1);
}
