# AGENTS.md — Instructions for AI Agents

This repository is a **turnkey OpenClaw multi-agent workspace**. Any AI agent
(Codex, Claude Code, Copilot, another OpenClaw instance, etc.) can clone it,
configure it via environment variables, and run/contribute without editing code.

## What this repo is
- A reusable OpenClaw agent workspace: `config/openclaw.json.example` defines 9
  generic agents (reviewer / writer / memory-keeper / …). Real `config/openclaw.json`
  is gitignored — never commit it.
- Core code lives in `workspace/.learnings/scripts/` (~30 Node.js ops/analysis scripts).
- Paths and secrets are **100% environment-variable driven** (zero hardcoded paths).

## Repository layout (key paths)
| Path | Purpose |
|------|---------|
| `config/openclaw.json.example` | Agent config template (edit this, not the real file) |
| `.env.example` → `.env` | All paths/tokens via env vars |
| `workspace/.learnings/scripts/` | The ~30 Node.js scripts (core code) |
| `workspace/.learnings/scripts/lib/common.js` | Shared path/CJK/atomic-write helpers — reuse these |
| `workspace/USER.md.example` | User profile template |
| `deploy/install.ps1` · `deploy/install.sh` | One-shot deploy (auto-creates empty dirs) |
| `workspace/tools/` | Auxiliary tool scripts |

## Local setup / verification
```bash
cp .env.example .env                      # fill QCLAW_PROJECT_DIR etc. as needed
bash deploy/install.sh                    # or: powershell -ExecutionPolicy Bypass deploy/install.ps1
make doctor                               # pre-flight env check (node/git/shell/.env/config/llm/gates) — runs offline
make check                                # syntax check all scripts (alias: scripts/dev.sh check)
node --test tests/                        # functional smoke tests (safePath / parseFiles / checkAll)
make validate                             # validate published template configs (config-first gate)
make healthcheck                          # check + validate + test + eval together
```

## Tests
- `tests/smoke.test.mjs` — functional tests over the **real** exported logic
  (`safePath`, `parseFiles`, and the `node --check` sweep in `scripts/ci/check-syntax.mjs`).
- `tests/edge-cases.test.mjs` — boundary & security tests (null bytes, empty inputs,
  deep escapes, multi-file payloads, non-standard fence formats).
- `tests/observer.test.mjs` — Observer Agent: protected paths, secret scan, syntax gate,
  and agent-contract path safety (the automated PR reviewer in `scripts/ci/observer.mjs`).
- `tests/router.test.mjs` — Router Agent: intent classification, task decomposition, and
  specialist routing for the planner in `scripts/agent/router.mjs`.
- `tests/reviewer.test.mjs` — Reviewer specialist: the automated review gate in
  `scripts/ci/reviewer.mjs` (syntax + config + functional tests + observer), the PASS/FAIL
  verdict that gates **local** commits (it never pushes — see the contribution flow below).
- `tests/validate-config.test.mjs` — covers the published `.env.example` + `config/openclaw.json.example` shape.
- `scripts/ci/check-syntax.mjs` — the canonical syntax gate reused by CI, `make check`, and the tests.
- `scripts/ci/validate-config.mjs` — config-first gate: ensures the shipped templates are well-formed.
  Run all: `node --test tests/*.test.mjs` or `make test`.

## See also
- `docs/README.md` — documentation index and the bilingual (中/EN) convention for `docs/`.
- `docs/AGENT_CONTRACT.md` — the agent interaction contract (task format, change JSON, path safety).
- `docs/ARCHITECTURE.md` — system architecture diagrams and autonomous pipeline flow (bilingual).
- `ROADMAP.md` — what's done / in progress / next.
- `SECURITY.md` — vulnerability reporting and secrets policy.
- `CODE_OF_CONDUCT.md` — community behavior standards.
- `.editorconfig` — coding style contract for all editors.
- `QUICKSTART.md` — get running in 5 minutes (local zero-key or framework deploy).
- `examples/` — copy-paste skill template and a sample agent task (study these first).
- `scripts/dev.sh` / `scripts/dev.ps1` / `Makefile` — everyday commands.

## Contribution flow
1. Fork / branch → make your change.
2. **Run `node --check` on every script you touched** and ensure it passes
   (`make check`). Also run `node --test tests/` for the functional smoke tests.
3. Open a PR → the `Node Syntax Check` and `Observer Agent Review` GitHub Actions run
   automatically and **must be green** to merge. (Local pre-commit hook also runs the
   Observer Agent via `scripts/ci/observer.mjs --diff`.)

The hourly auto-iteration automation commits locally and then runs
`scripts/ci/reviewer.mjs`; it **never pushes to any remote** — a human reviews and pushes
`origin/main` manually after the daily review (local-only iteration, by design).

## Hard rules (violations get blocked by CI or review)
- ❌ **No hardcoded absolute paths** (especially `C:\Users\Administrator`, `/Users/...`).
  Always use env vars (`QCLAW_PROJECT_DIR` etc.) or `os.homedir()` + `path.join()`.
- ❌ **No personal data**: `novel/`, `gbrain/`, `workspace/memory/`, `workspace/USER.md`
  are gitignored — never `git add -f` them.
- ❌ **No secrets**: `config/openclaw.json`, `.env` are gitignored. Change the `.example` files instead.
- ✅ Every `.js` must pass `node --check`.
- ✅ JS comments use `//` — **never `#`** (only `#!` shebang is allowed, else `node --check` fails).
- ✅ **Cross-platform**: no `2>nul`, `where`, `findstr`. Use Node APIs or `process.platform` branches.
- ✅ When editing `.ps1` (PowerShell 5.1 compat): no ternary `? :` (use `if/else`); file must be UTF-8 **with BOM**.
- ✅ Reuse helpers from `workspace/.learnings/scripts/lib/common.js` (paths, atomic write, CJK count).

## Anti-over-engineering principles (design philosophy)
Borrowed directly from Anthropic's **#1 rule** in *Building Effective Agents*
(2024-12-19) and the 2026 "When Not to Build AI Agents" playbook:
**start with the simplest thing that works** — a single LLM call beats a workflow,
a workflow beats a multi-agent system. Apply this explicitly when extending this repo:
- ❌ Don't add a feature just because another framework has it. Only add when the
  added complexity **measurably improves** the result for the turnkey use case.
- ❌ Don't introduce new npm/Python dependencies. **Zero-dependency Node ESM is a
  hard constraint, not a style preference** — it is what makes the repo clone-and-run.
- ✅ New code must be **verifiable**: pure functions + `node --test` coverage +
  a quality-gate entry point (Makefile / dev.sh / dev.ps1). No code without tests.
- ✅ Prefer reusing `workspace/.learnings/scripts/lib/common.js` over writing new helpers.
- ✅ The auto-iteration automation must **pause when the framework is at a high
  maturity mark** (quality gates all green, Next items are doc/research-only) to
  avoid piling changes that burden human daily review. Doc-level polish is fine;
  stacking features is not.

## Path conventions (reuse, don't reinvent)
- Project output dir: `process.env.QCLAW_PROJECT_DIR` (default `项目产出`)
- Hotspot dir: `process.env.QCLAW_HOT_DIR`
- Knowledge dir: `process.env.QCLAW_KNOWLEDGE_DIR`
Defaults/parsing live in `workspace/.learnings/scripts/lib/common.js`.

> Note: the public repo ships **empty framework only** — `gbrain/` (66 MB knowledge base)
> and user novels stay local and are not published. Deploy scripts create empty dirs so it runs.

## Autonomous agent pipeline (optional)
This repo includes a GitHub Action (`.github/workflows/agent-respond.yml`) that lets an
AI agent manage issues autonomously:
- Open an issue labeled `agent-task`, **or** comment `/agent` on any issue.
- The `Agent Responder` reads this `AGENTS.md`, asks an LLM to produce changes,
  runs `node --check` on all scripts, and **opens a PR for human review** (it never merges).

### LLM backend (3 options — pick one)
1. **Local, zero key (recommended for zero-budget)**: install [Ollama](https://ollama.com),
   run `ollama pull qwen2.5-coder:3b && ollama serve`, then point the agent at it:
   `LLM_BASE_URL=http://127.0.0.1:11434/v1` (no `LLM_API_KEY` needed — it's auto-detected).
2. **Free hosted key**: DeepSeek / Qwen / Moonshot free tiers — set `LLM_API_KEY` +
   the matching `LLM_BASE_URL`. On GitHub, store it as a repo **Secret**.
3. **OpenAI**: set `LLM_API_KEY` (defaults to `api.openai.com/v1`).
- Optional `LLM_MODEL` (local default `qwen2.5-coder:3b`; cloud default `gpt-4o-mini`).
- Without ANY usable LLM, the agent only posts a "how to enable" guide comment and
  takes no code actions.

### Local mode (no GitHub needed)
- Set `AGENT_LOCAL=1` and `AGENT_TASK_FILE=path.md`, then `node scripts/agent/respond.mjs`.
- It reads the task from the file, applies changes to your working tree, runs `node --check`,
  and commits to a local branch (`agent/local-<ts>`) for you to review. Works fully offline
  with the Ollama backend above. See `scripts/agent/task.example.md`.

---
# 中文说明（详细版）
本仓库是开箱即用的 OpenClaw 多智能体工作区。任何智能体 clone 后按下方配置即可运行与贡献。

**结构**：核心代码在 `workspace/.learnings/scripts/`（约 30 个 Node 脚本）；`config/openclaw.json.example` 是 9 个通用 agent 模板（真实 `config/openclaw.json` 已 gitignore，勿提交）；所有路径/令牌走环境变量，零硬编码。

**流程**：开分支改代码 → 本地 `node --check` 全过 → 开 PR，GitHub Actions（`Node Syntax Check`）自动校验，必须全绿才合并。

**硬规则**：禁硬编码绝对路径（`C:\Users\...`/`/Users/...`）；禁提交个人数据（novel/、gbrain/、memory/、USER.md）与密钥（config/openclaw.json、.env）；`.js` 须过 `node --check`；JS 注释用 `//` 不用 `#`；跨平台（禁 `2>nul`/`where`/`findstr`）；改 `.ps1` 用 `if/else` 且带 UTF-8 BOM；复用 `lib/common.js` 的约定。

## 反过度工程原则（设计哲学）
直接取自 Anthropic《Building Effective Agents》(2024-12-19) **第一原则** 与 2026《When Not to Build AI Agents》playbook：**从最简单能用的方案起步**——单次 LLM 调用优于 workflow，workflow 优于多智能体。扩展本仓库时显式遵循：
- ❌ 别因"别人有"就加特性。仅当新增复杂度**显著改善**开箱即用结果时才加。
- ❌ 别引入新 npm/Python 依赖。**零依赖 Node ESM 是硬约束而非风格偏好**——它是仓库 clone-and-run 的基石。
- ✅ 新代码必须**可验证**：纯函数 + `node --test` 覆盖 + 质量门入口（Makefile / dev.sh / dev.ps1）。无测试不入库。
- ✅ 优先复用 `workspace/.learnings/scripts/lib/common.js`，别另写 helper。
- ✅ 自动化工位在**框架达高成熟度**（质量门全绿、Next 仅剩文档/研究级）时须**主动暂停**，避免堆改动加重人工每日 review 负担。文档级打磨可以；堆特性不行。
