## 改动说明 / What changed
<!-- 简述这次 PR 做了什么 / Briefly describe the change -->

## 自检清单 / Pre-merge checklist (CI also checks this)
- [ ] 所有改动的 `.js` 已通过 `node --check`
- [ ] 无硬编码绝对路径（无 `C:\Users\...` / `/Users\...`）
- [ ] 未提交个人数据（`novel/`、`gbrain/`、`workspace/memory/`）或密钥（`config/openclaw.json`、`.env`）
- [ ] 配置改动只动了 `.example`，真实配置保持 gitignore
- [ ] 跨平台兼容（无 `2>nul` / `where` / `findstr` 等 Windows 专属命令）

## 关联 Issue / Related issue
<!-- Closes #123 -->
