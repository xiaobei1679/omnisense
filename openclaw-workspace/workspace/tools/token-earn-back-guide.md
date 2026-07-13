# Token 省钱实战手册 — 2026-07-04 已装三件套

## 装上能用的

### ✅ RTK v0.43.0 — 命令输出压缩 (已装+已集成)

**原理**: 识别 git/npm/dir/ls 等命令的输出模式，去掉重复行、时间戳、数字后缀，保留语义结构。

**省什么**: 每次 exec 返回的输出 token。大项目 `git status` 2000字→40字、`npm list` 序列化→树形摘要。

**怎么用**:
```powershell
# 直接在 exec 里用 rtk 前缀
rtk git diff --stat
rtk npm list
rtk dir
# 从任何 exec 返回的结果都是压缩后的
```

**节省**: 实测大输出场景 90-99%，日常 exec 15-40%。

### ✅ codegraph v1.2.0 — 代码知识图谱 (已装+已索引)

**原理**: Tree-sitter 预索引 96 文件的函数/类/导入/调用链为 SQLite 图，让 LLM 跳过逐行扫描。

**省什么**: 你让我"看看这代码怎么改"时，不再把整个文件塞进上下文。

**怎么用**:
```powershell
# 我需要改某个文件时，先用 codegraph 查结构
codegraph query "MEMORY 管理"    # 语义搜索
codegraph query "experience pool"   # 精确匹配
# 然后只给我相关的片段，而不是整个文件
```

**节省**: CSP 实测省 35-59% 输入 token（每次涉及代码的任务）。

### ✅ Headroom v0.30.0 — 上下文压缩 (已装，API可用)

**原理**: 用指令微调的小模型识别冗余内容，保留语义。

**省什么**: 长对话历史、重复的系统提示词、冗余的工具输出。

**怎么用**: 
```python
from headroom import compress
result = compress(messages=context_messages, model="claude-sonnet-4-20250514")
# 返回压缩后的 messages，token 节省 60-95%
```

**⚠️ 限制**: API 模式对非代码类内容压缩率 0%。需 proxy/MCP 模式才能真正工作（等待 npm 包 `headroom-openclaw`）。

### ✅ Caveman 协议 — 输出风格压缩 (已注入 AGENTS.md)

**原理**: 子 Agent 遵守 50 字内、不客套、不预告。

**省什么**: 子 Agent 的输出 token（每次心跳 3-5 个子 Agent）。

**节省**: 预估 65%（子 Agent 输出侧）。

---

## 三件套组合：日常省钱场景

### 场景 1: 你问我"看看 MEMORY.md 里有什么规则"
- **之前**: 我 `read` MEMORY.md → 全量 3160 字进上下文 → ~900 token
- **现在**: 我先 `codegraph query "MEMORY 规则"` → 找到摘要 → 只给你相关片段 → ~200 token
- **省**: 700 token/次

### 场景 2: 我跑 `git log` 看变更历史
- **之前**: 2000+ 字原始输出 → ~600 token
- **现在**: `rtk git log --oneline` → 压缩到 ~200 字 → ~60 token
- **省**: 540 token/次

### 场景 3: 子 Agent 执行后报告
- **之前**: "好的，我已经完成了任务 A，下一步我打算做 B..." → 150 字 → ~45 token
- **Caveman**: "任务A done. B pending." → 20 字 → ~6 token
- **省**: 39 token/次, 每天 10 次 = 390 token/天

### 场景 4: 读大文件
- **之前**: read 50KB 文件 → ~15000 token
- **codegraph**: 查结构化图谱 → 只给函数签名/类定义 → ~500 token
- **省**: 14500 token/次

---

## 月省估算

| 场景 | 频率/天 | 每次省 | 月省 |
|------|:--:|:--:|--:|
| RTK 过滤 exec 输出 | 20次 | 200 token | 120K |
| codegraph 替代大文件读取 | 5次 | 2000 token | 300K |
| Caveman 子Agent输出 | 10次 | 39 token | 12K |
| 心跳：记忆/经验/学习 | 8次 | 500 token | 120K |
| **合计** | | | **~550K token/月** |

按 `pool-deepseek-v4-pro` ≈ ¥0.01/1K input + ¥0.03/1K output = ~¥15-30/月

---

## 还没装的（更大头）

| 工具 | 预期月省 | 状态 |
|------|:--:|:--:|
| **OpenViking OpenClaw Plugin** | 200-500K | 已装 Python，等 npm plugin |
| **SimpleMem MCP** | 100-300K | 未装 |
| **Headroom Proxy Mode** | 300-800K | 等待 npm 包成熟 |

---

## 立即可用的省钱命令

```powershell
# 设置别名（QClaw exec 内有效）
# 依赖 rtk 在 PATH 中；若不在 PATH，改为其完整路径，例如 $env:CARGO_HOME/bin/rtk.exe
$rtk = "rtk"
$codegraphShim = "C:\Program Files\QClaw\v0.2.31.600\resources\node\node_modules\@colbymchenry\codegraph\npm-shim.js"
$nodeExe = $env:QCLAW_CLI_NODE_BINARY

# RTK — 压缩任何命令输出
& $rtk <command> <args>

# codegraph — 查询代码结构，跳过全文件读取
& $nodeExe $codegraphShim query "<关键词>"

# Caveman — 子Agent 自动遵守（AGENTS.md 已注入）
```
