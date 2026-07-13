// scripts/agent/respond.mjs
// Autonomous agent responder for openclaw-workspace.
//
// Two run modes:
//   1) GitHub Actions (cloud): triggered by issue/issue_comment webhook. Reads
//      EVENT_PATH payload, comments on the issue, opens a PR via gh.
//   2) Local: set AGENT_LOCAL=1 and AGENT_TASK_FILE=<path.md> (or AGENT_TASK=<text>).
//      Reads the task from a local file, applies changes to the working tree,
//      runs `node --check`, and commits to a local branch (no GitHub interaction).
//
// Both modes ask an OpenAI-compatible LLM (LLM_API_KEY + optional LLM_BASE_URL/LLM_MODEL)
// to produce file changes. Without LLM_API_KEY they only print/comment setup guidance.
//
// Required env:
//   GITHUB_TOKEN   - (cloud only) auto-provided by Actions
//   EVENT_PATH     - (cloud only) webhook payload path
//   REPO           - (cloud only) owner/name
//   LLM_API_KEY    - OpenAI-compatible key (user-supplied secret)
//   LLM_BASE_URL   - optional, default https://api.openai.com/v1
//   LLM_MODEL      - optional, default gpt-4o-mini
//   AGENT_LOCAL    - set to 1 to run locally
//   AGENT_TASK_FILE- (local) path to a markdown task file (first line = title)

import { readFileSync, writeFileSync, rmSync, existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { execFileSync, execSync } from 'node:child_process';
import { resolve, relative, isAbsolute } from 'node:path';
// Adapter layer (ROADMAP "Adapter layer"): resolve the effective LLM connection
// config from a short LLM_PROVIDER name (openai/deepseek/qwen/moonshot/siliconflow/ollama)
// or explicit base/model/key overrides. Identical to the legacy flow when none are set.
import { buildConfig, chatCompletionsUrl, buildHeaders } from '../llm/adapter.mjs';
// Resilience layer (2026-07-09 round 2, GitHub-sourced, zero-dep):
//   prompt-cache (messkan/prompt-cache, karthyick/prompt-cache) + circuit
//   breaker (rheatkhs/yves-circuit-breaker). Both engage ONLY on the real
//   network path (when no test `opts.fetch` is injected) and opt out via the
//   LLM_CACHE / LLM_CIRCUIT env flags. Docs: docs/LLM_RESILIENCE.md.
import { lookup, store, DEFAULT_LEDGER } from '../llm/cache.mjs';
import { createBreaker, CircuitOpenError } from '../llm/circuit-breaker.mjs';

const REPO_ROOT = process.cwd();
const TOKEN = process.env.GITHUB_TOKEN;
const REPO = process.env.REPO;
const EVENT_PATH = process.env.EVENT_PATH;
const IS_LOCAL = process.env.AGENT_LOCAL === '1';
const FORBIDDEN = new Set(['config/openclaw.json', '.env']);
// Adapter layer: resolve connection config from LLM_PROVIDER / base / model / key.
// Defaults match the legacy behavior (OpenAI + gpt-4o-mini) when nothing is set.
const LLM = buildConfig({
  provider: process.env.LLM_PROVIDER,
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
  apiKey: process.env.LLM_API_KEY,
  apiKeyEnv: 'LLM_API_KEY',
});
// When the LLM endpoint is a local/Ollama server, no paid key is required.
const HAS_KEY = !!LLM.apiKey || LLM.isLocal;
// LLM request timeout (ms) and max retry count.
const LLM_TIMEOUT_MS = parseInt(process.env.LLM_TIMEOUT_MS || '120000', 10);
const LLM_RETRIES = parseInt(process.env.LLM_RETRIES || '1', 10);
// Max LLM response body size (2 MB) — prevents OOM from malformed responses.
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

// --- Resilience layer config (PRODUCTION DEFAULT ON; opt-out via env) ---
//   LLM_CACHE=0      disable the prompt cache
//   LLM_CIRCUIT=0    disable the circuit breaker
//   LLM_CACHE_PATH    ledger file (default .cache/llm-cache.json, gitignored)
//   LLM_CACHE_TTL     general (non-codegen) entry TTL (default 6h)
//   LLM_CACHE_MAX     ledger entry cap (default 500)
//   LLM_CACHE_CODEGEN set 0 to disable caching for CODE-GEN responses (default 1)
//   LLM_CACHE_CODEGEN_TTL  short TTL for codegen responses (default 10m) — a
//     cached failure can't self-heal, so codegen gets a short TTL by default
//   LLM_CB_FAILURE    consecutive failures that trip OPEN (default 3)
//   LLM_CB_COOLDOWN  ms to stay OPEN before probing (default 5000)
//   LLM_CB_SUCCESS    consecutive successes in HALF_OPEN that close it (default 2)
//   LLM_CB_PERSIST    path to persist breaker state across runs (default OFF /
//     in-memory; set e.g. .cache/llm-circuit.json so the breaker actually
//     matters under the one-process-per-call run model)
// The layer ENGAGES only on the real network path (no test `opts.fetch` injected)
// and is ALWAYS non-fatal: a cache/breaker failure falls through to a plain
// call, so resilience can never block a valid request.
const CACHE_ENABLED = (process.env.LLM_CACHE ?? '1') !== '0';
const CIRCUIT_ENABLED = (process.env.LLM_CIRCUIT ?? '1') !== '0';
const CACHE_LEDGER = process.env.LLM_CACHE_PATH || DEFAULT_LEDGER;
// Cache hygiene (bounds staleness + growth):
//   LLM_CACHE_TTL  ms after which a cached entry is treated as a miss (default
//     6h) — so a failed/undesired generation isn't frozen forever and can be
//     regenerated on a later retry. Set 0 to disable expiry.
//   LLM_CACHE_MAX  max ledger entries before oldest are evicted (default 500).
const CACHE_TTL_MS = Number(process.env.LLM_CACHE_TTL ?? 6 * 60 * 60 * 1000);
const CACHE_MAX = Number(process.env.LLM_CACHE_MAX ?? 500);
// Codegen cache: this responder ONLY does CODE GENERATION, where a cached
// failure can't self-heal (the broken output keeps matching the same key
// because a failed generation doesn't change `git ls-files`). So codegen
// responses get a SHORT default TTL (10m) and can be disabled outright via
// LLM_CACHE_CODEGEN=0 — the safe default for creative output. Non-codegen
// callers can pass opts.codegen=false to use the long CACHE_TTL_MS instead.
const CODEGEN_CACHE_ENABLED = (process.env.LLM_CACHE_CODEGEN ?? '1') !== '0';
const CODEGEN_TTL_MS = Number(process.env.LLM_CACHE_CODEGEN_TTL ?? 10 * 60 * 1000);
// Circuit-breaker persistence (opt-in). When set, the breaker reloads its
// state from this file on startup and rewrites it on every transition, so it
// protects across the one-process-per-call run model. Default OFF so the test
// suite stays hermetic (no stale OPEN state bleeding between separate runs).
const CB_PERSIST = process.env.LLM_CB_PERSIST || '';
const breaker = CIRCUIT_ENABLED
  ? createBreaker({
      failureThreshold: Number(process.env.LLM_CB_FAILURE ?? 3),
      cooldownMs: Number(process.env.LLM_CB_COOLDOWN ?? 5000),
      successThreshold: Number(process.env.LLM_CB_SUCCESS ?? 2),
      persistPath: CB_PERSIST || undefined,
    })
  : null;

let ISSUE_NUMBER = '';

// --- Lightweight observability: append-only JSONL run trace (non-fatal). ---
// Traces go to .agent-runs/run-<ts>.jsonl (gitignored). This is the minimal
// "tracing" pillar from production-grade agent practice — cheap, offline, no deps.
const RUN_LOG_DIR = resolve(REPO_ROOT, '.agent-runs');
const RUN_ID = Date.now();
function trace(stage, data = {}) {
  try {
    mkdirSync(RUN_LOG_DIR, { recursive: true });
    appendFileSync(
      resolve(RUN_LOG_DIR, `run-${RUN_ID}.jsonl`),
      JSON.stringify({ t: new Date().toISOString(), stage, ...data }) + '\n'
    );
  } catch {
    /* tracing must never break the agent */
  }
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8' });
}

function comment(body) {
  if (ISSUE_NUMBER) {
    const tmp = resolve(REPO_ROOT, '.agent-comment.tmp');
    writeFileSync(tmp, body);
    try {
      gh(['issue', 'comment', String(ISSUE_NUMBER), '--body-file', tmp]);
    } catch (e) {
      console.error('comment failed:', e.message);
    } finally {
      rmSync(tmp, { force: true });
    }
  } else {
    console.log('[agent comment]\n' + body);
  }
}

function loadPayload() {
  if (!EVENT_PATH) throw new Error('EVENT_PATH missing');
  return JSON.parse(readFileSync(EVENT_PATH, 'utf8'));
}

// Cloud: decide whether this event should trigger the agent.
function determineTrigger(payload) {
  const issue = payload.issue;
  if (!issue || issue.pull_request) return null; // skip PRs
  if (payload.action === 'opened') {
    const labels = (issue.labels || []).map((l) => l.name);
    if (labels.includes('agent-task')) return issue;
  }
  if (payload.action === 'created' && payload.comment) {
    const body = payload.comment.body || '';
    if (body.includes('/agent')) {
      if (payload.comment.user && payload.comment.user.type === 'Bot') return null; // no loops
      return issue;
    }
  }
  return null;
}

// Resolve the task to work on. Returns null when there's nothing to do.
function getTask() {
  if (IS_LOCAL) {
    const f = process.env.AGENT_TASK_FILE;
    const raw =
      f && existsSync(f) ? readFileSync(f, 'utf8') : process.env.AGENT_TASK || '';
    const lines = raw.split('\n');
    const title = (lines[0] || '').replace(/^#\s*/, '').trim() || 'Local agent task';
    const body = lines.slice(1).join('\n').trim();
    return { title, body, number: '', local: true };
  }
  const payload = loadPayload();
  const issue = determineTrigger(payload);
  if (!issue) {
    console.log('No agent trigger. Exiting.');
    return null;
  }
  return { title: issue.title, body: issue.body || '', number: issue.number, local: false };
}

// The raw network exchange — the unit the circuit breaker protects. Contains
// the AbortController timeout, auth headers, response guards, and the single
// transient RETRY. Caching / breaker are layered *around* this in callLLM.
function doFetch(cfg, fetchImpl, system, user, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  const headers = buildHeaders(cfg.apiKey);
  return Promise.resolve()
    .then(() =>
      fetchImpl(chatCompletionsUrl(cfg.baseUrl), {
        method: 'POST',
        headers,
        signal: controller.signal,
        body: JSON.stringify({
          model: cfg.model,
          temperature: 0.2,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        }),
      })
    )
    .then(async (res) => {
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`LLM HTTP ${res.status}: ${body.slice(0, 500)}`);
      }
      // Guard against oversized responses.
      const contentLength = parseInt(res.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_RESPONSE_BYTES) {
        throw new Error(`LLM response too large (${contentLength} bytes, limit ${MAX_RESPONSE_BYTES})`);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content || '';
    })
    .catch((e) => {
      // Retry once on transient failures (network errors / aborts that aren't from real timeouts).
      if (attempt < LLM_RETRIES && (e.name === 'AbortError' || e.cause?.code === 'ECONNRESET' || e.cause?.code === 'ECONNREFUSED')) {
        trace('llm_retry', { attempt: attempt + 1, error: e.message });
        return doFetch(cfg, fetchImpl, system, user, attempt + 1);
      }
      throw e;
    })
    .finally(() => clearTimeout(timer));
}

// Public LLM call used by the production pipeline. Layers the prompt cache and
// circuit breaker AROUND doFetch:
//   1) prompt-cache lookup  (skips the network on a hit)
//   2) circuit breaker     (fails fast when the endpoint is unhealthy)
//   3) store successful response into the cache
// Engagement rule: resilience is active on the real network path (no test
// `opts.fetch` injected) and opt-out via LLM_CACHE=0 / LLM_CIRCUIT=0. The
// `opts.resilience` flag can force it on/off regardless. Failures inside the
// cache/breaker wrappers are non-fatal — they fall through to a plain doFetch
// so resilience can never *block* a valid request.
// The fetch implementation is injectable via `opts.fetch` — the same DI seam as
// adapter.mjs's createClient — so tests / proxies / logging middleware can
// substitute a fake without `if (TESTING)` branches. `opts.config` overrides
// the resolved module config. Defaults keep legacy behavior identical.
export async function callLLM(system, user, opts = {}, attempt = 0) {
  const fetchImpl = opts.fetch || globalThis.fetch;
  const cfg = opts.config || LLM;
  // Codegen detection: this responder's sole purpose is code generation, so
  // default to codegen semantics (short TTL / can be disabled). A caller can
  // pass opts.codegen=false to opt into the long general TTL instead.
  const isCodeGen = opts.codegen ?? true;
  const cacheOn = CACHE_ENABLED && (isCodeGen ? CODEGEN_CACHE_ENABLED : true);
  const useResilience = (opts.resilience ?? !opts.fetch) && cacheOn;

  // Build the cache-key request (matches the body doFetch sends).
  const cacheMessages = [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
  const cacheOpts = {
    model: cfg.model,
    provider: cfg.provider,
    temperature: 0.2,
    ledgerPath: CACHE_LEDGER,
    ttlMs: isCodeGen ? CODEGEN_TTL_MS : CACHE_TTL_MS,
    maxEntries: CACHE_MAX,
    // Injectable clock (tests only) so cache TTL expiry can be asserted
    // deterministically without real-time waits.
    now: opts.cacheNow,
  };

  // 1) prompt-cache lookup
  if (useResilience) {
    try {
      const hit = lookup(cacheMessages, cacheOpts);
      if (hit.hit) {
        trace('llm_cache_hit', { key: hit.key, hits: hit.meta?.hits });
        return hit.value;
      }
    } catch {
      /* cache read failure must never block the request */
    }
  }

  // 2) circuit breaker (or plain call) around the network exchange
  let text;
  if (CIRCUIT_ENABLED && (opts.resilience ?? !opts.fetch)) {
    try {
      text = await breaker.exec(() => doFetch(cfg, fetchImpl, system, user, attempt));
    } catch (e) {
      if (e && e.name === 'CircuitOpenError') {
        trace('llm_circuit_open', {});
        throw new Error(
          `LLM circuit breaker is OPEN (endpoint failing) — failing fast instead of hammering: ${e.message}`
        );
      }
      throw e;
    }
  } else {
    text = await doFetch(cfg, fetchImpl, system, user, attempt);
  }

  // 3) store successful (non-empty) response into the cache
  if (useResilience && text) {
    try {
      store(cacheMessages, text, cacheOpts);
    } catch {
      /* cache write failure must never block the request */
    }
  }
  return text;
}

// Build the system + user prompts an autonomous agent run uses. Reading the
// file tree and AGENTS.md is read-only, so this is safe to call from tests and
// from runAgentOffline.
function buildAgentPrompts(task) {
  const tree = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean)
    .join('\n');
  const agentsMd = existsSync('AGENTS.md') ? readFileSync('AGENTS.md', 'utf8') : '';
  const system =
    `You are an autonomous coding agent for the openclaw-workspace repository.\n` +
    `Follow these repo rules strictly (from AGENTS.md):\n` +
    `- NEVER hardcode absolute paths; use env vars / os.homedir().\n` +
    `- NEVER edit or commit secrets (config/openclaw.json, .env) or personal data.\n` +
    `- Every .js must pass 'node --check'; use // comments, never #.\n` +
    `- Keep scripts cross-platform (no 2>nul / where / findstr).\n` +
    `- Reuse helpers in workspace/.learnings/scripts/lib/common.js.\n` +
    `You may ONLY edit files that already exist in the repo (or add new files under existing directories).\n` +
    `NEVER edit config/openclaw.json or .env.\n` +
    `Output ONLY a fenced \`\`\`json code block containing a JSON array of objects:\n` +
    `  [{"path": "relative/path", "content": "<full new file content>"}]\n` +
    `Include ONLY files you changed. If you cannot safely complete the task, output {"error":"reason"}.`;
  const user =
    `Repository file tree:\n${tree}\n\n` +
    `AGENTS.md:\n${agentsMd}\n\n` +
    `TASK${task.number ? ' (issue #' + task.number + ')' : ' (local)'}\n` +
    `Title: ${task.title}\n\nBody:\n${task.body || '(empty)'}\n\n` +
    `Produce the changes now.`;
  return { system, user };
}

// Offline, side-effect-free smoke of the agent pipeline's CONTRACT path:
//   task → build prompts → LLM (injected fake) → parseFiles → safePath validation.
// It does NOT write to disk and does NOT touch git, so it is safe to run in CI
// without a real LLM — the offline equivalent of the Ollama end-to-end
// verification the sandbox cannot perform. Returns { files, resolved } where
// resolved[i].full is the repo-absolute path (validated by safePath). Throws if
// the LLM output fails the parse contract or any path escapes the repo / hits a
// forbidden secret file.
export async function runAgentOffline({ task, fetchImpl = globalThis.fetch } = {}) {
  const t = task || { title: 'offline smoke', body: '', local: true };
  const { system, user } = buildAgentPrompts(t);
  const text = await callLLM(system, user, { fetch: fetchImpl });
  const files = parseFiles(text);
  const resolved = files.map((f) => ({ path: f.path, full: safePath(f.path), content: f.content }));
  return { files, resolved };
}

export function parseFiles(text) {
  if (!text || !text.trim()) throw new Error('parseFiles: empty or blank input');
  const m = text.match(/```json\s*([\s\S]*?)```/i) || text.match(/```\s*([\s\S]*?)```/);
  const raw = (m ? m[1] : text).trim();
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (e) {
    throw new Error(`parseFiles: invalid JSON — ${e.message} (first 200 chars: ${raw.slice(0, 200)})`);
  }
  if (obj && obj.error) throw new Error('LLM refused: ' + obj.error);
  if (!Array.isArray(obj)) throw new Error('expected JSON array of files, got ' + typeof obj);
  return obj;
}

export function safePath(p) {
  if (!p || isAbsolute(p) || p.includes('..')) throw new Error('invalid path: ' + p);
  if (/\x00/.test(p)) throw new Error('invalid path (null byte): ' + p);
  const full = resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, full);
  if (rel.startsWith('..') || rel === '') throw new Error('path escapes repo: ' + p);
  const norm = p.replace(/\\/g, '/');
  if (FORBIDDEN.has(norm)) throw new Error('forbidden path: ' + p);
  return full;
}

// Injectable git backend for the LOCAL commit path — the dependency-injection
// seam (symmetric with callLLM's `opts.fetch` and adapter's `createClient`) that
// makes the autonomous agent's git TOOL calls offline-testable. Per Tian Pan,
// "How to Integration-Test AI Agent Workflows in CI" (2026-04): the third layer
// of agent CI is TOOL-CONTRACT testing — mock the agent's tool calls (git, fs)
// and assert the EXACT commands, fully offline. The default backend is real
// `execSync`; tests substitute a fake that records commands. Behavior is
// identical to the previous inline implementation.
//   contract: checkout a fresh local branch → stage everything → commit as the
//   fixed bot identity (non-fatal, piped stdout).
export function commitLocally({ title, now = Date.now, git = defaultGit } = {}) {
  const branch = `agent/local-${now()}`;
  git(`checkout -B ${branch}`);
  git('add -A');
  git(`-c user.name="agent-bot" -c user.email="agent@noreply.github.com" commit -m "agent: ${title}"`, { stdio: 'pipe' });
  return branch;
}
function defaultGit(args, opts) {
  execSync(`git ${args}`, opts);
}

function nodeCheck(paths) {
  for (const f of paths) {
    if (/\.(js|mjs|cjs)$/i.test(f)) {
      try {
        execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' });
      } catch (e) {
        throw new Error(`node --check failed on ${f}:\n${e.stderr || e.message}`);
      }
    }
  }
}

async function main() {
  const task = getTask();
  if (!task) return;
  ISSUE_NUMBER = task.number;
  trace('task', { title: task.title, local: task.local, number: task.number });

  if (!HAS_KEY) {
    const guide =
      `🤖 **Agent Responder 已就绪，但未配置 LLM。**\n\n` +
      `三种方式启用（任选其一）：\n` +
      `1) 本地免密钥：装好 Ollama 并 \`ollama serve\`，设 \`LLM_PROVIDER=ollama\`（或 \`LLM_BASE_URL=http://127.0.0.1:11434/v1\`，无需 key）。\n` +
      `2) 免费托管密钥：DeepSeek / 通义 / Moonshot 等免费额度，设 \`LLM_PROVIDER=deepseek\`（或 qwen/moonshot）并填对应密钥环境变量（如 \`DEEPSEEK_API_KEY\`）。\n` +
      `3) OpenAI：设 \`LLM_API_KEY\`（默认指向 api.openai.com）。\n` +
      `可选 \`LLM_MODEL\`（本地默认 qwen2.5-coder:3b；云端默认 gpt-4o-mini）。\n\n` +
      `触发方式：云端给 issue 打 \`agent-task\` 标签或评论 \`/agent\`；本地设 \`AGENT_LOCAL=1\` + \`AGENT_TASK_FILE\`。`;
    comment(guide);
    return;
  }

  const { system, user } = buildAgentPrompts(task);

  comment(
    `🤖 收到，正在根据 AGENTS.md 分析任务${task.number ? ' #' + task.number : '（本地）'} 并生成改动…` +
      (task.local ? '' : '（将开 PR 供人工审核，不会自动合并）')
  );

  let text;
  try {
    text = await callLLM(system, user);
  } catch (e) {
    comment(`⚠️ 调用 LLM 失败：${e.message}`);
    return;
  }

  let files;
  try {
    files = parseFiles(text);
  } catch (e) {
    comment(
      `⚠️ 无法解析智能体输出：${e.message}\n\n原始输出：\n\`\`\`\n${text.slice(0, 2000)}\n\`\`\``
    );
    return;
  }

  const changed = [];
  for (const f of files) {
    const full = safePath(f.path);
    writeFileSync(full, f.content);
    changed.push(f.path);
  }
  trace('files_written', { changed });

  const tracked = execSync('git ls-files', { encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  try {
    nodeCheck([...tracked, ...changed]);
  } catch (e) {
    comment(`⚠️ 改动未通过 node --check，已中止：${e.message}`);
    trace('check_failed', { message: e.message });
    return;
  }
  trace('check_pass');

  if (task.local) {
    const branch = commitLocally({ title: task.title });
    console.log(`✅ 本地改动已提交到分支 ${branch}，请人工 review 后再 push / 开 PR。`);
    trace('committed', { branch, local: true });
    return;
  }

  const branch = `agent/issue-${task.number}`;
  execSync(`git checkout -B ${branch}`);
  execSync('git add -A');
  execSync(
    `git -c user.name="agent-bot" -c user.email="agent@noreply.github.com" commit -m "agent: address #${task.number}"`,
    { stdio: 'pipe' }
  );
  execSync(`git push origin ${branch}`);
  const prUrl = gh([
    'pr',
    'create',
    '--head',
    branch,
    '--base',
    'main',
    '--title',
    `agent: #${task.number} ${task.title}`.slice(0, 60),
    '--body',
    `Auto-generated by Agent Responder for #${task.number}.\n\nCloses #${task.number}`,
  ]).trim();

  comment(`✅ 已生成改动并通过 node --check，开 PR：${prUrl}（请人工审核后合并）`);
  trace('pr_created', { branch, url: prUrl });
}

// Only run when executed as the main module (not when imported by tests).
if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => {
    console.error('Agent error:', e);
    trace('error', { message: e.message });
    try {
      comment(`⚠️ 智能体执行出错：${e.message}`);
    } catch {}
    process.exit(0); // never fail the workflow run hard
  });
}
