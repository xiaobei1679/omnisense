#!/usr/bin/env node
// cron-templates.js — Cron任务模板系统
// 用法:
//   node cron-templates.js list              — 列出所有模板
//   node cron-templates.js show <name>       — 显示模板详情
//   node cron-templates.js create <name>     — 从模板创建cron任务（输出JSON供cron工具使用）

const fs = require('fs');
const path = require('path');

const TEMPLATES = {
  'daily-hotspot': {
    name: '每日热点采集',
    description: '每天08:00采集热点，6环节串行',
    schedule: { kind: 'cron', expr: '0 8 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: `你是一个热点采集Agent。执行以下6个环节：
1. 搜索今日AI/科技/创作/视频/Agent/Token方向的热点
2. 每个方向搜索3-5条
3. 汇总成markdown格式
4. 写入 ~/Desktop/每日热点\\qclaw<YYYYMMDD>\\今日热点.md
5. 提取可执行行动清单
6. 写入 ~/Desktop/每日热点\\qclaw<YYYYMMDD>\\今日行动_<YYYYMMDD>.md
完成后输出1行总结。`,
      timeoutSeconds: 1500
    },
    delivery: { mode: 'announce' }
  },
  'daily-standup': {
    name: '每日站会',
    description: '每天09:00执行团队站会',
    schedule: { kind: 'cron', expr: '0 9 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: `你是团队站会Agent。执行以下任务：
1. 读取MEMORY.md获取当前项目状态
2. 读取最近的memory/YYYY-MM-DD.md获取昨日动态
3. 检查各Agent最近活动
4. 生成站会报告：昨日完成/今日计划/阻塞项
5. 写入 ~/Desktop/QClaw产出文件\\_协作基础设施_\\站会_<YYYYMMDD>.md`,
      timeoutSeconds: 600
    },
    delivery: { mode: 'announce' }
  },
  'weekly-knowledge': {
    name: '每周知识库整理',
    description: '每周日10:00整理知识库+技能发现',
    schedule: { kind: 'cron', expr: '0 10 * * 0', tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: `你是知识库管理Agent。执行以下任务：
1. 扫描本周知识库新增文件
2. 整理分类
3. 运行 node .learnings/scripts/skill-discovery.js scan
4. 生成周报
5. 写入 ~/Desktop/QClaw产出文件\\知识库\\周报_<YYYYMMDD>.md`,
      timeoutSeconds: 1200
    },
    delivery: { mode: 'announce' }
  },
  'exp-expire': {
    name: '经验过期巡检',
    description: '每天12:00清理过期经验',
    schedule: { kind: 'cron', expr: '0 12 * * *', tz: 'Asia/Shanghai' },
    sessionTarget: 'isolated',
    payload: {
      kind: 'agentTurn',
      message: `执行经验池过期巡检：
1. 运行 node .learnings/scripts/experience-pool.js expire
2. 输出清理结果`,
      timeoutSeconds: 300
    },
    delivery: { mode: 'none' }
  },
  'reminder': {
    name: '一次性提醒',
    description: '模板：一次性提醒（需传--time和--text参数）',
    schedule: { kind: 'at', at: '<ISO时间>' },
    sessionTarget: 'main',
    payload: {
      kind: 'systemEvent',
      text: '<提醒内容>'
    }
  }
};

function listTemplates() {
  console.log('Cron模板列表:\n');
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    console.log(`  ${key.padEnd(20)} — ${tmpl.name}：${tmpl.description}`);
    console.log(`    ${' '.repeat(22)}调度: ${JSON.stringify(tmpl.schedule)}`);
    console.log('');
  }
  console.log('用法: node cron-templates.js create <name> | show <name>');
}

function showTemplate(name) {
  const tmpl = TEMPLATES[name];
  if (!tmpl) { console.log('未找到模板: ' + name); return; }
  console.log(JSON.stringify(tmpl, null, 2));
}

function createTemplate(name) {
  const tmpl = TEMPLATES[name];
  if (!tmpl) { console.log('未找到模板: ' + name); return; }
  
  // 输出可直接用于cron工具的job对象
  const job = {
    name: tmpl.name,
    schedule: tmpl.schedule,
    sessionTarget: tmpl.sessionTarget,
    payload: tmpl.payload,
    delivery: tmpl.delivery || { mode: 'announce' },
    enabled: true
  };
  
  console.log(JSON.stringify(job, null, 2));
  console.error('\n# 用cron工具创建: 将上面的JSON作为job参数传入');
}

const cmd = process.argv[2];
const arg = process.argv[3];

switch (cmd) {
  case 'list': listTemplates(); break;
  case 'show': showTemplate(arg); break;
  case 'create': createTemplate(arg); break;
  default:
    console.log('cron-templates.js — Cron任务模板系统');
    console.log('  list          列出所有模板');
    console.log('  show <name>   显示模板详情');
    console.log('  create <name> 输出可创建的JSON');
    console.log('\n可用模板: ' + Object.keys(TEMPLATES).join(', '));
}
