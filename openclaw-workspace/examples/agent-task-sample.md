# 示例任务（Agent Task Sample）

把本文件作为 `AGENT_TASK_FILE` 传给 `scripts/agent/respond.mjs`
（本地模式：`AGENT_LOCAL=1 AGENT_TASK_FILE=examples/agent-task-sample.md ... node scripts/agent/respond.mjs`），
或作为 `agent-task` issue 的内容（云端模式），智能体就会按下面的契约工作。

---

## 任务标题

为仓库补充一个最小可运行的「健康检查」脚本，并接进 `make` 与 CI。

## 背景 / 上下文

仓库已有 `scripts/ci/check-syntax.mjs`（扫描 `node --check`）和 `tests/` 冒烟测试。
但还没有一个一键「整体自检」入口，新人容易漏跑某一步。

## 具体要求（Acceptance Criteria）

- [ ] 新增 `scripts/ci/healthcheck.mjs`：依次调用语法检查 + 配置校验，任一失败则非零退出。
- [ ] `Makefile` 增加 `healthcheck` 目标，依赖 `check` 与 `validate`。
- [ ] 不引入新依赖；保持零依赖 Node ESM。
- [ ] 改动后必须通过现有 `node --check` 与 `node --test tests/`。

## 约束（必须遵循）

- 遵守 `AGENTS.md` 硬规则：禁硬编码绝对路径、禁提交个人数据/密钥、注释用 `//`。
- 只修改框架文件；不得触碰 `gbrain/`、`novel/`、`config/openclaw.json`、`.env`。
- 改完后运行 `node scripts/ci/check-syntax.mjs` 与 `node --test tests/*.test.mjs` 全绿。

## 预期产出

- 一个新增的 `scripts/ci/healthcheck.mjs` 文件
- `Makefile` 的 `healthcheck` 目标
- 一条说明性提交信息

> 智能体契约详见 `docs/AGENT_CONTRACT.md`：任务用上面的结构，产出必须是
> 一个 JSON 数组（每项含 `path` 与 `content`），路径须经 `safePath` 安全校验。
