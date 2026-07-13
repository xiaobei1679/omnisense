#!/usr/bin/env bash
# install-hooks.sh — point git at the repo's .githooks directory.
# Run once after cloning:  bash scripts/install-hooks.sh
# After this, every `git commit` runs .githooks/pre-commit (syntax + config + tests).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit 2>/dev/null || true
echo "✅ Git hooks installed from .githooks/ (pre-commit will run healthcheck)."
echo "   To skip once: git commit --no-verify"
