// 创作串行依赖链 v1.0
//
// 每条链下游Agent不拿到上游产出就卡住——这是让团队"活"起来的核心机制

module.exports = {
  chains: {
    // 小说创作链：创作 → 架构师审设定 → 审核终检
    novel: [
      { agent: "小说创作专家(ds4ygtfdv3z7mmxn)", action: "写正文", output: "章节稿件" },
      { agent: "世界观架构师(worldview-architect)", action: "设定一致性审查", input_from: 0, output: "设定审读意见", wait: true },
      { agent: "审核专员(agent-bdd9ff1a)", action: "终审五维", input_from: 1, output: "审核报告", wait: true }
    ],
    
    // 设定变更链：任何人改设定 → 架构师审批
    setting_change: [
      { agent: "* (任何Agent)", action: "提议设定变更", output: "设定变更提案" },
      { agent: "世界观架构师(worldview-architect)", action: "审批+全局一致性扫描", input_from: 0, output: "批准/否决/修改", wait: true }
    ],
    
    // 视频管线链：创作Agent出脚本 → 管线Agent出视频 → 市场评估
    video: [
      { agent: "视频管线Owner", action: "拿脚本→生成帧→合成", output: "成品MP4" },
      { agent: "市场研究员(irfnf4l86a7w0aii)", action: "竞品对标+传播潜力评估", input_from: 0, output: "市场评估报告", wait: true }
    ],
    
    // 每日热点链：热点产出 → 心跳消费TOP1 → 世界观成长
    hotspot: [
      { agent: "cron:每日热点", action: "15维收集+AI消化+行动清单", output: "每日热点报告" },
      { agent: "心跳(main)", action: "读取TOP1行动→执行或分派", input_from: 0, output: "行动闭环", wait: true }
    ]
  },
  
  // 阻塞规则
  blocking: {
    max_wait_minutes: 120,  // 下游最多等2小时，超时→标记阻塞+跳过继续
    retry_on_block: true,    // 阻塞解除后自动重试
    escalation: "连续3次阻塞→推用户通知"
  }
};
