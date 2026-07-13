# 系统记忆与修复方案

## 编码问题彻底修复方案（2026-07-03）

### 问题
PowerShell 执行 JS 脚本时 stderr 中文乱码，已出现≥3次

### 根因
PowerShell 默认编码（GBK）与 node.js stderr（UTF-8）不匹配

### 修复方案

#### 短期（已执行）
- ✅ 创建 `nodeu.bat`（UTF-8 编码启动器）
- ✅ 用法：`nodeu.bat script.js` 替代 `node script.js`
- ✅ HEARTBEAT.md 已更新为直接调用格式（不用 `cmd /c` 嵌套）

#### 中期（待执行）
- 所有 heartbeat JS 调用已改为 `nodeu.bat script.js` 格式
- 验证下次心跳是否还有乱码

#### 长期（推荐）
在 PowerShell 脚本开头设置：
```powershell
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()
```

或者创建 PowerShell 版 nodeu.ps1：
```powershell
# nodeu.ps1 - UTF-8 编码的 node 启动器
[Console]::OutputEncoding = [Text.UTF8Encoding]::new()
node $args
```

### 验证方法
执行以下命令，检查 stderr 是否还有乱码：
```powershell
& ".learnings\scripts\nodeu.bat" ".learnings\scripts\health-observer.js" alerts active
```

---
*最后更新: 2026-07-03 00:15*
