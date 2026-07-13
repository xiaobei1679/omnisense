# OmniSense 更新日志 (Changelog)

所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。
回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。
版本规则: 每小时 minor 小版本；距上次 major 满 3 小时则 major 大版本（minor 归零）。

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
