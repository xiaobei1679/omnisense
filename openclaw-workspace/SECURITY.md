# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| `main`  | ✅        |

We only maintain the latest `main` branch.

## Reporting a vulnerability

If you discover a security issue, **do not open a public issue**. Instead:

1. Open a security advisory on GitHub (repo → Security → Advisories → "Report a vulnerability"), or
2. Contact the maintainer privately via a GitHub issue labeled `security` with details redacted.

We aim to acknowledge within 72 hours and provide a fix plan within 7 days.

## Secrets policy (enforced by design)

- **No plaintext secrets are ever committed.** `config/openclaw.json` and `.env` are
  gitignored. Only `.env.example` and `config/openclaw.json.example` (placeholders) are tracked.
- Inject all tokens via environment variables at runtime.
- The autonomous agent (`scripts/agent/respond.mjs`) hard-blocks writes to
  `config/openclaw.json` and `.env` via `safePath()`; see `docs/AGENT_CONTRACT.md`.
- If a token is ever leaked, rotate it immediately on the provider side and treat the
  old value as burned.

## Supply-chain notes

- The agent pipeline calls an **OpenAI-compatible** LLM endpoint you control
  (`LLM_BASE_URL`). For zero-budget use, point it at a **local Ollama** instance
  (`http://127.0.0.1:11434/v1`) — no external data leaves your machine.
- CI runs `node --check` on every tracked script and `tests/smoke.test.mjs` guards the
  path-safety contract. A change that breaks these cannot be merged.
