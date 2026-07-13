# OmniSense 更新日志 (Changelog)

所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。
回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。
版本规则: 每小时 minor 小版本；距上次 major 满 3 小时则 major 大版本（minor 归零）。

## v1.2.0 — 2026-07-13 (minor)

- 版本心跳机制收口：package.json 增加 release 脚本 + files 纳入 VERSION/CHANGELOG/versions.json/scripts；README/SKILL 增补『版本与回退』章节；版本逻辑单测已落地(test/version.test.mjs)。
- 注：本次 `auto` 判定为 minor——按本机时钟距基线 v1.0.0 仅约 6 分钟，未满 3h，故不升 major（major 将在距基线满 3h 后的首次心跳触发）。

## v1.1.0 — 2026-07-13 (minor)

- 新增版本逻辑单元测试(test/version.test.mjs)：parseVersion/nextVersionOf/decideAuto/latestMajorTime；保证心跳版本判定可测。

## v1.0.0 — 2026-07-13 (baseline)

- 建立版本心跳机制：scripts/release.mjs(发布/回退) + VERSION + CHANGELOG.md + versions.json；引入 hourly minor / 3h major 自动判定。
