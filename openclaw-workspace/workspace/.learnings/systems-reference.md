# 系统参考

> 从 MEMORY.md 拆分，按需读取。版本 2026-07-07。

## 进化系统（6子系统，全部已修复 07-07）

### 经验池 (experience-pool.js)
- 6命令：push/push-all/expire/stats/list/clear
- 数据：shared-experience-pool.json
- 状态：5条pushed + 1条forgotten
- ✅ record→push链路已打通（07-07修复）

### Skill进化 (skill-evolution.js)
- 3阶段：scan→propose→apply-all
- 数据：skill-evolution-state.json
- 状态：4个pattern全applied，周日cron触发

### 知识环 (knowledge-loop.js v1.1)
- 6命令：hot-ingest/query/list/search/sync/status
- 热点→gbrain自动入库已验证
- gbrain：7个实体page + 12个hotspot + 17个note = 36条

### 自愈 (auto-heal.js)
- 6类断链检测：经验池/Skill/KBI/gbrain/ERRORS/LEARNINGS
- 心跳第2步执行

### 创作反馈 (creation-feedback.js)
- 4命令：record/extract/patterns/push
- ✅ record时自动生成lesson（不依赖extract）
- HEARTBEAT第3步：record→push→patterns三步

### 技能发现 (skill-discovery.js)
- 4命令：scan/verify/integrate/status
- ✅ 编码已修复，76条pending
- ⚠️ verify/integrate必须用`node.exe`直接调用（不用`node`）

## 质检流水线
- qc-novel.js：全量扫描（字数/AI腔/设定一致性）
- cjk-counter.js：CJK统一汉字计数
- de-ai-prompt-templates.md：去AI腔模板v2（11KB）

## 字数铁律
- 每章 CJK≥2200字
- 番茄日更4000-6000字
- AI辅助创作必须标注

## 自主触发规则
1. 心跳每~2h执行HEARTBEAT.md任务
2. 每日08:00热点cron（串行3路搜索→gbrain入库）
3. 每周日心跳跑技能发现
4. 有小说产出→record经验→push经验池→patterns检测
5. 同类错误≥2次→自动生成修复→写入MEMORY

## KBI追踪
- kbi-tracker.json：ROI≥80自动应用，30天未触发标记废弃

## Dashboard
- dashboard/index.html (52KB, 11面板)
- dashboard/data.json + project-data.json
- 心跳中dashboard-data.js更新

## Cron任务（7个）
1. 每日热点+灵感收集 (08:00, 串行模式) — ⚠️ rate_limit
2. 每日团队站会 (08:35) — 正常
3. 每日团队学习会 (09:00) — 🆕 3路Agent视角消化热点→学习简报→gbrain入库
4. 创作瓶颈预警 (每12h) — 正常
5. 每周知识库整理 (周日 10:00) — 正常
6. 每日记忆整理 (23:00) — 正常
7. 系统自检L2 (周日 10:00) — 正常

## 已知问题
- 热点cron连续4次rate_limit（模型池高峰限流，非配置问题）
- gbrain缺OPENAI_API_KEY（embedding不可用，keyword search可用）
- skill-discovery 76条pending从未被消费（积累中，待人工筛选）
