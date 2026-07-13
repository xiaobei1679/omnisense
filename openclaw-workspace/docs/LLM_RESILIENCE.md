# LLM 弹性与缓存（Resilience & Caching）

> 两份零依赖基础设施模块，配套 `scripts/llm/cost.mjs`（成本追踪）与 `respond.mjs` 既有的「超时 + 瞬态重试」，把"跑 LLM 更省、更稳"做成可机器化复用的能力。全部零依赖、纯函数可单测、可离线。

## 1. LLM 响应缓存（prompt caching）— `scripts/llm/cache.mjs`

**解决什么**：相同 `(provider, model, 温度/采样, messages)` 请求必然得到相同补全，因此把响应按请求哈希缓存，跳过重复 LLM 调用 → 降本 + 降延迟。

**核心 API（纯函数）**

| 函数 | 作用 |
| --- | --- |
| `canonicalRequest(messages, opts)` | 把请求归整为稳定结构（role 小写、content 去首尾空格、采样参数归一） |
| `cacheKey(messages, opts)` | 上述结构的 SHA-256，作为缓存键 |
| `lookup(messages, opts)` | 查缓存，返回 `{ hit, key, value, meta }` |
| `store(messages, value, opts)` | 写缓存，返回 key |
| `withCache(callLLM, cacheOpts)` | 包裹 `callLLM`，命中则直接返回、未命中才调用并落库，返回 `{ response, cached, key }` |
| `stats(ledgerPath)` | `{ entries, totalHits }` |

- `opts.ledgerPath`：账本文件路径，默认 `.cache/llm-cache.json`（已在 `.gitignore` 忽略，生成物不入库）。
- `opts.fs`：可注入的内存 fs（测试用），默认 `node:fs`。
- 缓存仅当 `provider/model/温度/采样/messages` **完全一致**才命中（归一化后），不同采样参数视为不同请求。

**CLI**
```
node scripts/llm/cache.mjs --messages '[{"role":"user","content":"hi"}]' --model gpt-4o-mini
node scripts/llm/cache.mjs --stats
# 或经 make / dev：
make llm-cache --messages '...' --model gpt-4o-mini
```

**已默认接入 `respond.mjs` 生产路径**

`callLLM` 现在在生产路径（未注入测试 `opts.fetch` 时）自动：先查缓存 → 命中则直接返回（不进网络层）；未命中则经熔断器包裹的真实网络调用 → 成功后落缓存。接入规则如下，无需改业务代码：

| 环境变量 | 默认 | 作用 |
| --- | --- | --- |
| `LLM_CACHE` | `1` | 设 `0` 关闭 prompt 缓存 |
| `LLM_CIRCUIT` | `1` | 设 `0` 关闭熔断器 |
| `LLM_CACHE_PATH` | `.cache/llm-cache.json` | 缓存账本路径（已 gitignore） |
| `LLM_CACHE_TTL` | `21600000`（6h） | 条目超龄即视为未命中；设 `0` 关闭过期。**绑定陈旧度**，见 §5 |
| `LLM_CACHE_MAX` | `500` | 账本条目上限，超限按 ts 淘汰最旧；防账本无限膨胀 |
| `LLM_CB_FAILURE` | `3` | 连续失败多少次要跳闸 OPEN |
| `LLM_CB_COOLDOWN` | `5000` | OPEN 保持多久（ms）后放行探针 |
| `LLM_CB_SUCCESS` | `2` | HALF_OPEN 下连续成功多少次回到 CLOSED |
| `LLM_CACHE_CODEGEN` | `1` | 设 `0` 关闭**代码生成**响应的缓存（codegen 失败无法自愈，故默认短 TTL） |
| `LLM_CACHE_CODEGEN_TTL` | `600000`（10m） | **代码生成**响应的缓存 TTL；比通用 6h 短得多，缓解失败输出被长期冻结 |
| `LLM_CB_PERSIST` | _(空 / 关)_ | 设路径（如 `.cache/llm-circuit.json`）把熔断状态持久化到磁盘，使熔断在"一次进程一次 LLM"模型下跨运行生效；默认关，以保证测试确定性 |

- 缓存键取 `provider/model/温度0.2/messages`，与 `doFetch` 实际发出的请求体一致。
- 熔断器为**模块级单例**：跨多次 `callLLM` 累积失败，对持续故障的 provider 真正"雷鸣羊群"防护。
- **永远非致命**：缓存读/写失败、或熔断器异常都只 `trace` 一条日志并回落到普通 `doFetch`，绝不会因弹性层本身而阻断一次合法请求。
- 测试注入 `opts.fetch` 时弹性层自动不生效（`(opts.resilience ?? !opts.fetch)`），保持 `runAgentOffline` 等离线契约"零磁盘副作用"；可用 `opts.resilience=true` 显式开启做集成测试。

> 库本身（`withCache` / `createBreaker` 等）仍可直接 import 复用，上述路径只是生产默认接线。

## 2. 熔断器（Circuit Breaker）— `scripts/llm/circuit-breaker.mjs`

**解决什么**：`respond.mjs` 已有「瞬态错误重试」，但重试只对偶发抖动有效；当某个 provider 持续故障，反复重试会放大失败、浪费配额。熔断器在连续失败达到阈值后**直接拒绝**调用，冷却后放行一次探针，成功阈值达成再闭合——避免对故障 provider 的"雷鸣羊群"。

**核心 API（纯逻辑，可注入时钟）**

| 函数 | 作用 |
| --- | --- |
| `createBreaker({ failureThreshold, cooldownMs, successThreshold, now })` | 创建熔断器，返回 `{ exec, state, failures, snapshot, reset }` |
| `breaker.exec(fn)` | 经状态机执行 `fn`；OPEN 且未冷却时抛 `CircuitOpenError`（不调用 fn） |
| `withBreaker(breaker, fn)` | 把任意函数包成经熔断器的调用 |

状态机：`CLOSED`（正常）→ 连续 `failureThreshold` 次失败 → `OPEN`（拒绝）→ 冷却 `cooldownMs` 后放行一次探针 → `HALF_OPEN` → 连续 `successThreshold` 次成功 → 回到 `CLOSED`；`HALF_OPEN` 中失败立即重新 `OPEN`。

**CLI（状态机演示，无真实等待）**
```
node scripts/llm/circuit-breaker.mjs --demo
# 或：make circuit-breaker --demo
```

**已默认接入 `respond.mjs` 生产路径**

见第 1 节"已默认接入"中的 `LLM_CIRCUIT` / `LLM_CB_*` 环境变量与"永远非致命"说明——熔断器在 `callLLM` 内包裹 `doFetch`，OPEN 时抛出的 `CircuitOpenError` 会被 `main()` 捕获并转为 `⚠️ 调用 LLM 失败：LLM circuit breaker is OPEN …` 评论（快速失败、不空转重试），由人工介入。

## 3. 组合：缓存 + 熔断 + 重试

三者正交、可叠加：

- **缓存**在最外层：命中则不进入网络层（最快、最省）。
- **熔断**在缓存之后、重试之前：provider 持续故障时直接短路。
- **重试**（已有）在最内层：单次瞬态抖动自动恢复。

```js
const breaker = createBreaker({ failureThreshold: 3, cooldownMs: 5000, successThreshold: 2 });
const cachedCall = withCache(
  withBreaker(breaker, (m, o) => callLLM(m, o)),
  { ledgerPath: '.cache/llm-cache.json', model: LLM.model }
);
```

## 4. 调研依据（GitHub / 技术站点，2026-07-09 第二轮）

- **Prompt caching**：`messkan/prompt-cache`（宣称降本至 80%）、`karthyick/prompt-cache`（装饰器式语义缓存）；设计文 `yuanchaofa.com`《Agent 系统中的 Prompt Caching 设计》、`xirain.github.io`《LLM Agent Prompt Cache 深入浅出》——一致结论：Agent 比 Chatbot 更需要缓存，请求布局/工具管理影响缓存命中。
- **Circuit breaker**：`rheatkhs/yves-circuit-breaker`（明确"零依赖、纯逻辑、框架无关"）、`ayushedith/retryify`（retry/backoff/timeout/breaker/inflight-dedup 一体）；`dev.to` wallacefreitas / young_gao 的 CLOSED/OPEN/HALF_OPEN 状态机实现。
- 二者均满足本仓库"零依赖 Node ESM"硬规则：纯函数 + 可注入边界（fs / 时钟），离线可单测。

> 设计取舍：缓存与熔断现已**默认接入 `respond.mjs` 生产路径**（`callLLM` 内 `doFetch` 外层），仍保持对测试注入 `opts.fetch` 透明（自动不生效），不破坏任何既有离线契约测试；环境开关可随时降级为"仅作库"。

## 5. 已知边界与设计取舍（诚实标注，勿误判为"已完美"）

这几条不是 bug，而是当前运行模型下的**真实局限**，使用前务必知情：

1. **对"生成式 codegen"缓存要慎用——现已给 codegen 默认更短的 TTL。** `callLLM` 服务的是**代码生成**任务，缓存键 = `哈希(git 文件树 + AGENTS.md + 任务标题/正文 + model)`。这意味着：**同一仓库状态下重跑同一任务会命中缓存、原样返回上次生成结果，而不再调用 LLM**。若上次生成有 bug（parse 失败 / `node --check` 不过 / LLM 拒答），由于失败不改变 `git ls-files` 跟踪树，**立即重跑会拿到一模一样的失败输出，无法自愈**。缓解手段（已落地）：**代码生成响应默认 `LLM_CACHE_CODEGEN_TTL=10m`**（远短于通用 6h），超龄即重新生成；若需要"每次都要求全新生成"可设 `LLM_CACHE_CODEGEN=0` 或 `LLM_CACHE=0`。非代码生成调用可传 `opts.codegen=false` 走通用长 TTL。`cacheOpts` 现已按 `isCodeGen` 选取 TTL。**判断原则**：prompt 缓存最适合**幂等/确定性**子调用（路由、分类、摘要），对**创造性生成**应短 TTL 或关闭——本框架对 codegen 默认就短 TTL，正是这一原则的落地。
2. **熔断器原本是内存态单例，在当前"一次进程只调一次 LLM"模型下不跨运行——现已支持 opt-in 持久化。** `respond.mjs` 是一次性进程（一个 issue/本地任务 → 一次 `callLLM` → 退出），熔断器 `failureThreshold=3` 需同一进程内多次调用才可能跳闸；单次调用后进程退出、内存态丢失。现已给 `createBreaker` 增加 `persistPath`（temp+rename 原子写）：构造时从磁盘重载状态、每次状态转换即重写——**设 `LLM_CB_PERSIST=.cache/llm-circuit.json` 后，熔断对"每小时反复起进程打同一故障 provider"就能真正跨运行拦截**（OPEN 期间新进程快速失败、不空转重试）。**默认关闭**（`LLM_CB_PERSIST` 为空）：持久化开启会让 breaker 测试跨进程读到上次遗留的 OPEN 状态、破坏测试确定性；真实部署（Actions / 本地运行包装脚本）应显式开启。重载时只恢复"端点健康信号"（OPEN + 冷却时间戳），**不清算**连续失败/成功计数——独立任务不应继承上一次进程半跳闸的阈值。
3. **`Content-Length` 响应上限对分块/流式响应会被绕过。** 2MB 上限依赖响应头 `content-length`，很多服务端流式返回不带该头，此时上限失效（此为 `doFetch` 既有行为，非本次改动引入）。
4. **账本并发写已用 temp+rename 原子化**（防每小时自迭代与手动运行重叠时互相覆盖/半写），但仍是"最后写入者胜"——并发下可能丢失对方新写入的条目（非致命，只是少缓存几条）。真正的多写者场景需文件锁，目前按"单写者为主"假设，够用。
