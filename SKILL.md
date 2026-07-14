---
name: omnisense
description: |
  通用 AI 感知系统，赋予宿主多模态真实感知能力：眼睛(真实看网站/视频/漫画动漫/抖音/红果/B站/微博/头条/百度/热点)、
  耳朵(真实听用户意见/小说/文案/歌曲)、嘴巴(真实交流·给意见/对话)、大脑(思考/记忆/向眼耳嘴下发命令)、
  感知(环境聚合)、手(真正动手·联网抓/读写文件/计算/记忆/总结)、脚(常驻感知·在世界里移动与监视)。
  文本推理默认走本机模型网关（OpenAI 兼容端点，127.0.0.1:<gateway.port>/v1，免 API KEY）真思考真说；
  联网抓取/下载本机真实执行。
  适用：需要让 AI 像真人一样去"看/听/说/想"的任何场景。
  本技能可直接复制到任意 Agent 框架的技能目录使用：有本机模型网关时自动免 key 走网关在线模型；
  在没有网关的环境里，眼/耳依旧真实抓取，脑/嘴由调用方(宿主)自身驱动——同样免 key。
  触发词：看网站/看视频/看热点/看漫画/看动漫/听意见/听小说/听文案/听歌/感知/多模态/真实抓取/联网看/让AI去看
license: MIT
---

# OmniSense · 通用 AI 感知系统（技能/插件）

赋予宿主 眼·耳·嘴·脑·手·感知·脚 七类真实能力，像真人一样的身体一样感知、思考并行动。
**一次编写、到处使用**：可丢进任意 Agent 框架的 `skills/omnisense/` 目录，也可作为独立 CLI / npm 包 / 库使用。

> 本仓库同时是通用开源项目（见 `README.md`）。作为技能使用时，把整个目录放进框架的 `skills/omnisense/` 即可。

## 核心原则
- **真实执行**：网站抓取、热搜拉取、视频/音频下载、图像获取——全部本机真实联网完成（已实测通网）。
- **免 key 模型（双模式自适应）**：
  - **网关模式（gateway）**：本机运行了模型网关（OpenAI 兼容端点 `http://127.0.0.1:<gateway.port>/v1/chat/completions`），脑(思考)/嘴(说话/给意见/对话) 自动走网关在线模型（网关令牌由网关统管，无需任何供应商 key），真思考真说。
  - **驱动模式（driver，无该网关的环境）**：眼/耳真实抓取照常；脑/嘴由调用本脚本的宿主(agent)自身驱动——脚本把真实感知上下文+提示词交给宿主，宿主直接想、直接说。**同样免 key**。
  - 模式自动探测：环境变量 `OMNI_RUNTIME=gateway|driver` 可强制；否则按网关可达性自动判断。
- **诚实降级**：视觉「看图」(VLM)、语音「听」(ASR)与「出声」(TTS) 网关当前不支持，需外部 key 或本地引擎，未配置时如实说明，绝不假装已看懂/听懂/说出。

## 七器官与真实能力对照
| 器官 | 真实能做的 | 模型依赖 |
|------|-----------|---------|
| 眼 Eyes | 抓网站HTML、拉B站/头条/微博/百度/抖音热搜、红果短剧热榜(聚合)、知乎热搜词、微信热文、B站番剧榜(WBI签名)、yt-dlp下视频抽帧 | 网站/热搜抓取本机真实执行(免key)；看图视觉：driver模式由宿主直接读图(免key)，网关模式需VLM key |
| 耳 Ears | 下载并读取音频、听用户意见/小说文本/文案(文本理解) | 语音转写ASR需外部；文本理解走网关或 driver |
| 嘴 Mouth | 就话题给意见、真实对话回复、可TTS出声 | 说话/给意见免key(网关 或 driver 驱动)；出声需TTS |
| 脑 Brain | 记忆、聚合感知、思考决策、**行动(act: Agent 推理闭环执行目标)**、向眼耳嘴下发命令 | 思考/行动免key(网关 或 driver 驱动) |
| 手 Hand | 联网抓取(web_fetch)/读写文件/列表/计算(安全算术)/时间/热搜/网页摘要/记忆读写 | 全部本机真实执行(免key)；shell 需显式开启 |
| 感知 Perception | 聚合近期感知为情境模型、给出注意力建议 | 无 |
| 脚 Foot | 常驻感知循环(差异检测+多模式自主编排+新增热点联网摘要)、在世界里移动与监视 | 离线确定性与在线思考两路，互不阻塞 |

## 多智能体工作区集成（openclaw-workspace）

本仓库已把多智能体工作区 `openclaw-workspace/`（原独立仓库 `xiaobei1679/openclaw-workspace`，MIT）合并进来，并通过 `integrations/openclaw/` 桥接层打通：

- 工作区可注册 `omnisense-engine` 角色（`openclaw-workspace/config/openclaw.json.example` 已内置），把 OmniSense 当作「身体」。
- `integrations/openclaw/omni-body.mjs`：七器官桥接，直接驱动 `src/body.mjs` 真实实现。
- `integrations/openclaw/omnisense-bridge.mjs`：一句话目标 → 身体执行。
- 详见 [integrations/openclaw/README.md](./integrations/openclaw/README.md)。

## 工具插件自发现（借鉴 Nanobot / OpenSquilla）

加 `hand` 工具无需改核心：在 `src/tools/`（或 `OMNI_PLUGINS_DIR`）放一个 `.mjs`，默认导出 `{ name, description, parameters, run }`，`buildDefaultTools` 自动注册。内置示范：`src/tools/hash.mjs`（离线 SHA-256）。详见 README「🔌 工具插件自发现」。

## Agent 执行轨迹追踪（🔭 可观测性，借鉴 LangSmith / OpenTelemetry GenAI 语义约定）

每次 `agent` / `multiagent`（含 `live` 生命循环、`watch` 自主编排派发的 agent）自动把整次运行落盘为**可回放 trace**（trace→run→step）：每步含耗时、成功/失败、OTel 对齐的 `gen_ai.*` 属性与错误归类。此外，身体**自驱决策**（autopilot 每轮 / watch --autopilot 每 tick）也可经 `--trace` 显式记录为 `engine='autopilot'` 的 trace——身体"自己活着"的行为同样可追溯/可回放/可防退化（可观测性闭环）。数据自持、不进仓库（`.omni-traces.json` 已 gitignore）。

```bash
node "{SKILL_DIR}/src/cli.mjs" trace --summary          # 聚合：成功率/平均步数·耗时/工具级调用·成功·失败·平均耗时/错误归类
node "{SKILL_DIR}/src/cli.mjs" trace --list --limit=10  # 最近 10 条 run（含 runId）
node "{SKILL_DIR}/src/cli.mjs" trace --get=<runId>      # 回放单条 trace（模型看见了什么→决定了什么→执行了什么）
node "{SKILL_DIR}/src/cli.mjs" trace --find="autopilot:" --limit=10   # 检索全部自驱身体轨迹（engine=autopilot）
node "{SKILL_DIR}/src/cli.mjs" trace --clear            # 清空本地轨迹
node "{SKILL_DIR}/src/cli.mjs" trace --export=spans.otlp.json --export-format=otlp  # 导出 OTLP/JSON（OTel-native，可投 Grafana Tempo/Phoenix/Jaeger）
```

作为库：`omni.traceSummary()` · `omni.traces({limit,engine})` · `omni.getTrace(id)` · `omni.clearTraces()` · `omni.exportTraceOtlp({path})`（OTLP/JSON，对齐 OpenTelemetry GenAI 语义约定：run→trace，root span `invoke_agent` + 每步 `execute_tool` child span，`gen_ai.*`/`error.type`/`status.code`）。serve 暴露 `GET /trace-summary`、`GET /traces?engine=&limit=`、`GET /trace-export?format=otlp`。详见 README「🔭 Agent 执行轨迹追踪」与「📡 OTLP/GenAI 可观测性导出」。

## A2A 风格能力卡（Agent Card · 能力发现与委派，借鉴 Google A2A Protocol）

合并后的「新项目」让多智能体工作区能机器可读地「发现」并委派身体能力。`body.agentCard()`（库）/ CLI `node "{SKILL_DIR}/src/cli.mjs" card` / 桥接 `node integrations/openclaw/omni-body.mjs card` 把七器官能力扁平化为 `skills[]`（id/name/description/tags/examples/net，`net` 诚实标注联网依赖）。工作区侧 `openclaw-workspace/scripts/omnisense-link.mjs` 再提供 `describe`（七器官树）/ `card`（扁平卡）/ `route <organ.method>`（按技能 id 委派），全部离线可跑、可单测。

设计借鉴（思想/模式，非代码）：Google A2A Protocol · AgentCard `https://github.com/google/A2A` · 仅取「skill 自描述」结构用于能力发现，未引入其传输/协议依赖。

## 🔧 工具级缓存 / 熔断（复用 breaker 扩展到 Agent 工具调用）
`agent`/`multiagent` 每步经 `executeTool()` 调工具。联网工具 `web_fetch`/`summarize_url`/`hot_topics` 声明了 `cacheTtl`（60s/300s/60s），同一目标在 TTL 内直接命中缓存、不重复联网；声明 `circuit:true` 的工具连续失败达阈值（默认 3）后熔断、后续调用直接短路返回 `circuitOpen:true`，避免反复超时拖垮 agent 流水线。声明式、零侵入——未声明的默认工具行为完全不变。`node "{SKILL_DIR}/src/cli.mjs" cache` 查状态，`cache --clear` 清空；工作区侧 `node openclaw-workspace/scripts/omnisense-link.mjs cache` 同源复用内核实现（借鉴 LangChain LLM/工具调用缓存 + AutoGen per-tool circuit breaker 生产实践）。

## 🤖 自主循环（autopilot · 身体自己决定做什么，借鉴 BabyAGI）

`live()` 让身体自驱活着，但每轮动作写死。`autopilot()` 更进一步：**身体用自身能力卡 `skillResolve`
自己决定每轮做什么**，再 `skillDispatch` 离线执行——感知→自生成意图→选最佳器官→执行→**把结果回写议程、动态调权**。
思想借鉴 BabyAGI 的「自生成任务队列」循环（任务创建→优先级排序→执行→据结果重排→再生成）：
`https://github.com/yoheinakajima/babyagi` · `https://www.ibm.com/think/topics/babyagi` · `https://tinyagents.dev/compare/babyagi`（优先级随结果动态调整）。
区别：OmniSense **离线即可自驱**——默认议程只映射到离线器官（脑/嘴/耳），`hand.*` 需结构化参数的技能自动跳过降级；
**默认开启动态议程**：内置 4 项议程用优先级队列（最少跑→最高权→最早 seed）选意图，既保证全覆盖又让"结果好"的意图优先，
每步 trace 带 `agendaWeights` 快照可观测"权重如何随结果变化"；自定义议程默认尊重用户顺序（除非显式 `dynamic:true`），
`--no-dynamic` 可关闭重排。全程零网络、零挂起。

## 🔭 监控器官（monitor · 第 8 器官，统一观测身体是否健康）

合并后的「新项目」把 Agent 状态观测升格为内核一等公民。监控器官 `monitor` 统一聚合"身体是否健康、哪里在退化"：

- **统一状态快照 `monitor`**：整体状态 + 七器官数 + 四层记忆 + 活动(总运行/成功率/引擎分布/最近自驱轨迹) + 告警。
- **Agent 健康 `monitor --health`**：基于 tracer 运行轨迹的错误率 → healthy/degraded/critical。
- **可观测三支柱（借鉴 LangSmith/Langfuse/CloudWatch GenAI）**：指标（延迟 P50/P95/P99 按引擎 + 工具级延迟分布 `monitor --latency`/`--tools`）+ 追踪（复用 tracer）+ 日志（结构化告警）。
- **状态网格/舰队健康 `monitor --grid`**：每个引擎颜色化 healthy/degraded/down（借鉴 ClawHub 舰队健康）。
- **记忆健康 `monitor --memory`**：技能利用率/平均信任分/低信任/陈旧/增长（借鉴 perfecxion）。
- **异常检测 `monitor --anomalies`**：延迟突增/吞吐骤降/记忆批量注入/**熔断开启(circuit_open)** 四类信号（熔断开启直接反映 agent 工具流水线降级，借鉴 OpenLIT「工具可靠性是 agent 延迟的暗物质」）。
- **工具管线健康 `monitor --tools`**：工具缓存命中条目 + 每工具熔断器状态(开启/正常) + 工具级 P50/P95/P99 延迟分布（从 tracer 工具步聚合）——补齐"工具失败但 monitor 不报"盲区。
- **可调告警阈值 `monitor --config`（常驻迭代能力）**：所有告警/异常/网格判定阈值（不活跃窗口、延迟突增倍数、记忆陈旧窗口、记忆批量注入、liveness healthy/degraded 窗口、5 类趋势斜率）不再硬编码，可经三路覆盖——构造 `opts.thresholds` > `OMNI_MONITOR_*` 环境变量 > **JSON 配置文件**(`--config-file=<path>` 或 `OMNI_MONITOR_CONFIG` 或默认 `~/.omnisense/monitor.json`，Observability-as-Code) > 内置默认；每个阈值可溯源（default/env/file/opts），非法值自动回退默认（借鉴 Grafana/Prometheus「阈值即配置、纳入版本控制」的 Observability-as-Code 实践 + Grafana 动态阈值，避免硬编码阈值反模式）。
- **可视化仪表盘 `dashboard`**：零依赖静态 HTML（驾驶舱风格），含器官/舰队健康/延迟 sparkline/记忆健康/工具管线健康/**阈值配置**(展示来源文件与每项来源)/活动/告警/运行时间线。

```bash
node "{SKILL_DIR}/src/cli.mjs" monitor --summary    # 统一状态快照
node "{SKILL_DIR}/src/cli.mjs" monitor --tools      # 工具管线健康：缓存/熔断/工具级 P50-P95-P99
node "{SKILL_DIR}/src/cli.mjs" monitor --grid       # 引擎状态网格(颜色化)
node "{SKILL_DIR}/src/cli.mjs" monitor --anomalies  # 异常检测(含熔断开启)
node "{SKILL_DIR}/src/cli.mjs" monitor --config     # 查看/校验当前告警阈值(值/来源/环境变量名)
OMNI_MONITOR_SPIKE_FACTOR=3 node "{SKILL_DIR}/src/cli.mjs" monitor --config  # 环境变量覆盖延迟突增阈值
node "{SKILL_DIR}/src/cli.mjs" monitor --config-file=./my-monitor.json  # 从 JSON 文件加载阈值(Observability-as-Code)
node "{SKILL_DIR}/src/cli.mjs" dashboard            # 生成零依赖静态 HTML 仪表盘(含阈值配置区块)
# 工作区侧跨层复用同一份实现：
node openclaw-workspace/scripts/omnisense-link.mjs monitor toolHealth
node openclaw-workspace/scripts/omnisense-link.mjs monitor config
node openclaw-workspace/scripts/omnisense-link.mjs monitor --config-file=./my-monitor.json config  # 跨层从 JSON 文件加载阈值
```

```bash
node "{SKILL_DIR}/src/cli.mjs" autopilot --ticks=3                # 身体自驱决策（默认动态议程：结果驱动重排）
node "{SKILL_DIR}/src/cli.mjs" autopilot --ticks=3 --no-dynamic   # 关闭动态重排、尊重默认顺序
node "{SKILL_DIR}/src/cli.mjs" autopilot --ticks=2 --llm   # 有模型网关时在线思考
node "{SKILL_DIR}/src/cli.mjs" autopilot --ticks=3 --trace   # 每轮自驱决策记录为可回放 trace（可观测性闭环；默认不记录，显式 --trace 开启）
# 工作区侧驱动身体自主循环（合并后的新项目：工作区能真正让身体"自驱"）
node openclaw-workspace/scripts/omnisense-link.mjs autopilot 2 --json
node openclaw-workspace/scripts/omnisense-link.mjs autopilot 2 --no-dynamic --json
```

## 快速使用

### A. 作为库（在另一段脚本中 import）
```js
import { OmniSense } from 'omnisense';            // 已作为 npm 包安装
// 或相对路径导入本技能源码：
import { OmniSense } from './src/index.mjs';
const omni = OmniSense.create();
await omni.seeHotTopics('bilibili');   // 眼：真抓热搜
await omni.seeWebsite('https://...');  // 眼：真抓网站
await omni.think('用户关心什么');        // 脑：网关代理免key思考
await omni.giveOpinion('AI感知的价值');  // 嘴：免key给意见
// 或直接用「身体」隐喻驱动七器官：
await omni.body.eye('seeWebsite', 'https://example.com'); // 眼
await omni.body.hand('web_fetch', { url: 'https://example.com' }); // 手：动手抓取
await omni.live({ ticks: 3, speak: true }); // 生命循环：自驱地感知→思考→动手→说话→移动
```

### B. 命令行（SKILL_DIR 指向本技能目录）
```bash
node "{SKILL_DIR}/src/cli.mjs" demo                    # 真实联网演示
node "{SKILL_DIR}/src/cli.mjs" hot                     # 看B站热搜
node "{SKILL_DIR}/src/cli.mjs" hot douyin            # 看抖音热搜(免key)
node "{SKILL_DIR}/src/cli.mjs" hot hongguo           # 看红果短剧热榜(聚合源，免key)
node "{SKILL_DIR}/src/cli.mjs" hot weibo               # 看微博热搜(免key)
node "{SKILL_DIR}/src/cli.mjs" see https://...       # 看网站
node "{SKILL_DIR}/src/cli.mjs" image https://x/y.jpg # 看图：driver模式宿主直接读图(免key)；网关模式需VLM key
node "{SKILL_DIR}/src/cli.mjs" feedback "开头太慢"   # 听意见
node "{SKILL_DIR}/src/cli.mjs" novel "第一章…"       # 听小说
node "{SKILL_DIR}/src/cli.mjs" opinion "AI该不该有感知" # 嘴给意见
node "{SKILL_DIR}/src/cli.mjs" think "如何改开篇"    # 脑思考
node "{SKILL_DIR}/src/cli.mjs" status                  # 查看模型后端/能力
node "{SKILL_DIR}/src/cli.mjs" all                     # 并行聚合 9 大平台热搜(去重+频次排序)
node "{SKILL_DIR}/src/cli.mjs" summarize https://...   # 抓取并摘要网页(需网关/外部LLM)
node "{SKILL_DIR}/src/cli.mjs" search "关键词"         # 在记忆中检索
node "{SKILL_DIR}/src/cli.mjs" plan "今天做什么选题"   # 脑：基于当前感知给下一步建议(离线)
node "{SKILL_DIR}/src/cli.mjs" status --json           # 以 JSON 输出(便于解析)
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60      # 常驻感知循环(写 .omni-watch.json)
node "{SKILL_DIR}/src/cli.mjs" watch --agent --interval=120   # 开启"变化即行动"(remember)
node "{SKILL_DIR}/src/cli.mjs" watch --agent --agent-mode=alert --interval=120   # 仅"突变"时写告警记忆
node "{SKILL_DIR}/src/cli.mjs" watch --agent --agent-mode=digest --interval=120  # 变化即把热点+差异写成 markdown 摘要落盘
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60 --autopilot   # 常驻自驱身体：每 tick 由身体自身能力卡自主决策并离线执行（像真人一样持续自我驱动地活着）
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60 --autopilot --autopilot-agenda="思考当前环境,规划下一步行动"  # 自定义自驱议程（逗号分隔）
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60 --autopilot --no-dynamic   # 关闭动态重排、严格按默认/自定义顺序
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60 --autopilot --agent   # 常驻自驱 + 变化即行动，两者互补叠加
node "{SKILL_DIR}/src/cli.mjs" watch --interval=60 --autopilot --trace   # 每 tick 自驱决策记录为可回放 trace（--autopilot 默认即记录，--no-trace 关闭）
node "{SKILL_DIR}/src/cli.mjs" body                   # 身体自检：打印七器官(眼/耳/嘴/脑/手/感知/脚)及能力
node "{SKILL_DIR}/src/cli.mjs" live --ticks=3 --speak   # 生命循环：自驱地感知→思考→动手→说话→移动(像真人一样活着)
node "{SKILL_DIR}/src/cli.mjs" serve 8787              # 启动本地驱动服务(127.0.0.1；OMNI_TOKEN 启用 Bearer 鉴权)
# 🤖 Agent 行动闭环：真把目标做完（有模型走 ReAct，无模型走本地规划器离线完成）
node "{SKILL_DIR}/src/cli.mjs" agent "计算 2+2" --no-llm
node "{SKILL_DIR}/src/cli.mjs" agent "抓取 https://example.com 并写入 ./page.txt" --no-llm
# 🎯 技能匹配与自动委派（基于 Agent Card 能力卡的最佳技能自动路由）
node "{SKILL_DIR}/src/cli.mjs" dispatch "计算 2+2"              # → 自动委派 hand.calc
node "{SKILL_DIR}/src/cli.mjs" dispatch "思考当前热点" [--detail] # → 自动委派 brain.think；--detail 仅展示
```
> 选项：`--json`（结构化 JSON，便于解析）、`--quiet`（静默过程日志）、`--tts`（出声）。`watch` 专属：`--interval=<秒>` `--max=<次数>` `--think` `--out=<文件>` `--remember` `--agent`（变化即行动自主编排，含结构化差异检测）`--agent-mode=remember|alert|digest`（多模式）`--agent-cooldown=<秒>`（防刷冷却，默认60）`--agent-goal=<模板>`（`{date}{top3}{topics}{added}{removed}{count}` 占位）`--summarize-new`（对新增热点联网抓 URL 并摘要，digest 模式写入摘要段，默认关闭）`--autopilot`（常驻自驱身体：每 tick 由身体能力卡自主决策并离线执行，把常驻感知升级为常驻自驱）`--autopilot-agenda="a,b,c"`（自定义自驱议程，逗号分隔）`--no-dynamic`/`--dynamic`（关闭/强制开启动态议程重排，仅自驱路径生效）。`agent` 专属：`--max=<步数>`（默认8）`--no-llm`（强制本地规划器）`--allow-shell`（启用 shell 工具，默认禁用）。

### B2. 🤖 Agent 行动闭环（核心能力升级）
`agent "<目标>"` 让 OmniSense 从"感知+汇报"变成"能推理、能调用工具、能完成目标"的 agent：
- **有在线模型**（本机模型网关 或 配了 `LLM_*` key）：走 **ReAct 推理**，模型动态决定每步工具，直到给出最终答案。
- **无模型**（driver 模式/纯离线）：走 **本地确定性规划器 `localPlan`**，照样完成多步任务（抓取网页并落盘、计算、查记忆等），诚实不伪造。
- **通用意图分解**：先识别原子意图（算/抓/摘要/写/读/记/热搜/时间），再按依赖排序组合（如"抓→写""算→写"），原生支持**复合目标**（"计算 100/4 并写入文件"离线真落盘）。
- **越用越强（playbook 自动复用）**：每完成目标把"打法"沉淀进记忆；新目标来时按 Jaccard 相似度：高相似（≥0.5）直接复用并做参数迁移且 `hitCount`+1；中相似（0.25–0.5）把旧打法作 few-shot 注入 LLM 推理；都不中则正常完成再沉淀。记忆检索已升级为 **深度语义检索**：BM25-lite 相关性 + **时间衰减**(新记忆更靠前) + **复用权重**(hitCount 高的高频打法排更前) + **可选 MMR 去冗余**(`--diversity`)，按"相关×新鲜×常用"综合召回。
- **经验层闭环**：每次完成目标自动沉淀"经验笔记"；下次来新目标时先深度检索召回相关经验注入推理上下文（本地规划器作诚实 hints）。**ReAct 每步二次经验召回**：每拿到一步观察就再精炼一次召回注入下一步推理。**记忆去重压缩**：`Memory.dedupNotes()`/`compact()` 合并重复笔记、超上限删最旧。
- **Agent 自我反思**：每次 `runAgent` 跑完基于执行轨迹产出"经验教训"，以 `agent-reflection` 笔记写回记忆。有在线模型走 LLM 反思，否则离线启发式；反思失败静默退回离线。命令行 `agent` 支持 `--no-reflect` 关闭。
- 内置工具：`web_fetch`·`read_file`·`write_file`·`list_dir`·`calc`(安全算术)·`now`·`hot_topics`·`summarize_url`·`memory_search`·`memory_remember`·`shell`(默认禁用)。
- **多 Agent 协作**：`multiagent "<目标>"` 把复杂目标交给协调器 + 角色子 agent。协调器有在线模型时走 LLM 智能拆解子任务，否则离线确定性拆解（按任务级连接词拆句 → 关键词分派角色），独立子任务并行执行（Promise.all）、汇总/综合类子句自动第二批；子任务交给角色限定工具集的子 agent（researcher 检索/抓取、analyst 计算/分析、writer 写文档、critic 校验），复用 Agent 内核；结果入共享黑板、协调器综合产出（`--coordinator` 走 LLM 智能综合）；部分失败诚实报告（`allCompleted:false` 且说明原因）。`--roles=researcher,analyst,writer` 限定启用角色，`--no-parallel` 退回串行。

### C. 本地驱动服务 serve（跨进程编排）
`serve` 在 `127.0.0.1` 起一个 JSON HTTP API，让外部进程直接驱动本技能能力，无需 import。
```bash
# 启动（仅本机；设 OMNI_TOKEN 环境变量即启用 Bearer 鉴权）
OMNI_TOKEN=mytoken node "{SKILL_DIR}/src/cli.mjs" serve 8787
# 外部调用示例
curl -s -X POST http://127.0.0.1:8787/see   -H 'Content-Type: application/json' -d '{"url":"https://example.com"}'
curl -s -X POST http://127.0.0.1:8787/all   -H 'Content-Type: application/json' -d '{}'
curl -s -X POST http://127.0.0.1:8787/tick  -H 'Content-Type: application/json' -d '{}'   # 单次感知快照（供外部编排）
curl -s -X POST http://127.0.0.1:8787/agent -H 'Content-Type: application/json' -d '{"goal":"计算 2+2","useLLM":false}'
curl -s            http://127.0.0.1:8787/health
# 启用鉴权时，所有请求需带：Authorization: Bearer mytoken  （或 ?token=mytoken）
```
> ⚠️ 仅监听 `127.0.0.1`、无 TLS，**切勿用 -h 0.0.0.0 或端口转发暴露到公网**。设了 `OMNI_TOKEN` 后所有路由（含 `/health`）要求 `Authorization: Bearer <token>`（或 `?token=`）。路由：`/health /see /hot /all /summarize /think /plan /tick /speak /remember /recall /search /sense /status /agent`。

## 事件总线（模块间协同）
眼/耳 → 发 `percept`/`user-percept`；脑 → 发 `insight`/`decision` 并向 `eyes/ears/mouth` 下发 `command`；嘴 → 发 `utterance`。
各模块通过事件契约解耦协作。

## 扩展新平台 / 新感官
- 新增热搜源：在 `src/modules/eyes.mjs` 的 `_hotSources()` 增加一项（url / as / parse / 可选 headers），`all` 聚合自动覆盖（参照已有 9 个源：bilibili/toutiao/weibo/baidu/douyin/hongguo/zhihu/weixin/bangumi）。B站番剧榜等强制 WBI 签名的接口加 `sign:'wbi'` + `extra`（见 `biliWbiParams`）。单源失败不影响整体（Promise.allSettled 优雅降级）。热搜带 **TTL 缓存（默认 60s）+ 单源熔断**（连续失败自动冷却），可用 `OMNI_HOT_TTL / OMNI_HOT_MAX_FAILS / OMNI_HOT_COOLDOWN` 调参。
- 日志：`OMNI_LOG_LEVEL=trace|debug|info|warn|error|silent`（`QUIET=1` 等价 error）；CLI 加 `--quiet` 可静默过程日志。
- 测试：`npm test`（node --test，纯逻辑离线 fixture；B站 WBI 以固定密钥离线校验）；`npm run lint` 对 src/test 全量 `node --check`。CI 见 `.github/workflows/test.yml`（Node 18/20/22，先 lint 后 test）。
- 启用外部模型（可选）：复制 `src/.env.example` 为 `.env` 填 `LLM_*/VLM_*/ASR_*/TTS_*`；网关不可用时自动回退。

## 版本与回退（版本心跳）

用 `scripts/release.mjs` 做本地版本管理 + 自动回退，心跳自动化每小时迭代：

- 每小时 minor（`MAJOR.MINOR+1.0`）；每 3 小时 major（`MAJOR+1.0.0`，minor 归零）。
- 每次发布写 `VERSION`+`package.json`、追加 `CHANGELOG.md`/`versions.json`、打 git tag、本地 commit。**绝不推送**。
- `node scripts/release.mjs list` 看版本；`node scripts/release.mjs rollback vX.Y.Z` 非破坏式回退（历史保留）。

## 诚实边界（务必知晓）
- 眼/耳的**联网抓取/下载**是真实本地执行，不依赖任何 key，在任意环境都真跑。
- **文本推理（脑思考 / 嘴说话给意见对话）两种免 key 路径，都已经打通**：
  - 网关模式 → 网关在线模型真推理；
  - 无网关的环境（driver 模式）→ 由宿主(agent)自身驱动，脚本输出真实感知上下文供宿主直接思考/回答。
- 视觉「看图」：
  - **driver 模式**：脚本把远程图下载到本地临时文件，**由宿主(agent)直接读图真实描述**——免 key 真看见了。
  - **网关模式**：网关当前只支持文本，需配置外部 `VLM_*` key 或本地 VLM 引擎才能让看图真跑。
- 语音「听」(ASR)与「出声」(TTS)：网关当前无此能力，需配置外部 key 或本地引擎（如 whisper.cpp）。文本类「听」(意见/小说/文案)不受影响，走网关或 driver 文本理解。
