# 错误模式记录

Command failures and integration errors.

---

## 2026-06-29: 基建自激循环（重复3次）

### 错误描述
创作焦虑→替代性生产力（工具/系统构建）→虚假成就感→工具链更复杂→创作门槛更高→更不想写→更多工具构建。正反馈自激。

### 触发条件
- 瓶颈检测连续3次全红（10:15→16:15→22:15）
- 零创作响应
- 系统主动构建平行生产力（决策账本+质检门+熔断器+健康监控+提案路由）

### 根因
系统把"工具构建"当成"生产力"，未强制执行"创作优先"

### 修复方案（已固化到MEMORY.md）
⚠️ **创作优先铁律（2026-06-29新增）**：瓶颈检测连续2次全红+零创作响应 → 基建冻结令生效 → 必须产出≥300字创作内容后才能解锁新工具构建。

### 发生次数
3次（2026-06-29当天）

---

## 2026-06-29: 警告疲劳（重复3次）

### 错误描述
系统检测到瓶颈全红但继续执行原有计划，把警告当成"信息"而非"指令"

### 触发条件
- 10:15首次全红→继续建工具（B/C方案/qc-novel）
- 16:15第2次全红→继续建工具（decision-ledger/quality-gate/circuit-breaker）
- 22:15第3次全红→此报告

### 根因
检测与行动解耦——"检测到≠行动"

### 修复方案（已固化到MEMORY.md）
⚠️ **警告升级机制（2026-06-29新增）**：第2次连续全红无响应→心跳优先队列置顶"解除创作真空"，拒绝工具构建请求。第3次全红→推送用户通知。

⚠️ **瓶颈报告后行动闭环**：检测报告生成后，心跳下一次执行先验证"立即行动清单"完成状态，未完成则跳过所有其他任务。

### 发生次数
3次（2026-06-29当天）

---

## 2026-06-30: PowerShell stderr 乱码（重复≥3次）

### 错误描述
`.learnings/scripts/` 下的所有 JS 脚本（decision-ledger.js、health-observer.js 等）在 PowerShell 中运行时，stderr 会输出中文乱码（node 的 NODE_OPTIONS 等环境变量包含中文，PowerShell 默认编码不匹配）。

### 触发条件
- 在 PowerShell 环境执行任何 JS 脚本
- 脚本有 stderr 输出（包括 node 警告信息）
- 输出内容含中文

### 根因
PowerShell 控制台默认编码（GBK）与 node.js stderr 输出编码（UTF-8）不匹配。

### 修复方案（已执行）
✅ 已创建 `.learnings/scripts/nodeu.bat`（UTF-8 编码启动器）
- 用法：`nodeu.bat script.js` 替代 `node script.js`
- 原理：`chcp 65001 >nul` 切换控制台编码为 UTF-8
- 状态：待迁移所有 JS 脚本调用

### 发生次数
≥3次（06-30 04:40、05:40、22:10 均记录）

---

## 2026-07-02: nodeu.bat 通过 cmd /c 嵌套调用时 stderr 乱码溢出

### 错误描述
heartbeat 中用 `cmd /c "nodeu.bat ..."` 调用 JS 脚本时，nodeu.bat 内部的 `chcp 65001` 对 cmd /c 嵌套环境不够稳定，导致 stderr 中的 UTF-8 中文字符泄漏为 GBK 乱码，触发 PowerShell 的 `NativeCommandError`。

### 触发条件
- heartbeat exec 使用 `command: 'cmd /c "...nodeu.bat ..."'` 格式
- JS 脚本有 stderr 输出（包括 node 警告信息）
- 输出内容含中文 UTF-8 字符

### 根因
cmd /c 启动的新 cmd 进程继承父环境，但 chcp 65001 只影响标准输出重定向，不影响 stderr 管道编码。PowerShell 捕获 stderr 时仍用默认 GBK 解码 UTF-8 字节流。

### 修复方案（已部分执行）
- ✅ HEARTBEAT.md 已更新：所有 JS 调用改为直接 `nodeu.bat script.js`（不用 cmd /c 包装）
- ✅ 已在 HEARTBEAT.md 第8、9步增加注释，说明正确调用方式
- ⏳ 待验证：需要在下次心跳中验证是否还有乱码问题
- 长期方案：用 PowerShell 原生方式调用 node（设置 `$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new()`）

### 发生次数
1次（2026-07-02 07:10 heartbeat 自检发现）

### 修复验证
- 2026-07-02 08:02 心跳：已按新格式调用，待观察结果

---

## 模板

```markdown
## YYYY-MM-DD: 错误名称

### 错误描述
（简述发生了什么）

### 触发条件
（什么条件下会复现）

### 根因
（为什么会发生）

### 修复方案
（已采取或计划采取的措施）

### 发生次数
N次
```
