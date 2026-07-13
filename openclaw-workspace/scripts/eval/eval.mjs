// scripts/eval/eval.mjs
// Eval harness — the "evaluation pillar" for openclaw-workspace.
//
// Design rationale (from multi-agent best-practice research):
//   - Anthropic "Demystifying evals for AI agents" (2026-01): run automated
//     evals during development, no real users needed; deterministic assertions
//     are first-class, probabilistic (LLM-judge) are layered on top.
//   - Google "evaluating multi-agent systems" codelab: an automated REGRESSION
//     pipeline that runs on every change, just like unit tests.
//   - attest-framework / zylos "agent-native CI": shadow-mode comparison to
//     catch agent output drift before it ships.
//
// This file delivers all three cheaply and with ZERO dependencies:
//
//   Layer 1 — DETERMINISTIC (always on, zero key, CI-gated):
//     Run the repo's pure agent functions (router / observer / scaffold) on
//     fixed inputs and assert INVARIANTS: determinism, contract-safety,
//     protected-path guards, secret-scan hits/misses, slug normalization.
//
//   Layer 2 — LLM-AS-JUDGE (optional, gated by EVAL_LLM_BASE_URL):
//     Score a sample agent output against a rubric (1-5). Skipped in CI
//     unless an OpenAI-compatible endpoint is configured. Never blocks CI.
//
//   Drift monitoring:
//     --baseline  snapshot every case's output -> scripts/eval/.eval-baseline.json
//     --compare   diff current outputs vs the baseline (schema + token-overlap
//                 similarity, a zero-dep proxy for semantic similarity)
//
// CLI:
//   node scripts/eval/eval.mjs                # run deterministic cases
//   node scripts/eval/eval.mjs --baseline     # write a baseline snapshot
//   node scripts/eval/eval.mjs --compare      # compare current vs baseline
//   node scripts/eval/eval.mjs --judge        # also run LLM-as-judge (needs key)
//
// Reused by `make eval` and `.github/workflows/node-check.yml`.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.EVAL_ROOT
  ? resolve(process.env.EVAL_ROOT)
  : resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE_PATH = resolve(ROOT, 'scripts', 'eval', '.eval-baseline.json');

// Import the deterministic agents we evaluate (their CLI guards won't fire on import).
import { route, classifyIntent, decompose, DEFAULT_REGISTRY } from '../agent/router.mjs';
import { isProtectedPath, isPathSafe, detectSecrets, runReview } from '../ci/observer.mjs';
import { kebab } from '../scaffold.mjs';

// ---------------------------------------------------------------------------
// Token-overlap similarity — a deterministic proxy for "semantic similarity"
// used by drift monitoring. Zero-dep: splits on letter/number runs (CJK-safe
// via unicode property escapes) and returns Jaccard similarity in [0,1].
// ---------------------------------------------------------------------------
export function tokens(s) {
  return String(s || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
}
function tokenSet(arr) {
  return new Set(arr);
}
export function similarity(a, b) {
  const ta = tokenSet(tokens(a));
  const tb = tokenSet(tokens(b));
  if (ta.size === 0 && tb.size === 0) return 1;
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  return inter / (ta.size + tb.size - inter);
}

// ---------------------------------------------------------------------------
// Eval cases. Each case's `evaluate()` returns:
//   { ok: boolean, detail: string, value: <serializable artifact> }
// `value` is captured for baseline/drift comparison.
// ---------------------------------------------------------------------------
const SAMPLE_TASK =
  '调研竞品的计费模式，然后撰写一份对比报告，并部署到 staging 环境后由 reviewer 复查';

export const EVAL_CASES = [
  {
    id: 'router-determinism',
    name: 'Router is deterministic (same input → identical plan)',
    category: 'deterministic',
    evaluate() {
      const a = route(SAMPLE_TASK);
      const b = route(SAMPLE_TASK);
      const ok = JSON.stringify(a) === JSON.stringify(b);
      return { ok, detail: ok ? 'identical plans' : 'NON-deterministic output!', value: a };
    },
  },
  {
    id: 'router-contract-shape',
    name: 'Router output obeys the agent-contract shape',
    category: 'deterministic',
    evaluate() {
      const p = route(SAMPLE_TASK);
      const ok =
        typeof p.task === 'string' &&
        typeof p.intent === 'string' &&
        typeof p.primaryAgent === 'string' &&
        Array.isArray(p.subtasks) &&
        p.subtasks.length > 0 &&
        p.subtasks.every((s) => 'id' in s && 'intent' in s && 'agent' in s && 'prompt' in s);
      const validAgents = new Set(DEFAULT_REGISTRY.map((a) => a.id));
      const agentsOk = p.subtasks.every((s) => validAgents.has(s.agent));
      return {
        ok: ok && agentsOk,
        detail: ok ? (agentsOk ? 'valid shape + agents' : 'subtask uses unknown agent') : 'shape violated',
        value: p,
      };
    },
  },
  {
    id: 'router-decompose',
    name: 'Router decomposes a multi-step task into >1 clause',
    category: 'deterministic',
    evaluate() {
      const clauses = decompose(SAMPLE_TASK);
      const ok = Array.isArray(clauses) && clauses.length >= 2;
      return { ok, detail: `${clauses.length} clauses`, value: clauses };
    },
  },
  {
    id: 'observer-protected-path',
    name: 'Observer blocks secret/private paths (.env, config, novel/)',
    category: 'deterministic',
    evaluate() {
      const blocked = ['.env', 'config/openclaw.json', 'novel/chapter1.md', 'gbrain/kb.ts']
        .every((f) => isProtectedPath(f));
      const allowed = ['src/agent/router.mjs', 'docs/AGENT_CONTRACT.md', 'examples/sample-skill/SKILL.md']
        .every((f) => !isProtectedPath(f));
      const ok = blocked && allowed;
      return {
        ok,
        detail: ok ? 'protected paths enforced' : 'protected-path guard failed',
        value: { blocked, allowed },
      };
    },
  },
  {
    id: 'observer-secret-scan',
    name: 'Observer detects a real secret but ignores placeholders',
    category: 'deterministic',
    evaluate() {
      const hit = detectSecrets('const key = "sk-abcdefghijklmnopqrstuvwx";').length > 0;
      const miss = detectSecrets('const key = "your-api-key-here";').length === 0;
      const ok = hit && miss;
      return { ok, detail: ok ? 'secret detected, placeholder ignored' : 'secret scan wrong', value: { hit, miss } };
    },
  },
  {
    id: 'observer-contract-safety',
    name: 'Observer rejects an agent contract with an unsafe path',
    category: 'deterministic',
    evaluate() {
      const bad = runReview({
        files: [],
        contractJson: JSON.stringify([{ path: '/etc/passwd', content: 'x' }]),
      });
      const good = runReview({
        files: [],
        contractJson: JSON.stringify([{ path: 'examples/ok/SKILL.md', content: 'x' }]),
      });
      const ok = !bad.passed && good.passed && !isPathSafe('/abs/path') && isPathSafe('rel/path.js');
      return {
        ok,
        detail: ok ? 'contract path safety enforced' : 'contract path safety failed',
        value: { badViolations: bad.violations.length, goodPassed: good.passed },
      };
    },
  },
  {
    id: 'scaffold-kebab',
    name: 'Scaffold normalizes names to safe kebab-case slugs',
    category: 'deterministic',
    evaluate() {
      const ok =
        kebab('My Cool Skill!!') === 'my-cool-skill' &&
        kebab('  QA  Bot  ') === 'qa-bot' &&
        kebab('写作-助手') === '写作-助手';
      return { ok, detail: ok ? 'slug normalization ok' : 'kebab failed', value: { a: kebab('My Cool Skill!!') } };
    },
  },
];

// Optional LLM-as-judge cases. Only executed when --judge + EVAL_LLM_BASE_URL set.
export const JUDGE_CASES = [
  {
    id: 'judge-router-coverage',
    name: 'LLM judge: router plan covers all task clauses',
    rubric:
      'Score 1-5 how well the agent plan covers every clause of the original task. ' +
      '5 = every clause routed; 1 = major clauses dropped. Reply JSON {"score":N,"reason":"..."}.',
    getOutput() {
      return JSON.stringify(route(SAMPLE_TASK), null, 2);
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
export function runCases(cases) {
  const results = [];
  for (const c of cases) {
    try {
      const r = c.evaluate();
      results.push({ id: c.id, name: c.name, category: c.category, ok: !!r.ok, detail: r.detail || '', value: r.value });
    } catch (e) {
      results.push({ id: c.id, name: c.name, category: c.category, ok: false, detail: String(e.message || e), value: null });
    }
  }
  const passed = results.filter((r) => r.ok).length;
  return { total: results.length, passed, failed: results.length - passed, results };
}

// ---------------------------------------------------------------------------
// Baseline / drift
// ---------------------------------------------------------------------------
export function writeBaseline(results, path = BASELINE_PATH) {
  const map = {};
  for (const r of results) map[r.id] = r.value;
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify({ generatedAt: new Date().toISOString(), cases: map }, null, 2), 'utf8');
  return path;
}

export function readBaseline(path = BASELINE_PATH) {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    return raw.cases || raw;
  } catch {
    return null;
  }
}

// Compare current results against a stored baseline. Returns drift report using
// token-overlap similarity as a deterministic proxy for semantic similarity.
export function compareBaseline(results, baseline = readBaseline()) {
  const drifts = [];
  if (!baseline) return { ok: false, drifts, note: 'no baseline found (run with --baseline first)' };
  for (const r of results) {
    if (!(r.id in baseline)) {
      drifts.push({ id: r.id, similarity: null, note: 'new case (no baseline)' });
      continue;
    }
    const sim = similarity(JSON.stringify(r.value), JSON.stringify(baseline[r.id]));
    if (sim < 0.98) drifts.push({ id: r.id, similarity: sim, note: 'drift detected' });
  }
  return { ok: drifts.length === 0, drifts };
}

// ---------------------------------------------------------------------------
// Optional LLM-as-judge (OpenAI-compatible). Skipped unless configured.
// ---------------------------------------------------------------------------
export async function judgeCase(c, { baseUrl, model, apiKey }) {
  const fetchFn = globalThis.fetch;
  if (typeof fetchFn !== 'function') throw new Error('global fetch unavailable in this Node version');
  const res = await fetchFn(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a strict eval judge. Always reply valid JSON only.' },
        { role: 'user', content: `${c.rubric}\n\nAGENT OUTPUT:\n${c.getOutput()}` },
      ],
    }),
  });
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '{}';
  let parsed;
  try { parsed = JSON.parse(content); } catch { parsed = {}; }
  return { id: c.id, name: c.name, score: parsed.score ?? null, reason: parsed.reason || '' };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const doBaseline = args.includes('--baseline');
  const doCompare = args.includes('--compare');
  const doJudge = args.includes('--judge');

  const summary = runCases(EVAL_CASES);

  if (doBaseline) {
    const p = writeBaseline(summary.results);
    console.log(`📸 Baseline written to ${relative(ROOT, p)}\n`);
  }

  if (doCompare) {
    const cmp = compareBaseline(summary.results);
    console.log('\n🔭 Drift monitoring:\n');
    if (cmp.note) console.log(`   ${cmp.note}`);
    for (const d of cmp.drifts) {
      console.log(`   ⚠️  ${d.id} — similarity=${d.similarity} (${d.note})`);
    }
    if (cmp.ok) console.log('   ✅ No drift vs baseline.\n');
  }

  if (doJudge) {
    const baseUrl = process.env.EVAL_LLM_BASE_URL;
    const model = process.env.EVAL_LLM_MODEL || 'gpt-4o-mini';
    const apiKey = process.env.EVAL_LLM_API_KEY;
    if (!baseUrl) {
      console.log('\n⏭️  LLM-as-judge skipped: set EVAL_LLM_BASE_URL to enable.\n');
    } else {
      console.log('\n⚖️  LLM-as-judge:\n');
      for (const c of JUDGE_CASES) {
        try {
          const r = await judgeCase(c, { baseUrl, model, apiKey });
          console.log(`   ${r.score ?? '?'} / 5  ${r.name}\n      ${r.reason}`);
        } catch (e) {
          console.log(`   ⚠️  ${c.name}: judge failed (${e.message})`);
        }
      }
    }
  }

  const icon = summary.failed === 0 ? '✅' : '❌';
  console.log(`\n${icon} Eval harness — ${summary.passed}/${summary.total} deterministic case(s) passed\n`);
  for (const r of summary.results) {
    console.log(`   [${r.ok ? 'PASS' : 'FAIL'}] ${r.id} — ${r.detail}`);
  }
  if (summary.failed > 0) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
