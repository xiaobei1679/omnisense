# Agent Interaction Contract (契约式交互规范)

> 设计依据：多智能体系统的脆弱点在于 "语义漂移"——每个 Agent 自由发挥输出，
> 彼此理解错位导致整体崩坏。用**固定结构的契约**约束每个 Agent 的输入/输出，
> 只验证产物一致性、不干预中间推理，是让协作稳健的关键（见 10 条 Multi-Agent 实操建议）。

本文件定义 openclaw-workspace 中智能体（含 `scripts/agent/respond.mjs` 自动智能体）
之间、以及人与智能体之间交换信息的标准格式。任何新增 Agent 或脚本都应遵守。

---

## 1. 任务文件格式（本地模式 / `agent-task` issue）

一个任务的最小结构（`scripts/agent/task.example.md` 即此格式）：

```markdown
<一行标题，作为任务标题>

<多行正文：目标、约束、验收标准>
```

- 第一行（去除前导 `#`）作为标题。
- 其余内容作为任务正文传给 LLM。
- 建议正文包含三段：**Goal（目标）/ Constraints（约束）/ Accept criteria（验收）**。

## 2. Agent → 仓库 的改动契约（JSON 数组）

自动智能体（`respond.mjs`）要求 LLM **只输出一个 fenced JSON 代码块**，内容为文件改动数组：

````markdown
```json
[
  { "path": "relative/path/to/file", "content": "<文件完整新内容>" }
]
```
````

规则：
- `path` 必须是**仓库内相对路径**。
- 只输出你**实际修改**的文件。
- 若无法安全完成，输出 `{"error":"reason"}` 而非编造内容。
- 智能体**只新增/修改已存在目录下的文件**，绝不碰 `config/openclaw.json` 与 `.env`。

## 3. 路径安全契约（`safePath`）

所有写入路径必须经过 `safePath()` 校验，违反即抛错：
- ❌ 绝对路径（如 `/etc/passwd`、`C:\Windows\...`）
- ❌ 包含 `..` 的路径（逃逸仓库）
- ❌ 受限文件：`config/openclaw.json`、`.env`

测试覆盖见 `tests/smoke.test.mjs`。

## 4. 智能体 → 人 的反馈契约

- 云端模式：在 issue 下评论，说明已开 PR 供人工审核，**绝不自动合并**。
- 本地模式：打印到 stdout，并把改动提交到 `agent/local-<时间戳>` 分支，**由人 review 后再 push**。
- 失败时：只评论/打印错误原因，**不硬失败** CI（避免阻塞其他 PR）。

## 5. Agent 间消息格式（扩展预留）

当引入 Router / Observer 等多 Agent 协作时，Agent 间消息建议统一为：

```json
{
  "from": "agent-role",
  "to": "target-role",
  "type": "task | result | review | alert",
  "payload": { "...": "结构化内容" }
}
```

用 JSON / YAML / 模板化文本统一传递，防止语义漂移。

## 6. 质量护栏（CI 强制）

- 任何改动必须让全仓脚本通过 `node --check`（`scripts/ci/check-syntax.mjs`）。
- 引入新 Agent 时，建议补 `tests/` 下的功能测试（参考 `tests/smoke.test.mjs`）。

---

# Agent Interaction Contract (English)

This file specifies the standard formats agents in this repo exchange. The goal is
**contract-based interaction**: fix each agent's input/output schema, verify output
consistency, and avoid micromanaging its internal reasoning — the key to robust
multi-agent systems.

1. **Task format** — first line = title; rest = body with Goal / Constraints / Accept criteria.
2. **Change contract** — LLM must emit exactly one fenced ```json array of `{path, content}`.
   Refuse with `{"error":"reason"}`. Never touch `config/openclaw.json` / `.env`.
3. **Path safety** — `safePath()` forbids absolute paths, `..` escapes, and secret files.
4. **Feedback** — cloud mode opens a PR for human review (never auto-merges); local mode
   commits to `agent/local-<ts>` for review. Failures only comment, never hard-fail CI.
5. **Inter-agent messages** — future Router/Observer agents should use a uniform
   `{from, to, type, payload}` JSON envelope.
6. **Quality gate** — every change must keep all scripts green under `node --check`;
   add `tests/` coverage for new agents.
