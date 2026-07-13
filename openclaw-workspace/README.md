# AI Multi-Agent Workspace

> 📦 本目录是 **OmniSense** 仓库内的子包（原 `xiaobei1679/openclaw-workspace`，MIT）。
> OmniSense 通过仓库根 `integrations/openclaw/` 把它接入为「多智能体工作区」，并已在
> `config/openclaw.json.example` 注册 `omnisense-engine` 角色。
> 下方 CI 徽章指向原独立仓库；合并后统一由 OmniSense 父仓库的 Actions 持续集成。

![CI](https://github.com/xiaobei1679/openclaw-workspace/actions/workflows/node-check.yml/badge.svg)
![Tests](https://img.shields.io/badge/tests-234%20passing-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Template](https://img.shields.io/badge/repo-Template-blueviolet)

> 一套**开箱即用的 AI 多智能体工作环境**：知识库、技能系统、约束规则、记忆管理、自动化脚本与项目产出一体化。
> 任何人 clone / 解压后，配置几个环境变量即可直接运行——**无需改任何代码**。

👉 **[快速上手 QUICKSTART.md](QUICKSTART.md)** — 5 分钟跑起来（本地零密钥 / 框架部署两种路径）。

---

## ✨ 特性

- **多 Agent 团队协作**（写作 / 审核 / 视觉 / 开发 / 音乐 / 运营 / 数据分析…），角色与模型路由通过配置文件定义
- **脚本系统**：团队管理、经验池、自动修复、创作反馈、技能自进化、热点采集消费、知识闭环、文风质检
- **跨平台**：Windows / macOS / Linux 均可用，所有路径走环境变量 + 用户主目录，**不写死任何用户名或路径**
- **密钥安全**：所有 token 均为环境变量占位符，仓库不含任何明文密钥
- **贡献友好**：`scripts/scaffold.mjs` 一键生成技能/智能体模板；`make install-hooks` 安装提交前质量门
- **CI 与本地一致**：`node-check.yml` 跑完整 healthcheck（语法 + 配置 + 测试），坏改动无法过关
- **Observer Agent 自动审查**：`scripts/ci/observer.mjs` 在提交前 / PR 时拦截禁入库路径、明文密钥、坏语法与智能体契约越界
- **Router Agent 任务路由**：`scripts/agent/router.mjs` 把一句话任务分类意图、拆成子步骤、派给对应专家 agent（research/coding/writing/review/data），纯确定性逻辑、零密钥、`make router` 即可用
- **Reviewer 专员自动审核**：`scripts/ci/reviewer.mjs` 把语法 / 配置 / 测试 / Observer 四项确定性零密钥检查聚合成一个 PASS/FAIL verdict；自主迭代自动化**只本地 commit、绝不推送远端**，返回 PASS 后由用户每日 review 手动推送
- **一键部署**：内置 PowerShell / Bash 部署脚本，自动复制并校验
- **与 OmniSense 身体联动**：`scripts/omnisense-link.mjs` 让工作区智能体直接驱动 OmniSense 七器官（眼/耳/嘴/脑/手/感知/脚）与目标，是合并后"新项目"的一体化入口（见下节）

---

## 🔗 与 OmniSense 身体联动（合并后的新项目）

两个项目合并后不再是"并排两个仓库"，而是工作区能真正调用 OmniSense 身体的活组件。
`scripts/omnisense-link.mjs` 直接 import 仓库根 `integrations/openclaw/index.mjs`（桥接层），
无需 shell 中转、可单测、离线可跑。

```bash
# 列出七器官
node scripts/omnisense-link.mjs list
# 用手器官做离线计算（跨层：工作区 -> 桥接层 -> OmniSense 身体）
node scripts/omnisense-link.mjs hand calc '{"expression":"3*14"}'
# 用一句话目标驱动身体（感知->思考->记忆；联网路径由 CLI 的 process.exit 兜底退出）
node scripts/omnisense-link.mjs goal "记录一次跨层迭代验证" --json
# A2A 风格能力卡：身体全部能力扁平化为 skills[]（供工作区智能体发现与委派）
node scripts/omnisense-link.mjs card --json
# 七器官树（含每能力 desc/net/examples）
node scripts/omnisense-link.mjs describe --json
# 按技能 id 直接委派到器官/方法（route <organ.method> [args...]，organ 可为七器官任一）
node scripts/omnisense-link.mjs route --list
node scripts/omnisense-link.mjs route hand.calc '{"expression":"2+2"}'
node scripts/omnisense-link.mjs route brain.think "我该关注什么"
# 技能匹配与自动委派（能力发现闭环）
node scripts/omnisense-link.mjs dispatch "计算 2+2"
node scripts/omnisense-link.mjs dispatch "思考当前热点"
node scripts/omnisense-link.mjs dispatch "看今日热搜"
# 自主循环：让身体用自身能力卡自己决定每轮做什么并离线执行（合并后"新项目"的活证据）
# 默认开启动态议程（结果驱动重排，每步 trace 带 agendaWeights 快照）；--no-dynamic 关闭重排、尊重顺序
node scripts/omnisense-link.mjs autopilot 2 --json
node scripts/omnisense-link.mjs autopilot 2 --no-dynamic --json
# 可观测性：工作区侧消费身体的 Agent 轨迹（回放对比 / 检索 / 导出 / 回归门禁）
node scripts/omnisense-link.mjs trace --summary        # 聚合指标
node scripts/omnisense-link.mjs trace --list --limit=5 # 列出历史运行
node scripts/omnisense-link.mjs trace --find="计算 2+2" # 同目标多次运行检索
node scripts/omnisense-link.mjs trace --diff=<idA>,<idB> # 回放对比两次运行，定位首次分歧
node scripts/omnisense-link.mjs trace --export=reg.jsonl --export-format=jsonl # 导出回归数据集
node scripts/omnisense-link.mjs trace --export=spans.otlp.json --export-format=otlp # 导出 OTLP/JSON（OTel-native，可投 Grafana Tempo/Phoenix/Jaeger）
node scripts/omnisense-link.mjs trace --baseline=<id>  # 设基线
node scripts/omnisense-link.mjs trace --regression     # 回归门禁（退化退出码 1，可接 CI）
```

> 能力卡与委派借鉴 Google A2A Protocol 的 AgentCard 思想（`https://github.com/google/A2A`）：仅取「skill 自描述（id/name/description/tags/examples）」这一结构用于工作区侧能力发现；OmniSense 额外加 `net` 字段诚实标注联网依赖。`card` / `describe` / `route` / `dispatch` / `autopilot` / `trace` 均离线可跑、可单测（见 `tests/omnisense-link.test.mjs`）。`dispatch` 再借鉴 IETF AgentCard（能力发现）与 ARD（intent→tool 匹配）思想；`autopilot` 借鉴 BabyAGI 自生成任务队列思想，让工作区能真正驱动身体"自驱"而非只被动委派——默认开启动态议程（每轮结果回写议程、据结果调权，每步 trace 带 `agendaWeights` 快照，`--no-dynamic` 关闭重排、尊重用户顺序）；`trace` 复用内核 `tracer` 的 compareRuns / findRunsByGoal / exportDataset / exportOtlp / regressionCheck，让工作区能真正对身体的行为做可观测性分析（借鉴 Forkline 分歧检测、LangSmith trace→dataset、OTLP/OTel GenAI 语义约定、recut-ai/shadow 回归门禁思想）。

`config/openclaw.json.example` 中的 `omnisense-engine` 角色即基于此入口，把"做事"统一收口到身体。
跨层测试见 `tests/omnisense-link.test.mjs`（离线断言，不触发联网挂起）。

---

## 🚀 三步上手

### 前置条件
1. 已安装 **Node.js**（脚本运行依赖）
2. （可选）向量检索 CLI（如 `gbrain`），用于知识库语义搜索；没有则退化为全文检索

### 第 1 步：获取仓库
```bash
git clone <仓库地址> agent-workspace
cd agent-workspace
```

### 第 2 步：配置环境变量
复制模板并填写：
```bash
cp .env.example .env        # 编辑 .env，填入你的 token 和路径
```
需要填的只有两类：
- **鉴权**：网关 token、消息通道凭证（接企业微信等才需要）
- **路径**（均可留空，留空时自动回退到当前用户目录下的默认位置）

> 不知道填什么？全部留空也能跑——脚本会在你当前用户的桌面下自动创建所需目录。
> 变量完整说明见 [环境变量一览](#环境变量一览) 与 `.env.example`。

### 第 3 步：运行部署
**Windows**
```powershell
./deploy/install.ps1
```
**macOS / Linux**
```bash
chmod +x deploy/install.sh
./deploy/install.sh
```

部署脚本会：备份已有配置 → 复制工作区 → 复制配置模板 → 创建项目目录。最后运行校验脚本确认部署成功。

### 验证改动（与 CI 同款）
```bash
make healthcheck     # = check(语法) + validate(配置) + test(冒烟) 一气呵成
# 或分跑：make check && make validate && make test
# 无 make 也行：bash scripts/dev.sh healthcheck
```
智能体契约与示例见 [`docs/AGENT_CONTRACT.md`](docs/AGENT_CONTRACT.md) 与 [`examples/`](examples/)。

---

## 🤖 自主智能体（本地，零密钥）

本仓库内置一个自动智能体（`scripts/agent/respond.mjs` + `.github/workflows/agent-respond.yml`）：

- **本地模式（推荐，零成本）**：装好 [Ollama](https://ollama.com) 后 `ollama pull qwen2.5-coder:3b && ollama serve`，然后：
  ```bash
  AGENT_LOCAL=1 AGENT_TASK_FILE=scripts/agent/task.example.md \
  LLM_BASE_URL=http://127.0.0.1:11434/v1 node scripts/agent/respond.mjs
  ```
  它会读任务、改代码、跑 `node --check`、提交到本地分支 `agent/local-<时间戳>` 等你审。**无需任何密钥、可离线。**
- **云端模式**：给 issue 打 `agent-task` 标签或评论 `/agent`，自动开 PR 供你审核（绝不自动合并）。需配置 LLM 后端（本地 Ollama 在云端访问不到，可用 DeepSeek/通义/Moonshot 的免费额度密钥）。
- 交互契约见 [`docs/AGENT_CONTRACT.md`](docs/AGENT_CONTRACT.md)。

---

## 📁 仓库结构

```
agent-workspace/
├── README.md                 # 本文件
├── .env.example              # 环境变量模板（复制为 .env 填写）
├── .gitignore
├── LICENSE                   # MIT 许可证
├── deploy/                   # 部署/校验脚本
│   ├── install.ps1           # Windows 一键部署
│   ├── install.sh            # macOS/Linux 一键部署
│   └── verify.ps1            # 部署验证（带退出码，供 CI 使用）
├── config/
│   ├── openclaw.json         # ⚠️ 含密钥占位符，已被 .gitignore 忽略
│   └── openclaw.json.example # ✅ 提交到仓库的模板，直接使用
├── workspace/                # Agent 工作空间（核心）
│   ├── MEMORY.md / MEMORY-RULES.md / HEARTBEAT.md  # 记忆与规则
│   ├── .learnings/           # 脚本系统 + 学习规则（框架，随仓库发布）
│   │   ├── scripts/          # 全部 Node 脚本
│   │   └── lib/common.js     # 公共库（路径/原子读写/字数统计）
│   ├── tools/                # 工具参考与脚本（框架，随仓库发布）
│   ├── memory/               # 产出报告 + 日志（⚠️ 本地数据，已 .gitignore）
│   ├── skills/               # 技能定义
│   ├── USER.md.example       # 用户画像模板（复制为 USER.md 填写）
│   └── ...（其余协作基础设施/共享池/项目产出 等均为本地数据，已 gitignore）
├── project/                  # ⚠️ 本地数据：你的项目产出，已 .gitignore，不随仓库发布
├── knowledge/                # ⚠️ 本地数据：个人知识库，已 .gitignore，不随仓库发布
└── docs/                     # 架构 / Agent 团队 / 更新日志
```

> **关于本地数据**：`project/`、`knowledge/`、`workspace/memory/` 以及各类协作目录
> 是使用者本人的真实产物，已被 `.gitignore` 排除，**不会进入公开仓库**。
> 任何人 clone 后拿到的是纯框架；部署脚本会自动创建这些空目录，框架即可运行。

---

## 🧩 核心系统（脚本入口）

| 系统 | 入口脚本 | 说明 |
|------|----------|------|
| 团队管理 | `team-cli.js` | 多 Agent 统一管理 |
| 经验池 | `experience-pool.js` | 自动推送 + 过期巡检 |
| 自愈 | `auto-heal.js` | 断链检测（check 纯只读 / fix 才写入） |
| 创作反馈 | `creation-feedback.js` | record→push→patterns |
| 技能进化 | `skill-evolution.js` | scan→propose→apply-all（仅低风险自动应用） |
| 技能发现 | `skill-discovery.js` | 扫描知识库发现可集成工具 |
| 热点消费 | `hotspot-consumer.js` | 每日热点 → 行动清单 |
| 知识闭环 | `knowledge-loop.js` | 热点 → 知识库 → 行动 |
| 质检 | `pace-diagnose.js` + `style-engine.js` | 字数 / AI 腔 / 节奏诊断 |

---

## 🌱 接入你自己的项目

公开仓库**不含**任何示例内容。你拿到的就是一套空框架。要真正"开箱即用"，只需：

1. 把你的项目产出放进 `PROJECT_DIR` 指向的目录（默认 `桌面/项目产出`），或设该环境变量指向你已有目录
2. 把 `workspace/USER.md.example` 复制为 `workspace/USER.md` 并填写你自己的画像
3. 在 `config/openclaw.json.example` 基础上调整 Agent 团队（角色、模型路由）后，另存为 `config/openclaw.json`

脚本不在乎项目叫什么名字——它只认环境变量指向的目录。

---

## 🔧 环境变量一览

| 变量 | 作用 | 默认（留空时） |
|------|------|----------------|
| `QCLAW_GATEWAY_TOKEN` | 网关鉴权 token | 必填（否则网关连不上） |
| `WECHAT_ACCESS_TOKEN` / `WECHAT_GUID` / `WECHAT_USER_ID` | 企业微信通道凭证 | 接微信才需填 |
| `QCLAW_WECHAT_WS_URL` | 企业微信 WS 地址 | 接微信才需填 |
| `QCLAW_USER_DATA_DIR` | 用户数据根目录 | `<HOME>/.qclaw` |
| `QCLAW_PROJECT_DIR` | 项目产出根目录 | `<HOME>/Desktop/项目产出` |
| `QCLAW_HOT_DIR` | 每日热点目录 | `<HOME>/Desktop/每日热点` |
| `QCLAW_KNOWLEDGE_DIR` | 知识库目录 | `<PROJECT_DIR>/知识库` |
| `OPENAI_API_KEY` | 向量 embedding 用的 Key | 无则退化为全文检索 |

> 完整说明见 `.env.example`。

---

## ⚠️ 安全须知

- `config/openclaw.json` **已被 `.gitignore` 忽略**，请务必用环境变量注入密钥，**不要提交明文 token**
- 泄露的 token 必须在对应平台后台**手动轮换**
- 派生/修改后若对外分发，请遵守 MIT 许可证条款

---

## 🐛 常见问题

**Q：部署后连不上网关？**
A：检查网关 token 是否已设置且正确；确认 `config/openclaw.json` 已就位（`verify.ps1` 会检查）。

**Q：脚本报找不到目录？**
A：首次运行目录不存在属正常；脚本大多有存在性守卫不会崩溃。要指定自己的目录，设 `PROJECT_DIR` / `HOT_DIR`。

**Q：企业微信通道用不了？**
A：需填 `WECHAT_*` 与 `WECHAT_WS_URL` 四个变量，并确保通道已启用。

**Q：macOS/Linux 下某些命令报错？**
A：所有 Windows 专用命令已在脚本中按平台分流，若仍报错请提交 issue 并附环境信息。

---

## 📜 License

[MIT](LICENSE)

---
---

# 🌐 English

# AI Multi-Agent Workspace

> A **turnkey AI multi-agent workspace**: knowledge base, skill system, constraint rules, memory management, automation scripts, and project output — all in one.
> Anyone can `clone` / unzip, set a few environment variables, and run it — **no code changes required**.

👉 **[QUICKSTART.md](QUICKSTART.md)** — get running in 5 minutes (local zero-key / framework deploy).

Built on top of the open-source **[OpenClaw](https://docs.openclaw.ai)** framework. It ships a clean, de-personalized workspace template so you can stand up your own agent team in minutes.

## ✨ Features

- **Multi-agent team collaboration** (writing / review / visual / dev / music / ops / data analysis…); roles and model routing are defined in config files
- **Script system**: team management, experience pool, self-healing, creation feedback, skill self-evolution, hotspot ingestion, knowledge loop, style QA
- **Cross-platform**: Windows / macOS / Linux; all paths resolve via env vars + home directory — **no hardcoded usernames or absolute paths**
- **Secret-safe**: every token is an env-var placeholder; the repo contains zero plaintext secrets
- **One-click deploy**: built-in PowerShell / Bash deploy scripts that copy and verify automatically

## 🚀 Quickstart (3 steps)

### Prerequisites
1. **Node.js** installed (scripts run on it)
2. (optional) a vector-search CLI such as `gbrain` for semantic knowledge retrieval; falls back to full-text search if absent

### Step 1 — Get the repo
```bash
git clone <repo-url> agent-workspace
cd agent-workspace
```

### Step 2 — Configure environment
```bash
cp .env.example .env      # edit .env, fill in your tokens and paths
```
You only need two kinds of values:
- **Auth**: gateway token, and messaging-channel credentials (only if you connect WeCom / WeChat)
- **Paths** (all optional — left blank they fall back to default locations under your home dir)

> Not sure what to fill? Leave everything blank — scripts auto-create the needed directories under your desktop. See [Environment variables](#environment-variables) and `.env.example`.

### Step 3 — Run deploy
**Windows**
```powershell
./deploy/install.ps1
```
**macOS / Linux**
```bash
chmod +x deploy/install.sh
./deploy/install.sh
```

The deploy script: backs up existing config → copies the workspace → copies config templates → creates project directories. A verify script then confirms success.

### Verify your changes (same as CI)
```bash
make healthcheck     # = check (syntax) + validate (config) + test (smoke) in one pass
# or separately: make check && make validate && make test
# or without make: bash scripts/dev.sh healthcheck
```
The agent contract and examples are in [`docs/AGENT_CONTRACT.md`](docs/AGENT_CONTRACT.md) and [`examples/`](examples/).

---

## 🤖 Autonomous agent (local, zero key)

This repo ships an autonomous agent (`scripts/agent/respond.mjs` + `.github/workflows/agent-respond.yml`):

- **Local mode (recommended, zero-cost)**: install [Ollama](https://ollama.com), then `ollama pull qwen2.5-coder:3b && ollama serve`, then:
  ```bash
  AGENT_LOCAL=1 AGENT_TASK_FILE=scripts/agent/task.example.md \
  LLM_BASE_URL=http://127.0.0.1:11434/v1 node scripts/agent/respond.mjs
  ```
  It reads the task, edits code, runs `node --check`, and commits to a local branch `agent/local-<ts>` for your review. **No key required, runs offline.**
- **Cloud mode**: label an issue `agent-task` or comment `/agent` — it opens a PR for your review (never auto-merges). Needs an LLM backend (a local Ollama is unreachable from GitHub's cloud; use a free DeepSeek/Qwen/Moonshot key instead).
- The interaction contract is in [`docs/AGENT_CONTRACT.md`](docs/AGENT_CONTRACT.md).

## 📁 Repository structure

```
agent-workspace/
├── README.md
├── .env.example              # env-var template (copy to .env)
├── .gitignore
├── LICENSE                   # MIT
├── deploy/                   # deploy / verify scripts
│   ├── install.ps1           # Windows one-click deploy
│   ├── install.sh            # macOS/Linux one-click deploy
│   └── verify.ps1            # deploy verification (exit code for CI)
├── config/
│   ├── openclaw.json         # ⚠️ secret placeholders; gitignored
│   └── openclaw.json.example # ✅ committed template, use directly
├── workspace/                # Agent workspace (core)
│   ├── MEMORY.md / MEMORY-RULES.md / HEARTBEAT.md
│   ├── .learnings/           # script system + learning rules (shipped)
│   │   ├── scripts/          # all Node scripts
│   │   └── lib/common.js     # shared lib (paths / atomic IO / CJK counting)
│   ├── tools/                # tool references & scripts (shipped)
│   ├── memory/               # output reports + logs (⚠️ local, gitignored)
│   ├── skills/               # skill definitions
│   ├── USER.md.example       # user-profile template (copy to USER.md)
│   └── ... (collaboration infra / shared pools / output are local, gitignored)
├── project/                  # ⚠️ local: your project output, gitignored
├── knowledge/                # ⚠️ local: your knowledge base, gitignored
└── docs/                     # architecture / agent team / changelog
```

> **About local data**: `project/`, `knowledge/`, `workspace/memory/`, and collaboration dirs are the user's own artifacts, excluded by `.gitignore` and **never published**. Cloning gives you a pure framework; the deploy script creates those empty dirs so it runs out of the box.

## 🧩 Core systems (script entry points)

| System | Entry script | Notes |
|--------|--------------|-------|
| Team management | `team-cli.js` | unified multi-agent control |
| Experience pool | `experience-pool.js` | auto-push + expiry sweep |
| Self-heal | `auto-heal.js` | dead-link detection (check = read-only / fix = write) |
| Creation feedback | `creation-feedback.js` | record→push→patterns |
| Skill evolution | `skill-evolution.js` | scan→propose→apply-all (low-risk only) |
| Skill discovery | `skill-discovery.js` | scan knowledge base for integrable tools |
| Hotspot consumer | `hotspot-consumer.js` | daily hotspots → action list |
| Knowledge loop | `knowledge-loop.js` | hotspot → knowledge → action |
| QA | `pace-diagnose.js` + `style-engine.js` | length / AI-tone / pace diagnostics |

## 🌱 Bring your own project

The public repo ships **no sample content** — you get an empty framework. To make it yours:

1. Put your project output into the dir pointed to by `PROJECT_DIR` (default `Desktop/项目产出`), or point that env var at your existing dir
2. Copy `workspace/USER.md.example` → `workspace/USER.md` and fill in your own profile
3. Tune the agent team (roles, model routing) on top of `config/openclaw.json.example`, then save as `config/openclaw.json`

Scripts don't care what your project is called — they only follow the env-var-pointed directories.

## 🔧 Environment variables

| Variable | Purpose | Default (if blank) |
|----------|---------|--------------------|
| `QCLAW_GATEWAY_TOKEN` | gateway auth token | required (else gateway won't connect) |
| `WECHAT_ACCESS_TOKEN` / `WECHAT_GUID` / `WECHAT_USER_ID` | WeCom channel credentials | only if using WeChat |
| `QCLAW_WECHAT_WS_URL` | WeCom WS address | only if using WeChat |
| `QCLAW_USER_DATA_DIR` | user-data root | `<HOME>/.qclaw` |
| `QCLAW_PROJECT_DIR` | project-output root | `<HOME>/Desktop/项目产出` |
| `QCLAW_HOT_DIR` | daily-hotspot dir | `<HOME>/Desktop/每日热点` |
| `QCLAW_KNOWLEDGE_DIR` | knowledge-base dir | `<PROJECT_DIR>/知识库` |
| `OPENAI_API_KEY` | key for vector embeddings | falls back to full-text search |

> Full details in `.env.example`.

## ⚠️ Security

- `config/openclaw.json` is **gitignored** — inject secrets via env vars, never commit plaintext tokens
- A leaked token must be rotated manually on the provider side
- If you fork / redistribute, comply with the MIT license

## 🐛 FAQ

**Q: Gateway won't connect after deploy?**
A: Check the gateway token is set and correct; ensure `config/openclaw.json` is in place (`verify.ps1` checks this).

**Q: Script says directory not found?**
A: Missing dirs on first run are normal; most scripts guard with existence checks and won't crash. To point at your own dirs, set `PROJECT_DIR` / `HOT_DIR`.

**Q: WeCom channel not working?**
A: Fill the four `WECHAT_*` / `WECHAT_WS_URL` vars and ensure the channel is enabled.

**Q: Errors on macOS/Linux?**
A: Windows-only commands are already branched by platform inside the scripts; if it still errors, open an issue with your environment info.

## 📜 License

[MIT](LICENSE)
