#!/usr/bin/env bash
# openclaw-workspace dev helper (Git Bash / Linux / macOS).
# Usage: ./scripts/dev.sh <command>
set -euo pipefail
NODE_BIN="${NODE:-node}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

case "${1:-help}" in
  check)
    "$NODE_BIN" scripts/ci/check-syntax.mjs
    ;;
  test)
    "$NODE_BIN" --test tests/*.test.mjs
    ;;
  validate)
    "$NODE_BIN" scripts/ci/validate-config.mjs
    ;;
  healthcheck)
    "$NODE_BIN" scripts/ci/check-syntax.mjs
    "$NODE_BIN" scripts/ci/validate-config.mjs
    "$NODE_BIN" --test tests/*.test.mjs
    ;;
  run-agent)
    AGENT_LOCAL=1 \
    AGENT_TASK_FILE="${AGENT_TASK_FILE:-scripts/agent/task.example.md}" \
    LLM_PROVIDER="${LLM_PROVIDER:-ollama}" \
    "$NODE_BIN" scripts/agent/respond.mjs
    ;;
  llm-adapter)
    "$NODE_BIN" scripts/llm/adapter.mjs $2 $3 $4
    ;;
  install)
    cp -n .env.example .env 2>/dev/null || true
    ./deploy/install.sh
    ;;
  install-hooks)
    bash scripts/install-hooks.sh
    ;;
  observer)
    "$NODE_BIN" scripts/ci/observer.mjs --diff
    ;;
  router)
    "$NODE_BIN" scripts/agent/router.mjs $2 $3 $4
    ;;
  reviewer)
    "$NODE_BIN" scripts/ci/reviewer.mjs $2 $3 $4
    ;;
  roles)
    "$NODE_BIN" scripts/agent/roles.mjs ${2:-}
    ;;
  evolve)
    "$NODE_BIN" scripts/evolve/ingest.mjs $2 $3 $4
    ;;
  dashboard)
    "$NODE_BIN" scripts/dashboard.mjs ${2:-}
    ;;
  release-notes)
    "$NODE_BIN" scripts/release/notes.mjs $2 $3 $4 $5 $6
    ;;
  doctor)
    "$NODE_BIN" scripts/doctor.mjs
    ;;
  permissions)
    "$NODE_BIN" scripts/security/permissions.mjs $2 $3 $4
    ;;
  skills)
    "$NODE_BIN" scripts/skills/registry.mjs --list ${2:-examples}
    ;;
  cost)
    "$NODE_BIN" scripts/llm/cost.mjs $2 $3 $4 $5 $6 $7
    ;;
  llm-cache)
    "$NODE_BIN" scripts/llm/cache.mjs $2 $3 $4 $5 $6 $7
    ;;
  circuit-breaker)
    "$NODE_BIN" scripts/llm/circuit-breaker.mjs $2 $3 $4
    ;;
  review)
    # Daily review gate: show everything not yet on the remote, then healthcheck.
    echo "=== Unpushed commits (local vs origin/main) ==="
    if git rev-parse --git-dir >/dev/null 2>&1; then
      UNPUSHED=$(git log origin/main..HEAD --oneline 2>/dev/null || git log --oneline -10)
      if [ -z "$UNPUSHED" ]; then
        echo "(none — local is in sync with origin/main)"
      else
        echo "$UNPUSHED"
        echo ""
        echo "=== File change summary (origin/main..HEAD) ==="
        git diff --stat origin/main...HEAD 2>/dev/null || git diff --stat HEAD~$(git log origin/main..HEAD --oneline 2>/dev/null | wc -l)
      fi
    else
      echo "(not a git repo)"
    fi
    echo ""
    echo "=== Healthcheck (syntax + config + tests) ==="
    "$NODE_BIN" scripts/ci/check-syntax.mjs
    "$NODE_BIN" scripts/ci/validate-config.mjs
    "$NODE_BIN" --test tests/*.test.mjs
    echo ""
    echo "✅ Review complete. If all green and changes look good, push with:"
    echo "   git push origin main"
    ;;
  *)
    echo "Usage: dev.sh {check|test|validate|healthcheck|run-agent|install|review|install-hooks|observer|router|reviewer|roles|evolve|dashboard|llm-adapter|release-notes|doctor|permissions|skills|cost|llm-cache|circuit-breaker}"
    exit 1
    ;;
esac
