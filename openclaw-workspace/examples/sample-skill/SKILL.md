---
name: sample-skill
description: 示例技能（模板）。演示一个最小可用技能的结构，供你照抄扩展本框架。触发词：示例、sample、demo、模板技能。
---

# Sample Skill（示例技能）

这是一个**通用模板**，展示如何为 openclaw-workspace 编写一个技能（skill）。
照抄本目录即可创建你自己的技能；技能会被 `find-skills` / 智能体自动发现。

## 目录结构

```
examples/sample-skill/
├── SKILL.md          # 本文件：元数据 + 指令（必须）
└── run.mjs           # 可选：技能实际执行的脚本（零依赖 Node，推荐）
```

## SKILL.md 头部约定

文件顶部用 YAML frontmatter 声明：

- `name`：技能唯一名（小写中划线）
- `description`：一句话说明 + 触发词（智能体据此决定是否调用）

## 编写原则（来自 AGENTS.md 硬规则）

- 注释用 `//`，**不要**用 `#`（那是 shell，不是 JS）
- 不硬编码绝对路径；用 `process.env` 或 `os.homedir()`
- 跨平台：禁用 `2>nul` / `where` / `findstr` 等 Windows 专属命令
- `.ps1` 用 `if/else` 而非三元 `?:`，且保存为 UTF-8 **含 BOM**
- `.js`/`.mjs` 必须通过 `node --check`

## 最小可运行示例（run.mjs）

```js
// run.mjs —— 零依赖示例：读入一个词，输出问候
import { readFileSync } from 'node:fs';
const word = process.argv[2] || 'world';
console.log(`Hello, ${word}! (from sample-skill)`);
```

运行：`node examples/sample-skill/run.mjs openclaw`

## 如何让你自己的技能被智能体使用

1. 在 `config/openclaw.json.example` 的某 agent 的 `skills` 数组里加上技能 `name`；
2. 或被 `scripts/skills/registry.mjs` 自动发现（`make skills` 会递归扫描并校验所有 `SKILL.md`，按 name/category 检索）；
3. 智能体在 `AGENTS.md` 规范下调用，产出经 `node --check` 校验后提交。

> 这是框架的一部分示例，不含任何个人数据，可安全随仓库发布。
