const fs = require('fs');
const path = require('path');

const configPath = path.join(process.env.USERPROFILE, '.qclaw', 'openclaw.json');
const skillPath = path.join(process.env.USERPROFILE, '.qclaw', 'skills', 'g113593');

// 读取配置
const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

// 确保 skills.entries 存在
if (!config.skills) config.skills = {};
if (!config.skills.entries) config.skills.entries = {};

// 添加 g113593 技能配置
config.skills.entries['tomato-novelist'] = {
  enabled: true,
  path: skillPath,
  config: {}
};

// 保存配置
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

console.log('✅ g113593 (tomato-novelist) 技能已添加到 OpenClaw 配置');
console.log('路径:', skillPath);
