# openclaw-workspace — developer commands
# Windows users: use scripts/dev.ps1 (no make needed)
# *nix users: use scripts/dev.sh or this Makefile

.PHONY: check test validate healthcheck run-agent install verify review reviewer install-hooks observer router eval roles evolve dashboard llm-adapter release-notes doctor permissions skills cost llm-cache circuit-breaker help

check:   ## Syntax-check every tracked script
	$(NODE) scripts/ci/check-syntax.mjs

test:    ## Run functional smoke tests (node:test)
	$(NODE) --test tests/*.test.mjs

validate: ## Validate published template configs (config-first gate)
	$(NODE) scripts/ci/validate-config.mjs

healthcheck: ## Run check + validate + test + eval together
	$(NODE) scripts/ci/check-syntax.mjs
	$(NODE) scripts/ci/validate-config.mjs
	$(NODE) --test tests/*.test.mjs
	$(NODE) scripts/eval/eval.mjs

run-agent: ## Run the autonomous agent locally (keyless with Ollama)
	AGENT_LOCAL=1 AGENT_TASK_FILE=scripts/agent/task.example.md LLM_PROVIDER=ollama $(NODE) scripts/agent/respond.mjs

llm-adapter: ## Show resolved LLM provider config (or --list all providers)
	$(NODE) scripts/llm/adapter.mjs $(ARGS)

install: ## Copy .env.example -> .env and run deploy
	cp -n .env.example .env 2>/dev/null || true
	./deploy/install.sh

verify:  ## Run deploy verification
	./deploy/verify.ps1

review:  ## Daily review gate: show unpushed changes + run healthcheck
	bash scripts/dev.sh review

install-hooks: ## Enable local pre-commit hook (syntax + config + tests)
	bash scripts/install-hooks.sh

observer: ## Review current changes for rule violations (paths/secrets/syntax/contract)
	$(NODE) scripts/ci/observer.mjs --diff

reviewer: ## Full local review gate (syntax + config + observer + tests)
	$(NODE) scripts/ci/reviewer.mjs

router: ## Plan + route a task to specialist agents (deterministic, no key)
	$(NODE) scripts/agent/router.mjs $(ARGS)

eval:    ## Run the eval harness (deterministic regression + drift)
	$(NODE) scripts/eval/eval.mjs

roles:   ## List the bundled agent role presets (examples/agents)
	$(NODE) scripts/agent/roles.mjs

evolve:  ## Distill collected insights into framework-level improvement proposals
	$(NODE) scripts/evolve/ingest.mjs examples/insights

dashboard: ## Generate the static framework-state dashboard (.dashboard/index.html)
	$(NODE) scripts/dashboard.mjs

release-notes: ## Generate release notes from CHANGELOG.md (writes release-notes.md)
	$(NODE) scripts/release/notes.mjs $(ARGS)

doctor:  ## Pre-flight environment check (node/git/shell/env/config/llm/gates)
	$(NODE) scripts/doctor.mjs

permissions: ## Show / resolve the per-tool permission ladder (deny/ask/allow)
	$(NODE) scripts/security/permissions.mjs $(ARGS)

skills:  ## Discover & validate SKILL.md files under a dir (default: examples)
	$(NODE) scripts/skills/registry.mjs --list $(ARGS)

cost:    ## LLM token/cost helper: --estimate "text" | --cost --model X --prompt N --completion M | --models
	$(NODE) scripts/llm/cost.mjs $(ARGS)

llm-cache: ## LLM response cache (prompt caching): --messages '<json>' [--model X] | --stats [<ledger>]
	$(NODE) scripts/llm/cache.mjs $(ARGS)

circuit-breaker: ## Circuit breaker demo: CLOSED/OPEN/HALF_OPEN walk-through (--demo)
	$(NODE) scripts/llm/circuit-breaker.mjs $(ARGS)

help:    ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN{FS=":.*?## "}{printf "  %-10s %s\n", $$1, $$2}'
