# CLAUDE.md

This project's agent instructions live in **[AGENTS.md](./AGENTS.md)**.
Claude Code (and Codex / Copilot / other agents) should read that file before
operating on this repository.

Quick rules:
- All paths/tokens are environment-variable driven — **never hardcode absolute paths**.
- Personal data (`novel/`, `gbrain/`, `workspace/memory/`) and secrets
  (`config/openclaw.json`, `.env`) are gitignored — **never commit them**.
- After editing scripts, ensure `node --check` passes; PRs are auto-checked by
  the `Node Syntax Check` GitHub Action and must stay green.
