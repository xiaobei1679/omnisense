# Contributing to openclaw-workspace

This repo is a turnkey OpenClaw multi-agent workspace. Both humans and AI agents
are welcome to contribute. The rules below apply to everyone (and are enforced
by `AGENTS.md` for agents).

## 1. Set up locally
```bash
git clone <your-fork>
cd openclaw-workspace
cp .env.example .env
bash deploy/install.sh          # or: powershell -ExecutionPolicy Bypass deploy/install.ps1
```

## 2. Before you open a PR
- Run `node --check` on every `.js` file you touched (the CI does this too):
  ```bash
  node --check workspace/.learnings/scripts/*.js
  ```
- Make sure **no hardcoded absolute paths** appear (no `C:\Users\...`, `/Users/...`).
- Make sure you did **not** commit personal data or secrets:
  - Personal data (gitignored): `novel/`, `gbrain/`, `workspace/memory/`, `workspace/USER.md`
  - Secrets (gitignored): `config/openclaw.json`, `.env`
  - Edit the `.example` versions instead of the real (gitignored) files.

## 3. Open a PR
- Fill in the PR template checklist.
- The `Node Syntax Check` GitHub Action runs automatically on every PR and must
  pass before merge.

## 4. Good first issues
- See the **Agent task** / **Bug report** / **Feature request** issue templates
  under the "New issue" button — they are structured so an agent can pick one up
  directly.

## Conventions
- JS comments use `//`, never `#` (only `#!` shebang is allowed).
- Keep scripts cross-platform (no `2>nul`, `where`, `findstr`).
- Reuse helpers from `workspace/.learnings/scripts/lib/common.js`.
- When editing `.ps1`: no ternary `? :`; save as UTF-8 **with BOM**.

## 5. Autonomous agent (optional)
The repo ships an agent pipeline (`.github/workflows/agent-respond.yml` + `scripts/agent/respond.mjs`):
- Open an issue with the `agent-task` label, or comment `/agent` on any issue.
- An AI agent reads `AGENTS.md`, edits code, runs `node --check`, and opens a PR (human review required — it never auto-merges).

**LLM backend (pick one):**
- **Local, zero key (zero-budget):** `ollama pull qwen2.5-coder:3b && ollama serve`, then set
  `LLM_BASE_URL=http://127.0.0.1:11434/v1` (no `LLM_API_KEY` needed — auto-detected as local).
- **Free hosted key:** DeepSeek / Qwen / Moonshot free tiers → `LLM_API_KEY` + matching `LLM_BASE_URL`
  (on GitHub, store as a repo Secret).
- **OpenAI:** `LLM_API_KEY` (defaults to `api.openai.com/v1`).
- Without ANY usable LLM, the agent only posts a "how to enable" guide comment and takes no actions.

- **Local mode** (no GitHub needed): set `AGENT_LOCAL=1` + `AGENT_TASK_FILE=path.md` (see
  `scripts/agent/task.example.md`), then `node scripts/agent/respond.mjs`. It reads the task
  from the file, applies changes to your working tree, runs `node --check`, and commits to a
  local branch for you to review — no issue, secret, or PR required. With the Ollama backend
  above this runs fully offline.

