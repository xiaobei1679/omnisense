const fs = require('fs');
const path = require('path');
const cp = path.join(process.env.USERPROFILE, '.qclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(cp, 'utf8'));

// 需要保留心跳的 Agent（主控 + 核心创作 + 审核）
const keepHeartbeat = ['main', 'ds4ygtfdv3z7mmxn', 'agent-bdd9ff1a'];

// 子 Agent 用轻量模型
const lightModel = 'qclaw/pool-hy3-preview';

let changes = [];

config.agents.list.forEach(a => {
  // 1. 关掉非必要心跳
  if (!keepHeartbeat.includes(a.id)) {
    if (!a.heartbeat) a.heartbeat = {};
    if (a.heartbeat.enabled !== false) {
      a.heartbeat.enabled = false;
      changes.push('关心跳: ' + a.name);
    }
  }

  // 2. 非主控 Agent 降级模型
  if (a.id !== 'main' && a.model?.primary !== lightModel) {
    if (!a.model) a.model = {};
    a.model.primary = lightModel;
    changes.push('降模型: ' + a.name + ' -> ' + lightModel);
  }
});

// 3. 默认心跳间隔从30min调到60min
if (config.agents.defaults.heartbeat) {
  config.agents.defaults.heartbeat.intervalSeconds = 3600;
  changes.push('默认心跳: 30min -> 60min');
}

fs.writeFileSync(cp, JSON.stringify(config, null, 2), 'utf8');
console.log('✅ 已完成:');
changes.forEach(c => console.log('  -', c));
console.log('✅ 需要重启 Gateway');
