// scripts/doctor.mjs
// Pre-flight environment check ("doctor") for openclaw-workspace.
//
// The repo promises "clone and run" (turnkey). `make healthcheck` validates the
// CODE (syntax/config/tests), but nothing tells a new contributor whether their
// MACHINE is set up to run it. `doctor` closes that gap: it verifies Node,
// git, a usable shell, the .env / config templates, LLM-backend readiness, and
// that the five quality-gate scripts exist — then prints a clear pass/fail.
//
// This mirrors a well-established OSS pattern: `npm doctor`, skills-check's
// `doctor` (Node/package-manager/registry/LLM-provider checks), rapidkit's
// `doctor` (drift detection before major ops), and OpenClaw Gateway's
// pre-flight runbook. Exit code is non-zero ONLY when a required (error)
// check fails; warnings (e.g. missing .env) are advisory and don't block.
//
// Every I/O boundary is injectable (opts) so the checks are unit-testable
// offline — the same dependency-injection philosophy as respond.mjs's
// callLLM / commitLocally seams.

import { existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const REQUIRED_NODE_MAJOR = 18;

// Run a shell command; return its trimmed stdout. Throws on non-zero exit.
function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}

// Probe whether a command exists (exit 0). Returns true/false.
function probe(cmd) {
  try {
    execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// --- individual checks (IO via injectable opts for offline testability) ---

// Node must be modern enough for ESM + the built-in test runner (>= 18).
export function checkNode(opts = {}) {
  const nodeVersion = opts.nodeVersion ?? process.versions.node;
  const major = parseInt(String(nodeVersion).split('.')[0], 10);
  if (major >= REQUIRED_NODE_MAJOR) {
    return {
      name: 'node',
      ok: true,
      severity: 'info',
      message: `Node v${nodeVersion} (>= ${REQUIRED_NODE_MAJOR} required)`,
    };
  }
  return {
    name: 'node',
    ok: false,
    severity: 'error',
    message: `Node v${nodeVersion} too old — require >= ${REQUIRED_NODE_MAJOR}`,
  };
}

// git is needed for the agent's local-commit path and for `make review`.
export function checkGit(opts = {}) {
  const execGit = opts.execGit ?? ((a) => sh(`git ${a}`));
  try {
    const out = execGit('--version');
    return { name: 'git', ok: true, severity: 'info', message: String(out).trim().split('\n')[0] };
  } catch {
    return { name: 'git', ok: false, severity: 'error', message: 'git not found on PATH' };
  }
}

// The dev commands run via bash (unix) or pwsh/powershell (win). Need at least one.
export function checkShell(opts = {}) {
  const probeCmd = opts.probe ?? probe;
  const hasBash = probeCmd('bash --version');
  const hasPwsh =
    probeCmd('pwsh --version') ||
    probeCmd('powershell -NoProfile -Command "$PSVersionTable.PSVersion.Major"');
  const shells = [];
  if (hasBash) shells.push('bash');
  if (hasPwsh) shells.push('pwsh');
  if (shells.length) {
    return { name: 'shell', ok: true, severity: 'info', message: `available: ${shells.join(', ')}` };
  }
  return {
    name: 'shell',
    ok: false,
    severity: 'error',
    message: 'neither bash nor pwsh available (need one to run dev commands)',
  };
}

// A configured .env (or at least the template) must exist to run agents.
export function checkEnvFiles(opts = {}) {
  const exists = opts.exists ?? ((p) => existsSync(p));
  if (exists('.env')) {
    return { name: 'env', ok: true, severity: 'info', message: '.env present (configured)' };
  }
  if (exists('.env.example')) {
    return {
      name: 'env',
      ok: true,
      severity: 'warn',
      message: '.env missing — copy from .env.example (cp .env.example .env)',
    };
  }
  return { name: 'env', ok: false, severity: 'error', message: '.env and .env.example both missing' };
}

// The agent config template (or a real config) must be present.
export function checkConfigFiles(opts = {}) {
  const exists = opts.exists ?? ((p) => existsSync(p));
  if (exists('config/openclaw.json')) {
    return { name: 'config', ok: true, severity: 'info', message: 'config/openclaw.json present (configured)' };
  }
  if (exists('config/openclaw.json.example')) {
    return {
      name: 'config',
      ok: true,
      severity: 'warn',
      message: 'config/openclaw.json missing — copy from .example before running agents',
    };
  }
  return {
    name: 'config',
    ok: false,
    severity: 'error',
    message: 'config/openclaw.json and .example both missing',
  };
}

// LLM backend: zero-key Ollama, a remote baseUrl, or an API key. Advisory only.
export function checkLLMBackend(opts = {}) {
  const env = opts.env ?? process.env;
  const provider = env.LLM_PROVIDER;
  const base = env.LLM_BASE_URL;
  const key = env.LLM_API_KEY;
  if (provider === 'ollama' || (base && /11434/.test(base))) {
    return { name: 'llm', ok: true, severity: 'info', message: 'local Ollama backend detected (zero-key ready)' };
  }
  if (base || key) {
    return { name: 'llm', ok: true, severity: 'info', message: 'remote LLM backend configured (baseUrl/key set)' };
  }
  return {
    name: 'llm',
    ok: false,
    severity: 'warn',
    message: 'no LLM backend set — agent prints setup guide only (set LLM_PROVIDER=ollama or LLM_API_KEY)',
  };
}

// All five quality-gate scripts must exist, or `make healthcheck` will fail.
export function checkGates(opts = {}) {
  const exists = opts.exists ?? ((p) => existsSync(p));
  const required = [
    'scripts/ci/check-syntax.mjs',
    'scripts/ci/validate-config.mjs',
    'scripts/ci/observer.mjs',
    'scripts/ci/reviewer.mjs',
    'scripts/eval/eval.mjs',
  ];
  const missing = required.filter((p) => !exists(p));
  if (!missing.length) {
    return { name: 'gates', ok: true, severity: 'info', message: 'all 5 quality-gate scripts present' };
  }
  return {
    name: 'gates',
    ok: false,
    severity: 'error',
    message: 'missing gate scripts: ' + missing.join(', '),
  };
}

// Orchestrate all checks. Returns { results, ok } where ok is false if any
// error-severity check failed (warnings do not block).
export function runDoctor(opts = {}) {
  const results = [
    checkNode(opts),
    checkGit(opts),
    checkShell(opts),
    checkEnvFiles(opts),
    checkConfigFiles(opts),
    checkLLMBackend(opts),
    checkGates(opts),
  ];
  const errors = results.filter((r) => !r.ok && r.severity === 'error');
  return { results, ok: errors.length === 0 };
}

function formatResult(r) {
  const icon = r.ok ? '✅' : r.severity === 'error' ? '❌' : '⚠️';
  return `${icon} ${r.name.padEnd(6)} ${r.message}`;
}

function main() {
  const { results, ok } = runDoctor();
  for (const r of results) console.log(formatResult(r));
  console.log('');
  if (ok) {
    console.log('✅ Environment ready — run `make healthcheck` to validate code, then `make run-agent`.');
  } else {
    console.log('❌ Some required checks failed. Fix the ❌ items above, then re-run `make doctor`.');
  }
  process.exitCode = ok ? 0 : 1;
}

// Only run when executed as the main module (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main();
}
