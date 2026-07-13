#!/usr/bin/env node
// team-cli.js — 团队自成长系统统一入口
// 用法:
//   node team-cli.js status          — 全系统状态概览
//   node team-cli.js heal            — 执行自愈
//   node team-cli.js feedback <cmd>  — 创作反馈（record/extract/patterns/push）
//   node team-cli.js discover <cmd>  — 技能发现（scan/verify/integrate/status）
//   node team-cli.js experience <cmd> — 经验池（add/list/push/stats）
//   node team-cli.js evolve <cmd>    — Skill进化（scan/propose/apply/stats）
//   node team-cli.js knowledge <cmd> — 知识环（status/hot-ingest）
//   node team-cli.js dashboard       — 生成仪表盘数据

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const SCRIPTS_DIR = __dirname;
const nodePath = process.execPath;

const commands = {
  status: () => {
    console.log('📊 团队自成长系统状态\n');
    runScript('auto-heal.js', ['check']);
    runScript('experience-pool.js', ['stats']);
    runScript('skill-discovery.js', ['status']);
    runScript('creation-feedback.js', ['patterns']);
  },
  heal: () => runScript('auto-heal.js', ['fix']),
  feedback: (args) => runScript('creation-feedback.js', args),
  discover: (args) => runScript('skill-discovery.js', args),
  experience: (args) => runScript('experience-pool.js', args),
  evolve: (args) => runScript('skill-evolution.js', args),
  knowledge: (args) => runScript('knowledge-loop.js', args),
  hotspot: (args) => runScript('hotspot-consumer.js', args),
  cron: (args) => runScript('cron-templates.js', args),
  dashboard: () => {
    const out = execFileSync(nodePath, [path.join(SCRIPTS_DIR, 'dashboard-data.js')], { encoding: 'utf-8' });
    const dashboardDir = path.resolve(SCRIPTS_DIR, '..', '..', 'dashboard');
    if (!fs.existsSync(dashboardDir)) fs.mkdirSync(dashboardDir, { recursive: true });
    fs.writeFileSync(path.join(dashboardDir, 'data.json'), out, 'utf-8');
    console.log('✅ 仪表盘数据已更新: dashboard/data.json');
  }
};

function runScript(name, args) {
  try {
    const out = execFileSync(nodePath, [path.join(SCRIPTS_DIR, name), ...args], { encoding: 'utf-8', timeout: 30000 });
    console.log(out);
  } catch (e) {
    console.error(`❌ ${name} 执行失败: ${e.message}`);
  }
}

const [cmd, ...args] = process.argv.slice(2);
if (commands[cmd]) {
  commands[cmd](args);
} else {
  console.log('team-cli.js — 团队自成长系统统一入口');
  console.log('  status           全系统状态概览');
  console.log('  heal             执行自愈');
  console.log('  feedback <cmd>   创作反馈（record/extract/patterns/push）');
  console.log('  discover <cmd>   技能发现（scan/verify/integrate/status）');
  console.log('  experience <cmd> 经验池（add/list/push/stats）');
  console.log('  evolve <cmd>     Skill进化（scan/propose/apply/stats）');
  console.log('  knowledge <cmd>  知识环（status/hot-ingest）');
  console.log('  hotspot <cmd>    热点消费（check/consume）');
  console.log('  cron <cmd>       Cron模板（list/show/create）');
  console.log('  dashboard        生成仪表盘数据');
}
