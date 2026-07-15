# OmniSense 更新日志 (Changelog)

所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。
回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。
版本规则: 基于**实际变更规模**而非时间判定 major/minor（详见 `scripts/release.mjs` 头部说明）。

## v9.3.0 — 2026-07-15 (minor)

- 轻量心跳: 学习+硬骨头变更汇总

## v9.2.0 — 2026-07-15 (minor)

- monitor 新增学习子系统观测 learnings（第22个总线方法）+ CLI learn 命令触发学习循环 + workspace 桥接 learnings/learn 同步 + learning 新增 forkline/braintrust 来源（trace→regression 反馈闭环 + 可观测反馈回路）+ 三层同迭代（内核 monitor+cli / workspace omnisense-link / learning 心跳+源扩展）。借鉴2026 Agent 可观测性 feedback loop 思想(arahi.ai/blog/ai-agent-observability)，补齐可观测三支柱中的反馈回路支柱。

## v9.1.0 — 2026-07-15 (minor)

- monitor 多舰队差异化阈值(scoped thresholds): 阈值配置 JSON 文件支持 scopes 按引擎/环境 profile 分组覆盖；config/thresholdHealth/thresholdAlerts 支持 --scope（引擎 scope 仅测该引擎 runs、环境 profile scope 仅覆盖阈值，不改测量对象）；优先级 opts>env>scope>file>default，来源诚实标注 source:'scope'；config 回显当前 scope 并列出 availableScopes，dashboard 展示当前 scope 与可用 scope 列表。内核 monitor.mjs+cli.mjs / 桥接 omnisense-link.mjs 三层一致。学习子系统 learner.mjs 新增 observability 本地学习源（身体从自身监控器官蒸馏多舰队可观测性模式，离线可用），满足三层同迭代。借鉴 100+ Agent per-Agent-type 差异化阈值 / kaxo.io per-agent 可观测 / Prometheus 按环境 tier 分级告警。

## v9.0.0 — 2026-07-14 (major)

- 工具级缓存/熔断落盘持久化（OMNI_TOOL_CACHE_FILE/--persist-file 启用零依赖 JSON 落盘，跨重启续命：缓存不重抓+熔断冷却续命）；setToolCachePersistence/toolCachePersistence/persistToolCache/clearToolCachePersistence 暴露至 facade+CLI+工作区桥接；新增 5 内核单测+1 跨层断言；借鉴 disk-backed TTL cache/SQLiteCache 思想

## v8.2.0 — 2026-07-14 (minor)

- monitor 综合健康评分维度权重可配置化（opts>env>JSON文件>default 四源，复用 Observability-as-Code，计分前归一化恒在 0-100；新增 weights 总线方法第21个）

## v8.1.0 — 2026-07-14 (minor)

- monitor 常驻轨道延续 · OTLP 导出增强：为每个 span 注入 OTel GenAI span events（root→gen_ai.user.message 目标 / gen_ai.assistant.message 最终答案 / 未完成 exception；child→gen_ai.assistant.message 思考 / gen_ai.tool.message 工具结果或错误 / 失败步 exception；并加 gen_ai.tool.call.id 关联）。对齐 uptrace / opentelemetry.io「内容放事件而非属性」约定，便于 Collector 按隐私策略过滤、不污染索引。三层（内核/桥接/工作区）同源一致；内核+2 单测、工作区跨层断言升级；npm test 282/282、子包 279/279、lint 52 全绿。

## v8.0.0 — 2026-07-14 (major)

- monitor 新增综合健康评分 healthScore（0-100 加权汇总 Liveness/可靠性/阈值/异常/工具管线 5 维度 + 等级 A/B/C/D/F + 仪表盘区块 + 跨层复用，借鉴 Nobl9 Composite SLO 与 New Relic 健康分）

## v7.3.0 — 2026-07-14 (minor)

- monitor 新增可推送告警清单 thresholdAlerts/alertables（Alertmanager 形状 fingerprint+labels{severity}+annotations，over→critical/warn→warning 对齐 severity 标签），CLI --threshold-alerts 与 工作区 monitor thresholdAlerts 跨层复用同一份实现；dashboard 阈值区块附可推送告警清单子块；借鉴 Prometheus Alertmanager 告警数据模型

## v7.2.0 — 2026-07-14 (minor)

- 修复内核真实 bug + 真实本地 LLM(Ollama) E2E：resolveModel() 支持 gateway.json 显式 model 引脚(优先级 OMNI_MODEL>gateway.model>探测首模型>openclaw) 避免盲取不可用模型静默回退离线；chat() 主模型连接失败时自动回退探测到的其他可用模型(仅连接错误重试)；附 examples/gateway.ollama.example.json 零 env 接 Ollama；补 2 项内核单测

## v7.1.0 — 2026-07-14 (minor)

- monitor 第16总线方法 thresholdHealth：实时测 11 项当前值 vs THRESHOLD_SPEC 阈值，输出 ok/warn/over/na 红黄绿着色(dashboard 当前值vs阈值着色)；CLI --threshold-health + 工作区 omnisense-link monitor thresholdHealth 跨层复用(借鉴 Grafana 阈值阶梯着色)

## v7.0.0 — 2026-07-14 (major)

- monitor 阈值配置支持 JSON 文件（Observability-as-Code）：新增 loadThresholdFile + 扩展 resolveThreshold 第四来源 file + 构造器自动加载 OMNI_MONITOR_CONFIG 或默认 ~/.omnisense/monitor.json + 新增 loadConfigFile + 内核 CLI --config-file 与工作区 omnisense-link 桥接；新增 5 项内核单测 + 1 项跨层；借鉴 Grafana/Prometheus Observability-as-Code

## v6.1.0 — 2026-07-14 (minor)

- monitor 告警阈值可配置化：11 类阈值经 OMNI_MONITOR_* 环境变量/opts 覆盖(opts>env>default，值可溯源、非法回退)，新增 config 总线方法(第15个)+CLI --config+dashboard 阈值配置区块+工作区 monitor config；消灭硬编码阈值反模式(借鉴 Grafana/Prometheus 动态阈值)

## v6.0.0 — 2026-07-14 (major)

- 监控器官 monitor 增强：趋势异常检测(trend-based anomaly detection)——新增 _detectTrendAnomalies() 检测「慢煮青蛙」式渐进退化(P95爬坡 trend_regression/成功率漂移 trend_drift/记忆空转 trend_pre_warning/舰队健康退化)，集成进 detectAnomalies 与 snapshot；修复 pre-existing bug：snapshot() 中 _appendTrend 为死代码(直接 return 对象字面量致趋势点从未落盘)，trends/trend 字段等功能实质上一直未生效；新增 14 号总线方法 trendAnomalies + 公共方法别名；工作区 omnisense-link.mjs 增 trendAnomalies 跨层子命令；内核测试 +5(253/253)、子包 +1(274/274)全绿；借鉴 OpenObserve/AIOps 'gradual degradation' + LangSmith drift detection + Prometheus linReg 趋势回归思想。

## v5.0.0 — 2026-07-14 (major)

- 监控器官 monitor 新增工具管线健康维度（toolHealth：缓存命中分布/熔断状态/工具级 P50-P95-P99 延迟分布 + circuit_open 熔断开启告警），CLI --tools 与 工作区 omnisense-link monitor toolHealth 跨层复用内核同一份 monitor；修复运行时产物 .omni-health-metrics.json 未 gitignore 的污染 gap

## v4.5.0 — 2026-07-13 (minor)

- 监控器官 monitor 修复两处真实缺陷(基于种子化演示验证)：①记忆批量注入检测失效——原 memoryHealth() 每次调用都覆盖共享基线，导致 snapshot() 内 detectAnomalies() 永远看到 baseline==current 而 memory_bulk_injection 永不触发；改为分离『稳定基线(供 growth 展示,仅首次建立)』与『滑动基线(供批量注入检测,每次检查后更新)』。②snapshot() 重复调用 detectAnomalies()(经 allAlerts + 直接调用)使首次调用吞掉批量注入告警；改为单次计算复用。模块测试 17/17,核心 244/244,lint 52 文件全过。另附种子化演示仪表盘(omni-dashboard-demo.html)展示舰队健康/延迟P95/记忆健康/异常检测全能力。

## v4.4.0 — 2026-07-13 (minor)

- 监控器官 monitor 全面升级(借鉴 LangSmith/Langfuse/CloudWatch GenAI 可观测三支柱 + ClawHub 舰队健康 + perfecxion 记忆专属指标 + 心跳存活判定)：①延迟指标 P50/P95/P99 按引擎分布+趋势 sparkline；②状态网格/舰队健康(颜色化 healthy/degraded/down)；③记忆健康(技能利用率/信任分分布/低信任/陈旧记录/增长批量注入检测)；④异常检测(延迟突增/吞吐骤降/记忆批量注入)；⑤运行时间线；⑥驾驶舱风格可视化仪表盘。总线方法 6→11，CLI 新增 --latency/--grid/--memory/--anomalies/--runs。测试核心 244/244。

## v4.3.0 — 2026-07-13 (minor)

- 升格监控为第八器官 monitor：①可视化仪表盘(零依赖HTML,展示器官/四层记忆/活动/告警)；②AI Agent 状态检测(基于tracer runs健康度)；③四层记忆快照；④多种状态检测(连续失败/48h不活跃/错误率突增+兼容health-observer)；⑤CLI monitor/dashboard 命令 + HTTP /monitor /dashboard 路由 + 桥接层 route 透传

## v4.2.0 — 2026-07-13 (minor)

- watch autopilot 自驱决策接 tracer 可观测性闭环：autopilot / watch --autopilot 每 tick 自驱落盘 engine=autopilot trace（--trace 显式开启，watch --autopilot 默认记录），tracer.findRunsByGoal 增精确优先+包含回退前缀检索(trace --find=autopilot:)，内核+桥接+工作区三端同步 --trace。借鉴 LangGraph checkpointer / Octopoda 时间线回放。

## v4.1.0 — 2026-07-13 (minor)

- 常驻自驱身体（watch --autopilot）：脚(foot) 每 tick 由身体自身能力卡 skillResolve 自主决策并 skillDispatch 离线执行，把常驻感知循环升级为常驻自驱之活身体；与 --agent(变化即行动) 互补、可叠加。内核 src/core/watch.mjs 增 autopilot 选项(runWatchTick/runWatch)，src/cli.mjs watch 增 --autopilot/--autopilot-agenda/--no-dynamic/--dynamic；工作区 omnisense-link.mjs watch 增 --autopilot/--no-autopilot/--no-dynamic/--dynamic + 跨层测试。内核 test/watch.test.mjs +5、工作区 +2。借鉴 OpenClaw Heartbeat Loop 与 Sophia System 3 持久自驱层(离线启发式,零网络零 key)。两测试套件全绿(224/224、268/268)、lint 50 文件 OK、E2E 离线真跑通(每 tick 自驱委派 mouth.getStyle)。本地提交+tag，未推送。

## v4.0.0 — 2026-07-13 (major)

- 工具级缓存/熔断扩展到 Agent 工具调用：复用 breaker.mjs 的 TTL 缓存+熔断器（此前仅热搜），覆盖 web_fetch/summarize_url/hot_topics——同一目标 TTL 内命中缓存直接返回(避免重复联网)、连续失败达阈值则熔断短路(防反复超时)；声明式启用(cacheTtl/circuit)、默认工具行为不变。新增 facade toolCacheStats/clearToolCache/toolBreakerStatus、CLI cache [--clear]、工作区 omnisense-link cache [--clear] 可观测；内核 tools.test 增 4 项单测、工作区增 2 项跨层断言。

## v3.2.0 — 2026-07-13 (minor)

- live() 生命循环默认升级为 autopilot 自驱（身体每拍用能力卡自主决策，借鉴 Stanford Generative Agents 持续自驱生命周期；--no-autopilot 保留旧写死步骤）；工作区新增 live 命令

## v3.1.0 — 2026-07-13 (minor)

- autopilot 升级为结果驱动的动态议程重排（借鉴 BabyAGI 优先级随结果重排：每轮委派结果回写议程、动态调权，默认开启、--no-dynamic 可关；内核 body.mjs + 工作区 omnisense-link.mjs 双触达，离线自驱、全程零网络）

## v3.0.0 — 2026-07-13 (major)

- OTLP/GenAI 可观测性导出：身体轨迹一键导出 OTLP/JSON（OTel-native，run→trace，root invoke_agent + 每步 execute_tool，gen_ai.*/error.type/status.code），可直投 Grafana Tempo/Phoenix/Jaeger/OTel Collector；CLI trace --export-format=otlp、serve GET /trace-export?format=otlp、工作区 omnisense-link trace --export-format=otlp 跨层复用同一份 tracer

## v2.4.0 — 2026-07-13 (minor)

- Agent 轨迹回放对比与回归门禁：tracer 新增 compareRuns(首次分歧检测+verdict)/findRunsByGoal/exportDataset/基线·回归门禁；CLI trace 增 --diff/--find/--export/--baseline/--regression(regressed 退出码1可接CI)；serve 增 /trace-diff//trace-find//trace-regression//trace-baseline；工作区 omnisense-link 增 trace 子命令跨层消费身体 tracer；借鉴 Forkline/LangSmith/recut-ai 思想

## v2.3.0 — 2026-07-13 (minor)

- 自主循环 autopilot：身体用自身能力卡 skillResolve 自驱决策每轮动作并 skillDispatch 离线执行（借鉴 BabyAGI 自生成任务队列）；内核+桥接+工作区三层同迭代，197+255 测试全绿

## v2.2.0 — 2026-07-13 (minor)

- 四层记忆架构改造(AGI-Memory 借鉴)：1) Memory 类从单文件键值存储升级为四层派生架构——Layer1 Memory(原store/notes，向后兼容)+Layer2 Rule(IF-ELSE 门控规则，带 matchRule 引擎)+Layer3 Skill(技能定义/trigger搜索/hitCount追踪)+Layer4 Knowledge(结构化知识+derived_from+confidence+avoid_pitfall);2) 各层独立 json 文件持久化(原子 rename 写)，独立的 CRUD 与 BM25 搜索方法;3) Brain 新增 12 个总线方法(addRule/removeRule/getRules/checkRules/addSkill/findSkills/hitSkill/addKnowledge/searchKnowledge/learnFromCorrection/searchAll/layerSnapshot);4) 跨层 searchAll 支持 from 参数筛选各层;5) learnFromCorrection 自动从纠错中生成 Knowledge 条目;6) 所有原有 API 完全不变，195+254 测试全绿。

## v2.1.0 — 2026-07-13 (minor)

- CodeGraph MCP + Caveman 输出压缩集成：1) 安装 CodeGraph 知识图谱(colbymchenry/codegraph, MIT, 47K★)，索引 145 文件/1701 节点/5230 边，新建 src/tools/codegraph.mjs 注册为 hand 器官工具(支持 explore/query/node/callers/callees 五种模式);2) mouth 器官注入 Caveman 输出压缩(借鉴 88K★ 开源项目)，新增 setStyle/getStyle 方法，支持 normal/lite/full/ultra 四级风格，通过 omnisense-link route mouth.setStyle 调用;3) 创建两个实用 WorkBuddy Skills(codegraph-mcp-setup + agi-memory-architecture)供后续直接加载;4) 更新 .gitignore 排除 .codegraph/ 索引目录;5) 修复 skillResolve 测试因 getStyle 新增使匹配偏移;6) 两套测试全绿(核心 195 + 工作区 254)。

## v2.0.0 — 2026-07-13 (major)

- 能力发现闭环：新增 skillResolve/skillDispatch 基于 Agent Card 关键词匹配自动委派到最佳器官/方法（CLI dispatch / 桥接 dispatchSkill / 工作区 omnisense-link dispatch）。借鉴 IETF AgentCard + ARD intent→tool 匹配 + AutoGen MCP Skill Registry + CrewAI 能力路由思想。两套测试全绿：核心 195/195、工作区 254/254。

## v1.6.0 — 2026-07-13 (minor)

- 能力自描述与跨层委派迭代：1) OmniSense 内核 body.describe() 升级为 A2A Agent Card 风格结构化能力卡(METHOD_META/NET_HAND 模块化，新增 agentCard() 扁平技能卡，含 net 联网诚实标注);2) 工作区侧 omnisense-link.mjs 新增 describe(七器官树)/card(A2A 技能卡)/route<organ.method>(按技能 id 委派到任意器官);3) 跨层测试补 describe/route 用例(11 断言全绿，解决 undici keep-alive 致 node --test 挂起与 node:test 提前 finalize 的取舍);4) 修复工作区子包 8 个预存测试路径问题(基于 import.meta.url 子包根，不再依赖 cwd)，整套件 252/252 通过;5) 两套测试全绿(核心 185 + 工作区 252)。借鉴 Google A2A Protocol 的 AgentCard 思想(仅结构与字段语义，未引入传输/协议依赖)。

## v1.5.0 — 2026-07-13 (minor)

- A2A 风格 Agent Card 能力自描述（body.agentCard()/CLI card/桥接 omni-body.mjs card）+ 工作区 omnisense-link 增强 describe(器官树)/card(扁平技能卡)/route(按 organ.method 委派)；借鉴 Google A2A Protocol 的 AgentCard 思想（仅取结构语义 id/name/description/tags/examples，未引入其传输/协议依赖），额外加 net 字段诚实标注联网依赖。两套测试全绿：OmniSense 185/185、子包 252/252。

## v1.4.0 — 2026-07-13 (minor)

- 跨层迭代：新增 openclaw-workspace/scripts/omnisense-link.mjs（工作区驱动 OmniSense 七器官/目标的一体化入口）+ 跨层测试 tests/omnisense-link.test.mjs（离线，after 兜底退出避免 undici keep-alive 挂起）；工作区 README 增补联动说明；.gitignore 忽略 .workbuddy/ 本地记忆。落实用户要求：合并后的新项目两轮同迭代、不再只动内核。

## v1.3.0 — 2026-07-13 (minor)

- 新增 Agent 执行轨迹追踪层(src/core/tracer.mjs)：agent/multiagent/live 运行自动落盘可回放 trace，对齐 OpenTelemetry GenAI 语义约定(gen_ai.*)；CLI trace 命令(聚合/列表/回放/清空)；serve 新增 GET /traces 与 /trace-summary 路由；brain.act 修正为传递父级 OmniSense 实例以接入 tracer

## v1.2.0 — 2026-07-13 (minor)

- 版本心跳机制收口：package.json 增加 release 脚本 + files 纳入 VERSION/CHANGELOG/versions.json/scripts；README/SKILL 增补『版本与回退』章节；版本逻辑单测已落地(test/version.test.mjs)。
- 注：本次 `auto` 判定为 minor——按本机时钟距基线 v1.0.0 仅约 6 分钟，未满 3h，故不升 major（major 将在距基线满 3h 后的首次心跳触发）。

## v1.1.0 — 2026-07-13 (minor)

- 新增版本逻辑单元测试(test/version.test.mjs)：parseVersion/nextVersionOf/decideAuto/latestMajorTime；保证心跳版本判定可测。

## v1.0.0 — 2026-07-13 (baseline)

- 建立版本心跳机制：scripts/release.mjs(发布/回退) + VERSION + CHANGELOG.md + versions.json；引入 hourly minor / 3h major 自动判定。
