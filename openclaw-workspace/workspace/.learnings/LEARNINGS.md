# Learnings

Corrections, insights, and knowledge gaps captured during development.

**Categories**: correction | insight | knowledge_gap | best_practice

---

## 2026-07-01: PowerShell UTF-8 乱码修复

### 类别
best_practice

### 内容
在 PowerShell 中执行 node.js 脚本时，stderr 中文会乱码（GBK/UTF-8 不匹配）。

**修复方案**：创建 \nodeu.bat 包装器，用 chcp 65001 切换控制台编码为 UTF-8，然后调用 node。

**用法**：将 .learnings/scripts/nodeu.bat 添加到 PATH，或在 heartbeat 中用 \nodeu.bat script.js 替代 
ode script.js。

### 来源
ERRORS.md 中 'PowerShell stderr 乱码' 条目的修复方案

---

## 2026-07-02: PowerShell 复杂管道脚本块执行失败

### 类别
best_practice

### 内容
在 PowerShell 中执行复杂的脚本块语法（如 `Where-Object { $_.Property -gt value }`）时，如果命令格式不正确，`$_` 变量可能不会被正确解析。

**最佳实践**：
1. 避免使用复杂的 PowerShell 管道和脚本块，改用简单的 cmd 命令
2. 如果必须用 PowerShell，先将命令保存到 .ps1 文件再执行
3. 使用替代工具（Python、Node.js 脚本）

### 来源
心跳任务执行时发现

---

## 2026-07-02: health-observer.js 在 PowerShell 中的 stderr 干扰

### 类别
best_practice

### 内容
`health-observer.js` 用 `console.error()` 输出中文调试信息，在 PowerShell 管道（`2>&1`）中会被当成 RemoteException 错误流，导致退出码为1（即使 JSON 结果正确）。

**修复方案**：
1. 直接调用 `node.exe`，不要用 `nodeu.bat`（它内部包装了 `cmd /c`）
2. 分离 stderr：`node script.js alerts active 2>$null` 抑制 stderr
3. 长期修复：让 health-observer.js 的调试信息改为 stdout 或支持 `--quiet` 参数

### 来源
心跳任务 #8 执行时发现
