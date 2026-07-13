# OmniSense 更新日志 (Changelog)

所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。
回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。
版本规则: 每小时 minor 小版本；距上次 major 满 3 小时则 major 大版本（minor 归零）。

## v1.0.0 — 2026-07-13 (baseline)

- 建立版本心跳机制：scripts/release.mjs(发布/回退) + VERSION + CHANGELOG.md + versions.json；引入 hourly minor / 3h major 自动判定。
