# Token Optimization Plan — 2026-07-07

## 已执行（8项）

| # | 措施 | 变更 | 预估节省 |
|---|------|------|---------|
| 1 | Skills精简 | main 29→19个 | 15-20% 系统提示词 |
| 2 | contextPruning TTL | 10m→5m | 10-15% 上下文 |
| 3 | maxConcurrent | 3→4 | 减少排队 |
| 4 | 心跳频率 | 2h→3h | 33% 心跳token |
| 5 | 子Agent reasoning | 3个关闭stream | 省reasoning token |
| 6 | AGENTS.md瘦身 | 4.5K→1.7K | ~1.5K/次 |
| 7 | HEARTBEAT.md精简 | 3K→1.2K | ~1K/次心跳 |
| 8 | TOOLS.md精简 | 6K→755B | ~3K/次 |

## 移出的按需文件
- `.learnings/group-chat-rules.md` — 群聊详细规则
- `.learnings/agent-rules.md` — Caveman协议+八荣八耻
- `.learnings/media-tools-reference.md` — AI视频/音乐工具速查

## 未采用（投入产出比低）
- Headroom: ONNX不可用+Windows兼容性
- RTK: Rust CLI Windows兼容性
- codegraph: 项目非大型代码库
- SimpleMem: lossless-claw已覆盖

## 省钱铁律（仍有效）
1. 同一任务不切换模型（缓存失效=全量重写）
2. 长任务拆短任务
3. 简单任务不开启reasoning
4. 会话压缩在50-60%触发
5. 大任务用子Agent并行
6. 子Agent模型分级
7. 每日热点流水线化
8. 子Agent Caveman风格
