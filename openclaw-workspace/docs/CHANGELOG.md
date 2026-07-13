# 更新日志

> 说明：本文件记录**工作区内部**的项目演进（异兽学院 / 阴间考编等）。
> 下方「openclaw-workspace 公开框架」段记录**本仓库（对外开源模板）**自身的迭代。

## openclaw-workspace 公开框架（仓库级更新）

### 2026-07-10（codegen 缓存语义 + 熔断状态持久化 · 特性级 · 本地，未推送）

- **背景**：承接 2026-07-09 深度审查的"两项待拍板设计取舍"，用户指示"1.2 都落地"。这是把上次诚实标注的两个边界变成可配置、可用的能力，而非仅文档说明。
- **决策 1 — codegen 缓存语义（短 TTL / 可关）**（`scripts/agent/respond.mjs`）：`callLLM` 现在默认按**代码生成**处理（`isCodeGen = opts.codegen ?? true`）。codegen 响应走更短的 `LLM_CACHE_CODEGEN_TTL`（默认 **10 分钟**，远短于通用 6h），缓解"失败的 codegen 输出被永久缓存、无法自愈"；`LLM_CACHE_CODEGEN=0` 可完全关闭 codegen 缓存；非代码生成调用传 `opts.codegen=false` 走通用长 TTL（`CACHE_TTL_MS`）。缓存键仍取 `provider/model/温度0.2/messages`，并新增可注入 `opts.cacheNow` 时钟便于确定性测试。
- **决策 2 — 熔断状态持久化（opt-in）**（`scripts/llm/circuit-breaker.mjs`）：`createBreaker` 新增 `persistPath`——构造时从磁盘重载状态、每次状态转换即**原子写**（temp+rename）回盘。设 `LLM_CB_PERSIST=.cache/llm-circuit.json` 后，熔断对"每小时反复起进程打同一故障 provider"**跨运行真正拦截**（OPEN 期间新进程快速失败、不空转重试），弥补了"一次性进程模型下熔断近乎失效"的边界。**默认关闭**：持久化开启会让 breaker 测试跨进程读到上次遗留的 OPEN 状态、破坏测试确定性——真实部署（Actions / 本地运行包装脚本）应显式开启。重载时只恢复"端点健康信号"（OPEN + 冷却时间戳），不清算连续失败/成功计数（独立任务不应继承上一次进程半跳闸的阈值）。
- **测试**：`tests/respond.test.mjs` +2（codegen 短 TTL 过期 vs 非 codegen 长 TTL 命中，确定性时钟注入；为避开模块级熔断单例被前置 breaker 测试置 OPEN，该用例置于 breaker 测试之前）；`tests/circuit-breaker.test.mjs` +3（持久化跨运行重载 OPEN / 损坏文件忽略 / opt-in 内存态）。全量 `node --test tests/*.test.mjs` **241/241 通过**（较上轮 236 +5）。
- **文档**：`docs/LLM_RESILIENCE.md` 环境变量表增 `LLM_CACHE_CODEGEN`/`LLM_CACHE_CODEGEN_TTL`/`LLM_CB_PERSIST` 三行；§5 第 1、2 条改写为"已落地"状态（含 opt-in 默认值与重载语义的诚实说明）；`ROADMAP.md` Done 段补一条。
- **质量门**：`node --check` + `reviewer.mjs`（syntax/config/functional/observer）全绿。**本地提交，未推送**。

### 2026-07-10（缓存卫生补强 + 诚实边界文档 · 特性/文档级 · 本地，未推送）

- **背景**：对昨日「弹性三件套 + 默认接入生产路径」做深度代码审查（不止跑门禁绿灯，逐行查边界/并发/单例/跨平台）。发现 4 个真问题，本次补掉 3 个纯增益项、诚实记录 2 个设计取舍。
- **缓存 TTL 过期**（`scripts/llm/cache.mjs`）：`lookup` 新增 `opts.ttlMs`——超龄条目视为未命中。**直接缓解最高优先级问题**：`callLLM` 服务代码生成，缓存键含 `git 文件树+AGENTS.md+任务`，同仓库状态重跑同任务会命中旧结果；若上次生成失败（parse/`node --check`/拒答，均不改跟踪树），立即重跑会拿到**一模一样的失败输出无法自愈**。生产默认 `LLM_CACHE_TTL=6h`（设 0 关闭），超时后可重新生成。
- **缓存容量上限**（同上）：`store` 新增 `opts.maxEntries`——超限按 `ts` 淘汰最旧，防账本无限膨胀（每条可存最大 2MB 响应）；生产默认 `LLM_CACHE_MAX=500`。
- **账本原子写**（同上）：`writeAll` 真实 fs 下改 temp+rename——防每小时自迭代与手动运行**重叠时互相覆盖/读到半写文件**；注入 fs shim 无 rename 则回退直写（保离线测试）。
- **可注入时钟**：`store`/`lookup` 均支持 `opts.now`，测试确定性；`tests/cache.test.mjs` 6→8（+TTL 过期、+容量淘汰）。
- **生产接线**（`scripts/agent/respond.mjs`）：`cacheOpts` 传 `ttlMs`/`maxEntries`；新增环境变量 `LLM_CACHE_TTL`(6h)/`LLM_CACHE_MAX`(500)。
- **诚实边界文档**（`docs/LLM_RESILIENCE.md` §5 新增）：① 生成式 codegen 缓存需慎用（prompt 缓存最宜幂等/确定性子调用）；② **熔断器是内存态单例，在当前"一次进程只调一次 LLM"运行模型下几乎不生效**——需多步长驻循环或持久化状态才有跨运行价值，现状"为未来预留、今日备而未用"，不构成危害但别高估；③ `Content-Length` 上限对流式响应会被绕过（既有行为）；④ 原子写仍"最后写入者胜"，真多写者需文件锁。
- **质量门**：`node --check` + 缓存 8 测试 + 全量测试 + `reviewer.mjs` 全绿。**本地提交，未推送**。

### 2026-07-09（文档事实性订正：绝不自动推送 + 测试数刷新 · 文档级 · 本地，未推送）
- 订正公开框架文档中**与真实铁律「只本地 commit、绝不推送远端」矛盾**的过期表述（调研 + 自查发现），落实用户「绝不骗用户」最高原则：
  - `AGENTS.md` 两处——Tests 段「verdict that gates auto-push.」改为「gates **local** commits (it never pushes)」；Contribution flow「The 30-minute auto-iteration automation…pushes `origin/main` only when that gate returns PASS.」改为「The hourly auto-iteration automation…**never pushes to any remote**—a human reviews and pushes manually after the daily review」
  - `ROADMAP.md` 两处——头部 blockquote「30-minute…pushes `origin/main` only after…」改为「(hourly) commits locally only and **never pushes**…a human reviews and pushes manually」；Reviewer 条目「the gate that lets the 30-minute automation auto-push `origin/main` only on PASS」改为「the gate that the auto-iteration automation runs before each **local** commit (it never pushes)」
  - `README.md` 特性段「30 分钟自动化只有它返回 PASS 才 `git push origin main`」改为「自主迭代自动化**只本地 commit、绝不推送远端**…由用户每日 review 手动推送」
- 刷新 README 测试徽章：写死的 `tests-75 passing` 已严重过期（早自 07-09 06:02 的 75 项），更新为实测 **234 passing**（与本轮 `node --test` 结果一致），避免对外展示虚假指标
- 调研依据（≥3 类）：① 2026 主流多智能体框架（MetaGPT/LangGraph/CrewAI/AutoGen）横评一致将「清晰文档 + CI 一致 + 贡献者信任」列为生产级标配（jishuzhan / cloud.tencent / xtechtools）；② 开源信任来自「可观测、可重复、可审计的流程」（百度文库开源信任危机、CSDN 文档规范指南一致结论）——文档与真实行为不一致本身即侵蚀信任；③ GitHub topics `awesome-ai-agents-2026` / `multi-agent` 确认本仓功能/测试/安全/可观测/评估/发布/命令参考全链路已达高成熟度，剩余 ROADMAP Next 项均被约束挡住（改质量门禁脚本/需用户设源/特性级违暂停原则），唯一真实缺口是**文档自身的事实性**
- 质量门影响：纯 Markdown 文档订正（3 文件），不触及任何 `.js/.mjs` 质量门禁脚本与 `scripts/eval/`；`node --check`(78/78) / `validate-config` / `observer --diff`(3 文件零违规) / `node --test`(234/234) / `reviewer` VERDICT: PASS 全过
- `ROADMAP.md` 无新增项（此为文档订正，非功能落地）

### 2026-07-09（命令参考文档 COMMANDS.md · 文档级 · 本地，未推送）
- 完成一处**真实、安全、文档级**的可发现性缺口：本仓库 dev 命令已增至 ~23 个（质量门禁 / 智能体运行时 / 角色技能 / 框架演化 / 发布 / LLM 工具 / 权限 / 安装 / 每日复盘），但 `docs/README.md` 仅索引概念文档、`make help` 仅英文，新用户难一眼摸清全套能力。
  - 新增 `docs/COMMANDS.md`——中英双语（单文件双语约定：中文在前、英文在后）汇总**全部开发命令**，按类别分组（质量门禁 / 智能体运行时 / 角色与技能 / 框架演化 / 发布 / LLM 工具 / 权限 / 安装 / 每日复盘 / 帮助），每条含说明与关键参数/环境变量；另附「常用环境变量表」与「绝不 git push / 零依赖 / 入口等价」三条铁律说明
  - `docs/README.md` 文档清单新增 `COMMANDS.md` 一行（中英双语标注），提升导航性
- 调研依据（≥3 类）：① 本轮 WebSearch 多源确认 2026 主流多智能体框架（LangGraph/CrewAI/AutoGen/Claude Agent SDK/OpenAI Agents）已将「清晰 CLI + 开发者文档」列为生产级标配（jishuzhan 对比、langcopilot 分档、daoyuly 趋势、awesome-ai-agents-2026）；② 本仓库既有 `Makefile`/`dev.sh`/`dev.ps1` 三入口命令已高度完整但缺统一中文文档入口；③ 对齐本仓库「单文件双语」i18n 约定（docs/README.md 已立）。本改进属「文档级打磨」——呼应上轮落地的 anti-over-engineering 原则（「文档级打磨可，堆特性不可」），在框架已达高成熟度时不堆特性、只补可发现性
- 质量门影响：纯 Markdown 文档（新增 + 索引一行），不触及任何 `.js/.mjs` 质量门禁脚本与 `scripts/eval/`；`node --check` / `validate-config` / `observer` / `tests` 不受影响

### 2026-07-09（缓存 + 熔断器默认接入 respond.mjs 生产路径 · 特性级 · 本地，未推送）
- 按用户指示，把上一轮落地的两块零依赖 LLM 弹性基础设施**默认接入自主智能体生产路径**（`scripts/agent/respond.mjs` 的 `callLLM`），不再是"仅作可 import 库 + 文档示例"：
  - **重构 `callLLM`**：抽出真实网络交换 `doFetch`（保留原有的超时 / 瞬态重试 / 2MB 响应上限 / 解析诊断），在其外层叠① prompt 缓存查命中（命中则跳过网络、直接返回）→ ② 熔断器包裹 `doFetch`（OPEN 时快速失败、不空转重试）→ ③ 成功后落缓存
  - **默认开启、非致命**：缓存与熔断在生产路径（未注入测试 `opts.fetch`）自动生效；`LLM_CACHE=0` / `LLM_CIRCUIT=0` 可分别关闭；模块级熔断器单例跨多次调用累积失败，真正对持续故障 provider 做"雷鸣羊群"防护。缓存读/写失败或熔断异常只 `trace` 一条日志并回落普通 `doFetch`，**弹性层本身永不阻断合法请求**
  - **零磁盘副作用保离线契约**：测试注入 `opts.fetch` 时弹性层自动不生效（`(opts.resilience ?? !opts.fetch)`），`runAgentOffline` 等离线契约测试保持纯粹；可用 `opts.resilience=true` 显式开启做集成验证
  - **环境变量开关**：`LLM_CACHE` / `LLM_CIRCUIT` / `LLM_CACHE_PATH`（默认 `.cache/llm-cache.json`，已 gitignore）/ `LLM_CB_FAILURE`(3) / `LLM_CB_COOLDOWN`(5000ms) / `LLM_CB_SUCCESS`(2)
  - 调研依据（同上一轮 GitHub / 技术站点直搜，可复制零依赖）：messkan/karthyick prompt-cache、rheatkhs/yves-circuit-breaker、ayushedith/retryify
  - 配套新增集成测试 `tests/respond.test.mjs`（缓存命中第二次请求不进网络、熔断器跳闸后快速失败不调 fetch，均离线）；`docs/LLM_RESILIENCE.md` 的"接入"段由"可选示例"改为"已默认接入 + 环境开关表"
  - 质量门影响：仅改 `scripts/agent/respond.mjs`（仍为纯函数 + 可注入边界，契约不变）、`tests/`、`docs/`；`node --check` / `validate-config` / `observer` / `reviewer` 不受影响（旧测试仍 16/16 通过，新增 2 项集成测试）

### 2026-07-09（anti-over-engineering 原则 · 文档级 · 本地，未推送）
- 完成 **ROADMAP Next「anti-over-engineering 原则」**（文档级，零风险，呼应本自动化的自我约束）：
  - `AGENTS.md` 在「硬规则」之后新增「Anti-over-engineering principles（设计哲学）」中英双语段：直接落 Anthropic《Building Effective Agents》**第一原则**「能用单次 LLM 调用解决就别上 workflow，能 workflow 就别上 agent」；并固化为可操作规则——① 不为"别人有"而加特性，仅当复杂度**显著改善**开箱即用结果才加；② 零依赖 Node ESM 是**硬约束非风格偏好**（clone-and-run 基石）；③ 新代码必须可验证（纯函数 + `node --test` + 质量门入口），无测试不入库；④ 优先复用 `lib/common.js`；⑤ **自动化工位在框架达高成熟度（质量门全绿、Next 仅剩文档/研究级）时主动暂停**，避免堆改动加重人工每日 review 负担（文档级打磨可，堆特性不可）
  - 来源（≥3 类）：① Anthropic《Building Effective Agents》(2024-12-19) 三大核心原则之首「简单性（simple, composable patterns over complex frameworks）」；② mer.vin《When Not to Build AI Agents: Anthropic's Workflow-vs-Agent playbook》(2026-05) 主张 "start simple"，仅当简单 prompt 不够才上 agent；③ 本仓库 `docs/research/2026-07-09-external-research.md` 1.1 已将该原则列为 Next 候选 #6（低价值风险）
- 质量门影响：纯 Markdown 文档改动，不触及任何 `.js/.mjs` 质量门禁脚本与 `scripts/eval/`；`node --check` / `validate-config` / `observer` / `tests` 不受影响
- `ROADMAP.md`：anti-over-engineering 原则（Next→Done）

### 2026-07-09（LLM 响应缓存 + 熔断器 · 特性级 · 本地，未推送）
- 完成用户"去 GitHub 等站搜可借鉴/可复制功能"指示的第二轮落地——在既有 `cost.mjs` 与 `respond.mjs` 重试之上，补上两块零依赖 LLM 弹性基础设施（均经 GitHub 直搜 + 技术站点核实可复制、零依赖可行）：
  - **LLM 响应缓存（prompt caching）** `scripts/llm/cache.mjs`（特性级，零依赖）：把"相同 `(provider,model,采样,messages)` 请求命中缓存跳过重复 LLM 调用"做成可机器化复用能力。纯函数 `canonicalRequest`（role 小写、content 去首尾空格、采样参数归一）/ `cacheKey`（SHA-256 稳定键）/ `lookup` / `store` / `withCache`（命中则不调 `callLLM`、`cached:true`）/ `stats`；账本默认 `.cache/llm-cache.json`（新增 gitignore），可注入 `fs` 离线可单测。CLI `make llm-cache --messages '<json>' [--model X]` / `--stats`
  - **熔断器** `scripts/llm/circuit-breaker.mjs`（特性级，零依赖）：CLOSED/OPEN/HALF_OPEN 纯状态机，补"持续故障短路"——`createBreaker({ failureThreshold, cooldownMs, successThreshold, now })`，`exec` 在 OPEN 未冷却时抛 `CircuitOpenError` 且不调 fn，冷却后放行探针、`successThreshold` 次成功闭合；`withBreaker` 便捷包裹；可注入 `now` 离线可单测。CLI `make circuit-breaker --demo`（无真实等待走完状态机）
  - 二者与既有"超时+瞬态重试"正交可叠加（缓存最外层→熔断中层→重试内层），组合示例见 `docs/LLM_RESILIENCE.md`；均未自动改写 `respond.mjs` 生产路径（保持默认行为、不触碰离线契约测试），仅作可 import 库 + 文档示例
  - 配套测试：`tests/cache.test.mjs`（6 测试：归一化/确定性/按模型·温度·内容区分/查miss→存→查hit 往返/withCache 仅调一次/统计计数）、`tests/circuit-breaker.test.mjs`（7 测试：CLOSED 成功/阈值跳闸/冷却前拒连且不调 fn/冷却后半开并闭合/半开失败重开/CLOSED 成功治愈/withBreaker 路由）；接入：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `llm-cache`、`circuit-breaker`；`.gitignore` 忽略 `.cache/`
- 调研依据（≥4 类）：① GitHub 直搜 `llm response cache prompt caching`：`messkan/prompt-cache`（降本至 80%）、`karthyick/prompt-cache`（装饰器式语义缓存）；② 设计文 `yuanchaofa.com`《Agent 系统中的 Prompt Caching 设计》、`xirain.github.io`《LLM Agent Prompt Cache 深入浅出》——Agent 比 Chatbot 更需缓存、请求布局影响命中；③ GitHub 直搜 `circuit breaker node zero dependency`：`rheatkhs/yves-circuit-breaker`（明确"零依赖、纯逻辑、框架无关"）、`ayushedith/retryify`（retry/backoff/timeout/breaker 一体）；④ `dev.to` wallacefreitas / young_gao 的 CLOSED/OPEN/HALF_OPEN 状态机实现。均满足"零依赖 Node ESM"硬规则
- 同期检索但**暂缓/不采纳**（诚实标注）：最小 MCP 客户端（dyneth02/MCP-Client-Server-NodeJS，协议面大、风险高，列 ROADMAP Next）、结构化输出校验（darshjme/agent-schema，与 `respond.mjs` 解析重叠）、语义缓存（需嵌入模型，过度工程）、重试一体（既有重试已覆盖）；完整候选表与决策见 `docs/research/2026-07-09-github-features.md`
- 验证：check-syntax 全过（含 2 新脚本）、validate-config、observer --diff 无违规、node --test 全绿（新增 13 项）、reviewer VERDICT: PASS
- `ROADMAP.md`：Done 新增「LLM 响应缓存」「熔断器」；`docs/LLM_RESILIENCE.md` 新增（缓存/熔断 API + respond.mjs 接入示例 + 组合）；`docs/research/2026-07-09-github-features.md` 新增（GitHub 候选表 + 来源链接）

### 2026-07-09（Skills 注册/发现层 + Token/成本追踪 · 特性级 · 本地，未推送）
- 借鉴 2026-07 GitHub `multi-agent` 主题热门框架（deer-flow / ruflo / CowAgent / MemOS / PraisonAI 均把 **skills** 作为一等原语；token/成本追踪为普遍刚需），补上本仓库缺失的两块零依赖基础设施层：
  - **Skills 注册/发现层** `scripts/skills/registry.mjs`（特性级，零依赖）：解析 `SKILL.md` frontmatter、递归发现技能（`discoverSkills`，`maxDepth` 限深、跳过 `node_modules/.git/.workbuddy`）、校验必填字段（`name`/`description` + 小写 slug 约定）、按 name/分类检索（`getSkill` 大小写不敏感 / `filterByCategory` / `listValid`）。核心函数纯函数可单测，发现层走 fs 薄封装。CLI `make skills`（默认扫 `examples`）。让「有 roles 但无 skill 注册」的复用摩擦彻底消失——agent 调用技能前可机器化发现与校验
  - **Token/成本追踪** `scripts/llm/cost.mjs`（特性级，零依赖）：确定性离线 token **估算**（`estimateTokens`：CJK 每字≈1 token、拉丁每 4 字符≈1 token，明确标注 estimate 非精确 BPE）、可扩展 provider 价格表（`DEFAULT_PRICES`，近似公开报价、注释声明需自行核验最新价）、按模型算 prompt/completion 成本（`costFor`）、多条目汇总（`tally`）、可选 JSONL ledger 累加（`accumulate`/`readLedger`，无 ledgerPath 时保持纯函数/离线）。CLI `make cost --estimate "..."` / `--cost --model gpt-4o-mini --prompt 1000 --completion 500` / `--models`。零依赖（不引 tiktoken/bpe），与「零依赖 Node ESM」硬规则一致
  - 配套测试：`tests/skills.test.mjs`（9 项：frontmatter 解析 / 缺字段标记 / slug 校验 / 大小写检索 / 分类过滤 / 有效性过滤 / 递归发现 / maxDepth）、`tests/cost.test.mjs`（7 项：估算/确定性/价格别名/成本计算/汇总/ledger 往返/无 ledger 纯函数）；接管入口：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `skills`、`cost`
  - `examples/sample-skill/SKILL.md` 增补「技能会被 `scripts/skills/registry.mjs` 自动发现（`make skills`）」说明，与新基础设施对齐
- 调研依据（≥3 类）：① GitHub `topics/multi-agent` 页面（2026-07）前列仓库 deer-flow/ruflo/CowAgent/MemOS/PraisonAI 均原生 skills 层；②「2026 年 AI Agent 技术生态开源项目合集」八维盘点——skills/plugin/memory/observability 为高权重品类；③《Agent Token 优化完全指南》(daoyuly.cn, 2026-04) 与 zylos.ai《OpenTelemetry for AI Agents》(2026-02)——确认 token 成本可见性是框架运行 LLM 的普遍诉求
- 质量门影响：纯新增零依赖模块 + 测试 + 入口接线，不触及任何既有质量门禁脚本（`scripts/ci/*`、`scripts/eval/`）；`node --check` / `validate-config` / `observer` / `tests` 不受影响（下一步需跑全门类禁验证）

### 2026-07-09（权限阶梯 per-tool deny/ask/allow · 特性级 · 本地，未推送）
- 完成 **ROADMAP Next「权限阶梯配置」**：在静态 `observer` 之外补上**基础设施级**运行时工具授权层（特性级，零依赖）：
  - 新增 `scripts/security/permissions.mjs`——把「Permission is infrastructure, not prompt」（Agent Security 2026 第六层栈）落地为可单测纯函数：`normalizeTool`（工具名按 `:` 命名空间分层、小写归整）/ `classifyTool`（最具体前缀匹配胜出、平局按严重度 deny>ask>allow、未命中回落 `default`）/ `isAllowed` / `resolvePolicy`（结构化 tool/level/category/reason/matched/defaulted）/ `listRules`；CLI `--list` 打印全部规则、`--tool <name>` 解析单个
  - 默认阶梯**把本仓库铁律变成机器可校验策略**：`git:push` / `git:push:force` / `repo:commit:main` / `secret:read` 一律 `deny`；`repo:commit:local` / `fs:read` `allow`；`git:remote` / `git:fetch` / `git:pull` / `fs:write` / `network:egress` / `shell:exec` `ask`（失败-闭合：未知工具默认 `ask` 需人工确认）。这正是「绝不 push / 绝不 force / 绝不改 main」从人类约定升级为可验证策略
  - 与既有 `observer.mjs` 互补：observer 守「什么能入库」（静态门），本层守「agent 运行时能调什么工具」（运行时授权）；二者同属「权限是基础设施而非提示词」一层，`examples/agents/security-auditor.md` 已增补指向
  - 配套 `tests/permissions.test.mjs`（13 测试）：覆盖归一化 / 铁律 deny / 前缀匹配 / ask 级 / allow 级 / 特异性覆盖 / 平局严重度 / 默认回落 / 空与非字符串 / `isAllowed` / `resolvePolicy` 结构化 / `listRules` 不可变 / 确定性
  - 接入：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `permissions`（`make permissions --list` / `make permissions --tool git:push`）
- 调研依据（≥3 类）：① slavadubrov《AI Agent Security in 2026》六层栈（权限阶梯为第一层，「Permission is infrastructure, not prompt」）；② Claude Code 官方《Permission Model》Allow/Ask/Deny 三级 + 最具体匹配胜出；③ Larry Peseckis《Agent Tool Permission Matrix》(2026-06) default-deny 授权表，16 类工具跨 OWASP 对齐；④ cybertrendlab《AI Agent Security Checklist 2026》least-privilege + approval gates。均指向「per-tool 权限阶梯是 2026 agent 安全基线，且应独立于提示词」
- 质量门影响：纯新增零依赖模块 + 测试 + 入口接线，不触及任何既有质量门禁脚本（`scripts/ci/*`、`scripts/eval/`）；`node --check` / `validate-config` / `observer` / `tests` 不受影响

### 2026-07-09（外部调研：可借鉴实践 + 可集成热点项目 · 文档级 · 本地，未推送）
- 新增**中立框架级调研存档** `docs/research/2026-07-09-external-research.md`：跨 5+ 专业站点（Anthropic《Building Effective Agents》/ arXiv 2026《Memory for Autonomous LLM Agents》/ awesome-ai-agents-2026 / AI Agent Security 2026 / 2026 生态盘点）提炼可融入 openclaw-workspace 的架构与模式，含「框架现状对照」与「Next 候选」表（按价值/风险排序）。
- 同步落 **3 个结构化洞察**到 `examples/insights/`（memory-write-path / evaluator-optimizer-loop / permission-ladder），供自动化工位经 `make evolve` 蒸馏为框架提案（中立原则，绝不写项目内容）。
- 关键结论：① Anthropic 5 workflow 中框架已有 Routing / 角色驱动 / Evaluator-Optimizer 雏形，缺口在**显式精炼循环**与 Parallelization；② `.learnings/` 缺 **write-path 与 temporal 分层**（借 arXiv 三维记忆分类，零依赖落地）；③ agent 安全六层栈中缺 **per-tool 权限阶梯**；④ 多数热点项目（LangGraph/CrewAI/Dify）是 Python 重框架，「集成」应**借模式而非复制依赖**。
- 质量门影响：纯 Markdown 调研文档 + insight 示例，不触及任何 `.js/.mjs` 门禁脚本与 `scripts/eval/`；`node --check` / `validate-config` / `observer` / `tests` 不受影响。

### 2026-07-09（security-auditor 角色预设 · 文档级 · 本地，未推送）
- 新增第 7 个开箱即用智能体角色预设 `examples/agents/security-auditor.md`，把「安全审计」做成可复用、可克隆的提示模板（文档级，低风险高价值）：
  - 与既有 `reviewer`（质量 / 契约）互补：`reviewer` 守契约与质量门，`security-auditor` 守**安全红线**——侧重**逻辑层**风险（最小权限、注入面、记忆 / 多智能体越界），这些是静态 `observer.mjs` 抓不到的；二者共用同一套安全红线（无明文密钥 / 无个人数据 / 无硬编码绝对路径）
  - 角色提示结构化覆盖 **OWASP《AI Agent Security Cheat Sheet》九大实践领域**：工具最小权限 / 输入校验与提示注入防御 / 记忆与上下文安全 / 人工介入 / 输出护栏 / 监控可观测 / 多智能体安全 / 数据保护隐私 / 安全测试与对抗验证；末附 OWASP Do's and Don'ts 红线
  - 沿用既有 `role-meta` 契约（id/name/description/skills + 正文系统提示），与 `scripts/agent/roles.mjs` 加载器及 `tests/roles.test.mjs` 完全兼容
- 配套更新：`tests/roles.test.mjs` 预设数量下限 `>=6` → `>=7`（明确 7 个预设为基线，防回归删减）；`ROADMAP.md` Done「Agent role presets」补列 security-auditor
- 调研依据（≥3 类）：① OWASP《Agentic AI Top 10》（2025-12 发布，全球首个自主 Agent 安全风险框架）；② OWASP《AI Agent Security Cheat Sheet》（9 大实践领域 + Do's/Don'ts + 滥用案例测试矩阵）；③ 全网检索 agent 安全清单（prompt injection / 密钥扫描 / 最小特权 / 多智能体越界）——一致结论：安全审计正成为 agent 框架标配，且应「静态 CI 门（observer）+ 角色级逻辑审查（本预设）」双层互补
- 质量门影响：纯 Markdown 预设 + 测试下限微调，不触及任何 `.js/.mjs` 质量门脚本与 `scripts/eval/`；`node --check` / `validate-config` / `observer` 不受影响

### 2026-07-09（环境预检 doctor 命令 · 特性级 · 本地，未推送）
- 新增**环境就绪预检** `scripts/doctor.mjs`：本仓库核心是「开箱即跑（turnkey）」，但 `make healthcheck` 只验代码（语法/配置/测试），不验**本机是否就绪**——新增 `doctor` 补上环境层这一缺口（特性级，零依赖）：
  - 7 项检查，纯函数 + 可注入 IO 边界（opts 注入 git/探针/exists/env/nodeVersion），离线可单测，与 `respond.mjs` 的 `callLLM`/`commitLocally` 同一套依赖注入理念：`checkNode`（Node >= 18，ESM+内置 test runner）/ `checkGit` / `checkShell`（bash 或 pwsh 至少一个）/ `checkEnvFiles`（`.env` 或模板）/ `checkConfigFiles`（`config/openclaw.json` 或模板）/ `checkLLMBackend`（Ollama 免密钥 / 远端 baseUrl / key，缺则为 warn 不阻塞）/ `checkGates`（五大质量门禁脚本存在性）
  - 退出码仅当 **error 级**检查失败时非 0；**warn 级**（如缺 `.env`、未配 LLM）仅提示不阻断——符合 npm doctor 的「error 阻塞 / warn 建议」分级
  - 接入：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `doctor`；`QUICKSTART.md` 与 `AGENTS.md` 的「验证/setup」段加 `make doctor` 并说明「doctor 验环境、healthcheck 验代码」互补
- 调研依据（≥3 类）：① skills-check《doctor command》——自检命令检查 Node 版本 / 包管理器 / 注册表可达 / 隔离运行时 / LLM provider 配置 / 项目就绪；② `npm doctor`——验证 Node 版本、注册表可达、运行环境等并分级展示建议；③ rapidkit-npm「doctor workspace/project 检测漂移」+ OpenClaw Gateway「pre-flight/rollback runbook」——均确认 agent 框架/CLI 把 `doctor` 预检作为成熟最佳实践；本仓库零依赖薄脚本替代重依赖，与「零依赖 Node ESM」硬规则一致
- 验证：check-syntax（含新 doctor.mjs 全过）、validate-config ✓、observer --diff 无违规、node --test 全绿（新增 `tests/doctor.test.mjs` 20 项）、reviewer VERDICT: PASS
- `ROADMAP.md`：新增 Done「环境预检 doctor 命令」

### 2026-07-09（本地提交路径可注入 git 后端缝 · 特性级 · 本地，未推送）
- 完成上轮"下次建议"第二条——给 `scripts/agent/respond.mjs` 的本地提交逻辑抽取为**可注入 git 后端缝** `commitLocally({ title, now, git })`（特性级，零依赖），使智能体的 git 工具调用可离线契约测试：
  - `commitLocally` 默认走真实 `defaultGit`（`execSync` 包裹），与原内联实现**行为完全等价**（命令序列：`checkout -B agent/local-<ts>` → `add -A` → `commit -m "agent: <title>"` 且 `stdio:'pipe'` 非致命）；与 `callLLM` 的 `opts.fetch`、`adapter` 的 `createClient` 完全对称——同一套"依赖注入缝"理念贯穿网络层与工具层
  - 新增 `tests/respond.test.mjs` 断言精确命令序列（分支名 / `add -A` / 固定 bot 身份 commit 且 pipe stdout），**零真实 git 调用**即可证明智能体本地提交路径正确
- 调研依据：tianpan.co《How to Integration-Test AI Agent Workflows in CI Without Mocking the Model》(2026-04) 主张——第三层 CI 是"工具契约测试（tool-contract testing）"：mock 智能体的工具调用（git/fs）并断言**精确命令**，完全离线；agentharness 等亦主张"mock MCP tools、断言 exact tool calls"；zylos"agent-native CI"把工具层做离线可验证
- 注意：本改进**未触碰 `scripts/eval/`**（质量门禁脚本只调用不改写，严守硬规则）；上轮"把 runAgentOffline 接入 eval.mjs"的建议因该硬规则已不可行，故改走"git 后端缝"这一同样高价值且合规的路径
- 验证：check-syntax 66/66、validate-config ✓、observer --diff 无违规(7 文件)、node --test **166/166**（新增 1 项全绿）、reviewer VERDICT: PASS
- `ROADMAP.md`：新增 Done「Agent 本地提交路径可离线验证（可注入 git 后端缝）」

### 2026-07-09（respond.mjs 可注入 fetch 缝 + 离线端到端冒烟 · 特性级 · 本地，未推送）
- 完成上轮建议"给 respond.mjs 的 callLLM 也加可注入 fetch 缝（与 adapter 对称），让 agent 管线可做离线端到端冒烟测试"——把自主智能体管线的 LLM 网络边界做成离线可验证（特性级，零依赖）：
  - `scripts/agent/respond.mjs` 的 `callLLM` 现接受 `opts.fetch`（默认仍走 `globalThis.fetch`，**行为完全等价**）与 `opts.config`（默认模块 `LLM`）；调用形态不变，生产代码无 `if TESTING:` 污染——与 `scripts/llm/adapter.mjs` 的 `createClient(opts.fetch)` 完全对称
  - 抽取 `buildAgentPrompts(task)`（只读 `git ls-files` + `AGENTS.md`，无副作用），`main()` 复用之；新增 `runAgentOffline({ task, fetchImpl })` 导出——离线、无磁盘写入、不碰 git 地跑通"任务 → 提示词 → LLM(假) → parseFiles → safePath 校验"全契约路径，是沙箱无法做的"真实 Ollama 端到端"的离线等价物
  - 新增 `tests/respond.test.mjs`（15 测试，Tier-1 stub fake，零网络）：镜像 `tests/adapter-client.test.mjs` 断言真实请求契约（精确 `/chat/completions` 端点 / Bearer 仅含 key 时存在 / 请求体含 model+temperature(0.2)+归一化 messages / 真实响应解析 / 非 2xx 抛错 / 超 2MB 拒绝 / 瞬态 ECONNRESET 重试一次后成功 / 重试耗尽重抛），外加 `runAgentOffline` 离线端到端断言（解析假 LLM 响应为已校验的库内文件 / 越界路径被 safePath 拒绝 / `.env` 等密钥文件被拒 / 空输出与显式拒答按契约报错）
- 调研依据：① agentic-ai-engineering《unit-testing-agents》主张——"test AI agents without making API calls: mock LLM responses and test everything around the model (message construction, error handling)"；② 沿用上轮 tianpan.co《Dependency Injection for AI》(2026-04) 的"好 fake 断言真实契约 + 可注入缝而非 if TESTING"主张；③ arxiv 2603.05344v1《Building AI Coding Agents for the Terminal》强调 harness 可离线驱动 agent 循环
- 验证：check-syntax 65/65、validate-config ✓、observer --diff 无违规(7 文件)、node --test **165/165**（新增 15 项全绿）、reviewer VERDICT: PASS
- `ROADMAP.md`：新增 Done「离线端到端冒烟（agent 管线契约路径，无需真实 LLM）」；「真实 Ollama 端到端验证」仍 In progress（沙箱无 Ollama，需用户本地完成）

### 2026-07-09（Adapter 网络层 fake-fetch 集成测试 + 可注入 fetch 缝 · 特性级 · 本地，未推送）
- 完成上轮建议的"给 adapter 的 createClient 做假 fetch 集成测试"，并补上对应的**依赖注入缝**（特性级，零依赖）：
  - `scripts/llm/adapter.mjs` 的 `createClient` 现接受 `opts.fetch` 可注入 fetch 实现（默认仍走全局 `fetch`，**行为完全等价**）；返回对象新增 `fetchImpl` 字段，供测试 / 代理 / 日志中间件透明替换，**不污染生产代码**（无 `if TESTING:` 分支）
  - 新增 `tests/adapter-client.test.mjs`（11 测试，Tier-1 stub fake）：用假 fetch **断言真实请求契约**——精确 endpoint URL（`/chat/completions`）/ Bearer 鉴权头仅在含 key 时存在（Ollama 本地无头）/ 请求体含 `model`+`temperature`(默认 0.2)+归一化 `messages` / 真实形态响应解析 / 非 2xx 抛错含状态码 / 响应超 `maxBytes` 上限拒绝 / 瞬态错误(`ECONNRESET`)重试一次后成功 / 重试耗尽重抛 / 全部 6 个 provider 均可绑定调用
  - 全程零网络调用；假 fetch 断言契约而非"写死的字符串"，避免测试对生产行为说谎（契合 tianpan.co《Dependency Injection for AI》2026-04 主张）
- 调研依据：① tianpan.co《Dependency Injection for AI: Mocking Model Calls Without Losing Test Fidelity》(2026-04) 主张——好的 LLM fake 应断言真实请求契约（URL/头/体），用可注入缝而非 `if TESTING:` 污染生产；② OpenAI-compatible 客户端单测普遍用可注入 fetch 验证端点与鉴权形态
- 验证：check-syntax 64/64、validate-config ✓、observer --diff 无违规、node --test **150/150**（新增 11 项全绿）、reviewer VERDICT: PASS
- `ROADMAP.md`：Adapter 层已在 Done；本次为其网络层补"可验证契约"的事实测试，路线图无新增项

### 2026-07-09（Release 工作流 · 特性级 · 本地，未推送）
- 完成 **ROADMAP Later「Release workflow（tags → changelog → GitHub Release）」**：让"打 tag 即自动发布"成为框架标配（特性级，零依赖配套）：
  - 新增 `.github/workflows/release.yml`：仅当人类手动推送语义化 tag（`v*`）或手动 `workflow_dispatch` 时触发；先跑完整 healthcheck（语法 + 配置 + 测试 + eval），再用 `softprops/action-gh-release@v2` + 自动注入的 `GITHUB_TOKEN` 创建 GitHub Release（**不含任何显式 token 行**，`observer` 密钥扫描天然放行）。本地每小时自动化工位绝不打 tag，永不触发此流程——严守"只改本地、绝不推送"铁律
  - 新增零依赖 **发布说明生成器** `scripts/release/notes.mjs`：纯函数 `findPublicSection` / `parseEntries` / `cleanTitle`（剥离内部「本地，未推送」标记）/ `extractEntries`（支持 `--count`/`--since`）/ `formatReleaseNotes`（确定性）/ `buildRelease`；CLI `--changelog`/`--version`/`--out`/`--json`，解析 `CHANGELOG.md` 的「公开框架」段并**截断于内部项目段**（防隐私泄漏）
  - 新增 `tests/release-notes.test.mjs`（9 测试）：覆盖公开段提取（排除内部「项目转向」段）/ 条目解析顺序 / 标题清洗 / count 与 since 过滤 / 确定性 / 缺段优雅降级
  - 接入：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `release-notes`（写入 `release-notes.md`，已 gitignore）；顺带**补齐 Windows 侧 `dev.ps1`**（此前落后于 `dev.sh`/`Makefile`：缺 `install-hooks`/`observer`/`router`/`reviewer`/`roles`/`evolve`，本次一并补齐）
- 调研依据：GitHub 官方《Releasing and maintaining actions》主张"语义化 tag + Release 工作流 + 自动测试护栏"；开源 agent 框架（googleapis/release-please、oneuptime 自动化发布实践）普遍把"changelog 生成→Release 创建"做成 CI 一环；本仓库用零依赖薄脚本替代 release-please 的重依赖，把产出直接喂给 `softprops/action-gh-release`，与"零依赖 Node ESM"硬规则一致
- `ROADMAP.md`：Release workflow（Later→Done）；Windows `dev.ps1` 同步（缺命令补齐）

### 2026-07-09（LLM Adapter 适配层 · 特性级 · 本地，未推送）
- 完成 **ROADMAP Next/Later「Adapter 层」**：让同一套 agent 脚本在 **OpenAI / DeepSeek / Qwen(DashScope) / Moonshot(Kimi) / SiliconFlow / Ollama** 上统一运行（特性级，零依赖）：
  - 新增 `scripts/llm/adapter.mjs`——薄适配层，把 provider 名解析为有效连接配置：
    - `PROVIDERS` 目录（6 个 OpenAI 兼容端点）+ `ALIASES`（gpt/openai、kimi/moonshot、dashscope/tongyi/qwen、silicon/siliconflow、local/ollama 等别名）
    - 纯函数 `normalizeProviderName` / `resolveProvider` / `chatCompletionsUrl`（去尾斜杠+拼 `/chat/completions`）/ `buildHeaders`（有 key 才加 Bearer）/ `normalizeMessages`（字符串→user、角色校验）/ `buildConfig`（优先级：显式 `baseUrl` 覆盖 provider 默认值，未设时回退 OpenAI+gpt-4o-mini，与旧 `LLM_BASE_URL/LLM_MODEL/LLM_API_KEY` 流程**行为完全等价**）/ `parseCompletion` / `createClient`（绑定 chat 客户端，沿用 timeout/retry/2MB 上限）
    - CLI：`--list` 列全部 provider；`--provider <name>` 打印解析配置（key 脱敏）
  - 接入 `respond.mjs`：仅多一行 `import` + 用 `LLM_PROVIDER` 驱动 `buildConfig`；未设置任何变量时回退原默认，**不改变既有运行行为**；设置引导文案同步更新
  - 新增 `tests/adapter.test.mjs`（15 测试）：覆盖别名归一化、未知 provider 抛错、URL 拼装、header 鉴权、消息归一化（含缺省 role→user、非法 role 抛错）、`buildConfig` 三类优先级（显式 baseUrl / 默认 OpenAI / ollama 本地免密钥 / deepseek 读自身密钥环境变量 / 显式 key 覆盖 / model 覆盖）、响应解析、客户端构造、目录自洽
  - 接入：`Makefile`/`scripts/dev.sh`/`scripts/dev.ps1` 新增 `llm-adapter` 命令；`run-agent` 默认走 `LLM_PROVIDER=ollama`；**`.env.example` 新增 LLM 适配层段**（各 provider 密钥环境变量说明）；`QUICKSTART.md` 与新增 `examples/llm-providers.md` 示例同步
- 调研依据：OpenAI Chat Completions 已成事实标准，Ollama/DeepSeek/Qwen(DashScope)/Moonshot/SiliconFlow 均暴露兼容 `/v1/chat/completions` 端点（Ollama 官方 OpenAI-compatibility 文档、DeepSeek/Ollama 接入指南、CSDN《LLM 多厂商接入：provider/api/base_url/adapter 层级划分》、windy664《可替换 LLM 抽象层》）；多智能体框架工程实践主张"LLM 必须可替换"——本适配层用零依赖薄封装把这一需求落地，且保持与旧显式配置完全等价
- `ROADMAP.md`：Adapter 层（Next/Later→Done）

### 2026-07-09（轻量框架状态仪表盘 · 特性级 · 本地，未推送）
- 完成 **ROADMAP Next「轻量 Web 仪表盘」**：新增零依赖 `scripts/dashboard.mjs`，把仓库**框架级**状态做成可离线打开的静态仪表盘（特性级）：
  - 纯函数、零依赖、可单测：`parseRoadmap`（按段统计 Done/In progress/Next/Later 条目，忽略 emoji/括号装饰，遇到未知 `##` 段即停止计数的健壮解析）/ `countTestFiles` / `countScripts` / `countDocs` / `countPresets` / `countConfigAgents` / `qualityGates` / `collectRepoState` / `renderHtml`
  - 生成**单文件、自包含内联 CSS、无任何 CDN/外链**的 `.dashboard/index.html`：概览卡片（Agent 预设/配置角色、测试数、脚本数、文档数）+ 路线图进度条 + 五大质量门禁（check-syntax/validate-config/observer/reviewer/eval）健康清单；`renderHtml` 确定性输出、对仓库名做 HTML 转义防注入
  - **完全去个人化**：旧 `workspace/.learnings/scripts/dashboard-data.js` 读的是个人项目统计（经验池/创作反馈等），本脚本只读公开仓库结构，不含任何个人项目数据——复用"仪表盘"思路但剥离隐私
  - 新增 `tests/dashboard.test.mjs`（13 测试）：覆盖路线图解析（含未知段不计、空/nil 容错）、各计数器对真实仓库的下界、门禁清单、聚合可序列化、HTML 确定性/无外链/注入转义
  - 接入：`Makefile` / `scripts/dev.sh` / `scripts/dev.ps1` 新增 `dashboard` 命令；`.dashboard/` 加入 `.gitignore`（生成物不入库）
- 调研依据：agent 框架可观测性（LangGraph Studio / LangSmith / AutoGen）的仪表盘主要可视化**智能体状态 / 运行轨迹 / 质量门禁**；对"框架模板"（非运行实例）而言最合适的形态是**静态、自包含的框架级状态面板**（agents / tests / scripts / docs / roadmap / gates），且须零依赖、可离线——与仓库"零依赖 Node ESM"硬规则一致
- `ROADMAP.md`：轻量 Web 仪表盘（Next→Done；Later 同名项同步移除）

### 2026-07-09（闭环「采集→审核员→应用」· 框架级 · 本地，未推送）
- 闭环上轮桥梁缺失的"应用"半环——把 qa-heuristic 提案落到真实、可复用的框架模块：
  - 新增 **零依赖文风自检模块** `workspace/.learnings/scripts/style-engine.mjs`：识别 6 类低质文风（客套开场 / AI 腔过渡词 / 空泛夸张词 / 过长句 / 被动滥用 / 段落重复起句），输出 `{ score(0-100), passed, issues[], counts }` 结构化报告；附 CLI（文件或 stdin 输入，JSON 输出）
  - 新增 `tests/style-engine.test.mjs`（8 测试）：覆盖招呼填充词报错、AI 腔/空泛词告警、过长句、干净文本通过、确定性、空/非字符串容错
  - 接入：`make evolve` 默认洞察源改为中立示例 `examples/insights/`（3 个去项目化样本，演示 H1+`<!-- insight-meta -->`+正文契约）；`scripts/evolve/ingest.mjs` 的 qa-heuristic 落点同步更正为 `style-engine.mjs`；`.gitignore` 忽略本地 `/insights/` 与生成物 `insights-out/`
- 意义：至此"审核员审核收集的信息直接作用到项目"端到端跑通——`make evolve` 把中立采集洞察蒸馏为框架级提案，审核员门禁（reviewer.mjs）放行后落为真实框架改进（style-engine）；全程零项目内容、零依赖、可离线
- `ROADMAP.md`：闭环「采集→审核员→应用」（Done）；Next「接入真实中立采集源」改为可选的一次性来源

### 2026-07-09（采集信息→框架改进中立桥梁 · 特性级 · 本地，未推送）
- 新增 **「采集信息 → 框架改进」桥梁** `scripts/evolve/ingest.mjs`：把中立采集到的洞察（小说/漫剧/音乐/独立游戏调研等）解析→分类→产出**框架级**改进提案，补上"审核员消费采集信息→作用到项目"缺失的那半环（特性级，零依赖）：
  - `parseInsight()`：容错解析 H1 标题 + `<!-- insight-meta -->` 块（tags/source）+ 正文
  - `classifyInsight()`：按标签/关键词归类到 prompt-template / agent-role / skill / qa-heuristic / doc / other
  - `toProposal()`：产出结构化提案（id / 类别 / 建议落点 / 动作），落点均为去项目化的框架路径（如 `examples/agents/<id>.md`、`examples/<id>/SKILL.md`）
  - `ingestDir()` / `renderProposal()`：批量摄入 + 中立 Markdown 卡片渲染；CLI `node scripts/evolve/ingest.mjs [dir] [--write]`，默认输入 `./insights`（可经 `OPENCLAW_INSIGHTS_DIR` 覆盖）
  - 设计原则：**只蒸馏可复用框架改进，绝不写入任何具体项目内容**——中立身份
- 新增 `tests/ingest.test.mjs`（11 测试）：覆盖 slug 归一化、meta 解析、标签/关键词分类、提案形态、agent-role→agents 路径、批量摄入、缺目录报错
- 接入：`Makefile` / `scripts/dev.sh` 新增 `evolve` 命令（列出现有提案）
- 调研依据：用户明确架构——"审核员审核收集的信息直接作用到项目"；本桥梁将"采集到的信息"与"框架改进"解耦，使审核员（reviewer.mjs / 人工）只需对**提案**做采纳判定，而非对原始项目数据做处理
- `ROADMAP.md`：采集信息→框架改进桥梁（Done）；Next 新增"闭环采集→审核员→应用"（默认洞察源接 `AI创作日报/`）

### 2026-07-09（Agent 角色预设库 · 特性级 · 本地，未推送）
- 完成 **ROADMAP Later「More out-of-the-box agent roles」**：新增**零依赖、可验证的智能体角色预设库**，降低贡献门槛（克隆预设填充即可，无需从零设计角色）：
  - `examples/agents/*.md`：6 个开箱即用角色预设（reviewer / writer / memory-keeper / researcher / coder / qa），每个用统一契约（`<!-- role-meta -->` 元数据块 + 正文系统提示）描述，中文在前
  - `scripts/agent/roles.mjs`：零依赖加载器，导出 `parseMeta` / `validateRole` / `loadRole` / `loadRoles` / `getRole`，可校验 id 格式、必填字段、重复 id，CLI `node scripts/agent/roles.mjs [dir]` 输出 JSON 清单
  - `tests/roles.test.mjs`（8 测试）：覆盖元数据解析、必填校验、id 格式、单文件加载、缺块无效、真实预设全绿且 id 唯一、getRole 命中/未命中
  - 接入：`Makefile` / `scripts/dev.sh` 新增 `roles` 命令（列出现有预设）
- 调研依据：Anthropic《Building Effective Agents》六大可组合模式（reviewer↔evaluator-optimizer、coder↔orchestrator-workers、researcher↔parallelization）；CrewAI 的 Role+Task+Crew 角色抽象；多框架对比文（CrewAI 角色扮演 / LangGraph 状态机 / AutoGen 对话）显示"角色预设"是降低编排门槛的通用做法
- `ROADMAP.md`：More out-of-the-box agent roles（Later→Done）

### 2026-07-09（i18n docs：docs/ 中英双语化 · 本地，未推送）
- 完成 **ROADMAP Next「i18n docs」**：把对外文档统一为「中文在前、英文在后」的单文件双语（文档级，低风险高价值）：
  - `docs/ARCHITECTURE.md` 改写：新增完整中文翻译段（系统总览 / 自主智能体管线 / 智能体团队 / 脚本系统 / CI 质量门 / 记忆层级 / 可观测性），英文原文保留在后；ASCII 架构图语言无关，中英共用
  - 新增 `docs/README.md` 双语索引：说明 i18n 约定并列出全部对外文档（AGENT_CONTRACT / ARCHITECTURE / CHANGELOG）与根目录入口，提升可导航性
  - `AGENTS.md`「See also」新增指向 `docs/README.md` 文档中心
- 调研依据：OSS 文档 i18n 最佳实践——中小型项目用「单文件双语（同文件中文段+英文段）」优于多语言分目录（i18next 文档、JavaGuide 国际化指南）；本仓库 `AGENT_CONTRACT.md` 已采用此约定，本次统一补齐 `ARCHITECTURE.md` 并建索引；参考 crewAI 等框架的清晰文档结构（项目布局 + 开发循环 + 结构化输出）
- 质量门影响：纯 Markdown 改动，不触及任何 `.js/.mjs` 质量门脚本与 `scripts/eval/`；`node --check` / `validate-config` / `tests` / `observer` 不受影响
- `ROADMAP.md`：i18n docs（Next→Done）

### 2026-07-09（Eval 评估支柱 + 修复 Reviewer 缺失模块 · 本地，未推送）
- 新增 **Eval 评估工具** `scripts/eval/eval.mjs`：把"评估支柱"做成零依赖、可 CI 门禁的**回归 + 漂移监控**工具（特性级）：
  - 第 1 层（确定性，常驻 CI、零密钥）：对仓库既有纯函数 agent（router / observer / scaffold）的固定输入断言"不变量"——确定性、契约形态、禁路径守卫、密钥扫描正负例、slug 归一化；任一失败即红
  - 第 2 层（LLM-as-judge，可选门）：仅当配置 `EVAL_LLM_BASE_URL` 才跑，对样例 agent 输出按 rubric 打 1-5 分；CI 不配则不跑、绝不阻塞
  - 漂移监控：`--baseline` 快照各用例产物 → `scripts/eval/.eval-baseline.json`（已 gitignore）；`--compare` 与基线比（token Jaccard 作为语义相似度代理），相似度 <0.98 即告警
- 新增 `tests/eval.test.mjs`（11 个测试）：覆盖全部确定性用例 + similarity 同输入=1 + compareBaseline 无漂移/有漂移
- **修复既有缺陷**：`scripts/ci/reviewer.mjs` 此前被 `tests/reviewer.test.mjs` 引用却从未创建，导致测试套件长期 4 个失败；本次补建该"Reviewer Agent"（聚合 syntax / config / observer / tests 得出结构化判定 `runReviewer / verdict / formatReport / runCheck`），套件恢复全绿（75/75）
- 接入：`Makefile` 新增 `eval` 与 `reviewer` 目标并加入 `healthcheck`；`.github/workflows/node-check.yml` 在测试后增加 `node scripts/eval/eval.mjs`；`.gitignore` 忽略基线快照
- 调研依据：Anthropic《Demystifying evals for AI agents》(2026-01) 确定性断言与概率性断言并重；Google 多智能体评估 codelab 自动化回归管线；attest-framework 把确定性断言作为一等公民；zylos Agent-native CI 用 Shadow Mode 做漂移监控
- 测试套件恢复全绿（**75/75**，此前 4 个长期失败）

### 2026-07-09（Router Agent 任务路由冲刺 · 本地，未推送）
- 新增 **Router Agent** `scripts/agent/router.mjs`：纯函数、零密钥的**确定性任务规划/路由**器，无需 LLM：
  - `classifyIntent()` / `scoreIntent()`：识别主导意图（research / coding / writing / review / data， fallback general），并给出置信度（high/medium/low）
  - `decompose()`：按句末标点与步骤连接词（并 / 然后 / 另外 / and then…）把任务拆成子步骤
  - `route()`：把每个子句路由到注册表（`DEFAULT_REGISTRY`）中的专家 agent，输出结构化计划（task / intent / primaryAgent / subtasks / confidence / fallback / truncated）
  - `resolveAgent()`：无对应专家时回落到 generalist，保证永远有路由结果
- 新增 `tests/router.test.mjs`（14 个测试）：覆盖五类意图正/反例、general 回落、decompose 拆分、resolveAgent 专家选择、route 计划形态、多步路由、空任务抛错、自定义注册表、超长任务截断、确定性（同输入同输出）
- 接入：`Makefile` 新增 `router`（`$(NODE) scripts/agent/router.mjs $(ARGS)`）；`scripts/dev.sh` 新增 `router)` case；`ROADMAP.md` Router Agent（Next→Done）
- 测试总量从 45 → **59**（smoke 8 + validate-config 4 + edge-cases 14 + scaffold 8 + observer 11 + router 14），全绿
- 设计依据：多智能体框架的 Router/Observer 分工——Observer 守门（安全/质量），Router 分活（把一个任务派给对的专家），二者皆为零密钥确定性逻辑，可离线运行

### 2026-07-09（Observer Agent 自动审查冲刺 · 本地，未推送）
- 新增 **Observer Agent** `scripts/ci/observer.mjs`：纯函数、零密钥的自动化 PR/改动审查器，堵住四类风险：
  - 禁入库路径守卫（`.env` / `config/openclaw.json` / 个人数据目录如 `novel/` `gbrain/` `workspace/memory/` 等）
  - 明文密钥扫描（常见前缀 `ghp_` / `sk-` / `AKIA` / JWT + 高熵串；误报控制：跳过 `.example` 模板与占位符行）
  - 语法门禁（对每个 `.js/.mjs/.cjs` 跑 `node --check`）
  - 智能体契约路径安全（拒绝越界 / 指向禁改文件）
- 新增 `tests/observer.test.mjs`（11 个测试）：覆盖四类规则的正例/反例与 `runReview` 集成
- 接入：`Makefile`/`dev.sh` 新增 `observer` 命令；`.githooks/pre-commit` 提交前串接 observer；新增 `.github/workflows/observer.yml`（PR 时自动审，仅仓库文件、未推送）
- 测试总量从 34 → **45**（smoke 8 + validate-config 4 + edge-cases 14 + scaffold 8 + observer 11），全绿
- `ROADMAP.md`：Observer Agent（Next→Done）；`CHANGELOG`/`README`/`AGENTS.md` 同步

### 2026-07-09（CI硬化 + 开发体验冲刺 · 本地，未推送）
- **CI 硬化**：`node-check.yml` 从仅语法检查升级为跑完整 `make healthcheck`（语法 + 配置校验 + 全量测试），CI 与本地质量门完全一致，坏测试的 PR 不再能过关
- 新增 **预提交钩子**：`.githooks/pre-commit`（提交前本地跑 healthcheck）+ `scripts/install-hooks.sh` 一键安装，`Makefile`/`dev.sh` 新增 `install-hooks` 命令
- 新增 **脚手架脚本** `scripts/scaffold.mjs`：一条命令从模板生成新技能（`examples/<slug>/SKILL.md`+`run.mjs`）或新智能体（`examples/agent-<slug>.md`），降低贡献门槛
- 新增 `tests/scaffold.test.mjs`（8 个测试）：覆盖 kebab 归一化、skill/agent 文件生成、非法类型/空名/空 slug 拒绝、路径安全
- 测试总量从 26 → **34**（smoke 8 + validate-config 4 + edge-cases 14 + scaffold 8），全绿
- `ROADMAP.md`：标记 scaffolder（Next→Done）、pre-commit hook（Later→Done）；`CHANGELOG`/`README` 同步

### 2026-07-09（专业度成熟冲刺 · 本地，未推送）
- 新增 `.editorconfig`：统一编码风格（UTF-8、2空格缩进、LF换行），跨编辑器一致
- 新增 `CODE_OF_CONDUCT.md`：Contributor Covenant 2.1 行为准则，专业开源项目标配
- 新增 `.github/dependabot.yml`：GitHub Actions 依赖每周自动安全更新
- 新增 `tests/edge-cases.test.mjs`（14 个测试）：覆盖空输入、null byte、深层路径逃逸、多文件 payload、无 fence 原始 JSON、垃圾文本等边界场景
- `scripts/agent/respond.mjs` 鲁棒性增强：
  - `callLLM()` 加超时控制（默认 120s，可通过 `LLM_TIMEOUT_MS` 覆盖）
  - 瞬态故障自动重试（`LLM_RETRIES` 次，覆盖 ECONNRESET/ECONNREFUSED）
  - LLM 响应体大小上限 2MB（防 OOM）
  - `parseFiles()` 改进错误诊断：区分空输入 / 非法 JSON / 非 array 类型，附带原始内容片段
  - `safePath()` 新增 null byte 检测（安全加固）
- `docs/ARCHITECTURE.md` 重写：去品牌化、新增系统架构图 + 自主智能体管线流程图 + CI 质量门表格 + 可观测性说明
- 测试总量从 12 → **26**（smoke 8 + validate-config 4 + edge-cases 14），全绿通过
- `ROADMAP.md` 标记本轮所有完成项

### 2026-07-09（质量冲刺 · 本地，未推送）
- 新增 `QUICKSTART.md`：5 分钟从零跑起（本地零密钥 + 框架部署两种路径）
- 新增 `scripts/ci/validate-config.mjs` + `tests/validate-config.test.mjs`：配置优先（config-first）质量门禁，校验发布版 `.env.example` 与 `config/openclaw.json.example` 形态
- 新增 `examples/`：`sample-skill/`（通用技能模板，含可运行 `run.mjs`）+ `agent-task-sample.md`（展示智能体契约格式）
- `scripts/agent/respond.mjs`：增加轻量运行日志 `.agent-runs/*.jsonl`（可观测性种子，非致命，已 gitignore），贯穿任务/写文件/校验/提交/错误节点
- `Makefile` / `scripts/dev.sh` / `scripts/dev.ps1`：新增 `validate` 与 `healthcheck`（check+validate+test 一气呵成）命令
- `AGENTS.md` / `README.md` / `ROADMAP.md` / `CHANGELOG.md`：接新内容与入口
- 设计依据：调研生产级 agent 框架标杆（配置校验、评估/可观测性、示例模板、快速上手）

### 2026-07-08（自主迭代 · 本地）
- 新增 `scripts/ci/check-syntax.mjs`：统一的 `node --check` 扫描（CI / `make check` / 测试共用）
- 新增 `tests/smoke.test.mjs`：覆盖真实导出逻辑（`safePath` / `parseFiles` / 语法扫描）的功能冒烟测试
- `scripts/agent/respond.mjs`：导出 `safePath` / `parseFiles` 并加主模块守卫，使测试可安全导入；`node` 调用改用 `process.execPath`
- 新增契约式交互规范 `docs/AGENT_CONTRACT.md`（任务格式 / 改动 JSON / 路径安全 / 反馈契约）
- 新增开发者命令入口：`Makefile` + `scripts/dev.sh` + `scripts/dev.ps1`（`check` / `test` / `run-agent` / `install`）
- 新增 `SECURITY.md`、`ROADMAP.md`
- `AGENTS.md` / `README.md`：补充测试、契约、路线图、徽章与「自主智能体（本地零密钥）」说明
- 设计依据：全网调研多智能体最佳实践（契约式交互、Router/Observer、共享记忆、增量灰度、强仓库文档结构）

### 2026-07-08（早期）
- 去个人化改造：零硬编码路径、`.example` 模板、`.gitignore` 排除本地数据
- 双语 README + 仓库设为 Template
- `AGENTS.md` / `CLAUDE.md` / `CONTRIBUTING.md` + PR / Issue 模板
- GitHub Actions：`node-check`（语法）+ `agent-respond`（自动开 PR）
- 本地免密钥模式（指向本机 Ollama）

## 2026-07-08

### 项目转向
- 异兽学院v1-v4全部废弃
- 新项目：阴间考编 v1.2（黑色幽默女频漫剧向小说）
- 世界观v1.2完成（58609字节）
- 第1-7章正文完成（累计30435字）
- EP01-03漫剧分镜完成

### 系统升级
- Token优化8项全落地（contextPruning/maxConcurrent/心跳/Skills精简等）
- 团队扩至9人（新增多媒体制作人+商业化策略师）
- 自进化三路闭环（auto-heal/creation-feedback/skill-discovery）
- gbrain知识库激活（7个核心page）
- 仪表盘升级至11面板
- workspace从45→8核心文件

## 2026-07-06 ~ 07-07

### 异兽学院链（已废弃）
- v1-v4世界观全部废弃
- 第1-3章旧版废弃
- 10→9 Agent团队重组
- 协议v2.3落地
- 抖音收藏三路调研（270→144条AI相关）

## 2026-06-28 ~ 07-05

### 基础设施建设
- 10 Agent团队基础搭建
- 经验池v2.0
- 记忆系统（compose-context.js）
- 仪表盘搭建
- Headroom+RTK+codegraph安装
- cron从并行改串行
- 系统健康度85→92/100
