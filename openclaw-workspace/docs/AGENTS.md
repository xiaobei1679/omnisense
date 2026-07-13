# Agent 团队说明

## 协作协议 v2.3

### 三阶段
1. **团队自治**：Agent各自执行任务，通过信箱(mailbox)异步沟通
2. **自我分析**：定期自检，记录经验到经验池
3. **跟你讨论**：遇到需要决策的问题，上报main Agent→用户

### 信箱系统
- 每个Agent有独立mailbox
- mailbox.js v2.0 管理名字映射
- 7种跨Agent建议场景

### 经验池
- push-all：心跳自动推送pending经验
- expire：定期清理过期经验
- 每条经验附 agent + category + confidence

### 技能进化
- scan：扫描使用模式
- propose：生成改进提案
- apply-all：应用低风险提案

### 升级条件 (8个)
1. 创作停滞>24h
2. 周边占比>50%
3. 角色偏移×3
4. Agent异常输出
5. 审核退回
6. 读者反馈<3.5分
7. 章节字数<2000
8. AI腔密度>15个/千字
