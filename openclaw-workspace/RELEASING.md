# 发布与审查流程（RELEASING）

本仓库采用 **「本地持续迭代 + 专员自动审核 + 用户手动推送」** 的协作模式：
自动化工位每小时在本地做一轮改进；**专员审核（`scripts/ci/reviewer.mjs`）全绿后自动
本地 `git commit`**——但**绝不推送远端**（用户明确约定：只改本地、不动云端）。
推送由用户每日 review 后手动完成。

> 原则：**只有专员审核 PASS 才允许本地 commit。** 任何未过门禁的改动都不会被提交；
> AI 绝不 `git push`、绝不 force-push、绝不推任何分支；推送完全由人类掌控。

---

## 专员审核（审核专员 = 自动化审查器）

```bash
make reviewer          # 或： bash scripts/dev.sh reviewer
# 机器可读结果（给自动化工位解析）：
node scripts/ci/reviewer.mjs --json
```

它跑四项确定性、零密钥检查，全过才给 PASS：
1. **syntax-check** — 每个脚本过 `node --check`
2. **config-validate** — 发布的模板配置合法
3. **functional-tests** — `node --test tests/*.test.mjs` 全绿
4. **observer-gate** — 无禁入库路径 / 明文密钥 / 坏语法 / 契约越界

退出码 0 = PASS（可本地提交），1 = FAIL（禁止提交，并列出未过项）。

---

## 推送（由人工完成 —— AI 绝不推送）

自动化工位（`automation-1783526614419`，每小时）每次运行：
1. 做一轮特性级改进；
2. 运行 `node scripts/ci/reviewer.mjs`；
3. **PASS → 本地 `git commit`**；FAIL → 不提交，仅报告未过项。
4. **绝不 `git push`**——推送由用户每日 review 后手动执行。

你（人类）在 review 本地改动后手动推送：

```bash
# 看一眼未推送的本地 commit
git log origin/main..HEAD
# 确认专员已 PASS，推送到 main
git push origin main
```

推送后顺手在 GitHub 看一眼 Actions（`node-check.yml`）是否全绿。

---

## 打 tag 即自动发布（人类触发，可选）

仓库带 `.github/workflows/release.yml`：当你**手动推送一个语义化 tag**（如 `v1.0.0`）时，GitHub Actions 会自动：
1. 跑完整 healthcheck（语法 + 配置 + 测试 + eval）；
2. 用 `scripts/release/notes.mjs` 解析 `CHANGELOG.md` 的「公开框架」段，生成 `release-notes.md`；
3. 用 `softprops/action-gh-release` + 自动注入的 `GITHUB_TOKEN` 创建 GitHub Release。

> 这是纯人类动作：自动化工位**绝不打 tag**，所以永远不会触发它。
> 也可在 GitHub 的 Actions 页手动 `workflow_dispatch` 触发。
> 本地预览发布说明：`make release-notes`（写入 `release-notes.md`，已 gitignore）。

---

## 自动化上下文

- 自动化工位：`automation-1783526614419`（每小时触发）
- 它做本地改进，**专员审核 PASS 后仅本地 `git commit`，绝不推送**
- 质量门禁脚本（`scripts/ci/reviewer.mjs`、`observer.mjs`、`check-syntax.mjs`、
  `validate-config.mjs`、`scripts/eval/`）是审核专员本身，**自动化只调用、不改写**

---

## 回滚（万一推送后发现问题）

```bash
git log --oneline -20
git revert <bad-commit-sha>
git push origin main
```

---

## 审查清单（Checklist，给专员 / 人工复核参考）

推送前（专员已在本地核对，这里供人工抽查）：
- [ ] `make reviewer` 全绿（语法 / 配置 / 测试 / observer）
- [ ] 改动不包含密钥（`.env`、`config/openclaw.json` 被 gitignore）
- [ ] 改动不包含个人数据（`novel/`、`gbrain/`、`workspace/memory/` 等已 gitignore）
- [ ] CHANGELOG.md 已记录本轮改动
- [ ] README / ROADMAP 引用与新文件一致
