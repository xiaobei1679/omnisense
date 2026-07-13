# OmniSense × 多智能体工作区 集成

本目录把 **OmniSense（通用 AI 身体框架）** 落地进 **`openclaw-workspace/` 多智能体工作区**，
让工作区里的智能体能以"真人身体"的方式调用 OmniSense 的七种器官。

> 仓库根目录的 `openclaw-workspace/` 是完整的工作区模板（原 `xiaobei1679/openclaw-workspace`，MIT）。
> 本目录是两者之间的**桥接层**，属于 OmniSense 框架自身的一部分。

## 七器官对照

| 器官 | 桥接入口 | 底层模块 | 真实能力 |
|------|----------|----------|----------|
| 眼 eye | `omni-body.mjs eye` | `eyes` | 抓网站 / 热搜 / 图像 / 视频 |
| 耳 ear | `omni-body.mjs ear` | `ears` | 听音频转写 / 小说 / 用户反馈 |
| 嘴 mouth | `omni-body.mjs mouth` | `mouth` | 表达观点 / 回复 / 朗读 |
| 脑 brain | `omni-body.mjs brain` | `brain` | 思考 / 决策 / 规划 / 指挥 |
| 手 hand | `omni-body.mjs hand` | `tools` | 联网抓 / 读写文件 / 计算 / 记忆 / 摘要 |
| 感知 perceive | `omni-body.mjs perceive` | `perception` | 把眼耳输入汇成环境理解 |
| 脚 foot | `omni-body.mjs foot` | `watch` | 常驻感知、在世界里移动与监视 |

## 快速使用

在**仓库根目录**执行（脚本基于相对路径定位 `src/index.mjs`）：

```bash
# 动手算一道题（离线，确定性）
node integrations/openclaw/omni-body.mjs hand calc '{"expression":"sqrt(16)+pi"}' --json

# 感知当前环境（离线）
node integrations/openclaw/omni-body.mjs perceive --json

# 列出七器官及其方法
node integrations/openclaw/omni-body.mjs describe --json

# A2A 风格能力卡：七器官能力扁平化为 skills[]（id/name/description/tags/examples/net）
# 借鉴 Google A2A Protocol 的 AgentCard 思想（https://github.com/google/A2A），仅借鉴结构语义
node integrations/openclaw/omni-body.mjs card --json

# 启动生命循环（像真人一样 感知→思考→动手→说话→移动）
node integrations/openclaw/omni-body.mjs live '{"ticks":2}' --json

# 把一句话目标交给身体去执行
node integrations/openclaw/omnisense-bridge.mjs "记录一条测试记忆" --json

# 技能匹配与自动委派：基于 Agent Card 能力卡找到最佳技能并执行
# （借鉴 IETF AgentCard 能力发现 + ARD intent→tool 匹配思想）
node integrations/openclaw/omni-body.mjs dispatch "计算 2+2" --json
node integrations/openclaw/omni-body.mjs dispatch "思考当前热点" --json
node integrations/openclaw/omni-body.mjs dispatch "看今日热搜" --json
```

## 在工作区里注册 OmniSense 为引擎

仓库内的 `openclaw-workspace/config/openclaw.json.example` 已内置一个 `omnisense-engine`
智能体角色（含 `skills` 与 `defaults.subagents.allowAgents` 注册）。把该文件复制为
`config/openclaw.json` 后，`omnisense-engine` 即可作为工作区的一员，通过本目录的桥接脚本
把 OmniSense 的七器官当作"身体"来使用。

### 调用方式（推荐：直接 import，无 shell 中转）

桥接层导出统一入口 `integrations/openclaw/index.mjs`，上层直接复用 `src/` 真实实现，
不 spawn 子进程、可单测：

```js
// ESM（推荐）
import { runOrgan, runGoal, agentCard, ORGANS, listOrgans } from '../integrations/openclaw/index.mjs';

// 驱动单个器官
const r = await runOrgan('hand', ['calc', '{"expression":"2+2"}']);
console.log(r.output.result); // 4

// 把一句话目标交给身体（感知→思考→动手）
const g = await runGoal('记录今天的关键决策', { useLLM: false });
console.log(g.trace.perceive); // 已 resolved 的环境理解
```

### 调用方式（兼容：shell 中子进程执行）

若工具脚本是 CommonJS、且不想改造模块类型，可让 Node 直接执行桥接脚本取 JSON：

```js
const { execFileSync } = require('node:child_process');
const { execPath } = require('node:process');
const path = require('node:path');
const repoRoot = path.resolve(__dirname, '../../../'); // 视调用位置调整
const bridge = path.join(repoRoot, 'integrations/openclaw/omni-body.mjs');
const out = execFileSync(execPath, [bridge, 'hand', 'calc', JSON.stringify({ expression: '2+2' }), '--json'], { encoding: 'utf8' });
console.log(JSON.parse(out));
```

## API 速查

| 导出 | 来源 | 说明 |
|------|------|------|
| `runOrgan(organ, rawArgs)` | `omni-body.mjs` | 执行单个器官动作，返回结果对象（供测试与脚本复用）；`organ='describe'` 返回七器官树、`'card'` 返回 A2A 技能卡、`'live'` 启动生命循环 |
| `runGoal(goal, opts)` | `omnisense-bridge.mjs` | 一句话目标 → 感知→思考→动手，返回 `{ goal, usedLLM, trace }` |
| `agentCard()` | `body.mjs` | A2A 风格能力卡：`{ schema, name, description, version, skills[] }`，skills 含 `id/name/description/tags/examples/net` |
| `dispatchSkill(goal)` | `index.mjs` | 技能匹配与委派：基于 Agent Card 自动找到最佳技能并执行（纯关键词匹配，零外部依赖） |
| `ORGANS` | `index.mjs` | 七器官常量数组 `['eye','ear','mouth','brain','hand','perceive','foot']` |
| `listOrgans()` | `index.mjs` | 返回器官副本，避免调用方误改常量 |

> 工作区侧消费入口见 `openclaw-workspace/scripts/omnisense-link.mjs`：`describe`（七器官树）、
> `card`（A2A 技能卡）、`route <organ.method> [args...]`（按技能 id 委派到对应器官/方法）、
> `dispatch <目标>`（**能力发现闭环**：自动匹配最合适的技能并委派），
> 以及 `list` / `hand` / `goal`。`route` 复用本层 `runOrgan`，对七器官通用。
> `dispatch` 复用 `body.skillDispatch`，基于关键词匹配自动选择最佳技能。

## 设计要点（诚实说明）

- 桥接脚本直接 `import` 同仓库的 `OmniSense`，**不是**伪造接口，所有能力都复用 `src/` 真实实现。
- 联网类器官（眼/耳抓站、脑在线思考）在无网关/无模型时**诚实降级**，绝不假装成功。
- 内建 120s 超时守卫，单个器官调用不会无限挂起。
- `runGoal` 的感知步骤已 `await` 解析，`trace.perceive` 是真实环境理解，而非未决 Promise。
- 无需任何外部密钥即可离线运行（计算 / 记忆 / 感知 / 生命循环骨架全部本地真实执行）。
- **可观测性**：经 `src/core/tracer.mjs`，`runGoal`/`runOrgan` 驱动的 agent 运行会自动落盘为可回放 trace（数据自持于 `.omni-traces.json`，不进仓库）。可在仓库根用 `node src/cli.mjs trace --summary` 聚合成功率/平均步数·耗时/工具级指标，或 `trace --list`/`--get=<id>` 回放。设计借鉴 LangSmith 全链路 Trace 与 OpenTelemetry GenAI 语义约定。
