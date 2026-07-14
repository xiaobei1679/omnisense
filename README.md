# OmniSense · 通用 AI 身体框架

> 一套**像真人一样的 AI 身体**：拥有 **眼 · 耳 · 嘴 · 脑 · 手 · 感知 · 脚** 七种器官，并相互协同，自驱地在世界里活着。
> 本仓库已将 **多智能体工作区（openclaw-workspace）** 合并进来——OmniSense 既是一个通用身体引擎，也内置了可直接驱动它的多智能体协作环境。

[![Node.js CI](https://github.com/xiaobei1679/omnisense/actions/workflows/test.yml/badge.svg)](https://github.com/xiaobei1679/omnisense/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org)

OmniSense 是一套**零依赖、可移植**的通用 AI 感知系统。它的「真实」体现在：

- **联网抓取本机真实执行**：看网站、拉 B站/头条/微博/百度/抖音/红果/知乎/微信/番剧榜等实时热搜、下视频、取图像——全部本地真实联网，**不依赖任何 API KEY**。
- **模型推理免 key 双模式自适应**：在本机有模型网关（OpenAI 兼容端点）的环境里，自动用网关在线模型真思考真说；在没有网关的环境，脑/嘴由**调用方（你 / 你的代码 / 你的 agent）**驱动，同样免 key。
- **诚实降级**：视觉「看图」（VLM）、语音「听」（ASR）、「出声」（TTS）若未配置对应模型，会**如实说明**，绝不假装已看懂/听懂/说出。

**一次编写，到处运行**：既可作为独立 CLI / npm 包在任何装了 Node ≥ 18 的机器上跑，也可 `import` 作为库嵌入你的项目，或作为技能/插件接入任意 Agent 框架。

## 🧍 像真人一样的身体：七种器官

OmniSense 不只是一堆零散能力，而是一个**有机整合的身体**——七种器官各司其职、又协同工作，如同真人：

| 器官 | 隐喻 | 能力 | 底层模块 |
|------|------|------|---------|
| 🔎 眼 Eye | 看 | 网站 / 热搜 / 图像 / 视频 | `src/modules/eyes.mjs` |
| 👂 耳 Ear | 听 | 音频转写 / 小说朗读 / 用户反馈 | `src/modules/ears.mjs` |
| 👄 嘴 Mouth | 说 | 表达观点 / 对话回复 / 朗读 | `src/modules/mouth.mjs` |
| 🧠 脑 Brain | 思 | 思考 / 决策 / 规划 / 指挥 | `src/modules/brain.mjs` |
| ✋ 手 Hand | 做 | 联网抓 / 读写文件 / 计算 / 记忆 / 总结 | `src/core/tools.mjs` |
| 🌐 感知 Perception | 感 | 把眼耳输入汇成整体环境理解 | `src/modules/perception.mjs` |
| 🦶 脚 Foot | 行 | 常驻感知、在世界里移动与监视 | `src/core/watch.mjs` |

以真人隐喻直接驱动：`omni.body.eye('seeWebsite', url)`、`omni.body.ear('listenFeedback', '...')`、`omni.body.hand('web_fetch', { url })`、`omni.body.foot('watch', {...})`……

更关键的是 **`live()` 生命循环**——不是被动等命令，而是自驱地持续「感知 → 思考 → 动手 → 说话 → 移动」，像真人一样活着：

```js
const omni = OmniSense.create();
// 跑 3 轮生命循环（默认离线、不挂起），每轮都完整用上身体七器官
await omni.live({ ticks: 3, speak: true });
```

`omni.organs` 可随时自检七器官与各自能力；CLI 里 `node src/cli.mjs body` 打印同一张表。

---

## 🧩 多智能体工作区集成（openclaw-workspace）

OmniSense 不只是单打独斗的引擎——仓库内已合并 **`openclaw-workspace/`**（原独立仓库 `xiaobei1679/openclaw-workspace`，MIT），一套开箱即用的多智能体工作环境。
两者通过 **`integrations/openclaw/`** 桥接层打通：工作区里的智能体可以 `omnisense-engine` 角色，把 OmniSense 当作「身体」来用。

- `integrations/openclaw/omni-body.mjs`：七器官桥接（`eye/ear/mouth/brain/hand/perceive/foot`），直接驱动 `src/body.mjs` 的真实实现。
- `integrations/openclaw/omnisense-bridge.mjs`：把「一句话目标」交给身体去执行（感知 → 思考 → 动手）。
- `openclaw-workspace/config/openclaw.json.example`：已内置 `omnisense-engine` 角色（含 `skills` 与 `defaults.subagents.allowAgents` 注册）。

```bash
# 让身体算一道题（离线，确定性）
node integrations/openclaw/omni-body.mjs hand calc '{"expression":"2+2"}' --json
# A2A 风格能力卡：把身体全部能力扁平化为 skills[]（id/name/description/tags/examples/net）
node integrations/openclaw/omni-body.mjs card --json
# 七器官树（含每能力 desc/net/examples）
node integrations/openclaw/omni-body.mjs describe --json
# 把一句话目标交给身体去执行
node integrations/openclaw/omnisense-bridge.mjs "记录一条测试记忆" --json
```

详见 [integrations/openclaw/README.md](./integrations/openclaw/README.md) 与 [openclaw-workspace/README.md](./openclaw-workspace/README.md)。

---

## 目录

- [核心特性](#核心特性)
- [🧍 像真人一样的身体：七种器官](#🧍-像真人一样的身体七种器官)
- [🧩 多智能体工作区集成（openclaw-workspace）](#🧩-多智能体工作区集成openclaw-workspace)
- [它能做什么（真实 vs 模型）](#它能做什么真实-vs-模型)
- [快速开始](#快速开始)
- [Agent 行动闭环](#agent-行动闭环)
- [多 Agent 协作](#多-agent-协作)
- [本地驱动服务 serve](#本地驱动服务-serve)
- [测试](#测试)
- [运行模式（自动识别）](#运行模式自动识别)
- [环境变量](#环境变量)
- [目录结构](#目录结构)
- [扩展指南](#扩展指南)
- [诚实边界](#诚实边界)
- [License](#license)

---

## 核心特性

| 特性 | 说明 |
|------|------|
| 🔎 真实感知 | 网站/热搜/视频/图像的联网抓取与下载，本机真实执行（零 key） |
| 🧠 免 key 双模式 | `gateway` 模式走本机模型网关在线模型；`driver` 模式由调用方驱动大脑与嘴巴 |
| 🧩 零依赖 | 纯 Node 原生 ESM，无 npm 依赖，复制即用 |
| 🤝 事件总线 | 五模块通过事件契约解耦协作（眼/耳发感知 → 脑聚合决策 → 向眼/耳/嘴下发命令） |
| 🪧 诚实边界 | 能力不可用时明确告知，不伪造结果 |
| 🔌 可扩展 | 热搜源、感官、模型后端均可按约定扩展 |
| 🔥 多平台热搜聚合 | `hot all` 并行抓 9 大平台，去重 + 跨平台频次排序（越热越靠前） |
| 🧩 热搜缓存 + 熔断 | 单源 TTL 缓存（默认 60s）降低重复联网；连续失败自动熔断冷却 |
| 🖥 本地驱动服务 | `serve` 启动 127.0.0.1 的 JSON API，供外部进程跨进程驱动能力；设 `OMNI_TOKEN` 后自动启用 Bearer 鉴权 |
| 🔁 常驻感知循环 + 自主编排 | `watch` 按间隔持续聚合热搜+感知+规划，写 JSON 快照；开启 `--agent` 后做结构化差异检测并自动派发 Agent 真动手 |
| 🗺 离线规划 | `plan` 基于当前感知合成情境，给出下一步行动建议（纯离线） |
| 🤖 **Agent 行动闭环** | `agent "<目标>"` 让系统真正做事：ReAct 推理 → 选工具 → 执行 → 观察 → 再推理，直到目标完成；无模型走本地确定性规划器 |
| 🧩 **多 Agent 协作** | `multiagent "<目标>"` 把复杂目标交给协调器 + 角色子 agent，独立子任务并行执行、汇总综合，部分失败诚实报告 |
| 🪵 分级日志 | 统一 `core/logger.mjs`（trace/debug/info/warn/error/silent），`OMNI_LOG_LEVEL` 可控，`--quiet` 静默 |
| ⚡ 更快的 standalone | 无网关环境秒级进入 driver 模式（免联网探测）；统一 HTTP 客户端带超时/重试 |
| 🔌 **工具插件自发现** | 往 `src/tools/`（或 `OMNI_PLUGINS_DIR`）丢一个 `.mjs` 模块即自动注册为 `hand` 工具，无需改核心（借鉴 Nanobot / OpenSquilla 的技能自动加载模式） |
| 🔭 **Agent 执行轨迹追踪** | 每次 agent / multiagent 运行自动落盘为可回放 trace（trace→run→step），含每步耗时、成功/失败、OTel 对齐的 `gen_ai.*` 属性与错误归类；`trace` 命令聚合成功率/平均步数·耗时/工具级指标（借鉴 LangSmith / OTel GenAI 语义约定） |
| 🔬 **Trace 回放对比 & 回归门禁** | 两次运行行为分歧定位（first-divergence，对齐 Forkline 思想）+ verdict(identical/similar/improved/regressed)；`--find` 同目标多次运行检索；`--export` 导出回归数据集（LangSmith 式 trace→dataset）；`--baseline` + `--regression` 行为回归门禁（退化即 FAIL，可接 CI，借鉴 recut-ai / shadow 思想） |
| 📡 **OTLP/GenAI 可观测性导出** | 身体轨迹可一键导出为 **OTLP/JSON**（OTel 原生 wire 格式）：一次 run → 一条 trace（root span `invoke_agent` + 每步 `execute_tool` child span），属性对齐 OpenTelemetry GenAI 语义约定（`gen_ai.*` / `error.type` / `status.code`）。直接投递 Grafana Tempo / Phoenix / Jaeger / OTel Collector 的 `/v1/traces`，零依赖、离线、数据主权自持（借鉴 OTLP/HTTP+JSON 编码与 OTel GenAI 语义约定） |
| 🪪 **A2A 风格能力卡（Agent Card）** | `body.agentCard()` / CLI `card` / 桥接 `omni-body.mjs card` 把七器官能力扁平化为 `skills[]`（id/name/description/tags/examples/net），供多智能体工作区做能力发现与委派（借鉴 Google A2A Protocol 的 AgentCard 思想，仅借鉴结构与字段语义，未引入其传输/协议依赖） |
| 🔗 **技能匹配与自动委派（skillDispatch）** | `body.skillResolve(goal)` 基于关键词匹配从 Agent Card 的 skills[] 中找到最匹配的器官/方法；`body.skillDispatch(goal)` 自动委派到最佳技能并调用。CLI `dispatch` 命令 / 工作区 `omnisense-link dispatch` 均可用（借鉴 IETF AgentCard 能力发现 + ARD intent→tool 匹配思想） |
| 🤖 **自主循环（autopilot）** | 身体用自身能力卡 `skillResolve` **自己决定每轮做什么**并离线执行：感知→自生成意图→选最佳器官→`skillDispatch` 执行，全程零网络、像真人一样自驱活着（借鉴 BabyAGI 自生成任务队列思想：任务创建→优先级排序→执行→据结果重排→再生成） |
| 🔧 **工具级缓存/熔断** | 复用 `breaker.mjs` 的 TTL 缓存 + 熔断器（此前只用于热搜），**扩展到 Agent 工具调用**：联网工具 `web_fetch`/`summarize_url`/`hot_topics` 命中缓存直接返回、避免重复联网；某工具持续失败则熔断、避免反复超时拖垮整条 agent 流水线。声明式启用（工具定义加 `cacheTtl`/`circuit`），默认工具行为完全不变。`cli cache` / 工作区 `omnisense-link cache` 可查状态与清空（借鉴 LangChain 的 LLM/工具调用缓存与 AutoGen「per-tool circuit breaker」生产实践） |
| 🦶 **常驻自驱身体（watch --autopilot）** | 把 `watch` 常驻感知循环升级为**常驻自驱**：每 tick 由身体自身能力卡 `skillResolve` 自主决策并 `skillDispatch` 离线执行，脚（foot）从"巡逻"变成**持续自我驱动的活身体**（像真人一样在世界里自驱地活着）。与 `--agent`（变化即行动·固定目标）**互补**：两者可同时开，互相叠加。离线启发式实现（借鉴 OpenClaw「心跳闭环 / Heartbeat Loop」与 Sophia「System 3 持久自驱层」），零网络零 key（https://www.aigcopen.com/content/omni-channel/39278.html · https://arxiv.org/abs/2512.18202） |
| 🔭 **监控器官 monitor（第 8 器官）** | 统一状态快照（状态/器官/四层记忆/活动/告警）＋ Agent 健康（错误率→healthy/degraded/critical）＋ 可观测三支柱（指标+追踪+日志，借鉴 LangSmith/Langfuse/CloudWatch GenAI）＋ 状态网格/舰队健康颜色化（借鉴 ClawHub）＋ 记忆健康（技能利用率/信任分/陈旧，借鉴 perfecxion）＋ 异常检测（延迟突增/吞吐骤降/记忆批量注入/**熔断开启 circuit_open**）＋ 工具管线健康（缓存命中/熔断状态/工具级 P50-P95-P99 延迟分布）＋ 趋势异常检测（P95 爬坡/成功率漂移/记忆空转）＋ **可调告警阈值（`monitor --config`/`--config-file`，常驻迭代）：所有阈值可经 JSON 文件/环境变量/`OMNI_MONITOR_*`/构造 opts 覆盖，来源(default/env/file/opts)可观测可溯源（Observability-as-Code），避免硬编码阈值反模式** ＋ **阈值健康着色（`monitor --threshold-health`，ok/warn/over/na）与可推送告警清单（`monitor --threshold-alerts`，Alertmanager 形状 payload）** ＋ **综合健康评分（`monitor --score`）：把 Liveness/成功率/阈值/异常/工具管线 5 维度加权汇总成一个 0-100 分 + 等级 A/B/C/D/F，一眼看清整体健康，借鉴 Nobl9 Composite SLO 与 New Relic 健康分；**维度权重可配置**（`monitor --weights`/`--weights-file`：5 维度权重可经 JSON 文件/`OMNI_MONITOR_WEIGHT_*`/构造 opts 覆盖，优先级 opts>env>file>default，计分前归一化使分数恒在 0-100，复用 v7.0.0 的 Observability-as-Code 思想）** ＋ 零依赖静态 HTML 驾驶舱仪表盘（含「阈值配置/当前值 vs 阈值红黄绿/可推送告警清单/综合健康评分」区块）。CLI `monitor [--summary|--health|--latency|--grid|--memory|--anomalies|--runs|--tools|--trends|--config|--threshold-health|--threshold-alerts|--score|--health-score|--weights] [--config-file=<path>] [--weights-file=<path>]`，工作区 `omnisense-link monitor <snapshot|health|alerts|dashboard|recordMetric|checkAlerts|toolHealth|trends|trendAnomalies|config|thresholdHealth|thresholdAlerts|alertables|healthScore|score|weights>` 跨层复用同一份实现 |
| 🔭 **自驱身体轨迹可观测（autopilot / watch --autopilot trace）** | 身体自驱决策（autopilot 每轮 / watch --autopilot 每 tick）经**同一份 tracer** 落盘为 `engine='autopilot'` 的可回放 trace：**可观测性闭环**——身体"自己活着"的行为同样可追溯、可回放、可防退化。`--trace` 显式开启（watch --autopilot 默认开启）；`trace --find="autopilot:"` 可检索全部自驱轨迹，`trace --diff`/`--regression`/`--export` 同样适用（对齐 Agent 可观测性四要素 Traces/Replay/Decision Log/Cost Attribution；借鉴 LangGraph checkpointer 每步落盘 + Octopoda 时间线回放思想，https://docs.langchain.com/oss/python/langgraph/persistence · https://ai-curator.jp/articles/cmo08r7qd00urdo1edgf942tn） |

## 🔌 工具插件自发现（借鉴 Nanobot / OpenSquilla 技能加载器）

传统框架把工具写死在核心里，加一个工具就要改核心、重测、重发版。OmniSense 借鉴
[Nanobot](https://github.com/HKUDS/Nanobot) 与 [OpenSquilla](https://www.ai-all.info/ai-models/opensquilla-ai-agent-token)
的「技能/工具自动加载」思想：**工具即插件**——

- 在 `src/tools/` 下放一个 `.mjs`，默认导出一个工具对象 `{ name, description, parameters, run }`，
  启动时被 `buildDefaultTools` 自动扫描并注册为 `hand` 工具。
- 额外可用环境变量 `OMNI_PLUGINS_DIR=/path/to/your/tools` 指定你自己的插件目录（方便集成层扩展，不改核心）。
- 加载失败或契约不合法的插件会被跳过并记录警告，**绝不拖垮启动**。
- 内置示范插件：`src/tools/hash.mjs`（离线 SHA-256，用于内容指纹/去重）。

```js
// 你的插件 src/tools/greet.mjs
export default {
  name: 'greet',
  description: '打招呼',
  parameters: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
  run: async ({ name }) => ({ message: `你好, ${name}` }),
};
```
```bash
node integrations/openclaw/omni-body.mjs hand hash '{"text":"hello"}' --json
# → { "ok": true, "output": { "algo": "sha256", "digest": "..." } }
```

## 它能做什么（真实 vs 模型）

| 模块 | 真实执行的部分（本机联网，零 key） | 模型推理（免 key） |
|------|----------------------------------|------------------------------|
| 🔎 眼 Eyes | 抓网站 HTML、拉 B站/头条/微博/百度/抖音实时热搜、红果短剧热榜、知乎热搜词、微信热文、B站番剧榜（WBI 签名）、下视频抽帧、获取图像 | 看图视觉：driver 模式由调用方直接读图；外部 VLM key 时真跑 |
| 👂 耳 Ears | 下载并读取音频文件、接收用户意见/小说文本/文案 | 文本理解（意见/小说/文案）；语音转写 ASR 需外部 key 或本地引擎 |
| 🗣 嘴 Mouth | 输出意见/对话文本 | 生成意见与回复（网关模型 / 外部 LLM / 调用方驱动）；出声 TTS 需外部 key |
| 🧠 脑 Brain | 记忆落盘、聚合感知、向眼/耳/嘴下发命令 | 思考/决策（网关模型 / 外部 LLM / 调用方驱动） |
| 🌐 感知 Perception | 聚合近期感知为情境模型、给出注意力建议 | — |

---

## 快速开始

### 方式一：作为独立 CLI / npm 包（最常见）

```bash
# 直接克隆运行（无需 npm install，零依赖）
git clone https://github.com/xiaobei1679/omnisense.git
cd omnisense
node src/cli.mjs demo          # 真实联网演示

# 也可作为 npm 包使用（发布后）
npm install omnisense
npx omnisense demo             # 或：node node_modules/omnisense/src/cli.mjs demo
```

常用命令：

```bash
node src/cli.mjs hot                      # 看 B站 实时热搜
node src/cli.mjs hot douyin              # 看 抖音 实时热搜（免 key 真抓）
node src/cli.mjs hot hongguo             # 看 红果短剧 热榜
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
node src/cli.mjs status --json           # 查看模型后端与能力（JSON 输出便于解析）
node src/cli.mjs watch --interval=60 --max=∞   # 常驻感知循环（写 .omni-watch.json）
node src/cli.mjs watch --interval=60 --autopilot   # 常驻自驱身体：每 tick 由身体自身能力卡自主决策并离线执行（像真人一样持续自我驱动地活着）
node src/cli.mjs watch --interval=60 --autopilot --trace   # 每 tick 自驱决策记录为可回放 trace（可观测性闭环；--autopilot 默认即记录，--no-trace 关闭）
node src/cli.mjs watch --interval=60 --autopilot --autopilot-agenda="思考当前环境,规划下一步行动"  # 自定义自驱议程（逗号分隔）
node src/cli.mjs watch --interval=60 --autopilot --no-dynamic   # 关闭动态重排、严格按默认/自定义顺序
node src/cli.mjs watch --interval=60 --autopilot --agent   # 常驻自驱 + 变化即行动，两者互补叠加
node src/cli.mjs autopilot --ticks=3 --trace   # 自主循环每轮自驱决策记录为可回放 trace（默认不记录，显式 --trace 开启可观测性闭环）
node src/cli.mjs trace --find="autopilot:" --limit=10   # 检索全部自驱身体轨迹（engine=autopilot），可接 --diff/--regression 防退化
node src/cli.mjs serve 8787              # 启动本地驱动服务（127.0.0.1）
node src/cli.mjs body                    # 身体自检：打印七种器官及能力
node src/cli.mjs live --ticks=3 --speak     # 生命循环：身体每拍用自身能力卡自主决策（autopilot 自驱，像真人一样活着；借鉴 Stanford Generative Agents 持续自驱生命周期）
node src/cli.mjs live --ticks=3 --no-autopilot   # 回到写死步骤（感知→思考→动手→说话→移动）
node src/cli.mjs autopilot --ticks=3        # 自主循环：身体用能力卡自己决定每轮做什么并离线执行（借鉴 BabyAGI 自生成任务队列）
node src/cli.mjs trace --summary             # Agent 执行轨迹聚合指标（成功率/平均步数·耗时/工具级）
node src/cli.mjs trace --list --limit=10     # 列出最近 10 条可回放 trace（含 runId）
node src/cli.mjs trace --get=<runId>         # 回放某条 trace（模型看见了什么→决定了什么→执行了什么）
node src/cli.mjs trace --clear               # 清空本地轨迹文件
node src/cli.mjs trace --export=spans.jsonl --export-format=otlp   # 导出 OTLP/JSON（OTel-native，可投 Grafana Tempo/Phoenix/Jaeger）
node src/cli.mjs dispatch "<目标>"             # 技能匹配与自动委派：基于 Agent Card 能力卡找到最佳器官/方法并执行（纯关键词匹配，零外部依赖；--detail 仅展示不执行）
node src/cli.mjs cache                        # 工具级缓存/熔断状态（web_fetch/summarize_url/hot_topics 命中缓存直接返回、避免重复联网；持续失败熔断防反复超时）
node src/cli.mjs cache --clear               # 清空工具级缓存
node src/cli.mjs cache --persist-file=./.omni-tool-cache.json   # 启用落盘持久化（进程重启后缓存/熔断续命）
node src/cli.mjs cache --flush              # 立即落盘一次
node src/cli.mjs cache --clear-persist     # 清空内存与磁盘
# 或设环境变量（每个进程启动自动载入，跨重启续命）：OMNI_TOOL_CACHE_FILE=./.omni-tool-cache.json
```

选项：`--json`（结构化 JSON 输出便于解析）、`--quiet`（静默过程日志）、`--tts`（出声）。
`watch` 专属：`--interval=<秒>`（间隔，默认 60）、`--max=<次数>`（最大循环，默认 ∞ 常驻）、`--think`（每轮在线思考）、`--out=<文件>`（快照路径）、`--remember`（最新摘要写入记忆 `lastWatch`）、`--agent`（开启「变化即行动」自主编排）、`--agent-mode=<模式>`（`remember` 默认记当前/新增/消失 | `alert` 仅突变触发写告警记忆 | `digest` 写 markdown 摘要落盘）、`--agent-cooldown=<秒>`（两次自主行动最小间隔，默认 60，防刷）、`--agent-goal=<模板>`（自定义目标，`{date}{top3}{topics}{added}{removed}{count}` 占位）、`--summarize-new`（对新增热点联网抓 URL 并摘要，best-effort，digest 模式写入摘要段；默认关闭，避免意外联网）、`--autopilot`（开启**常驻自驱身体**：每 tick 由身体自身能力卡自主决策并离线执行，把常驻感知升级为常驻自驱）、`--autopilot-agenda="a,b,c"`（自定义自驱议程，逗号分隔；不传用身体默认离线议程）、`--no-dynamic`/`--dynamic`（关闭/强制开启动态议程重排，仅自驱路径生效）。
`agent` 专属：`--max=<步数>`（默认 8）、`--no-llm`（强制走本地规划器，离线完成任务）、`--allow-shell`（启用 shell 工具，默认禁用需显式开启）。

### 方式二：作为技能/插件接入你的 Agent 框架

把整个 `omnisense/` 目录复制到你的 Agent 框架的技能（skills）目录即可：

```bash
cp -r omnisense <你的框架技能目录>/omnisense
```

在有本机模型网关的环境里，文本推理自动免 key 走网关在线模型；眼/耳照常真实抓取。
详见 [`SKILL.md`](./SKILL.md)。

### 方式三：作为库 import

```js
import { OmniSense } from 'omnisense';          // npm 包
// 或：import { OmniSense } from './src/index.mjs'; // 本地源码

const omni = OmniSense.create();
await omni.seeHotTopics('bilibili');   // 眼：真抓热搜
await omni.seeWebsite('https://...');  // 眼：真抓网站
await omni.think('用户关心什么');        // 脑：自动选免 key 路径
await omni.giveOpinion('AI 感知的价值'); // 嘴：自动选免 key 路径

// 或直接用「身体」隐喻驱动七器官：
await omni.body.eye('seeWebsite', 'https://example.com'); // 眼
await omni.body.hand('web_fetch', { url: 'https://example.com' }); // 手：动手抓取
await omni.live({ ticks: 3, speak: true }); // 生命循环：自驱地感知→思考→动手→说话→移动
```

最小可运行示例见 [`examples/standalone.mjs`](./examples/standalone.mjs)。

---

## Agent 行动闭环

`agent "<目标>"` 让 OmniSense 从「感知+汇报」升级为「能推理、能调用工具、能完成目标」的 agent：

- **有在线模型（网关/外部 LLM key）时**：模型动态决定每一步用哪个工具，直到给出最终答案——真正意义上的智能 agent，能处理开放式、多分支目标。
- **无模型（driver 模式 / 纯离线）时**：走**本地确定性规划器 `localPlan`**，照样能完成具体多步任务（如「抓取某网页并写入文件」「计算」「查记忆」），诚实不伪造。
- **通用意图分解（localPlan）**：先识别原子意图（算/抓/摘要/写/读/记/热搜/时间），再做依赖排序（如「抓取→写入」「读→写入」「计算→写入」）组合成步骤序列，原生支持复合目标。
- **越用越强（playbook 自动复用）**：每完成一个目标，把「打法」(playbook) 沉淀进记忆。下次来新目标时：
  - **高相似（Jaccard ≥ 0.5）** → 直接复用旧打法并做参数迁移，`hitCount` +1；
  - **中相似（0.25 ≤ Jaccard < 0.5）** → 把旧打法当作 few-shot 注入 LLM 推理；
  - 相似度都不足 → 走常规 ReAct / localPlan 正常完成，再沉淀新打法。
  - **经验层闭环**：每次完成目标自动沉淀「经验笔记」，下次来新目标时用深度检索召回并注入推理上下文（本地规划器路径作为诚实 hints）。
  - **ReAct 每步二次经验召回**：LLM 推理循环中每执行一步都再精炼一次经验召回，注入下一步推理，长链路任务边做边「想起」相关经验。
  - **记忆去重压缩**：`Memory.dedupNotes()` / `compact()` 合并重复笔记、超上限删最旧，记忆不会无限膨胀。
  - **Agent 自我反思**：每次跑完基于执行轨迹产出「经验教训」，以 `agent-reflection` 笔记写回记忆，未来同类目标经 `recallContext` 召回真正影响下次推理。有在线模型走 LLM 反思，否则离线启发式；反思失败静默退回离线。`agent` 命令可用 `--no-reflect` 关闭。
  - **深度语义检索**：记忆检索从「字符串包含」升级为 BM25-lite（中英混合分词）+ 时间衰减 + 复用权重 + 可选 MMR 去冗余，按「相关 × 新鲜 × 常用」综合召回，越用越准。

内置工具：`web_fetch`(联网抓取) · `read_file` / `write_file` / `list_dir`(文件) · `calc`(安全算术，白名单求值杜绝任意代码执行) · `now`(时间) · `hot_topics`(热搜) · `summarize_url`(网页摘要) · `memory_search` / `memory_remember`(记忆) · `shell`(默认禁用，需 `--allow-shell`)。

```bash
# 离线也能真做完的多步任务：
node src/cli.mjs agent "计算 2+2" --no-llm
node src/cli.mjs agent "抓取 https://example.com 并写入 ./page.txt" --no-llm
# 复合目标：本地规划器自动做依赖排序（先算后写），离线真落盘：
node src/cli.mjs agent "计算 100/4 并写入 ./result.json" --no-llm
# 越用越强：第一次跑沉淀 playbook，第二次同类目标直接复用
node src/cli.mjs agent "计算 200/8 并写入 ./result.json" --no-llm
# 有模型时让 agent 自主推理（本机模型网关 或 配了 LLM_* key 的环境）：
node src/cli.mjs agent "帮我查今天最热的三条热搜，并记住它们"
```

---

## 多 Agent 协作

把「单体助手」升级为「可编排团队」——复杂目标由协调器拆解成角色子任务，每个子任务交给一个能力被限定的子 agent 执行，结果汇总到共享黑板后综合产出。

- **角色（能力边界 = 工具集白名单）**：
  - `researcher` 检索/抓取/摘要
  - `analyst` 计算/分析/结构化
  - `writer` 写文件/产出文档
  - `critic` 校验/复核
- **协调器（离线确定性 + 并行调度）**：按任务级连接词拆句 → 每句按关键词分派角色；合成类子句自动归入第二批，依赖前序产出。独立子任务默认并行执行（Promise.all）。子 agent 越权调用未授权工具会被诚实拒绝（沙箱）。
- **协调器综合**：所有子任务完成后综合成最终 `result`——默认确定性摘要；传 `--coordinator`（且环境有模型）走 LLM 智能综合；也支持代码层注入自定义 `coordinator` 函数。
- **共享黑板 `blackboard`**：每个子 agent 的结果按 `角色#序号` 记入。
- **诚实**：某子任务失败 → 整体 `completed` 仍为真（其他已完成的有产出），但 `allCompleted` 标为假并说明失败原因，绝不谎称全员成功。

```bash
# 协调器拆成 researcher(抓取落盘) + analyst(计算落盘)，两个 worker 并行；"汇总"子句第二批综合落盘
node src/cli.mjs multiagent "抓取 https://example.com 并写入 ./page.txt，然后计算 100/4 并写入 ./result.json，然后汇总以上并写入 ./summary.md" --no-llm
# 指定启用角色
node src/cli.mjs multiagent "计算 2+2 并写入 ./a.txt，然后生成报告写入 ./b.txt" --roles=analyst,writer --no-llm
# 串行执行 + LLM 协调器综合（有模型时）
node src/cli.mjs multiagent "抓取 https://example.com 并写入 ./page.txt，然后计算 100/4 并写入 ./r.json" --no-parallel --coordinator
```

---

## 🔭 Agent 执行轨迹追踪（可观测性）

OmniSense 每次跑 `agent` / `multiagent`（含 `live` 生命循环、watch 自主编排派发的 agent）都会把整次运行**自动记录为可回放 trace**——离线落盘到 `.omni-traces.json`，无需任何外部平台（LangSmith/AgentOps 类 SaaS 不进仓库、数据主权自持）。此外，**身体自驱决策**（autopilot 每轮 / watch --autopilot 每 tick）也可经 `--trace` 显式记录为 `engine='autopilot'` 的 trace，让"身体自己活着"的行为同样可追溯/可回放/可防退化（可观测性闭环）。

设计借鉴（思想/模式，非代码）：
- **LangSmith / LangChain v1 全链路 Trace**：一次运行 = 一条 trace，内部由若干 run/step 组成，每步是可回放的因果事件（id / 耗时 / 输入 / 输出 / 错误）——让"事故复盘"从猜变成看。
  来源: <https://www.wangyiyang.cc/2025/12/14/langchain-guide-20/> · <https://developer.volcengine.com/articles/7647092173612433444>
- **HuggingFace smolagents 的 ActionStep**：每步 = thought + action + observation，与本框架既有 trace 形状天然一致。
  来源: <https://hugging-face.cn/docs/smolagents/conceptual_guides/react>
- **OpenTelemetry GenAI 语义约定**：可移植的 span 属性命名（`gen_ai.operation.name` / `gen_ai.tool.name` / `gen_ai.tool.call.arguments|result` / `error.type`），未来可无缝对接 OTLP 后端。
  来源: <https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/> · <https://technspire.com/blog/agent-observability-tracing-decisions-tool-calls>
- **AWS Agent 可观测性维度**：响应时间、工具执行耗时、错误与异常归类。
  来源: <https://aws.amazon.com/cn/blogs/china/agentic-ai-infrastructure-practice-series-7/>

**每条 run** 记录：`runId` / `goal` / `engine`(`llm`|`local`|`dispatcher`) / 起止时间·总耗时 / `completed` / `usedLLM` / `reused` / 各步（thought / action / action_input / observation / 单步耗时 / OTel 属性）。

**`trace` 命令**（聚合 & 回放）：

```bash
node src/cli.mjs trace --summary                       # 聚合：总次数/成功率/平均步数·耗时/工具级调用·成功·失败·平均耗时/错误归类/引擎分布
node src/cli.mjs trace --list --limit=10               # 最近 10 条 run 概览（含 runId）
node src/cli.mjs trace --list --engine=local          # 按引擎过滤
node src/cli.mjs trace --get=run_xxxx                  # 回放单条 trace 完整步骤
node src/cli.mjs trace --clear                         # 清空本地轨迹（仅删 .omni-traces.json）
```

**作为库 / HTTP 使用**：`omni.traceSummary()` · `omni.traces({limit,engine})` · `omni.getTrace(id)` · `omni.clearTraces()`；serve 暴露 `GET /trace-summary` 与 `GET /traces?engine=&limit=`。

> 诚实边界：默认不落全量大内容（参照 OTel「敏感内容默认不记录」约定），目标/参数/输出统一截断至 ~2KB，只保留 `ok`/`error` 这类结构化结论——可回顾而不泄密。`.omni-traces.json` 已纳入 `.gitignore`，不进仓库。

---

## 🔬 Trace 回放对比 & 回归门禁（让 Agent 行为可追溯、可防退化）

仅记录 trace 还不够——真正有用的是「同目标两次运行，行为从第几步开始不一样？」「这次改了提示词后有没有让原本能跑通的目标退化？」OmniSense 在 tracer 之上提供**对比 / 检索 / 导出 / 回归门禁**四件套，全程离线、本地、零依赖。

设计借鉴（思想/模式，非代码）：
- **Forkline 的 first-divergence 检测**：replay-first tracing & diffing，确定性地定位「行为从第几步开始分歧」，不重新调用 LLM、不联网。
  来源: <https://github.com/sauravvenkat/forkline>
- **LangSmith 的 trace→dataset**：把历史/生产 trace 导出为回归基准数据集，CI 里反复跑同一目标对比行为是否退化。
  来源: <https://theneuralbase.com/langsmith/learn/intermediate/setting-up-a-regression-test-suite> · <https://blog.langchain.com/p/647419d5-fa7e-493f-a997-d81fd0009f7a/> （LangSmith Fetch：从 trace 建回归测试套件）
- **recut-ai / shadow 的行为回归门禁**：把某次 run 固定为基线，后续 run 与之对比，退化则非零退出（CI 门禁）。
  来源: <https://github.com/ksek87/recut-ai> · <https://pypi.org/project/shadow-diff/>

**对比两次运行**（定位首次分歧 + 判定）：
```bash
node src/cli.mjs trace --list --limit=5          # 找到两次运行的 runId
node src/cli.mjs trace --diff=<idA>,<idB>       # 回放对比：差异数 / 首次分歧步 / verdict
# verdict:
#   identical  两次完全一致
#   similar    都有/都无完成，但步骤有差异（输出不同/缺步）
#   improved   A 未完成、B 完成（行为变好）
#   regressed  A 完成、B 未完成（行为退化 → 退出码 1，可接 CI）
```

**同目标多次运行检索**（"这个目标是怎么变的"）：
```bash
node src/cli.mjs trace --find="计算 2+2" --limit=10   # 列出该目标的所有历史运行
```

**导出回归数据集**（LangSmith 式 trace→dataset，供 CI 反复对比）：
```bash
node src/cli.mjs trace --export=regression.jsonl --export-format=jsonl --find="计算 2+2"
# 也可 --export=- 直接打到 stdout；每条含 goal/engine/completed/finalAnswer/steps(扁平化)
```

**回归门禁（CI 可用）**：把一次好 run 固定为基线，之后每次跑完自动对比最新 run，退化即 `exit 1`。
```bash
node src/cli.mjs trace --baseline=<好的 runId>   # 设基线（落盘 .omni-traces.json.baseline）
node src/cli.mjs agent "计算 2+2" --no-llm       # 跑目标
node src/cli.mjs trace --regression             # PASS / FAIL（FAIL → 退出码 1）
```

> 工作区侧同样可用：`node openclaw-workspace/scripts/omnisense-link.mjs trace --diff=<a>,<b>` / `--find=` / `--export=` / `--baseline=` / `--regression`（复用内核同一份 tracer，离线、可单测）。serve 也新增 `GET /trace-diff?a=&b=`、`GET /trace-find?goal=`、`GET /trace-regression`、`POST /trace-baseline`。

---

## 📡 OTLP/GenAI 可观测性导出（OTel-native · 对接 Grafana Tempo / Phoenix / Jaeger）

轨迹追踪解决了"身体行为可追溯"，但要把这些数据接入成熟的 APM 生态（在 Grafana Tempo 里看 waterfall、在 Phoenix 里做 LLM 评估、在 Jaeger 里定位慢 span），需要一个标准协议。OmniSense 把身体轨迹导出为 **OTLP/JSON**——OpenTelemetry 的原生 wire 格式，无需任何 SDK/依赖，离线即可生成：

- 一次 run → 一条 trace：`runId` 经 FNV-1a 派生字长合法的 `traceId`（32 hex）/ `spanId`（16 hex），保证同一 run 每次导出链路一致、可被 collector 重建。
- run 本身一个 **root span**（`gen_ai.operation.name = invoke_agent`，携带 `gen_ai.agent.description`/`engine`/`completed`/`used_llm`/`final_answer`，`status.code` 完成=1/未完成=2）。
- 每步一个 **child span**（`gen_ai.operation.name = execute_tool`，携带 `gen_ai.tool.name` / `call.arguments` / `call.result` 或 `error.type` + `error.message` + `gen_ai.tool.call.id`（工具调用关联 id），`status.code` 成功=1/失败=2）。
- **每个 span 注入 OTel GenAI span events**（对齐 uptrace / opentelemetry.io 的「内容放事件而非属性」约定，便于 Collector 按隐私策略过滤/丢弃、且不污染索引）：
  - root span → `gen_ai.user.message`（用户目标）+ `gen_ai.assistant.message`（最终答案）+ 未完成 run 的 `exception`（根因，`exception.type=agent_run_incomplete`）。
  - child span → `gen_ai.assistant.message`（思考/推理）+ `gen_ai.tool.message`（工具结果或错误信息）+ 失败步的 `exception`（`exception.type`/`exception.message`/`exception.escaped=false`）。
- 时间用纳秒级 Unix 字符串，属性值按 OTLP 类型化（`stringValue`/`boolValue`），事件同样带 `timeUnixNano` 纳秒串，可直接 `POST` 到 OTel Collector 的 `/v1/traces`。

设计借鉴（思想/协议结构，非代码）：
- OTLP/HTTP+JSON 编码：`https://opentelemetry.io/docs/specs/otlp/#otlphttp`（`resourceSpans[].scopeSpans[].spans[]`，必填 `traceId/spanId/name/kind/startTimeUnixNano/endTimeUnixNano/attributes`，非根含 `parentSpanId`）
- OpenTelemetry GenAI 语义约定：`https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/`（gen_ai.operation.name ∈ {invoke_agent, execute_tool} 等）
- Microsoft Agent 365 直接 OTel 集成（wire 结构 + gen_ai.* 属性示例）：`https://learn.microsoft.com/zh-cn/microsoft-agent-365/developer/direct-open-telemetry-integration`
- Greptime OTel GenAI 实践（属性示例）：`https://greptime.cn/blogs/2026-05-09-opentelemetry-genai-semantic-conventions`

```bash
# 导出 OTLP/JSON 到文件（或 --export=- 打到 stdout；serve 也支持 GET /trace-export?format=otlp）
node src/cli.mjs trace --export=spans.otlp.json --export-format=otlp
# 接 OTel Collector / Tempo / Phoenix（示例：本地 collector 监听 4318）
curl -X POST http://localhost:4318/v1/traces \
  -H 'Content-Type: application/json' \
  -d @spans.otlp.json
# 工作区侧同样可用（复用内核同一份 tracer，跨层）
node openclaw-workspace/scripts/omnisense-link.mjs trace --export=- --export-format=otlp
```

> 诚实边界：导出与落盘同样遵守"敏感内容默认不记录"约定，目标/参数/输出统一截断至 ~2KB，只保留结构化结论（`ok`/`error`）；`otlp` 与既有 `json`/`jsonl` 导出共享同一份过滤逻辑与截断策略。

---

## 🪪 A2A 风格能力卡（Agent Card · 能力发现与委派）

合并后的「新项目」要让多智能体工作区真正「发现」并能委派身体能力，需要一份机器可读的能力清单。OmniSense 借鉴 **Google A2A Protocol 的 AgentCard** 思想（每个技能带 `description` / `tags` / `examples`，让 client 发现与调用），提供 A2A 风格的能力卡：

- `body.agentCard()`（库）/ CLI `node src/cli.mjs card` / 桥接 `node integrations/openclaw/omni-body.mjs card`：把七器官全部能力扁平化为 `skills[]`，每项含 `id`(`organ.method`) / `name` / `description` / `tags` / `examples` / `net`(是否联网，诚实标注离线降级)。
- 多智能体工作区的 `openclaw-workspace/scripts/omnisense-link.mjs` 在此基础上再提供：
  - `describe`：七器官树（含每能力 `desc`/`net`/`examples`）；
  - `card`：A2A 扁平技能卡；
  - `route <organ.method> [args...]`：按技能 id 直接委派到对应器官/方法（如 `route hand.calc '{"expression":"2+2"}'` / `route brain.think "我该关注什么"`）。
  - `dispatch <目标>`：**能力发现闭环**——基于关键词自动匹配最合适的技能并委派（如 `dispatch "计算 2+2"` → 自动委派 `hand.calc`；`dispatch "思考当前热点"` → 自动委派 `brain.think`；`dispatch "看今日热搜"` → 自动委派 `eye.seeHotAll`）。

设计借鉴（思想/模式，非代码，未引入其传输/协议依赖）：
- Google A2A Protocol · AgentCard：`https://github.com/google/A2A` · 文档 `https://a2aprotocol.ai/docs/guide/python-a2a-tutorial-with-source-code`
- 仅取「skill 自描述（id/name/description/tags/examples）」这一结构用于工作区侧能力发现；OmniSense 额外加 `net` 字段诚实标注联网依赖。

```bash
node src/cli.mjs card                              # 打印 A2A 风格 Agent Card（skills[]）
node openclaw-workspace/scripts/omnisense-link.mjs card          # 工作区侧：跨层取能力卡
node openclaw-workspace/scripts/omnisense-link.mjs route --list  # 列出全部可委派能力
node openclaw-workspace/scripts/omnisense-link.mjs route hand.calc '{"expression":"2+2"}'
node openclaw-workspace/scripts/omnisense-link.mjs dispatch "思考一下当前热点"   # 自动匹配最佳技能并委派
```

---

## 🤖 自主循环（autopilot · 身体自己决定做什么）

`live()` 让身体"自驱地活着"，但每轮动作是写死的（感知→思考→记一笔）。`autopilot()` 更进一步：
**身体用自身能力卡自己决定每轮做什么**——不再是被动执行预定步骤，而是用 `skillResolve` 把自生成的
意图映射到最佳器官，再 `skillDispatch` 真正执行，并记录每轮的委派结果。这是"和真人一样"的本质升级。

> **重要（v3.2.0 起）**：`live()` 生命循环现在**默认就是 autopilot 自驱**——身体每拍自己决定做什么，
> 而不是跑写死步骤。这把"和真人一样活着"再推一层：活着 = 持续自驱决策与行动（借鉴 Stanford
> **Generative Agents / Smallville** 的**持续自驱认知生命周期**：感知→记忆→检索→反思→规划→行动，
> 而非按剧本生活；https://arxiv.org/abs/2304.03442）。`--no-autopilot` 可回到旧写死步骤以兼容旧行为。

设计借鉴（思想/模式，非代码）：**BabyAGI 的自生成任务队列循环**（任务创建 → 优先级排序 → 执行 →
据结果重排 → 再生成）：`https://github.com/yoheinakajima/babyagi` · `https://www.ibm.com/think/topics/babyagi`
· `https://tinyagents.dev/compare/babyagi`（执行/创建/优先级 三元组；优先级随结果动态调整——"原本次要的任务可能因新信息而升优先"）
区别于 BabyAGI：OmniSense **离线即可自驱**——每轮 (1) 感知环境 (2) 从议程自生成意图 (3) 用自身能力卡
`skillResolve` 把意图映射到最佳器官/方法 (4) `skillDispatch` 真正执行 (5) **把本次结果回写议程、动态调权**：
动作成功 → 提权，且"想清楚/规划"成功会带升"记忆类"意图（该记住/回顾）；退化到感知（无动作）→
惩罚并逼出"真正动手"的意图。这正是对 BabyAGI「优先级随结果重排」思想的离线启发式实现。
全程**零网络、零挂起、可离线自活**。

**动态议程（默认开启）**：内置 4 项默认议程时，`autopilot` 默认按"优先级队列（最少跑→最高权→最早 seed）"
选意图——既保证 4 项都轮到，又让"结果好"的意图优先；每步 trace 带 `agendaWeights` 快照，可观测"权重如何随结果变化"。
自定义议程默认**尊重用户给定顺序**（除非显式 `dynamic:true`）；用 `--no-dynamic`（CLI / 桥接 / 工作区）可关闭重排。

```js
const omni = OmniSense.create();
// 身体自主决定每轮做什么（默认议程离线安全：思考/记忆/规划/回顾），默认开启动态议程（结果驱动重排）
await omni.autopilot({ ticks: 3 });
// 关掉动态重排、严格按我给的顺序（尊重用户顺序）
await omni.autopilot({ ticks: 3, dynamic: false, agenda: ['思考当前环境', '规划下一步行动'] });
// 自定义议程也想开启动态重排：显式 dynamic:true
await omni.autopilot({ ticks: 3, dynamic: true, agenda: ['思考当前环境', '规划下一步行动'] });
```

```bash
node src/cli.mjs autopilot --ticks=3                # 身体自驱决策（默认动态议程：结果驱动重排）
node src/cli.mjs autopilot --ticks=3 --no-dynamic   # 关闭动态重排、尊重默认顺序
node integrations/openclaw/omni-body.mjs autopilot '{"ticks":2}' --json   # 桥接层（默认动态）
node openclaw-workspace/scripts/omnisense-link.mjs autopilot 2 --json      # 工作区侧驱动身体自主循环（默认动态）
node openclaw-workspace/scripts/omnisense-link.mjs autopilot 2 --no-dynamic --json  # 工作区侧关闭动态重排
```

> 诚实边界：默认议程只映射到离线器官（脑/嘴/耳），`hand.*` 等需结构化参数的技能会被自动跳过并降级到感知，
> 绝不因缺参数而报错或联网。有本机模型网关时 `autopilot` 同样可用（在线思考），但离线也可完整自活。

---

## 🦶 常驻自驱身体（watch --autopilot · 脚持续自我驱动的活身体）

`watch` 原本只是"常驻感知循环"——每个 tick 聚合热搜 + 感知 + 规划，可选按「变化即行动」派发固定目标。
现在 `watch` 还能**每 tick 由身体自身能力卡自主决策并离线执行**，把"常驻感知"升级为"常驻自驱"：
脚（foot）不再只是巡逻，而是**持续自我驱动的活身体**——每拍用 `skillResolve` 自己决定做什么、`skillDispatch` 真正执行，像真人一样在世界上持续自驱地活着。

这与已有的 `--agent`（变化即行动）**互补而非替代**：
- `--agent`：只在热点"有意义变化"且过冷却时，派发一个**固定目标**（记得住 / 告警 / 摘要）；
- `--autopilot`：每 tick 都让身体**自己决定做什么**（脑/嘴/耳类离线器官），把感知循环变成持续自驱的生命活动；
- 两者可同时开：`--agent --autopilot` → 变化触发固定行动 + 每 tick 自驱决策，互相叠加。

设计借鉴（思想/模式，非代码）：
- OpenClaw 类自主智能体「心跳闭环 / Heartbeat Loop」（周期性感知→决策→行动的自驱循环）：
  https://www.aigcopen.com/content/omni-channel/39278.html
- Sophia「System 3 持久自驱层」（https://arxiv.org/abs/2512.18202：智能体可独立发起内驱任务，而非仅响应外部刺激）
  的离线启发式实现——OmniSense 不依赖 LLM / 向量库即在每 tick 让身体"自己想、自己做"。

```bash
node src/cli.mjs watch --interval=60 --autopilot              # 常驻自驱身体：每 tick 由身体能力卡自主决策并离线执行（像真人一样持续自我驱动地活着）
node src/cli.mjs watch --interval=60 --autopilot --autopilot-agenda="思考当前环境,规划下一步行动"  # 自定义自驱议程（逗号分隔）
node src/cli.mjs watch --interval=60 --autopilot --no-dynamic   # 关闭动态重排、严格按默认/自定义顺序
node src/cli.mjs watch --interval=60 --autopilot --agent      # 常驻自驱 + 变化即行动，两者互补叠加
```

> 诚实边界：autopilot 默认只映射离线器官（脑/嘴/耳），不触发联网；每 tick 的自驱结果记入快照 `autopilotAction:{fired,reason,mode,executed,intent,weights,...}`，`--remember` 会把自驱结果一并写入记忆 `lastWatch`。autopilot 调用异常被 `try/catch` 捕获，诚实降级为 `fired:false`（不中断 watch 循环）。

---

## 🔧 工具级缓存 / 熔断（把 breaker 基础设施扩展到 Agent 工具调用）

`agent` / `multiagent` 每步都经统一入口 `executeTool()` 调工具。联网类工具（抓网页、摘要、聚合热搜）
重复调用同一目标会反复触网、浪费带宽；某工具持续失败则会反复超时、拖垮整条 agent 流水线。
OmniSense 把 **`breaker.mjs` 的 TTL 缓存 + 熔断器**（此前只用于热搜抓取）**复用并扩展到 Agent 工具调用**：

- **命中缓存直接返回**：`web_fetch` / `summarize_url` / `hot_topics` 声明了 `cacheTtl`（60s / 300s / 60s），
  同一目标在 TTL 内第二次调用直接返回缓存结果，**不重复联网**。
- **持续失败熔断**：声明 `circuit:true` 的工具，连续失败达阈值（默认 3 次）后进入「开启」状态，
  后续调用**直接短路返回 `circuitOpen:true`**，绝不反复超时；任意一次成功即复位。
- **声明式、零侵入**：只在工具定义上加 `cacheTtl(ms)` / `circuit:true` 即生效；未声明的默认工具（`calc`/`read_file`/`write_file`/`now`/记忆类）行为**完全不变**，缓存/熔断不影响其正确性。
- **可观测、可清空**：`cli cache` 看当前缓存条目数与熔断器状态，`cli cache --clear` 清空；工作区侧 `omnisense-link cache` 同源复用内核实现。
- **落盘持久化（跨重启续命）**：默认只在内存，进程一重启缓存/熔断清零。设 `OMNI_TOOL_CACHE_FILE=./.omni-tool-cache.json`（或 `cli cache --persist-file=<path>`）即把缓存条目 + 熔断状态写进零依赖 JSON 文件，每次 `set`/`success`/`fail`/`clear`/`reset` 自动落盘，进程启动自动载入——重启后**刚抓过的内容不重抓、刚熔断的源继续短路冷却**，真正兑现「避免重复联网」。设 `cli cache --persist-off` 关闭，`--flush` 立即落盘，`--clear-persist` 清空内存+磁盘。

设计借鉴（思想/模式，非代码）：

- LangChain 的 LLM / 工具调用缓存（`InMemoryCache`：相同请求直接命中、不再重复触网，降低延迟与费用）：
  `https://mintlify.wiki/langchain-ai/langchain/advanced/performance`
- AutoGen / 生产实践里「把工具包进 per-tool circuit breaker」（`tenacity` / `Resilience4j` 思想；
  altersquare 的 Tool-Calling Reliability 亦建议 wrap tools in per-tool circuit breakers）：
  `https://altersquare.io/tool-calling-reliability-agent-frameworks-measurements-architecture/`
- **落盘持久化**借鉴「disk-backed TTL cache / SQLiteCache」思想（缓存放磁盘、重启不丢，常见于抓取/LLM 调用缓存，
  如 LangChain `SqliteCache`、redis 持久化语义）：缓存/熔断本是「运行时状态」，本设施的 `OMNI_TOOL_CACHE_FILE`
  把它变成「跨重启续命」的可加载 JSON，与 monitor 的「阈值/权重 JSON 文件」同属 Observability-as-Code 思路（配置/状态可版本化、可溯源）。

```bash
node src/cli.mjs cache                  # 工具级缓存/熔断状态（离线可用）
node src/cli.mjs cache --clear        # 清空工具级缓存
OMNI_TOOL_CACHE_FILE=./.omni-tool-cache.json node src/cli.mjs cache   # 启用落盘持久化（跨重启续命，启动时自动载入）
node src/cli.mjs cache --persist-file=./.omni-tool-cache.json --flush   # 立即落盘一次
# 监控器官 monitor（第 8 器官）：统一观测身体是否健康
node src/cli.mjs monitor --summary     # 统一状态快照（状态/器官/记忆/活动/告警）
node src/cli.mjs monitor --tools       # 工具管线健康：缓存命中/熔断状态/工具级 P50-P95-P99 延迟分布
node src/cli.mjs monitor --anomalies   # 异常检测（延迟突增/吞吐骤降/记忆批量注入/熔断开启）
node src/cli.mjs monitor --grid        # 引擎状态网格（颜色化 healthy/degraded/down）
node src/cli.mjs dashboard             # 生成零依赖静态 HTML 仪表盘（可视化 Agent 状态/记忆/告警/工具健康）
# 工作区侧同样可观测（合并后新项目：工作区能看 agent 工具流水线的健壮性）
node openclaw-workspace/scripts/omnisense-link.mjs cache
node openclaw-workspace/scripts/omnisense-link.mjs cache --clear
```

> 诚实边界：缓存只存工具成功输出（TTL 内复用），失败不入缓存；熔断是「诚实降级」的延续——工具真的不可用时明确报告 `circuitOpen`，绝不假装成功或无限重试。

---

## 🔭 监控器官（monitor · 第 8 器官）

合并后的「新项目」把 Agent 状态观测升格为内核一等公民——监控器官 `monitor` 统一回答"身体（与它的工具流水线）是否健康、哪里在退化"：

- **统一状态快照 `monitor`**：整体状态(healthy/warning/degraded) + 七器官数 + 四层记忆快照 + 活动(总运行/成功率/引擎分布/最近自驱轨迹) + 告警。
- **Agent 健康 `monitor --health`**：基于 tracer 运行轨迹的错误率 → healthy/degraded/critical。
- **可观测三支柱（借鉴 LangSmith/Langfuse/CloudWatch GenAI 可观测三支柱）**：① 指标——延迟 P50/P95/P99 按引擎分布(`--latency`) + 工具级延迟分布；② 追踪——复用 tracer 运行轨迹；③ 日志——结构化告警。
- **状态网格/舰队健康 `monitor --grid`**：每个引擎颜色化 healthy/degraded/down，汇总 fleet 健康计数（借鉴 ClawHub 舰队健康网格）。
- **记忆健康 `monitor --memory`**：技能利用率 / 平均信任分 / 低信任条目 / 陈旧记录 / 增长（借鉴 perfecxion 记忆专属指标）。
- **异常检测 `monitor --anomalies`**：延迟突增 / 吞吐骤降 / 记忆批量注入 / **熔断开启(circuit_open)** 四类信号；其中熔断开启直接反映 Agent 工具流水线是否降级（借鉴 OpenLIT「工具可靠性是 agent 延迟的暗物质」：工具级 P50/P95/P99 延迟 + 熔断状态并到可观测面板）。
- **工具管线健康 `monitor --tools`（本轮新增常驻迭代能力）**：工具缓存命中条目数 + 每工具熔断器状态(开启/正常) + **工具级 P50/P95/P99 延迟分布**（从 tracer 工具步聚合）。补齐了"agent 工具调用失败但 monitor 不报"的盲区——任何工具的熔断器开启即触发 `circuit_open` 告警。
- **可视化仪表盘 `dashboard`**：零依赖静态 HTML（驾驶舱风格），含器官/舰队健康/延迟趋势 sparkline/记忆健康/**工具管线健康**/活动/告警/运行时间线/阈值配置（当前值 vs 阈值 红黄绿 + **可推送告警清单**）＋ **综合健康评分区块（0-100 分 + 等级 A/B/C/D/F + 状态色 + Top 问题清单；5 维度权重可经 `OMNI_MONITOR_WEIGHT_*` 或 JSON 文件覆盖）**。
- **可推送告警清单 `monitor --threshold-alerts`（Alertmanager-ready）**：把"超标/关注"的阈值项转成可直接提交 Prometheus Alertmanager 的告警 payload——`labels{alertname,severity,monitor,key,status}` + `annotations{summary,description,current,threshold,source}` + 稳定 `fingerprint`（同一 key 跨运行稳定，用于告警去重聚合）；状态映射 `over→critical`、`warn→warning`、`ok/na→none`。离线不主动外发，仅产出形状一致的 payload，接入方直接 `POST /api/v2/alerts` 即可（借鉴 Prometheus Alertmanager 告警数据模型）。
- **综合健康评分 `monitor --score` / `monitor --health-score`（本轮新增常驻迭代能力）**：把分散的观测信号聚合成**一个 0-100 综合健康分 + 等级(A/B/C/D/F)**，一眼看清"整体健康度"——5 个加权维度：**Liveness 存活(0.25)**（是否有近期活跃运行）＋ **Reliability 可靠性(0.25)**（SLO 成功率，取自 tracer 运行轨迹）＋ **Threshold 阈值合规(0.20)**（当前值 vs 阈值，不含 liveness*Ms 避免双重计数）＋ **Anomalies 异常(0.15)**（异常数/严重度）＋ **Tool 工具管线(0.15)**（缓存命中/熔断状态/工具延迟分布，任一熔断开启即 0）。`score = round(100 × Σ weight·subScore)`，等级 A≥90/B≥75/C≥60/D≥40/F<40，状态 ok/warning/degraded/critical 映射，并聚合 Top 问题清单（按严重度排序，最多 12 条，na/未知维度绝不伪造读数）；无运行轨迹时 `score=null` + 等级 `N/A` + 状态 `unknown`（诚实降级）。借鉴 Nobl9 **Composite SLOs**（加权 rollup、非等权重：https://www.nobl9.com/features/composite-service-level-objectives · https://docs.nobl9.com/guides/slo-guides/composite-slos-use-cases）与 New Relic/Vortex IQ **Operational Health Score**（0-100 加权：Apdex/错误率/事件数/SLO 合规度：https://www.newrelic.com/blog/nerdlog/operational-health-score）以及 dev.to **Output Quality Score**（Agent 质量加权 + green/yellow/red + 可配权重）。

设计借鉴（思想/模式，非代码，诚实可溯源）：
- LangSmith / Langfuse / CloudWatch GenAI 可观测三支柱（指标+追踪+日志）：https://docs.smith.langchain.com/ · https://langfuse.com/docs
- ClawHub 舰队健康网格（每 agent 颜色化状态）：https://github.com/greenhelix
- perfecxion 记忆专属指标（信任分/检索命中/陈旧）：https://www.perfecxion.ai/
- OpenLIT + VictoriaMetrics「工具可靠性是 agent 延迟的暗物质」（工具级 P50/P99 延迟 + 熔断监测）：https://openlit.io/blogs/victoriametrics-openlit-agents-observability
- 心跳/存活判定与熔断监测（AgentCircuitBreaker 思想）：https://dev.to/pockit_tools/llm-observability-deep-dive-how-to-monitor-trace-and-debug-ai-agents-in-production-2mob
- Prometheus Alertmanager 告警数据模型（labels/annotations/fingerprint 用于路由/静默/去重，severity=critical|warning 驱动告警分级）：https://prometheus.io/docs/alerting/latest/alertmanager/ · https://michele.incuda.com/2022/07/14/introduction-to-prometheus-alertmanager/
- Nobl9 Composite SLOs（加权 rollup、非等权重，多 SLO 合成单一健康度）：https://www.nobl9.com/features/composite-service-level-objectives · https://docs.nobl9.com/guides/slo-guides/composite-slos-use-cases
- New Relic / Vortex IQ Operational Health Score（0-100 加权健康分：Apdex/错误率/事件数/SLO 合规度）：https://www.newrelic.com/blog/nerdlog/operational-health-score
- dev.to Output Quality Score（Agent 输出质量加权 + green/yellow/red + 可配权重）：https://dev.to/going_gitizen/building-an-ai-agent-quality-score-for-better-observability-53ac

```bash
node src/cli.mjs monitor --summary           # 统一状态快照
node src/cli.mjs monitor --tools             # 工具管线健康：缓存/熔断/工具级 P50-P95-P99
node src/cli.mjs monitor --anomalies         # 异常检测（含熔断开启 circuit_open）
node src/cli.mjs monitor --grid              # 引擎状态网格（颜色化）
node src/cli.mjs monitor --config            # 生效的告警阈值（值/来源/环境变量名，可用 OMNI_MONITOR_* 覆盖）
OMNI_MONITOR_SPIKE_FACTOR=3 node src/cli.mjs monitor --config   # 环境变量覆盖示例（source 变 env）
node src/cli.mjs monitor --config-file=./my-monitor.json   # 从 JSON 配置加载阈值（Observability-as-Code，优先级 opts>env>file>default）
node src/cli.mjs monitor --threshold-health   # 当前测量值 vs 阈值 红黄绿着色（ok/warn/over/na，一眼看出哪项告警阈值被踩）
node src/cli.mjs monitor --threshold-alerts   # 可推送告警清单（Alertmanager 形状：fingerprint+labels{severity}+annotations）
node src/cli.mjs monitor --score              # 综合健康评分（0-100 加权汇总 Liveness/成功率/阈值/异常/工具管线 5 维度 + 等级 A/B/C/D/F）
node src/cli.mjs monitor --weights            # 综合健康评分维度权重（值/归一化/来源，可用 OMNI_MONITOR_WEIGHT_* 或 ~/.omnisense/monitor-weights.json 覆盖）
OMNI_MONITOR_WEIGHT_TOOL=0.4 node src/cli.mjs monitor --weights   # 环境变量覆盖维度权重示例（source 变 env）
node src/cli.mjs monitor --weights-file=./my-weights.json --weights   # 从 JSON 文件加载维度权重（Observability-as-Code）
node src/cli.mjs dashboard                    # 生成零依赖静态 HTML 仪表盘（含「阈值配置」区块，展示配置文件路径与当前值 vs 阈值着色 + 可推送告警清单 + 综合健康评分）
# 工作区侧跨层复用同一份实现（合并后新项目：工作区能真正观测身体）
node openclaw-workspace/scripts/omnisense-link.mjs monitor snapshot
node openclaw-workspace/scripts/omnisense-link.mjs monitor toolHealth
node openclaw-workspace/scripts/omnisense-link.mjs monitor config     # 跨层查询生效告警阈值
node openclaw-workspace/scripts/omnisense-link.mjs monitor --config-file=./my-monitor.json config  # 跨层从 JSON 文件加载阈值
node openclaw-workspace/scripts/omnisense-link.mjs monitor thresholdHealth  # 跨层当前值 vs 阈值 红黄绿着色
node openclaw-workspace/scripts/omnisense-link.mjs monitor thresholdAlerts  # 跨层产出 Alertmanager 形状告警（可直推外部告警系统）
node openclaw-workspace/scripts/omnisense-link.mjs monitor healthScore  # 跨层综合健康评分（同内核 healthScore：score/grade/status/dimensions）
node openclaw-workspace/scripts/omnisense-link.mjs monitor score        # 别名：跨层综合健康评分
node openclaw-workspace/scripts/omnisense-link.mjs monitor weights     # 跨层查询综合健康评分维度权重
```

> 诚实边界：monitor 只读采集（tracer / memory / toolBreaker），任何采集失败均静默降级、绝不阻断主流程；`circuitOpen` 等告警是"诚实降级"的自然延伸——工具真的不可用时明确报告，绝不假装成功。

---

## 本地驱动服务 serve

`serve` 在 `127.0.0.1` 起一个 JSON HTTP API，让外部进程以 JSON API 驱动 OmniSense 能力，无需 import。

```bash
curl -s -X POST http://127.0.0.1:8787/see -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -s -X POST http://127.0.0.1:8787/all -H 'Content-Type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:8787/tick -H 'Content-Type: application/json' -d '{}'   # 单次感知快照（供外部编排）
curl -s -X POST http://127.0.0.1:8787/agent -H 'Content-Type: application/json' -d '{"goal":"计算 2+2","useLLM":false}'
curl -s http://127.0.0.1:8787/health
# 启用鉴权：启动时设环境变量 OMNI_TOKEN=xxx，则所有请求需带 Header: Authorization: Bearer xxx
```

> ⚠️ `serve` 仅监听 `127.0.0.1`、无 TLS，**切勿用 `-h 0.0.0.0` 或端口转发暴露到公网**。设了 `OMNI_TOKEN` 后所有路由（含 `/health`）要求 `Authorization: Bearer <token>`（或 `?token=`）。可行路由：`/health /see /hot /all /summarize /think /plan /tick /speak /remember /recall /search /sense /status /agent /traces /trace-summary /trace-diff?a=&b= /trace-find?goal= /trace-regression /trace-baseline`。

---

## 测试

零依赖、纯 Node 内置测试运行器 [`node:test`](https://nodejs.org/api/test.html)，无需安装任何测试框架：

```bash
npm test          # 等价 node --test，自动发现 test/*.test.mjs
```

- 测试**不触发真实联网**：仅覆盖纯逻辑（`Eyes._hotSources()` 各源 `parse` 解析、`extractMainText()` 正文提取、`Memory.search()` 检索、`Bus` 事件契约、`breaker` 缓存/熔断、`logger` 分级、`brain` 合成/规划、`server` 路由分发、`providers` 配置、WBI 离线签名等），用离线 fixture。
- 额外 `npm run lint` 对 `src/`、`test/` 全部 `.mjs` 跑 `node --check` 语法检查。
- CI：`.github/workflows/test.yml` 在 Node 18/20/22 矩阵上先 `npm run lint` 再 `npm test`。[查看最新 CI 状态](https://github.com/xiaobei1679/omnisense/actions/workflows/test.yml)。

---

## 运行模式（自动识别）

| 模式 | 触发条件 | 眼/耳 | 脑/嘴 |
|------|---------|-------|-------|
| `gateway` | 检测到本机模型网关（OpenAI 兼容端点 `127.0.0.1:<port>`）可达 | 真抓取 | 网关在线模型免 key 真推理 |
| `driver` | 无网关（如普通 Node / 任意调用方） | 真抓取 | **由调用方驱动**——脚本输出真实感知上下文 + 提示词，调用方直接想/说 |
| _外部 key 回退_ | 设置 `LLM_*` 环境变量且网关不可用 | 真抓取 | 走你配置的 OpenAI 兼容端点 |

- 模式自动探测；可用环境变量 `OMNI_RUNTIME=gateway|driver` 强制。
- 网关细节（端口、令牌）由网关配置（`~/.omnisense/gateway.json`，可用 `OMNI_GATEWAY_CONFIG` 覆盖）或环境变量管理，`src/core/llm.mjs` 仅在运行时读取，不写死任何密钥。

---

## 环境变量（全部可选）

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

其它可选开关：`OMNI_RUNTIME`（强制模式）、`OMNI_GATEWAY_BASE`（覆盖网关地址）、`OMNI_GATEWAY_CONFIG`（覆盖网关配置文件路径）、`GATEWAY_TOKEN`（覆盖网关令牌）、`OMNI_MODEL`（覆盖模型名）、`OMNI_MEMORY`（覆盖记忆文件路径）、`YTDLP_BIN`（覆盖 yt-dlp 路径）。

热搜抓取相关（提升稳定性）：`OMNI_HOT_TTL`（缓存有效期 ms，默认 60000）、`OMNI_HOT_MAX_FAILS`（熔断触发所需连续失败次数，默认 3）、`OMNI_HOT_COOLDOWN`（熔断冷却 ms，默认 300000）。

日志：`OMNI_LOG_LEVEL`（trace/debug/info/warn/error/silent，默认 info）；`QUIET=1` 等价于 `error`。

---

## 目录结构

```
omnisense/
├── README.md               # 本文件（统一主文档：身体引擎 + 多智能体工作区）
├── SKILL.md                # 技能/插件使用说明
├── LICENSE                 # MIT
├── package.json            # npm 元数据 + CLI bin
├── .gitignore
├── examples/
│   └── standalone.mjs      # 独立使用最小示例
├── integrations/           # 桥接层：把多智能体工作区接入 OmniSense 身体
│   └── openclaw/
│       ├── omni-body.mjs        # 七器官桥接（直接驱动 src/body.mjs 真实实现）
│       ├── omnisense-bridge.mjs # 一句话目标 → 身体执行（感知→思考→动手）
│       └── README.md            # 集成使用说明
├── openclaw-workspace/      # 合并进来的多智能体工作区（原独立仓库 xiaobei1679/openclaw-workspace，MIT）
│   ├── README.md
│   ├── config/openclaw.json.example  # 已内置 omnisense-engine 角色
│   ├── workspace/          # 工作区脚本 / 技能 / 知识
│   └── ...                 # 原 openclaw-workspace 全部内容
├── .github/
│   └── workflows/
│       └── test.yml        # CI：Node 18/20/22 跑 lint + node --test
├── test/                   # node:test 单元测试（离线 fixture，含集成冒烟）
└── src/
    ├── index.mjs           # 门面 OmniSense
    ├── body.mjs            # 身体：把七器官整合成像真人一样的智能体 + live() 生命循环
    ├── cli.mjs             # 命令行入口（npm bin: omnisense）
    ├── server.mjs          # 本地 HTTP 驱动服务（127.0.0.1，可选 Bearer 鉴权）
    ├── .env.example        # 可选外部模型配置模板
    ├── core/
    │   ├── bus.mjs         # 事件总线（on/once/off/wildcard + 命令调度）
    │   ├── http.mjs        # 统一 HTTP 客户端（超时/重试/UA）
    │   ├── memory.mjs      # 记忆中枢（深度语义检索：BM25-lite + 时间衰减 + 复用权重 + MMR 去冗余，落盘）
    │   ├── llm.mjs         # 本地模型网关代理（免 key，可选）
    │   ├── logger.mjs      # 分级日志
    │   ├── breaker.mjs     # TtlCache + CircuitBreaker（零依赖基础设施）
    │   ├── config.mjs      # 安全读取网关配置
    │   ├── watch.mjs       # 常驻感知循环（差异检测 + 多模式自主编排 + 新增热点联网摘要）
    │   ├── tools.mjs       # 工具执行器（web_fetch/文件/calc/now/记忆/热搜… 安全白名单）
    │   ├── agent.mjs       # Agent 内核（ReAct 闭环 + 经验召回 + 本地规划器 + playbook 复用 + 自我反思）
    │   ├── agents.mjs      # 多 Agent 协作（协调器 + 角色子 agent + 共享黑板 + 诚实部分失败）
    │   ├── tracer.mjs      # Agent 执行轨迹追踪（可回放 trace 落盘 + 聚合指标，对齐 OTel GenAI 语义约定）
    │   └── providers/index.mjs  # 模型适配层（网关优先 + 外部回退）
    └── modules/
        ├── eyes.mjs        # 眼：看网站/热搜/视频/图 + 正文提取 + WBI
        ├── ears.mjs        # 耳：听意见/小说/音频
        ├── mouth.mjs       # 嘴：给意见/对话
        ├── brain.mjs       # 脑：思考/决策/规划/行动(act) + synthesize()
        └── perception.mjs  # 感知：环境聚合
```

---

## 扩展指南

- **新增热搜源**：在 `src/modules/eyes.mjs` 的 `_hotSources()` 增加一项（url / as / parse / 可选 headers），`all` 聚合自动覆盖（参照已有 9 个源）。B站番剧榜等强制 WBI 签名的接口，加 `sign:'wbi'` + `extra` 即可（见 `biliWbiParams`）。单源失败不影响整体（`Promise.allSettled` 优雅降级）。
- **接入外部模型（可选）**：填 `.env` 的 `LLM_*/VLM_*/ASR_*/TTS_*`；网关不可用时自动回退。
- **新增感官/平台**：参考现有模块，在 `src/modules/` 下实现并在 `src/index.mjs` 注册即可。

---

## 版本与回退（版本心跳）

OmniSense 用 `scripts/release.mjs` 做**本地版本管理 + 自动回退**，配合「心跳」自动化每小时迭代：

- **每小时一次小版本 (minor)**：`MAJOR.MINOR+1.0`
- **每 3 小时一次大版本 (major)**：`MAJOR+1.0.0`，`MINOR` 归零
- 每次发布都会：写 `VERSION` + `package.json`、追加 `CHANGELOG.md` 与 `versions.json`、**打 git tag `vX.Y.Z`**、本地 commit。
- **全部本地，绝不推送**——推送需你明确下令。

常用命令（托管 node）：

```bash
node scripts/release.mjs current                         # 打印当前版本 + 最新 tag
node scripts/release.mjs list                            # 列出所有本地版本(tag)
node scripts/release.mjs auto --notes "本次更新说明"     # 自动判定 minor/major 并发布
node scripts/release.mjs bump --type minor --notes "..." # 手动 minor
node scripts/release.mjs bump --type major --notes "..." # 手动 major
node scripts/release.mjs rollback v1.0.0                 # 非破坏式回退到指定 tag(新提交，历史保留)
```

回退是**非破坏式**的：以新提交把工作树还原到目标 tag 的内容，原提交历史完整保留；如需彻底丢弃某版本之后的所有更新，可手动 `git reset --hard vX.Y.Z`。

## 诚实边界（务必知晓）

- ✅ **联网抓取/下载**是真实本地执行，不依赖任何 key，在任何环境都真跑。
- ✅ **文本推理（脑思考 / 嘴说话给意见对话）两条免 key 路径均已打通**：有网关走网关模型；无网关由调用方驱动，脚本输出真实感知上下文供其直接思考/回答。
- ✅ **视觉「看图」**：外部 VLM 配置时真跑；无则 driver 模式下把图像落到本地，由调用方直接读图真实描述——免 key 真看。
- ⚠️ **语音「听」(ASR)与「出声」(TTS)**：需配置外部 key 或本地引擎（如 whisper.cpp）。文本类「听」（意见/小说/文案）不受影响。

---

## License

[MIT](./LICENSE) © 2026 OmniSense contributors

> 开源版本不含作者任何个人数据或示例项目内容（拿到的是干净的通用框架）。如需对接你自己的项目，按上面的「快速开始」三步接入即可。
