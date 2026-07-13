# OmniSense 架构

> 通用 AI 感知系统：赋予 AI「眼睛 / 耳朵 / 嘴巴 / 大脑 / 手 / 感知 / 脚」七类真实能力，并整合为像真人一样的身体。
> 设计原则：**零运行时依赖、复制即跑、能力诚实降级、模块经事件契约解耦**。

## 多智能体工作区集成（openclaw-workspace）

本仓库同时合并了多智能体工作区 `openclaw-workspace/`（原独立仓库 `xiaobei1679/openclaw-workspace`，MIT）。
两者经 `integrations/openclaw/` 桥接层打通：工作区可注册 `omnisense-engine` 角色，把 OmniSense 的七器官当作「身体」来驱动。
- `integrations/openclaw/omni-body.mjs`：七器官桥接（直接 import `src/body.mjs`，无 shell 中转）。
- `integrations/openclaw/omnisense-bridge.mjs`：一句话目标 → 身体执行（感知→思考→动手）。
- 详见 [integrations/openclaw/README.md](./integrations/openclaw/README.md)。

## 模块关系

```
                        ┌───────────────────────────┐
   外部驱动方            │        OmniSense 门面        │
   (CLI / serve /       │  (src/index.mjs)           │
    agent / 调用方) ───▶│  统一 API: see/think/...    │
                        └─────────────┬───────────────┘
                                      │ 组合
        ┌──────────────┬──────────────┼──────────────┬──────────────┐
        ▼              ▼              ▼              ▼              ▼
        ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌────────────┐
        │  Eyes   │   │  Ears   │   │  Mouth  │   │  Brain  │   │ Perception │
        │  眼睛   │   │  耳朵   │   │  嘴巴   │   │  大脑   │   │   感知     │
        └────┬────┘   └────┬────┘   └────┬────┘   └────┬────┘   └─────┬──────┘
            │               │               │               │                │
        ┌─────────┐   ┌──────────────┐   ┌──────────────┐
        │  Hand   │   │  Foot           │   │   Body(身体)    │
        │  手     │   │  脚(常驻感知/移动)│   │  live()生命循环  │
        └────┬────┘   └──────┬───────┘   └───────┬──────┘
            │                    │                       │
            └────────────────────┴───────────────────────┘
                              ▼
                    （七器官皆由 Body 统一聚合，以真人隐喻驱动）
        │            │            │            │              │
        └────────────┴─────┬──────┴────────────┴──────────────┘
                          ▼
                    ┌─────────────┐
                    │   Bus 事件总线 │◀── 模块间只经事件契约耦合
                    │  + 命令调度    │    (on/once/off/wildcard, command)
                    └─────────────┘
                          │
            ┌─────────────┼──────────────────────┐
            ▼             ▼                      ▼
      ┌──────────┐  ┌────────────┐        ┌──────────────┐
      │ Memory   │  │  Providers │        │   core/*     │
      │ 记忆中枢 │  │ 模型适配层 │        │ http/logger/  │
      │ (落盘)   │  │ LLM/VLM/   │        │ breaker/config│
      └──────────┘  │ ASR/TTS    │        └──────────────┘
                    └─────┬──────┘
                          │
            ┌─────────────┴──────────────┐
            ▼                            ▼
   ┌──────────────────┐         ┌──────────────────────┐
   │ 本地模型网关        │         │ 外部 key / 本地引擎   │
   │ (OpenAI 兼容端点)  │         │ (可选回退)            │
   │ 免 key 在线模型    │         └──────────────────────┘
   └──────────────────┘
```

## 身体与七器官（像真人一样）

七个模块并非零散：由 `src/body.mjs` 的 `Body` 统一聚合为「像真人一样的身体」——眼/耳/嘴/脑/手/感知/脚。以真人隐喻驱动：`omni.body.eye(...)`、`omni.body.hand('web_fetch', ...)`、`omni.body.foot('watch', ...)`。

核心是一套 **`live()` 生命循环**：自驱地持续「感知 → 思考 → 动手 → 说话 → 移动」，而非被动等命令——这正是「和真人一样」的本质。默认离线、有限轮次、所有步骤带 `catch` 兜底，绝不因无模型而挂起。

其上层的 **`autopilot()` 自主循环**更进一步：身体用自身能力卡 `skillResolve` **自己决定每轮做什么**，再 `skillDispatch` 离线执行——感知→自生成意图→选最佳器官→执行→记录委派结果（借鉴 BabyAGI 自生成任务队列思想，离线零网络、零挂起）。

> **v3.2.0 起**：`live()` 生命循环**默认即 autopilot 自驱**——身体每拍用自身能力卡自主决策并离线执行，把"活着"与"自主决策"统一为一件事（持续自驱生命周期借鉴 Stanford Generative Agents / Smallville：https://arxiv.org/abs/2304.03442）。`--no-autopilot` 回到写死步骤以兼容旧行为。

## 数据流（一次「看热点 + 思考」）

1. 驱动方调用 `omni.seeHotAll()`（CLI `all` / serve `POST /all`）。
2. `Eyes.seeAllHot()` 并行 `Promise.allSettled` 拉 9 个平台；每个源经 **TTL 缓存 + 单源熔断**（`core/breaker.mjs`）后 `parse` 成标题数组。
3. 去重 + 跨平台频次排序 → 发 `percept` 事件给 Bus。
4. `Perception.sense()` 汇总近期 `percept` 为环境模型，发 `situation` 事件。
5. `Brain.think()` 取近期 `percept` + 记忆，离线 `synthesize()` 成结构化情境，再交给模型推理（driver 模式抛出 `AGENT_DRIVE` 交调用方），发 `insight` 事件。
6. `Brain.plan()` 基于情境给出下一步行动建议（纯离线）。

## 数据流（一次「Agent 行动」）

1. 驱动方调用 `omni.act(goal)`（CLI `agent` / serve `POST /agent`）。
2. `Brain.act()` → `runAgent(omni, {goal})`：先尝试 **LLM ReAct 推理**（`core/agent.mjs` 的 `makeLLMReasoner`，有网关/key 时真推理）；模型不可用则转 **本地确定性规划器** `localPlan(goal)`。
3. 每轮：`reasoner` 产出 `{thought, action, action_input}` → `executeTool()` 执行 `core/tools.mjs` 中注册的工具（联网抓取/文件/计算/记忆/热搜…）→ 观察结果回填历史。
4. 直到 reasoner 给出 `final_answer` 或规划器走完所有步骤；完成后把"打法"沉淀进 `Memory`（键 `playbook:<hash>`，含 `hitCount`/`reused`）——**越用越强**。下次同类目标来时：高相似（Jaccard ≥ 0.5）直接复用旧打法并做参数迁移；中相似（0.25–0.5）把旧打法作 few-shot 注入 LLM 推理；都不中则正常完成再沉淀。记忆检索经 `core/memory.mjs` 的 **BM25-lite 语义排序**（零 key、零依赖）按相关度召回。**ReAct 每步二次经验召回**：LLM 推理循环里每拿到一步观察就基于该观察再精炼一次召回并注入下一步推理上下文，长链路任务边做边"想起"经验。**记忆去重压缩**：`Memory.dedupNotes()`/`compact()` 合并重复笔记、超上限删最旧。**Agent 自我反思**：`runAgent` 跑完基于轨迹产出"经验教训"，以 `agent-reflection` 笔记写回 `Memory`，未来同类目标经 `recallContext` 召回真正影响下次推理；有在线模型走 `reflect()` 的 LLM 反思，否则离线启发式，反思失败静默退回离线；`agent` 命令 `--no-reflect` 可关。
5. 两路都失败则诚实返回"无法自主完成，需在线模型或更具体目标"，绝不伪造成功。

## 数据流（watch 自主编排：被动感知 → 主动行动）

1. `runWatch`/`runWatchTick` 每个 tick 调 `omni.seeHotAll()` 取当前热点，算 **签名**（前 5 条标题排序拼接）。
2. 与上一轮 `prevSig` 比较：首轮（无 prevSig）或签名变化 = 检测到"有意义变化"；否则视为无变化。同时用 `diffTopics` 算**结构化差异**（新增/消失列表）。
3. 变化且已过 `agentCooldownMs` 冷却 → 按 `--agent-mode` 合成目标并派发 `omni.act(goal, {useLLM:false})`（Agent 内核离线确定性执行，零成本、诚实不伪造）：`remember`(默认，目标含当前/新增/消失) / `alert`(**仅当存在新增话题**时触发，目标为突变告警记忆) / `digest`(目标为写 markdown 摘要文件)。目标可用 `{date}{top3}{topics}{added}{removed}{count}` 模板自定。
4. 结果记入该 tick 快照 `agentAction:{fired,reason,goal,completed,...}`；`runWatch` 跨 tick 透传 `prevSig`/`prevAgentAt`，使变化检测与冷却在循环内持续生效，`res.agentFired` 累计自主行动次数。
5. 无变化或不合冷却 → `agentAction.fired=false`（reason: `热点无变化`/`冷却中`），绝不空转刷记忆。agent 调用异常被 `try/catch` 捕获，诚实降级，不中断 watch 循环。

## 数据流（autopilot 自主循环：身体自己决定做什么）

1. 每轮 `autopilot` 先 `perceive()` 聚合近期眼耳输入 + 热搜，合成环境理解（离线）。
2. 从议程选意图：**默认开启动态议程**——用优先级队列 `（最少跑 → 最高权 → 最早 seed）` 选意图，既保证全部意图轮到、又让"结果好"的意图优先；自定义议程默认尊重用户顺序（除非显式 `dynamic:true`）。
3. `skillResolve(intent)` 把意图映射到能力卡 `skills[]` 中最佳器官/方法（top-3 排名，纯关键词匹配）。
4. 在排名里挑第一个"会做事"的器官（脑/嘴/耳；跳过需结构化参数的 `hand.*` 与本轮已做过的 `perceive.sense`），`skillDispatch(intent)` 真正执行，结果记入该轮 `trace.executed/result`。
5. **结果驱动重排（BabyAGI「优先级随结果重排」思想的离线实现）**：本轮委派结果回写议程——动作成功 → 提权（且"想清楚/规划"成功会带升"记忆类"意图，因为该记住/回顾）；退化到感知（无动作）→ 惩罚并逼出"真正动手"的意图。每步 `trace.agendaWeights` 快照当前权重，可观测"权重如何随结果变化"。
6. 全部候选都不可执行 → 诚实降级到 `perceive.sense` 并标注 `fallback` 原因（如 `matched-hand-needs-args` / `no-exec-organ`），绝不因缺参数报错或联网。
7. 借鉴 BabyAGI「任务创建→排序→执行→重排→再生成」自生成任务队列思想（https://github.com/yoheinakajima/babyagi · https://www.ibm.com/think/topics/babyagi · https://tinyagents.dev/compare/babyagi），但离线即可自驱，无需 LLM 即可让身体在世界里自主行动、并据结果自我调整下一步关注。

## 目录结构

```
src/
  index.mjs           门面 OmniSense（统一 API）
  cli.mjs             命令行入口（demo/status/hot/all/see/body/live/serve/...）
  body.mjs            身体：把七器官整合成像真人一样的智能体 + live() 生命循环
  server.mjs          本地 HTTP 驱动服务(127.0.0.1，无鉴权)
  core/
    bus.mjs           事件总线 + 命令调度
    logger.mjs        分级日志（trace/debug/info/warn/error/silent）
    breaker.mjs       TtlCache + CircuitBreaker（零依赖基础设施）
    config.mjs        安全读取网关配置(~/.omnisense/gateway.json)
    http.mjs          统一 HTTP 客户端（UA/超时/重试）
    memory.mjs        记忆中枢（深度语义检索：BM25-lite + 时间衰减 + 复用权重 + MMR 去冗余；键值 + 笔记 + 图谱，落盘）
    llm.mjs           本地模型网关代理层（免 key 双模式）
    tools.mjs         工具执行器（web_fetch/文件/calc/now/记忆/热搜… 安全白名单）；executeTool 统一入口复用 breaker.mjs 的 TTL 缓存 + 熔断器（声明式：工具定义加 cacheTtl/circuit 即启用，覆盖 web_fetch/summarize_url/hot_topics，避免重复联网与反复超时）
    agent.mjs         Agent 内核（ReAct 推理闭环 + localPlan 通用规划器[经验hints重建步骤] + playbook 自动复用 + 经验记忆召回注入推理 + 经验沉淀闭环）
    agents.mjs        多 Agent 协作（协调器 planSubtasks/planSubtasksSmart[LLM 智能拆解] + 角色子 agent 委派[并行/工具集沙箱] + 共享黑板 + 协调器综合 + 诚实部分失败）
    tracer.mjs        Agent 执行轨迹追踪（可回放 trace 落盘 + 聚合指标；对齐 OpenTelemetry GenAI 语义约定 gen_ai.*）。增强：compareRuns(idA,idB) 回放对比（Forkline 式 first-divergence 检测：定位行为首次分歧步 + verdict identical/similar/improved/regressed）、findRunsByGoal(goal) 同目标多次运行检索、exportDataset() 导出回归数据集（LangSmith 式 trace→dataset）、setBaseline/regressionCheck 行为回归门禁（recut-ai/shadow 思想：退化即 FAIL，可接 CI）、exportOtlp() 导出 OTLP/JSON（OTel-native：run→trace，root span invoke_agent + 每步 execute_tool child span，gen_ai.*/error.type/status.code，可直接投 Grafana Tempo/Phoenix/Jaeger/OTel Collector）
  body.mjs            身体：把七器官整合成像真人一样的智能体 + live() 生命循环；`describe()`（器官树，含每能力 desc/net/examples）+ `agentCard()`（A2A 风格能力卡：把全部能力扁平化为 skills[]，借鉴 Google A2A Protocol 的 AgentCard 思想，仅取结构语义；net 诚实标注联网依赖）
    watch.mjs         常驻感知循环 + 差异检测(diffTopics) + 多模式(remember/alert/digest) + 新增热点联网摘要(summarizeNewTopics) 自主派发 Agent 编排
  providers/index.mjs 模型适配层（LLM/VLM/ASR/TTS 统一接口）
  modules/
    eyes.mjs         眼睛：网站/热搜/图像/视频 + readability 正文提取 + WBI 签名
    ears.mjs         耳朵：音频/小说/反馈
    mouth.mjs        嘴巴：意见/对话/出声
    brain.mjs        大脑：思考/决策/规划/行动(act) + synthesize()
    perception.mjs   感知：环境模型聚合
test/                 node:test 离线单测（bus/breaker/config/logger/brain/server/providers/llm/eyes/memory/tools/agent/watch）
.github/workflows/    Node 18/20/22 CI（语法检查 + 单测）
```

## 诚实边界（能力可用性）

| 能力 | 免 key 真跑 | 条件 |
|------|------------|------|
| 看网站 / 热搜 / 图像落本地 | ✅ 本机真实联网 | 无需任何 key |
| 文本推理（思考/意见/对话） | ✅ | 本机模型网关 **或** 调用方(agent) 驱动 |
| 看图(VLM) | ⚠ 取决于 | 网关模式需 VLM key / driver 直接读图 |
| 听(ASR) / 出声(TTS) | ⚠ 取决于 | 需外部 key 或本地引擎；未配置则诚实降级 |

任何不可用时**明确告知**，绝不伪造结果。

## 扩展

- **加热搜源**：在 `src/modules/eyes.mjs` 的 `_hotSources()` 增加一项（`url`/`as`/`parse`，可选 `sign:'wbi'`），`all` 聚合与缓存/熔断自动覆盖。
- **加能力**：在对应模块实现方法 → 门面 `index.mjs` 暴露 → 可选登记到 Bus 供大脑 `command` 调度。
- **加 hand 工具（插件自发现）**：往 `src/tools/`（或 `OMNI_PLUGINS_DIR`）丢一个 `.mjs`，默认导出 `{ name, description, parameters, run }`，`buildDefaultTools` 自动注册；借鉴 Nanobot / OpenSquilla 技能加载器模式（见 README）。失败插件被跳过不拖垮启动。
- **驱动方式**：CLI、`serve` HTTP API、或直接 `import { OmniSense }` 作为库。
