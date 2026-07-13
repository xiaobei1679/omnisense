# 文档中心 / Documentation Index

> 本仓库对外文档统一采用 **「中文在前、英文在后」的单文件双语约定**，便于国内外贡献者阅读。
> This repo's public docs follow a **single-file bilingual convention: Chinese first, English after** — accessible to both Chinese- and English-speaking contributors.

## i18n 约定 / i18n convention

- 每个对外文档（位于 `docs/`）都同时包含中文段与英文段。
- 顺序：中文翻译在前（标题后缀「（中文）」），英文原文在后。
- 架构图等 ASCII 盒图语言无关，中英两版共用同一图示。
- 内部文档（如团队协议、个人笔记）不强制双语，按需维护。

Every public doc under `docs/` carries both a Chinese section and an English section.
Order: Chinese translation first (heading suffix `（中文）`), English original after.
Language-neutral ASCII diagrams are shared by both versions. Internal docs (team protocol, personal notes) are exempt.

## 文档清单 / Document list

| 文档 / File | 内容 / Contents | 语言 / Lang |
|------|------|------|
| [`AGENT_CONTRACT.md`](AGENT_CONTRACT.md) | 智能体交互契约：任务格式、改动 JSON、路径安全、质量护栏 / Agent interaction contract: task format, change JSON, path safety, quality guardrails | 中英双语 Bilingual |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | 系统架构、自主智能体管线、CI 质量门、记忆层级、可观测性 / System architecture, autonomous pipeline, CI gates, memory layers, observability | 中英双语 Bilingual |
| [`CHANGELOG.md`](CHANGELOG.md) | 仓库（公开框架）与项目演进记录 / Repo (public framework) & project changelog | 中英混合 Mixed |
| [`COMMANDS.md`](COMMANDS.md) | 全部开发命令参考（make/dev.sh/dev.ps1 等价入口 + 环境变量）/ Full dev-command reference (make/dev.sh/dev.ps1 equivalent entrypoints + env vars) | 中英双语 Bilingual |

## 其他入口 / Other entry points

- 根目录 [`README.md`](../README.md) — 项目总览与三步上手（中文优先，含英文要点）
- [`QUICKSTART.md`](../QUICKSTART.md) — 5 分钟从零跑起
- [`AGENTS.md`](../AGENTS.md) — AI 智能体使用本仓库的指引
- [`ROADMAP.md`](../ROADMAP.md) — 迭代路线与已完成项

## 贡献文档 / Contributing docs

新增对外文档时，请遵循上述双语约定；若只是补充英文/中文其中一方，请同步补齐另一方，保持双语一致。
When adding a public doc, follow the bilingual convention above; if you only fill one language, complete the other to keep both in sync.
