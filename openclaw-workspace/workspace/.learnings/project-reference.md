# 项目与团队参考

> 从 MEMORY.md 拆分，按需读取。版本 2026-07-07。

## 管理架构

老板 → 经理(QClaw) → 子Agent → 审核专员 → 汇报老板
- 子Agent产出先经审核专员审核再汇报用户
- 产出落盘 `QCLAW_PROJECT_DIR` 指向的目录（默认 `桌面\QClaw产出文件\`）对应子目录
- 用 sessions_spawn 派发
- 小说产出质检：创作Agent字数自检→qc-novel.js全量扫描→绿灯再送审
- 字数统计：CJK统一汉字（cjk-counter.js）
- 详细流程见 project-briefing-protocol.md v2.0

## 异兽学院项目

**世界观**：v2爽文版（45.7KB，771行）
- 文件：`方案\异兽学院_世界观_全新版v2_20260706.md`
- 昆仑学院/契约兽白泽幼体毛球/5阶力量体系/4层代价
- 装逼打脸流，毛球=金手指借力爆发（5阶段递进）
- 打脸公式：嘲讽→不回应→实力展示→对方沉默→旁观者震惊
- 融合多神话（山海经+北欧+希腊+日本）+规则怪谈
- 第1-30章逐章细纲

**主角**：林远（闷骚记仇型）
**契约兽**：毛球（白泽幼体，能听异兽真名）
**反派**：周鸿远（当众挑衅→被打脸）

**已完成章节**：
- 第1章《最后的名额》2513字 ✅ (07-06)
- 第2章《你算什么东西》2469字 ✅ (07-06)

**已废弃**：1-21章旧版（06-28），世界观v3.4（175KB），主角名"周明远"→"林远"

## Agent 团队（9个）

详见 project-briefing-protocol.md 第二节。

| 层级 | Agent | ID |
|------|-------|-----|
| 核心 | QClaw（主控） | main |
| 核心 | 小说故事创作专家 | ds4ygtfdv3z7mmxn |
| 核心 | 世界观架构师 | worldview-architect |
| 核心 | 技术制作人 | ua58rsb93veqtxl7 |
| 核心 | 多媒体制作人 | media-producer |
| 按需 | 审核专员 | agent-bdd9ff1a |
| 支援 | 质量诊断官 | bg0wgtn9jlge3doh |
| 支援 | 记忆管家 | ic7xj738h4v8p6g7 |
| 支援 | 商业化策略师 | biz-strategist |

## 脚本基建（17个核心脚本）

入口：`node .learnings/scripts/team-cli.js <command>`

核心脚本：experience-pool.js / skill-evolution.js / knowledge-loop.js / auto-heal.js / creation-feedback.js / skill-discovery.js / health-observer.js / dashboard-data.js / qc-novel.js / cjk-counter.js / team-cli.js / cron-templates.js / hotspot-consumer.js / project-data.js / kbi-save.js / spawn-template.js / mailbox.js

## 日常规范
- 每日热点 → `桌面\每日热点\qclawYYYYMMDD\`（串行模式，3路搜索→gbrain入库）
- 项目文件在 `QCLAW_PROJECT_DIR` 指向的目录（默认 `桌面\QClaw产出文件\`）
- 桌面文件操作用 PowerShell（read/write 被 sandbox 限制在 workspace）
- Node.js脚本用 `node.exe` 直接调用（不用 `node`，避免PowerShell引号问题）

## 已知问题
- 热点cron连续4次rate_limit失败（模型池高峰限流）
- gbrain缺OPENAI_API_KEY（embedding不可用）
- skill-discovery 76条pending未被消费
