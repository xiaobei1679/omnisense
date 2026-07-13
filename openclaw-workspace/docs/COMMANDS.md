# 命令参考 / Command Reference

> 本仓库对外文档统一采用「中文在前、英文在后」的单文件双语约定；下表每个单元格均为「中文说明 + 英文说明」。
> This repo's public docs follow the single-file bilingual convention (Chinese first, English after); each cell below carries both.

## 总览 / Overview（中文）

openclaw-workspace 通过 **三套等价入口** 暴露全部开发命令，任选其一即可：

- **Makefile**（\*nix / Git Bash）：`make <command>`
- **scripts/dev.sh**（\*nix / Git Bash）：`./scripts/dev.sh <command>`
- **scripts/dev.ps1**（Windows PowerShell）：`pwsh scripts/dev.ps1 <command>`

三套入口命令**完全一致**。下表汇总全部命令、所属类别、作用与关键参数/环境变量。
所有命令均为**零依赖 Node ESM**，无需 `npm install`。

## Overview（英文）

openclaw-workspace exposes every dev command through **three equivalent entrypoints** — pick any one:

- **Makefile** (\*nix / Git Bash): `make <command>`
- **scripts/dev.sh** (\*nix / Git Bash): `./scripts/dev.sh <command>`
- **scripts/dev.ps1** (Windows PowerShell): `pwsh scripts/dev.ps1 <command>`

All three entrypoints are **identical**. The table below lists every command, its category, purpose, and key args/env vars.
Every command is **zero-dependency Node ESM** — no `npm install` required.

## 命令清单 / Command list

| 命令 / Command | 类别 / Category | 说明 / Description | 关键参数 / 环境变量 / Args & Env |
|------|------|------|------|
| `check` | 质量门禁 / Quality gate | 对所有已跟踪脚本跑 `node --check` 语法扫描 / Syntax-scan every tracked `.js/.mjs/.cjs` via `node --check` | — |
| `test` | 质量门禁 / Quality gate | 运行 `node:test` 功能冒烟测试 / Run functional smoke tests (`node:test`) | `node --test tests/*.test.mjs` |
| `validate` | 质量门禁 / Quality gate | 校验发布版模板配置形态（`.env.example` / `config/openclaw.json.example`），config-first 门禁 / Validate published template config shape (config-first gate) | — |
| `healthcheck` | 质量门禁 / Quality gate | 一口气跑 `check` + `validate` + `test` + `eval` / Runs check + validate + test + eval in one pass | — |
| `observer` | 质量门禁 / Quality gate | 审查当前改动：禁改路径守卫 / 明文密钥扫描 / 语法 / 智能体契约安全 / Review the current diff for protected-path / secret-scan / syntax / agent-contract violations | 默认带 `--diff` |
| `reviewer` | 质量门禁 / Quality gate | 本地全树审核专员：聚合 syntax+config+observer+tests 出结构化 PASS/FAIL 裁决 / Full local review gate aggregating syntax+config+observer+tests into a structured PASS/FAIL verdict | 退出码 0=PASS，非 0=FAIL |
| `doctor` | 质量门禁 / Quality gate | 环境就绪预检：node≥18 / git / shell / `.env` 或模板 / `config/openclaw.json` 或模板 / LLM 后端 / 五大门禁脚本存在性 / Pre-flight env check: node≥18 / git / shell / `.env` or template / `config/openclaw.json` or template / LLM backend / quality-gate scripts | error 级失败才非 0 退出；warn 级仅提示 |
| `run-agent` | 智能体运行时 / Agent runtime | 本地零密钥跑自主智能体（默认 Ollama）/ Run the autonomous agent locally (keyless, Ollama by default) | `AGENT_LOCAL=1`、`AGENT_TASK_FILE=<任务文件>`、`LLM_PROVIDER=ollama` |
| `router` | 智能体运行时 / Agent runtime | 确定性任务规划 / 路由到专家 agent（无需密钥）/ Deterministic task planner/router to specialist agents (no key) | `make router -- "你的任务"`（参数透传） |
| `roles` | 角色与技能 / Roles & skills | 列出开箱即用角色预设（`examples/agents`）/ List bundled agent role presets | — |
| `skills` | 角色与技能 / Roles & skills | 发现并校验 `SKILL.md`（默认扫 `examples`）/ Discover & validate `SKILL.md` files (default: `examples`) | `make skills [dir]` |
| `evolve` | 框架演化 / Evolution | 把中立洞察蒸馏为框架级改进提案（绝不写项目内容）/ Distill collected insights into framework-level improvement proposals | 默认读 `examples/insights`；可设 `OPENCLAW_INSIGHTS_DIR` 覆盖 |
| `dashboard` | 框架演化 / Evolution | 生成静态框架状态仪表盘（`.dashboard/index.html`，可离线打开）/ Generate static framework-state dashboard (offline-openable) | 生成物不入库（已 gitignore） |
| `release-notes` | 发布 / Release | 从 `CHANGELOG.md` 公开段生成发布说明（自动截断于内部段）/ Generate release notes from CHANGELOG public section | `--version X --out <file> --json` |
| `llm-adapter` | LLM 工具 / LLM utilities | 解析 / 展示 LLM provider 配置；`--list` 列全部 / Show resolved LLM provider config; `--list` all | `make llm-adapter -- --list` |
| `cost` | LLM 工具 / LLM utilities | token / 成本估算（确定性启发式，标为 estimate）/ Token & cost estimator (deterministic heuristic, marked estimate) | `--estimate "文本"` / `--cost --model X --prompt N --completion M` / `--models` |
| `llm-cache` | LLM 工具 / LLM utilities | prompt 缓存：按 `(provider,model,采样,messages)` 哈希命中则跳过重复 LLM 调用 / Prompt cache: hash-hit skips duplicate LLM calls | `--messages '<json>' [--model X]` / `--stats` |
| `circuit-breaker` | LLM 工具 / LLM utilities | 熔断器状态机演示（CLOSED/OPEN/HALF_OPEN）/ Circuit breaker state-machine demo | `--demo` |
| `permissions` | 权限 / Permissions | 展示 / 解析 per-tool 权限阶梯（deny / ask / allow）/ Show/resolve per-tool permission ladder | `--list` / `--tool git:push` |
| `install` | 安装 / Install | 复制 `.env.example` → `.env` 并跑一键部署 / Copy `.env.example` → `.env` and run deploy | — |
| `install-hooks` | 安装 / Install | 启用本地 pre-commit 钩子（提交前跑 healthcheck）/ Enable local pre-commit hook (runs healthcheck before each commit) | — |
| `review` | 每日复盘 / Daily review | 展示未推送改动 + 跑 healthcheck，供人工每日 review / Show unpushed changes + healthcheck, for human daily review | — |
| `help` | 帮助 / Help | 显示命令帮助 / Show command help | `make help` |

## 常用环境变量 / Common environment variables

| 变量 / Variable | 作用 / Purpose | 默认值 / Default |
|------|------|------|
| `LLM_PROVIDER` | 驱动 adapter 的厂商：`openai` \| `deepseek` \| `qwen` \| `moonshot` \| `siliconflow` \| `ollama`；未设回退 OpenAI 默认 / Drives the adapter; unset falls back to OpenAI default | （未设 / unset） |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | 显式 LLM 连接，优先级最高，覆盖 provider 默认 / Explicit LLM connection, highest priority, overrides provider default | — |
| `LLM_TIMEOUT_MS` / `LLM_RETRIES` | 请求超时（毫秒）/ 瞬态故障重试次数 / Request timeout (ms) / transient retry count | `120000` / 内置重试 |
| `LLM_CACHE` / `LLM_CACHE_PATH` | 响应缓存开关（设 `0` 关闭）/ 账本路径 / Response-cache toggle (set `0` to disable) / ledger path | `1` / `.cache/llm-cache.json` |
| `LLM_CIRCUIT` / `LLM_CB_FAILURE` / `LLM_CB_COOLDOWN` / `LLM_CB_SUCCESS` | 熔断器开关与阈值（设 `0` 关闭）/ Circuit-breaker toggle & thresholds (set `0` to disable) | `1` / `3` / `5000` / `2` |
| `AGENT_LOCAL` / `AGENT_TASK_FILE` | 本地跑 agent 开关 / 任务文件路径 / Local agent toggle / task file path | `1` / `scripts/agent/task.example.md` |
| `OPENCLAW_INSIGHTS_DIR` | 覆盖 `evolve` 默认洞察源（一次性指到中立采集目录）/ Override `evolve` default insight source | `examples/insights` |
| `EVAL_LLM_BASE_URL` | 启用 eval 的 LLM-as-judge 层；不配则不跑、不阻塞 / Enables eval's LLM-as-judge layer; unset → skipped, never blocks | （未设 / unset） |
| `NODE` | 覆盖 node 二进制路径（旧系统 node 时）/ Override node binary path (for legacy system node) | `node` |

## 重要约定 / Important conventions

- **绝不 git push / Never push**: 本仓库约定为「本地持续迭代 + 用户每日 review 后手动推送」。自动化只负责本地 commit，推送由你手动完成。/ This repo's convention is *local iteration + manual push after your daily review*. Automation only commits locally; you push manually.
- **零依赖 / Zero-dependency**: 所有脚本均为纯 Node ESM，克隆即跑，无需 `npm install`。/ All scripts are pure Node ESM — clone-and-run, no `npm install`.
- **入口等价 / Entrypoints identical**: `make` / `dev.sh` / `dev.ps1` 命令完全一致；Windows 用户用 `dev.ps1` 即可，无需 make。/ `make` / `dev.sh` / `dev.ps1` are identical; Windows users use `dev.ps1`, no make needed.
