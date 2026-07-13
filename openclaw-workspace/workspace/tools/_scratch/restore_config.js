const fs = require('fs');
const path = require('path');

const base = path.join(process.env.USERPROFILE, '.qclaw');
const src = path.join(base, 'openclaw.json.clobbered.2026-06-24T15-05-38-548Z');
const dst = path.join(base, 'openclaw.json');

// 读取备份
const config = JSON.parse(fs.readFileSync(src, 'utf8'));

console.log('📋 备份内容:');
console.log('  Agent数:', config.agents.list.length);
config.agents.list.forEach(a => {
  console.log('  -', a.id, '(' + (a.name || '?') + ')', a.skills ? 'skills:' + a.skills.length : '无skills');
});

// 给 main Agent 添加 tomato-novelist（如果还没有）
const mainAgent = config.agents.list.find(a => a.id === 'main');
if (mainAgent) {
  if (!mainAgent.skills) mainAgent.skills = [];
  if (!mainAgent.skills.includes('tomato-novelist')) {
    mainAgent.skills.push('tomato-novelist');
    console.log('✅ 已添加 tomato-novelist 到主Agent');
  }
}

// 给小说创作专家添加 tomato-novelist
const fictionAgent = config.agents.list.find(a => a.id === 'ds4ygtfdv3z7mmxn');
if (fictionAgent) {
  if (!fictionAgent.skills) fictionAgent.skills = [];
  if (!fictionAgent.skills.includes('tomato-novelist')) {
    fictionAgent.skills.push('tomato-novelist');
    console.log('✅ 已添加 tomato-novelist 到小说创作专家');
  }
}

// 恢复到 openclaw.json
fs.writeFileSync(dst, JSON.stringify(config, null, 2), 'utf8');
console.log('✅ 配置已恢复并保存');
console.log('✅ 请重启 Gateway 使配置生效');
