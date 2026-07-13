# 架构说明 — openclaw-workspace（中文）

> 本仓库对外文档统一采用「中文在前、英文在后」的双语约定（见 `docs/README.md`）。
> 架构图使用 ASCII 盒图，语言无关，中英两版共用同一图示。

## 系统总览

```
┌─────────────────────────────────────────────────────┐
│                   User / Trigger                     │
│         (CLI / Issue / Cron / Agent Task)            │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              OpenClaw Gateway                        │
│           (config/openclaw.json)                     │
│     路由 → 鉴权 → 智能体分发 → 工具调用              │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
┌───────────┐ ┌─────────┐ ┌──────────────┐
│  主       │ │  团队   │ │ 自主智能体   │
│  智能体   │ │  CLI    │ │ 管线         │
│           │ │         │ │(respond.mjs) │
└─────┬─────┘ └────┬─────┘ └──────┬───────┘
      │            │              │
      ▼            ▼              ▼
┌─────────────────────────────────────────────────────┐
│                  工作区层 (Workspace)                  │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ 身份     │ │ 记忆     │ │ 工具 / 脚本        │  │
│  │ SOUL.md  │ │ MEMORY.md│ │ .learnings/        │  │
│  │ AGENTS.md│ │ memory/  │ │ skills/  tools/    │  │
│  └──────────┘ └──────────┘ └────────────────────┘  │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│                  产出层 (Output)                      │
│      project/   knowledge/   dashboard/             │
└─────────────────────────────────────────────────────┘
```

## 自主智能体管线

```
触发 (issue 标签 / 评论 / 本地环境变量)
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ 1. 读取任务 │──▶│ 2. 调用 LLM  │──▶│ 3. 解析产物 │
│ (getTask)   │    │ (callLLM)    │    │(parseFiles) │
└─────────────┘    └──────────────┘    └──────┬──────┘
                                               │
                    ┌──────────────┐            ▼
                    │ 6. 提交 /    │    ┌─────────────┐
                    │    PR        │◀───│ 4. 写文件 + │
                    │              │    │ node --check │
                    └──────────────┘    └─────────────┘
                           ▲                 │
                           │                 ▼
                    ┌──────────────┐   ┌─────────────┐
                    │ 5. 追踪日志 │   │ .agent-runs/ │
                    │ (.jsonl)    │   │  run-*.jsonl │
                    └──────────────┘   └─────────────┘
```

**运行模式：**
- **本地模式**（`AGENT_LOCAL=1`）：读取任务文件 → 修改工作区 → `node --check` → 提交到本地分支。配合本机 Ollama 可零密钥运行。
- **云端模式**（GitHub Actions）：issue webhook → LLM → 通过 `gh` 开 PR。**绝不自动合并**。

## 智能体团队

| 角色 | 职责 | 状态 |
|------|------|------|
| main | 总编排 | active |
| writer | 内容创作 | active |
| architect | 世界观 / 设定维护 | active |
| tech-producer | 视频管线 / 游戏原型 | active |
| reviewer | 质量审计 | on-demand |
| multimedia | 漫画 / 音乐 / 视觉 | on-demand |
| strategist | 商业化 / 运营 | dormant |
| qa | 系统诊断 | dormant |
| memory-keeper | 知识库维护 | dormant |

## 脚本系统

| 脚本 | 功能 | 触发时机 |
|------|------|----------|
| team-cli.js | 统一入口（10 个子命令） | 手动 |
| auto-heal.js | 6 类死链检测 + 修复 | 心跳 |
| experience-pool.js | 经验推送 + 过期清理 | 心跳 |
| creation-feedback.js | 创作后反馈记录 | 创作后 |
| skill-discovery.js | 技能发现 + 校验 | 每周 |
| skill-evolution.js | 技能自进化 | 心跳 |
| hotspot-consumer.js | 每日热点 → 行动清单 | 每日 |
| knowledge-loop.js | 热点 → 知识库 | 热点后 |
| pace-diagnose.js | 节奏 / 韵律诊断 | 创作后 |
| style-engine.js | AI 语感检测 | 创作后 |
| dashboard-data.js | 仪表盘数据聚合 | 心跳 |
| cron-templates.js | 定时模板注册表 | 手动 |

## CI / 质量门

| 门 | 工具 | 检查内容 |
|------|------|---------|
| 语法 | `node --check`（全部受控脚本） | 无 JS 语法错误 |
| 配置 | `validate-config.mjs` | `.env.example` 变量 + JSON 结构 |
| 冒烟 | `tests/smoke.test.mjs` | `safePath`、`parseFiles`、`checkAll` |
| 边界 | `tests/edge-cases.test.mjs` | 边界输入、空字节、空 payload |
| 配置形态 | `tests/validate-config.test.mjs` | 模板结构正确性 |

一键运行：`make healthcheck` 或 `bash scripts/dev.sh healthcheck`

## 记忆层级

1. **短期**：当前会话上下文
2. **中期**：`memory/` 目录（产出报告、日志）
3. **长期**：`MEMORY.md` 规则 + 向量库（gbrain）
4. **演进**：`experience-pool.js` + `skill-evolution.js`

## 可观测性

智能体运行会在 `.agent-runs/run-<ts>.jsonl` 产出追加式 JSONL 追踪记录：
- `task` — 请求了什么
- `llm_retry` — 瞬态失败的自动重试
- `files_written` — 哪些文件被改动
- `check_pass` / `check_failed` — 语法门结果
- `committed` / `pr_created` — 最终产出
- `error` — 崩溃信息（非致命）

这些文件**已被 gitignore**，绝不推送远端，仅用于本地调试。

---

# Architecture — openclaw-workspace (English)

## System overview

```
┌─────────────────────────────────────────────────────┐
│                   User / Trigger                     │
│         (CLI / Issue / Cron / Agent Task)            │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│              OpenClaw Gateway                        │
│           (config/openclaw.json)                     │
│     Route → Auth → Agent dispatch → Tools            │
└───────────────────┬─────────────────────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
┌───────────┐ ┌─────────┐ ┌──────────────┐
│  Main     │ │  Team   │ │ Autonomous   │
│  Agent    │ │  CLI    │ │  Pipeline    │
│           │ │         │ │ (respond.mjs)│
└─────┬─────┘ └────┬─────┘ └──────┬───────┘
      │            │              │
      ▼            ▼              ▼
┌─────────────────────────────────────────────────────┐
│                  Workspace Layer                      │
│  ┌──────────┐ ┌──────────┐ ┌────────────────────┐  │
│  │ Identity  │ │ Memory   │ │ Tool / Script      │  │
│  │ SOUL.md   │ │ MEMORY.md│ │ .learnings/        │  │
│  │ AGENTS.md │ │ memory/  │ │ skills/  tools/    │  │
│  └──────────┘ └──────────┘ └────────────────────┘  │
└───────────────────┬─────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────┐
│                Output Layer                          │
│      project/   knowledge/   dashboard/             │
└─────────────────────────────────────────────────────┘
```

## Autonomous agent pipeline

```
Trigger (issue label / comment / local env)
    │
    ▼
┌─────────────┐    ┌──────────────┐    ┌─────────────┐
│ 1. Load task │──▶│ 2. Call LLM   │──▶│ 3. Parse     │
│ (getTask)    │    │ (callLLM)     │    │ (parseFiles) │
└─────────────┘    └──────────────┘    └──────┬──────┘
                                               │
                    ┌──────────────┐            ▼
                    │ 6. Commit /  │    ┌─────────────┐
                    │    PR        │◀───│ 4. Write +   │
                    │              │    │ node --check  │
                    └──────────────┘    └─────────────┘
                           ▲                 │
                           │                 ▼
                    ┌──────────────┐   ┌─────────────┐
                    │ 5. Trace log │   │ .agent-runs/ │
                    │ (.jsonl)     │   │  run-*.jsonl │
                    └──────────────┘   └─────────────┘
```

**Modes:**
- **Local** (`AGENT_LOCAL=1`): reads task file → edits working tree → `node --check` → commits to local branch. Zero key with Ollama.
- **Cloud** (GitHub Actions): issue webhook → LLM → PR via `gh`. Never auto-merges.

## Agent team

| Role | Responsibility | Status |
|------|---------------|--------|
| main | Orchestration | active |
| writer | Content creation | active |
| architect | World-building / setting maintenance | active |
| tech-producer | Video pipeline / game prototypes | active |
| reviewer | Quality audit | on-demand |
| multimedia | Comics / music / visuals | on-demand |
| strategist | Monetization / ops | dormant |
| qa | System diagnostics | dormant |
| memory-keeper | Knowledge-base curation | dormant |

## Script system

| Script | Function | Trigger |
|--------|----------|---------|
| team-cli.js | Unified entry (10 subcommands) | Manual |
| auto-heal.js | 6-category broken-link detection + fix | Heartbeat |
| experience-pool.js | Experience push + expiry sweep | Heartbeat |
| creation-feedback.js | Post-creation feedback recording | After creation |
| skill-discovery.js | Skill discovery + validation | Weekly |
| skill-evolution.js | Skill self-evolution | Heartbeat |
| hotspot-consumer.js | Daily hotspot → action list | Daily |
| knowledge-loop.js | Hotspot → knowledge base | Post-hotspot |
| pace-diagnose.js | Pacing / rhythm diagnosis | After creation |
| style-engine.js | AI-tone detection | After creation |
| dashboard-data.js | Dashboard data aggregation | Heartbeat |
| cron-templates.js | Cron template registry | Manual |

## CI / Quality gates

| Gate | Tool | What it checks |
|------|------|----------------|
| Syntax | `node --check` (all tracked scripts) | No JS syntax errors |
| Config | `validate-config.mjs` | `.env.example` vars + JSON schema |
| Smoke | `tests/smoke.test.mjs` | `safePath`, `parseFiles`, `checkAll` |
| Edge cases | `tests/edge-cases.test.mjs` | Boundary inputs, null bytes, empty payloads |
| Config shape | `tests/validate-config.test.mjs` | Template well-formedness |

Run all: `make healthcheck` or `bash scripts/dev.sh healthcheck`

## Memory layers

1. **Short-term**: Current session context
2. **Mid-term**: `memory/` directory (output reports, logs)
3. **Long-term**: `MEMORY.md` rules + vector store (gbrain)
4. **Evolutionary**: `experience-pool.js` + `skill-evolution.js`

## Observability

Agent runs produce append-only JSONL traces in `.agent-runs/run-<ts>.jsonl`:
- `task` — what was requested
- `llm_retry` — transient failure retry
- `files_written` — which files changed
- `check_pass` / `check_failed` — syntax gate result
- `committed` / `pr_created` — outcome
- `error` — crash info (non-fatal)

These are **gitignored** and never pushed to remote. They exist purely for local debugging.
