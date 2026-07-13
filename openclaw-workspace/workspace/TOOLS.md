# TOOLS.md - Local Notes

## 浏览器自动化选择规则
web-access > xbrowser。先 `curl localhost:3456/health`，返回connected用它，否则xbrowser。

## Token优化（已落地）
- contextPruning: cache-ttl 5m, softTrim 0.3, hardClear 0.5
- maxConcurrent: 4
- 心跳: 3h, lightContext, isolated
- 子Agent reasoning: 仅创作/技术/诊断/世界观/多媒体保留stream
- Skills按需加载: main 19个（精简了10个不常用）
- AGENTS.md 4.5K→1.7K, HEARTBEAT.md 3K→1.2K
> 详细方案: `.learnings/token-optimization.md`

## AI视频/音乐/工具速查
> 已移至按需文件：`.learnings/media-tools-reference.md`

## Cron模板系统
`node .learnings/scripts/cron-templates.js list|create|show`

## 热点自动消费
`node .learnings/scripts/hotspot-consumer.js check|consume`

## 团队自成长系统
`node .learnings/scripts/team-cli.js <command>` (status|heal|feedback|discover|experience|evolve|knowledge|dashboard)
