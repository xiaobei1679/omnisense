# 调研存档：GitHub 可借鉴/可复制的零依赖功能（2026-07-09 第二轮）

> 中立框架视角。目的：在 GitHub / 技术站点上寻找**可借鉴架构模式、可复制实现**的零依赖（Node ESM）功能点，落地进 openclaw-workspace，绝不写入任何项目内容。
> 配套落地：本轮已实现 **LLM 响应缓存** 与 **熔断器** 两个特性（见 `docs/LLM_RESILIENCE.md`）。

## 检索范围（≥4 类来源）

1. GitHub 仓库直搜：`per-tool permission ladder` / `minimal MCP client stdio JSON-RPC` / `agent memory write path dedup` / `llm response cache prompt caching` / `circuit breaker node zero dependency` / `structured output json schema validation`
2. GitHub Topics / 生态盘点文（multi-agent 2026 热门框架）
3. 技术博客 / 文档（yuanchaofa、xirain、dev.to、anthropic、arxiv）
4. 既有 `docs/research/2026-07-09-external-research.md`（第一轮：Anthropic / arXiv / Security / Observability）

## 候选功能表（按"价值 / 风险 / 零依赖可行性"评估）

| # | 功能 | 可借鉴仓库 / 来源 | 零依赖可行性 | 与框架契合度 | 决策 |
| --- | --- | --- | --- | --- | --- |
| A | **LLM 响应缓存 (prompt caching)** | messkan/prompt-cache、karthyick/prompt-cache；yuanchaofa/xirain 设计文 | ✅ 哈希 + 本地 JSON 账本 | 高（补 `cost.mjs` 降本） | **已落地** `scripts/llm/cache.mjs` |
| B | **熔断器 (Circuit Breaker)** | rheatkhs/yves-circuit-breaker（零依赖纯逻辑）、ayushedith/retryify | ✅ 纯状态机 + 注入时钟 | 高（补既有重试） | **已落地** `scripts/llm/circuit-breaker.mjs` |
| C | **最小 MCP 客户端 (stdio JSON-RPC)** | dyneth02/MCP-Client-Server-NodeJS、mcpworld node-stdio-jsonrpc | ⚠️ 可行但协议面大 | 中（扩展外部工具） | 暂缓（风险/范围偏高，留作 Next） |
| D | **结构化输出校验 (JSON Schema)** | darshjme/agent-schema（无重框架）、thiagoaramizo/structured-json-agent | ✅ 最小校验可零依赖 | 中（与 `respond.mjs` 解析重叠） | 暂缓（重叠既有 parse，待显式需求） |
| E | **语义缓存 / 近似去重** | 多个 semantic-cache 仓库 | ⚠️ 需嵌入模型或相似度 | 低 | 不采纳（过度工程，违反 anti-over-engineering） |
| F | **重试/退避/限流一体** | ayushedith/retryify | ✅ | 低（既有重试已覆盖） | 不重复（既有 `respond.mjs` 重试足够） |

## 本轮落地明细（A + B）

- **A — `scripts/llm/cache.mjs`**：`canonicalRequest`（role 小写 / content 去空格 / 采样归一）→ `cacheKey`（SHA-256）→ `lookup` / `store` / `withCache` / `stats`；可注入 `fs` 离线可单测；CLI `--messages` / `--stats`；账本默认 `.cache/llm-cache.json`（已 gitignore）。配套 `tests/cache.test.mjs`（6 测试）。
- **B — `scripts/llm/circuit-breaker.mjs`**：`createBreaker({ failureThreshold, cooldownMs, successThreshold, now })` 纯状态机（CLOSED/OPEN/HALF_OPEN），`exec` / `withBreaker` / `CircuitOpenError`；可注入 `now` 离线可单测；CLI `--demo`。配套 `tests/circuit-breaker.test.mjs`（7 测试）。
- 接入：`Makefile` / `scripts/dev.sh` / `scripts/dev.ps1` 新增 `llm-cache` / `circuit-breaker`；`ROADMAP.md` Done 新增两项；`docs/CHANGELOG.md` 新增条目；`docs/LLM_RESILIENCE.md` 说明与 `respond.mjs` 接入示例。

## 暂缓项说明（诚实标注）

- **C（MCP 客户端）**：协议相对完整（initialize / tools/list / tools/call + 通知），零依赖可做 stdin/stdout 行分隔 JSON-RPC，但正确性与边界（超时、部分读取、协议协商）工作量明显高于 A/B；当前框架"工具层"已由 `observer`/`permissions`/`router` 覆盖，MCP 接入属"扩展性增强"而非"缺口"。列入 ROADMAP Next，待用户明确要接外部 MCP server 再做。
- **D（结构化输出校验）**：`respond.mjs` 的 `parseFiles` 已做文件级解析；引入 JSON Schema 校验属"锦上添花"，且零依赖最小实现（类型/必填/枚举）与既有解析重叠。待出现"Agent 必须输出强结构"的明确需求再落地。
- **E/F**：违反 anti-over-engineering 原则（语义缓存需嵌入模型；重试已覆盖），不采纳。

## 来源链接（可校验）

- https://github.com/messkan/prompt-cache
- https://github.com/karthyick/prompt-cache
- https://yuanchaofa.com/post/prompt-cache-design-for-llm-agents
- https://xirain.github.io/techlearn/posts/llm-agent-prompt-cache-design/
- https://github.com/rheatkhs/yves-circuit-breaker
- https://github.com/ayushedith/retryify
- https://github.com/dyneth02/MCP-Client-Server-Project-using-NodeJS
- https://github.com/darshjme/agent-schema
- https://dev.to/wallacefreitas/circuit-breaker-pattern-in-nodejs-and-typescript-enhancing-resilience-and-stability-bfi
