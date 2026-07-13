# 外部软件替代评估报告

## 日期：2026-07-05

## 评估矩阵

| 脚本 | 当前功能 | 外部替代方案 | 替代可行性 | 建议 |
|------|----------|-------------|-----------|------|
| knowledge-loop.js | 热点→gbrain入库（gbrain put/list + YAML frontmatter + 分类同步） | **Obsidian插件生态**：无直接等效的自动采集→入库插件。Obsidian的"Auto Capture"类插件（如QuickAdd、Templater）侧重于手动触发采集，不支持gbrain CLI调用。**TencentDB Agent Memory（腾讯开源，2026-05）**：提供分层记忆引擎（短期压缩+长期个性化），MIT协议，已适配OpenClaw。可作为gbrain的替代后端，但需重写knowledge-loop的存储层。**Cloudflare Agent Memory（2026-05内测）**：托管式跨会话记忆，自动从对话提取结构化记忆——但属于SaaS非本地部署。 | **低** | **保留+补充**：knowledge-loop与gbrain深度耦合（slug生成、YAML frontmatter、type分类），外部工具无法直接替代。但可关注TencentDB Agent Memory作为gbrain的未来替代后端。当前建议保留脚本，仅在其gbrain存储层抽象出adapter接口，便于未来切换。 |
| experience-pool.js | 经验存储+置信度+来源追溯+TTL过期+Agent间推送 | **TencentDB Agent Memory**：开源分层记忆引擎，支持短期记忆压缩和长期个性化记忆，已适配OpenClaw框架。理论上可替代experience-pool的存储层，但不支持Agent间定向推送（push --target）和置信度路由。**MemoryOS（EMNLP 2025 Oral，GitHub开源）**：提供记忆操作系统，支持个性化Agent记忆——但侧重单Agent记忆管理，无多Agent推送机制。**Cloudflare Agent Memory**：自动从对话提取结构化记忆，无需手动add——但无置信度/分类/定向推送。 | **低** | **保留**：experience-pool的核心价值在于Agent间定向推送（push --target agent1,agent2）和置信度路由（conf≥0.7自动推送），这些是通用记忆工具不具备的。高度定制化，外部工具无法满足。 |
| health-observer.js | Agent健康监控（metrics记录+告警检测+团队快照+趋势分析） | **Grafana + Prometheus**：开源监控组合，可可视化Agent metrics并设置告警规则。但需要Agent主动暴露metrics endpoint（当前是文件写入JSON）。**LangSmith（LangChain生态）**：提供Agent trace可视化+评估，但属于SaaS且侧重LLM调用链而非Agent健康状态。**OpenClaw Agent Dashboard**：开源监控面板，提供限额监控等——但主要面向OpenClaw自身状态，不支持自定义Agent健康规则。**Latitude（GitHub开源，ai-monitoring topic）**：开源AI监控平台，TypeScript实现，支持LLM实验追踪和Agent评估。 | **中** | **补充**：health-observer的告警逻辑（连续3次错误、48h无产出）是业务定制规则，通用监控面板无法直接覆盖。但可将metrics输出到Grafana做可视化展示，health-observer保留告警检测逻辑。建议：保留脚本，增加Prometheus exporter输出格式（未来可选）。 |
| decision-ledger.js | 决策记录+投票完整性校验+权重计算+执行追踪 | **无直接替代**。搜索"decision log tool open source"未找到专门面向AI Agent团队的决策日志工具。最接近的是：**Notion/飞书文档**手动记录（无API自动化）、**Jira**工单追踪（过于重量级）、**ADR-Tools（Architecture Decision Records）**仅记录技术决策（无投票/权重机制）。decision-ledger的投票校验（创作类需世界观架构师参与、tech/creative/cost/process四类投票权重不同）是高度定制逻辑。 | **低** | **保留**：决策台账的投票完整性校验和权重体系是团队协作协议（team-discussion-protocol v2.0）的核心实现，无现成工具可替代。未来可考虑输出为Markdown ADR格式归档。 |
| mailbox.js | Agent间异步消息（留言→读→回复，JSON文件存储） | **Microsoft Agent Framework（2025-10开源）**：整合Semantic Kernel + AutoGen，提供多Agent编排和消息传递。但这是完整框架，仅用其消息层过于重量级。**agentUniverse（蚂蚁开源）**：多Agent协作框架，提供丰富的协作模式组件——但需Python环境，与当前Node.js脚本栈不兼容。**Agency Swarm（GitHub开源）**：基于OpenAI Agents SDK的多Agent编排框架——依赖OpenAI生态。**Conductor（微软开源，MIT）**：YAML定义多Agent工作流，确定性编排——但消息传递是编排层面，非异步信箱模式。 | **低** | **保留**：mailbox.js是轻量级文件消息系统（JSON文件读写），与OpenClaw的Agent ID体系直接集成。引入完整多Agent框架（Microsoft Agent Framework/agentUniverse）会带来架构膨胀，且这些框架的消息模式是同步编排而非异步信箱。当前方案最简。 |
| qc-novel.js | 小说质检（CJK字数统计+解锁表对照+禁用名检测+合规标记+跨章快照） | **无直接替代**。搜索"novel quality checker AI Chinese"未找到专门的中文小说质检工具。现有AI文本工具（如AI Essay Checker、GPTZero）面向学术论文AI检测，不支持：CJK字数统计、世界观设定解锁表对照、角色名禁用检测、创作合规标记等小说特有质检需求。**大模型直接质检**（如用Claude/GPT读章节给评分）可补充但无法替代结构化规则检查（如字数≥2000、解锁表对照）。 | **低** | **保留+补充**：qc-novel的解锁表对照和禁用名检测是《山海巨兽录》项目特有规则，无通用工具。但可补充：用大模型做文风一致性、角色行为合理性等主观维度质检（当前仅做客观规则检查）。 |
| circuit-breaker.js | 熔断器+优雅降级（4级状态FULL/DEGRADED/MINIMAL/EMERGENCY + Agent备份切换 + 降级日志） | **LangGraph状态机**：支持复杂状态流转和条件分支，可实现熔断逻辑——但需Python环境+LangChain生态。**Resilience4j（Java）**：成熟的熔断器库，但仅限JVM生态。**Microsoft Conductor**：YAML定义工作流+确定性编排，可实现降级路由——但引入完整编排框架过重。**opossum（Node.js熔断器库）**：提供熔断器模式，但不含Agent备份切换和降级日志。 | **低** | **保留**：circuit-breaker的核心价值在于Agent备份映射（AGENT_BACKUPS表）和4级降级状态机，这是OpenClaw多Agent团队定制逻辑。通用熔断器库不提供Agent间备份切换。当前Node.js实现轻量且与团队CLI集成良好。 |

## 重复操作自动化清单

| 操作 | 当前频率 | 自动化方案 | 优先级 |
|------|---------|-----------|--------|
| 心跳跑多脚本 | 每次 | ✅ 已解决(auto-heal.js + HEARTBEAT.md整合) | - |
| 创作后质检+反馈 | 每章 | ✅ 已解决(creation-feedback.js) | - |
| gbrain手动调用 | 每次心跳 | **方案A（推荐）**：封装gbrain CLI为MCP工具，直接在对话中调用而非exec执行JS脚本。**方案B**：在auto-heal.js中增加gbrain自愈步骤（已有基础：断链检测中的gbrain search + 补入库）。**方案C**：封装gbrain-wraper.js统一入口，HEARTBEAT只调一个命令。 | **P1**（方案B已部分实现，方案A为进阶优化） |
| cron payload编辑 | 每次修改 | **方案**：创建cron模板系统——定义JSON模板（task_type + schedule + payload_template），通过`node cron-template.js apply --type hotspot-daily --date 20260706`自动生成payload。模板存储在`.learnings/cron-templates/`目录。 | **P2**（当前cron修改频率约每周1次，不紧急） |
| Agent配置变更 | 每次调整 | **已知限制**：allowAgents列表受OpenClaw保护，需用户UI操作，无法自动化。**可优化部分**：非受保护配置（如Agent的systemPrompt、model等）可通过gateway config patch API批量修改。建议创建`node team-cli.js config-update --agent <id> --key <key> --value <value>`快捷命令。 | **P2**（低频操作，且涉及安全边界） |

## 推荐行动

1. **[P0] 无P0项** — 当前7个脚本均无紧迫替代需求，外部工具无法直接覆盖定制逻辑

2. **[P1] gbrain调用封装优化**
   - 短期：在auto-heal.js中增强gbrain自愈逻辑（已有基础）
   - 中期：将gbrain封装为MCP工具（`gbrain_search`、`gbrain_put`、`gbrain_list`），在心跳中直接调用而非通过exec执行JS
   - 预期收益：减少心跳中3-5次exec调用，降低脚本维护成本
   - 实施难度：中等（需编写MCP server wrapper）

3. **[P2] cron模板系统**
   - 创建`.learnings/cron-templates/`目录，定义3-5个常用模板（hotspot-daily、heartbeat-check、novel-publish等）
   - 实现`cron-template.js apply --type <type> --date <date>`一键生成payload
   - 预期收益：将cron修改从5分钟手动编辑降至30秒命令执行
   - 实施难度：低

4. **[P2] Agent配置快捷修改**
   - 在team-cli.js中增加config-update子命令
   - 仅支持非受保护配置（systemPrompt、model、temperature等）
   - 预期收益：减少手动编辑openclaw.json的出错风险
   - 实施难度：低

5. **[P3] 关注TencentDB Agent Memory发展**
   - 腾讯2026-05开源的Agent Memory引擎，已适配OpenClaw
   - 如果其长期记忆能力成熟，可考虑替代gbrain作为knowledge-loop的存储后端
   - 当前观望，不急于迁移

## 不建议替代的脚本（理由）

1. **experience-pool.js**：核心价值是Agent间定向推送（push --target）和置信度路由（conf≥0.7自动推送）。TencentDB Agent Memory和Cloudflare Agent Memory都是单Agent记忆管理，不支持多Agent间定向消息推送。高度定制化，替代成本>收益。

2. **decision-ledger.js**：投票完整性校验（创作类需世界观架构师参与、四类投票权重不同）是team-discussion-protocol v2.0的核心实现。无现成决策日志工具支持多类型投票+权重+Agent角色校验。ADR-Tools仅记录技术决策，无投票机制。

3. **mailbox.js**：轻量级JSON文件消息系统，与OpenClaw Agent ID体系直接集成。引入Microsoft Agent Framework或agentUniverse等多Agent框架会带来架构膨胀（Python依赖、框架学习成本），且这些框架的消息模式是同步编排而非异步信箱。当前方案最简最稳。

4. **qc-novel.js**：解锁表对照（UNLOCK_TABLE v1.1，20章设定解锁清单）和禁用名检测（DISABLED_NAMES）是《山海巨兽录》项目特有规则。通用AI文本工具（GPTZero、AI Essay Checker）面向学术论文检测，不支持小说世界观一致性检查。

5. **circuit-breaker.js**：Agent备份映射（AGENT_BACKUPS表定义7对备份关系）和4级降级状态机是OpenClaw多Agent团队定制逻辑。通用熔断器库（opossum、Resilience4j）不提供Agent间备份切换和团队级降级编排。

6. **knowledge-loop.js**：与gbrain CLI深度耦合（slug生成、YAML frontmatter、type分类、execFileSync绕过shell传递多行内容）。外部工具（Obsidian插件、TencentDB Agent Memory）无法直接替代gbrain存储层。建议保留，仅抽象adapter接口备未来切换。

7. **health-observer.js**：告警规则（连续3次错误、48h无产出）是业务定制逻辑。Grafana可做可视化补充但无法替代告警检测。建议保留脚本，未来可选增加Prometheus exporter输出。

---

## 评估方法论

- 搜索引擎：yuanbao（腾讯元宝搜索）
- 搜索方向：5个核心方向 + 2个补充方向，共7次web_search
- 评估维度：功能匹配度、集成成本、架构兼容性、维护成本、替代收益
- 评估原则：外部工具需在不引入架构膨胀的前提下覆盖≥80%核心功能才考虑替代
