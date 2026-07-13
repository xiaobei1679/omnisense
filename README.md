# OmniSense · 通用 AI 感知系统

> 让 AI 像真人一样具备 **眼睛 · 耳朵 · 嘴巴 · 大脑 · 感知** 五类真实能力，并相互协同。

OmniSense 是一套**零依赖、可移植**的通用 AI 感知系统。它的"真实"体现在：

- **联网抓取本机真实执行**：看网站、拉 B站/头条/微博/百度/抖音/红果/知乎/微信/番剧榜等实时热搜、下视频、取图像——全部本地真实联网，**不依赖任何 API KEY**。
- **模型推理免 key 双模式自适应**：在有 OpenClaw/QClaw「控制网关」的环境里，自动用框架自带在线模型真思考真说；在没有网关的环境（如普通 Node / WorkBuddy），脑/嘴由**调用方（你 / 你的 agent）**驱动，同样免 key。
- **诚实降级**：视觉"看图"（VLM）、语音"听"（ASR）、"出声"（TTS）若未配置对应模型，会**如实说明**，绝不假装已看懂/听懂/说出。

**一次编写，到处运行**：它既能作为 OpenClaw/QClaw 技能直接丢进 `skills/` 目录，也能作为独立 npm 包 / CLI 在任何装了 Node ≥ 18 的机器上跑。

---

## ✨ 核心特性

| 特性 | 说明 |
|------|------|
| 🔎 真实感知 | 网站/热搜/视频/图像的联网抓取与下载，本机真实执行（零 key，已实测通网） |
| 🧠 免 key 双模式 | `qclaw` 模式走框架网关在线模型；`agent` 模式由调用方驱动大脑与嘴巴 |
| 🧩 零依赖 | 纯 Node 原生 ESM，无 npm 依赖，复制即用 |
| 🤝 事件总线 | 五模块通过事件契约解耦协作（眼/耳发感知 → 脑聚合决策 → 向眼/耳/嘴下发命令） |
| 🪧 诚实边界 | 能力不可用时明确告知，不伪造结果 |
| 🔌 可扩展 | 热搜源、感官、模型后端均可按约定扩展 |
| 🔥 多平台热搜聚合 | `hot all` 并行抓 9 大平台，去重 + 跨平台频次排序（越热越靠前） |
| 🧩 热搜缓存 + 熔断 | 单源 TTL 缓存（默认 60s）降低重复联网；连续失败自动熔断冷却，避免反复超时 |
| 🖥 本地驱动服务 | `serve` 启动 127.0.0.1 的 JSON API，供外部门户(agent/QClaw/Marvis)跨进程驱动能力；设 `OMNI_TOKEN` 后自动启用 Bearer 鉴权 |
| 🔁 常驻感知循环 + 自主编排 | `watch` 按间隔持续聚合热搜+感知+规划，写 JSON 快照历史，SIGINT/SIGTERM 优雅停止；开启 `--agent` 后做**结构化差异检测（新增/消失）**并自动派发 Agent 真动手——`--agent-mode` 三档：`remember`(默认,记当前/新增/消失) / `alert`(仅突变触发,写告警记忆) / `digest`(写 markdown 摘要落盘；配合 `--summarize-new` 可对新增热点**联网抓 URL 并摘要**)；`serve` 的 `POST /tick` 支持外部编排单次感知 |
| 🗺 离线规划 | `plan` 基于当前感知合成情境，给出下一步行动建议（纯离线，不依赖模型） |
| 🤖 **Agent 行动闭环** | `agent "<目标>"` 让系统**真正做事**：ReAct 推理（有模型时）→ 选工具 → 执行 → 观察 → 再推理，直到目标完成；无模型时走本地确定性规划器完成多步任务（抓取网页并落盘、计算、查记忆等）。完成后把"打法"沉淀进记忆（**越用越强**） |
| 🧩 **多 Agent 协作** | `multiagent "<目标>"` 把复杂目标交给**协调器 + 角色子 agent**：协调器**有在线模型时走 LLM 智能拆解子任务，否则离线确定性拆解**（researcher/analyst/writer/critic），**独立子任务并行执行（Promise.all）**、汇总/综合类子任务自动归入第二批依赖前序产出；每个子任务交给一个**角色限定的子 agent**（复用 Agent 内核、工具集被沙箱化），结果写入共享黑板、**协调器综合产出**（确定性默认；`--coordinator` 走 LLM 智能综合可注入）。部分子任务失败也诚实报告 |
| 🪵 分级日志 | 统一 `core/logger.mjs`（trace/debug/info/warn/error/silent），`OMNI_LOG_LEVEL` 可控，`--quiet` 静默 |
| ⚡ 更快的 standalone | 无网关环境秒级进入 agent 模式（免 8s 联网探测）；统一 HTTP 客户端带超时/重试 |

## 🧠 它能做什么（真实 vs 模型）

| 模块 | 真实执行的部分（本机联网，零 key） | 模型推理（免 key） |
|------|----------------------------------|------------------------------|
| 🔎 眼 Eyes | 抓网站 HTML、拉 B站/头条/微博/百度/抖音实时热搜、红果短剧热榜、知乎热搜词、微信热文、B站番剧榜（WBI 签名）、下视频抽帧、获取图像 | 看图视觉：agent 模式由调用方直接读图（免 key 真看）；外部 VLM key 时真跑 |
| 👂 耳 Ears | 下载并读取音频文件、接收用户意见/小说文本/文案 | 文本理解（意见/小说/文案）；语音转写 ASR 需外部 key 或本地引擎 |
| 🗣 嘴 Mouth | 输出意见/对话文本 | 生成意见与回复（网关模型 / 外部 LLM / 调用方驱动）；出声 TTS 需外部 key |
| 🧠 脑 Brain | 记忆落盘、聚合感知、向眼/耳/嘴下发命令 | 思考/决策（网关模型 / 外部 LLM / 调用方驱动） |
| 🌐 感知 Perception | 聚合近期感知为情境模型、给出注意力建议 | — |

---

## 🚀 快速开始

### 方式一：作为独立 CLI / npm 包（最常见）

```bash
# 方式 A：直接克隆运行（无需 npm install，零依赖）
git clone https://github.com/<你的用户名>/omni-sense.git
cd omni-sense
node src/cli.mjs demo          # 真实联网演示

# 方式 B：作为 npm 包使用
npm install omni-sense
npx omni-sense demo            # 或：node node_modules/omni-sense/src/cli.mjs demo
```

常用命令：

```bash
node src/cli.mjs hot                      # 看 B站 实时热搜
node src/cli.mjs hot douyin              # 看 抖音 实时热搜（免 key 真抓）
node src/cli.mjs hot hongguo             # 看 红果短剧 热榜（聚合源）
node src/cli.mjs hot weibo               # 看 微博 热搜
node src/cli.mjs all                     # 并行聚合 9 大平台热搜（去重 + 跨平台频次排序）
node src/cli.mjs see https://example.com # 看一个网站
node src/cli.mjs summarize https://...   # 抓取并摘要网页（需网关/外部 LLM）
node src/cli.mjs image https://x/y.jpg   # 看图（外部 VLM 或调用方读图）
node src/cli.mjs feedback "开头太慢了"    # 听用户意见
node src/cli.mjs novel "第一章…"         # 听小说文本
node src/cli.mjs opinion "AI 该不该有感知" # 嘴：给意见
node src/cli.mjs think "如何改进开篇"     # 脑：思考
node src/cli.mjs plan "今天做什么选题"    # 脑：基于当前感知给下一步建议（离线）
node src/cli.mjs search "关键词"          # 在记忆中检索
node src/cli.mjs status --json           # 查看模型后端与能力（JSON 输出便于 agent 解析）
node src/cli.mjs watch --interval=60 --max=∞   # 常驻感知循环（热搜+感知+规划，写 .omni-watch.json）
node src/cli.mjs watch --agent --interval=120   # 开启"变化即行动"(remember)：热点有意义变化时自动派发 Agent 把当前/新增/消失写入记忆（冷却 60s 防刷）
node src/cli.mjs watch --agent --agent-mode=alert --interval=120   # 仅"突变"(有新增话题)时写告警记忆
node src/cli.mjs watch --agent --agent-mode=digest --interval=120  # 变化即把本轮热点+差异写成 markdown 摘要落盘
node src/cli.mjs watch --agent --agent-mode=digest --summarize-new --interval=120  # 同上，并对新增热点联网抓 URL 摘要，写入 digest 文件
node src/cli.mjs serve 8787              # 启动本地驱动服务（127.0.0.1；设 OMNI_TOKEN 即启用 Bearer 鉴权）
```

选项：`--json`（结构化 JSON 输出便于 agent 解析）、`--quiet`（静默过程日志）、`--tts`（出声）。
`watch` 专属：`--interval=<秒>`（间隔，默认 60）、`--max=<次数>`（最大循环，默认 ∞ 常驻）、`--think`（每轮在线思考）、`--out=<文件>`（快照路径）、`--remember`（最新摘要写入记忆 `lastWatch`）、`--agent`（开启"变化即行动"自主编排：每轮做**结构化差异检测**，检测到热点有意义变化且过冷却即派发 Agent）、`--agent-mode=<模式>`（`remember` 默认记当前/新增/消失 | `alert` 仅突变触发写告警记忆 | `digest` 写 markdown 摘要落盘）、`--agent-cooldown=<秒>`（两次自主行动最小间隔，默认 60，防刷）、`--agent-goal=<模板>`（自定义目标，`{date}{top3}{topics}{added}{removed}{count}` 占位，覆盖默认模式目标）、`--summarize-new`（对**新增热点联网抓 URL 并摘要**，best-effort，digest 模式写入摘要段；默认关闭，避免意外联网）。
`agent` 专属：`--max=<步数>`（默认 8）、`--no-llm`（强制走本地规划器，离线完成任务）、`--allow-shell`（启用 shell 工具，默认禁用需显式开启）。

### 🤖 Agent 行动闭环（让系统真正"做事"）

`agent "<目标>"` 是 OmniSense 从"感知+汇报"升级为"能推理、能调用工具、能完成目标"的关键。它把目标交给 **ReAct 推理闭环**：

- **有在线模型（网关/外部 LLM key）时**：模型动态决定每一步用哪个工具，直到给出最终答案——真正意义上的智能 agent，能处理开放式、多分支目标。
- **无模型（agent 模式 / 纯离线）时**：走**本地确定性规划器 `localPlan`**，照样能完成具体多步任务（如"抓取某网页并写入文件""计算""查记忆"），诚实不伪造。
- **通用意图分解（localPlan）**：不靠几条死正则，而是先识别**原子意图**（算/抓/摘要/写/读/记/热搜/时间），再做**依赖排序**（如"抓取→写入""读→写入""计算→写入"）组合成步骤序列，原生支持**复合目标**（"计算 100/4 并写入文件""读取配置并写入摘要"）。
- **越用越强（playbook 自动复用）**：每完成一个目标，把"打法"(playbook：`playbook:<hash>`) 沉淀进记忆。下次来新目标时：
  - **高相似（Jaccard ≥ 0.5）** → 直接**复用**旧打法并做参数迁移（URL→`urls[0]`、路径→`paths[0]`、算式→`calcs[0]`），该 playbook 的 `hitCount` +1；
  - **中相似（0.25 ≤ Jaccard < 0.5）** → 把旧打法当作 **few-shot** 注入 LLM 推理器，引导模型沿已有经验走；
  - 相似度都不足 → 走常规 ReAct / localPlan 正常完成，再沉淀新打法。
  - **经验层闭环（记忆 v3 → 推理上层）**：每次完成目标，除 playbook 外还自动沉淀一条"经验笔记"（`经验: <目标> → 工具序列[...]`）。下次来新目标时，`runAgent` 在动手前先用深度检索召回相关经验，把"已知相关经验"注入 **LLM ReAct 推理上下文**（本地规划器路径则作为诚实 hints 返回，不改变确定性执行）——记忆地基越准，推理越有据。
  - **ReAct 每步二次经验召回**：LLM 推理循环中，**每执行一步、拿到观察结果后**，会基于"这一步实际看到的内容"再精炼一次经验召回，把新增相关经验注入**下一步**的推理上下文（而非只依赖动手前那一次目标级召回）。这样 Agent 在长链路任务里能边做边"想起"相关经验，推理不再片面；最终所有经验（初始 + 每步二次）去重并入 `experienceHints` 返回。
  - **二次召回真正影响本地规划器**：即便目标措辞缺失"抓取/写入"等动词、正则 `localPlan` 解析不出步骤，只要记忆里有相关**经验笔记（含 `工具序列[...]`）**，`runAgent` 会把召回经验作为 hints 传给规划器，按经验建议的工具 + 从目标宽松提取的 URL/路径/算式**重建执行步骤**——离线规划器也能"借经验"把事做成（不是只当提示返回）。
  - **记忆去重压缩（记忆自维护）**：`Memory.dedupNotes()` / `compact()` 合并完全重复的笔记（保留最早时间戳）、超上限删除最旧，返回移除条数。越用越强也不会让自由笔记无限膨胀撑爆记忆。
  - **Agent 自我反思（越用越强·闭环补齐）**：每次跑完，基于执行轨迹产出"经验教训"（失败工具/空结果/复用成功/未达成原因…），以 `agent-reflection` 笔记写回记忆，未来同类目标经 `recallContext` 召回，真正影响下次推理。有在线模型时走 LLM 反思，否则离线启发式；反思失败静默退回离线，绝不打断主流程。`agent` 命令可用 `--no-reflect` 关闭。`
  - 记忆检索本身已从"字符串包含"升级为 **深度语义检索**（零 key、零依赖）：在 **BM25-lite 相关性**（中英混合分词 + URL/路径作整体实体 token + 经典 BM25 打分）之上再叠加 ①**时间衰减**（recency，半衰期默认 7 天，新记忆自然更靠前）②**复用权重**（hitCount 越高的高频打法排更前，`log(1+hitCount)` 加成）③**可选 MMR 去冗余**（`--diversity`，避免 topK 里全是近重复）。三项对"无时间戳 / 无 hitCount"的记忆零影响，向后兼容。playbook 与经验因此按"相关 × 新鲜 × 常用"综合召回，越用越准。

内置工具：`web_fetch`(联网抓取) · `read_file` / `write_file` / `list_dir`(文件) · `calc`(安全算术/数学，白名单求值杜绝任意代码执行) · `now`(时间) · `hot_topics`(热搜) · `summarize_url`(网页摘要) · `memory_search` / `memory_remember`(记忆) · `shell`(默认禁用，需 `--allow-shell`)。

```bash
# 离线也能真做完的多步任务：
node src/cli.mjs agent "计算 2+2" --no-llm
node src/cli.mjs agent "抓取 https://example.com 并写入 ./page.txt" --no-llm
# 复合目标：本地规划器自动做依赖排序（先算后写），离线真落盘：
node src/cli.mjs agent "计算 100/4 并写入 ./result.json" --no-llm
# 越用越强：第一次跑沉淀 playbook，第二次同类目标直接复用（终端会显示 复用:true 相似度:0.667）
node src/cli.mjs agent "计算 200/8 并写入 ./result.json" --no-llm
# 有模型时让 agent 自主推理（在 QClaw/OpenClaw 运行时或配了 LLM_* key 的环境）：
node src/cli.mjs agent "帮我查今天最热的三条热搜，并记住它们"

### 🧩 多 Agent 协作（协调器 + 角色子 agent）

把"单体助手"升级为"可编排团队"——复杂目标由**协调器**拆解成角色子任务，每个子任务交给一个**能力被限定的子 agent** 执行，结果汇总到共享黑板后综合产出。

- **角色（能力边界 = 工具集白名单）**：
  - `researcher` 检索/抓取/摘要（web_fetch·read_file·write_file·list_dir·memory_search·summarize_url·memory_remember·now·hot_topics）
  - `analyst` 计算/分析/结构化（calc·read_file·write_file·memory_search·memory_remember·now）
  - `writer` 写文件/产出文档（write_file·read_file·memory_remember·now）
  - `critic` 校验/复核（read_file·calc·memory_search·memory_remember）
- **协调器（离线确定性 + 并行调度）**：按任务级连接词（然后/同时/另外…）拆句 → 每句按关键词分派角色；**合成类子句（汇总/综合/整合…）自动归入第二批**，依赖前序 worker 产出。**独立子任务默认并行执行（Promise.all）**，显著快于串行；`--no-parallel` 可退回串行（兼容严格有序场景）。子 agent 越权调用未授权工具会被诚实拒绝（沙箱）。
- **协调器综合（coordinator）**：所有子任务完成后，**协调器把共享黑板综合成最终 `result`**——默认确定性摘要；传 `--coordinator`（且环境有模型）走 **LLM 智能综合**（生成连贯汇报）；也支持代码层注入自定义 `coordinator` 函数。合成类子句若带写目标，会把综合结果落盘（"汇总以上并写入 s.txt"→ s.txt 得到团队综合）。
- **共享黑板 `blackboard`**：每个子 agent 的结果按 `角色#序号` 记入；返回字段新增 `batches`(批次)、`parallelWorkers`(并行 worker 数)、`coordinatorMode`(deterministic/injected/llm/none)。
- **诚实**：某子任务失败 → 整体 `completed` 仍为真（其他已完成的有产出），但 `allCompleted` 标为假并说明失败原因，绝不谎称全员成功。

```bash
# 复合目标：协调器拆成 researcher(抓取落盘) + analyst(计算落盘)，两个 worker 并行执行；"汇总"子句第二批综合落盘
node src/cli.mjs multiagent "抓取 https://example.com 并写入 ./page.txt，然后计算 100/4 并写入 ./result.json，然后汇总以上并写入 ./summary.md" --no-llm
# 指定启用角色（其余角色的子任务不生成）
node src/cli.mjs multiagent "计算 2+2 并写入 ./a.txt，然后生成报告写入 ./b.txt" --roles=analyst,writer --no-llm
# 串行执行 + LLM 协调器综合（有模型时）
node src/cli.mjs multiagent "抓取 https://example.com 并写入 ./page.txt，然后计算 100/4 并写入 ./r.json" --no-parallel --coordinator
```
```

**通过 `serve` 被外部驱动**（示例）：

```bash
curl -s -X POST http://127.0.0.1:8787/see -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -s -X POST http://127.0.0.1:8787/all -H 'Content-Type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:8787/tick -H 'Content-Type: application/json' -d '{}'   # 单次感知快照（供外部编排）
curl -s -X POST http://127.0.0.1:8787/agent -H 'Content-Type: application/json' -d '{"goal":"计算 2+2","useLLM":false}'
curl -s http://127.0.0.1:8787/health
# 启用鉴权：启动时设环境变量 OMNI_TOKEN=xxx，则所有请求需带 Header: Authorization: Bearer xxx
```
> ⚠️ `serve` 仅监听 `127.0.0.1`、无 TLS，**切勿用 -h 0.0.0.0 或端口转发暴露到公网**。设了 `OMNI_TOKEN` 后所有路由（含 `/health`）要求 `Authorization: Bearer <token>`（或 `?token=`）。可行路由：`/health /see /hot /all /summarize /think /plan /tick /speak /remember /recall /search /sense /status /agent`。

### 方式二：作为 OpenClaw / QClaw 技能

把整个 `omni-sense/` 目录复制到框架的技能目录：

```bash
cp -r omni-sense ~/.qclaw/workspace/skills/omni-sense
```

在 QClaw 运行时中，文本推理**自动免 key**走框架「控制网关」在线模型 `openclaw`；眼/耳照常真实抓取。
详见 [`SKILL.md`](./SKILL.md)。

### 方式三：作为库 import

```js
import { OmniSense } from 'omni-sense';          // npm 包
// 或：import { OmniSense } from './src/index.mjs'; // 本地源码

const omni = OmniSense.create();
await omni.seeHotTopics('bilibili');   // 眼：真抓热搜
await omni.seeWebsite('https://...');  // 眼：真抓网站
await omni.think('用户关心什么');        // 脑：自动选免 key 路径
await omni.giveOpinion('AI 感知的价值'); // 嘴：自动选免 key 路径
```

最小可运行示例见 [`examples/standalone.mjs`](./examples/standalone.mjs)。

---

## 🧪 测试

零依赖、纯 Node 内置测试运行器 [`node:test`](https://nodejs.org/api/test.html)，无需安装任何测试框架：

```bash
npm test          # 等价 node --test，自动发现 test/*.test.mjs
```

- 测试**不触发真实联网**：仅覆盖纯逻辑（`Eyes._hotSources()` 各源 `parse` 解析、`extractMainText()` 正文提取、`Memory.search()` 检索、`Bus` 事件契约、`breaker` 缓存/熔断、`logger` 分级、`brain` 合成/规划、`server` 路由分发、`providers` 配置、WBI 离线签名等），用离线 fixture。
- B站 WBI 签名逻辑以 `mixinKeyOverride` 注入固定密钥做**离线**校验（避免联网）。
- 额外 `npm run lint` 对 `src/`、`test/` 全部 `.mjs` 跑 `node --check` 语法检查。
- CI：`.github/workflows/test.yml` 在 Node 18/20/22 矩阵上先 `npm run lint` 再 `npm test`。

---

## ⚙️ 运行模式（自动识别）

| 模式 | 触发条件 | 眼/耳 | 脑/嘴 |
|------|---------|-------|-------|
| `qclaw` | 检测到 OpenClaw/QClaw 控制网关 `127.0.0.1:<port>` 可达 | 真抓取 | 框架 `openclaw` 在线模型免 key 真推理 |
| `agent` | 无网关（如普通 Node / WorkBuddy） | 真抓取 | **由调用方（你 / 你的 agent）驱动**——脚本输出真实感知上下文 + 提示词，调用方直接想/说 |
| _外部 key 回退_ | 设置 `LLM_*` 环境变量且网关不可用 | 真抓取 | 走你配置的 OpenAI 兼容端点 |

- 模式自动探测；可用环境变量 `OMNI_RUNTIME=qclaw|agent` 强制。
- 网关细节（端口、令牌）由框架统一管理，`src/core/llm.mjs` 仅在运行时读取，不写死任何密钥。

---

## 🔑 环境变量（全部可选）

复制 `src/.env.example` 为 `src/.env` 或项目根 `.env` 填写。留空则对应能力诚实降级。

```bash
# 文本/多模态大模型（OpenAI 兼容，网关不可用时回退）
LLM_BASE_URL=https://api.your-llm.com/v1
LLM_KEY=sk-xxx
LLM_MODEL=gpt-4o-mini

# 视觉理解（看图）
VLM_BASE_URL=
VLM_KEY=
VLM_MODEL=

# 语音转写（听）
ASR_BASE_URL=
ASR_KEY=
ASR_MODEL=whisper-1

# 语音合成（出声）
TTS_BASE_URL=
TTS_KEY=
TTS_MODEL=tts-1
```

其它可选开关：`OMNI_RUNTIME`（强制模式）、`OMNI_GATEWAY_BASE`（覆盖网关地址）、`GATEWAY_TOKEN`（覆盖网关令牌）、`OMNI_MODEL`（覆盖模型名）、`OMNI_MEMORY`（覆盖记忆文件路径）、`YTDLP_BIN`（覆盖 yt-dlp 路径）。

热搜抓取相关（提升稳定性）：`OMNI_HOT_TTL`（缓存有效期 ms，默认 60000）、`OMNI_HOT_MAX_FAILS`（熔断触发所需连续失败次数，默认 3）、`OMNI_HOT_COOLDOWN`（熔断冷却 ms，默认 300000）。

日志：`OMNI_LOG_LEVEL`（trace/debug/info/warn/error/silent，默认 info）；`QUIET=1` 等价于 `error`。

---

## 📂 目录结构

```
omni-sense/
├── README.md               # 本文件（通用主文档）
├── SKILL.md                # OpenClaw/QClaw 技能说明
├── LICENSE                 # MIT
├── package.json            # npm 元数据 + CLI bin
├── .gitignore
├── examples/
│   └── standalone.mjs      # 独立使用最小示例
├── .github/
│   └── workflows/
│       └── test.yml        # CI：Node 18/20/22 跑 lint + node --test
├── test/                   # node:test 单元测试（离线 fixture）
│   ├── eyes.test.mjs  memory.test.mjs  bus.test.mjs  breaker.test.mjs
│   ├── config.test.mjs  logger.test.mjs  brain.test.mjs
│   ├── server.test.mjs  server-auth.test.mjs  providers.test.mjs  llm.test.mjs
│   └── watch.test.mjs  tools.test.mjs  agent.test.mjs
└── src/
    ├── index.mjs           # 门面 OmniSense
    ├── cli.mjs             # 命令行入口（npm bin: omni-sense）
    ├── server.mjs          # 本地 HTTP 驱动服务（127.0.0.1，可选 Bearer 鉴权）
    ├── .env.example        # 可选外部模型配置模板
    ├── core/
    │   ├── bus.mjs         # 事件总线（on/once/off/wildcard + 命令调度）
    │   ├── http.mjs        # 统一 HTTP 客户端（超时/重试/UA）
    │   ├── memory.mjs      # 记忆中枢（深度语义检索：BM25-lite + 时间衰减 + 复用权重 + MMR 去冗余，落盘）
    │   ├── llm.mjs         # 框架网关在线模型代理（免 key，可选）
    │   ├── logger.mjs      # 分级日志
    │   ├── breaker.mjs     # TtlCache + CircuitBreaker（零依赖基础设施）
    │   ├── config.mjs      # 安全读取框架网关配置
    │   ├── watch.mjs       # 常驻感知循环（runWatch/runWatchTick + 差异检测diffTopics + 多模式自主编排 remember/alert/digest + 新增热点联网摘要 summarizeNewTopics，纯函数可测）
    │   ├── tools.mjs       # 工具执行器（web_fetch/文件/calc/now/记忆/热搜… 安全白名单）
    │   ├── agent.mjs       # Agent 内核（ReAct 闭环 + 每步二次经验召回 + localPlan 规划器[经验hints重建步骤] + playbook 自动复用 + 经验记忆召回注入推理 + 经验沉淀闭环 + reflect() 自我反思[写回 agent-reflection 笔记]）
    │   ├── agents.mjs      # 多 Agent 协作（协调器 planSubtasks/planSubtasksSmart[LLM 智能拆解] + 角色子 agent 委派[并行] + 共享黑板 + 协调器综合 + 诚实部分失败）
    │   ├── memory.mjs      # 记忆中枢（BM25 深度检索 + 时间衰减 + 复用权重 + MMR 去冗余 + 去重压缩 dedupNotes/compact）
    │   └── providers/index.mjs  # 模型适配层（网关优先 + 外部回退）
    └── modules/
        ├── eyes.mjs        # 眼：看网站/热搜/视频/图 + 正文提取 + WBI
        ├── ears.mjs        # 耳：听意见/小说/音频
        ├── mouth.mjs       # 嘴：给意见/对话
        ├── brain.mjs       # 脑：思考/决策/规划/行动(act) + synthesize()
        └── perception.mjs  # 感知：环境聚合
```

---

## 🧩 扩展指南

- **新增热搜源**：在 `src/modules/eyes.mjs` 的 `_hotSources()` 增加一项（url / as / parse / 可选 headers），`all` 聚合自动覆盖（参照已有 9 个源）。B站番剧榜等强制 WBI 签名的接口，加 `sign:'wbi'` + `extra` 即可（见 `biliWbiParams`）。单源失败不影响整体（`Promise.allSettled` 优雅降级）。
- **接入外部模型（可选）**：填 `.env` 的 `LLM_*/VLM_*/ASR_*/TTS_*`；网关不可用时自动回退。
- **新增感官/平台**：参考现有模块，在 `src/modules/` 下实现并在 `src/index.mjs` 注册即可。

---

## 🪧 诚实边界（务必知晓）

- ✅ **联网抓取/下载**是真实本地执行，不依赖任何 key，在任何环境都真跑。
- ✅ **文本推理（脑思考 / 嘴说话给意见对话）两条免 key 路径均已打通**：有网关走框架模型；无网关由调用方驱动，脚本输出真实感知上下文供其直接思考/回答。
- ✅ **视觉"看图"**：外部 VLM 配置时真跑；无则 agent 模式下把图像落到本地，由调用方（agent）直接读图真实描述——免 key 真看。
- ⚠️ **语音"听"(ASR)与"出声"(TTS)**：需配置外部 key 或本地引擎（如 whisper.cpp）。文本类"听"（意见/小说/文案）不受影响。

---

## 📜 License

[MIT](./LICENSE) © 2026 OmniSense contributors

> 开源版本不含作者任何个人数据或示例项目内容（拿到的是干净的通用框架）。如需对接你自己的项目，按上面的「快速开始」三步接入即可。
