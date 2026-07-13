const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE, '.qclaw', 'openclaw.json');

// 读取配置
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 找到 main Agent 并添加 tomato-novelist
const mainAgent = config.agents.list.find(a => a.id === 'main');
if (mainAgent) {
  if (!mainAgent.skills.includes('tomato-novelist')) {
    mainAgent.skills.push('tomato-novelist');
    console.log('✅ 已添加 tomato-novelist 到主Agent (main)');
  } else {
    console.log('⏭️ 主Agent已有tomato-novelist');
  }
}

// 找到小说创作专家并添加
const fictionAgent = config.agents.list.find(a => a.id === 'ds4ygtfdv3z7mmxn');
if (fictionAgent) {
  if (!fictionAgent.skills.includes('tomato-novelist')) {
    fictionAgent.skills.push('tomato-novelist');
    console.log('✅ 已添加 tomato-novelist 到小说创作专家');
  } else {
    console.log('⏭️ 小说创作专家已有tomato-novelist');
  }
}

// 保存
fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
console.log('✅ 配置已保存');
