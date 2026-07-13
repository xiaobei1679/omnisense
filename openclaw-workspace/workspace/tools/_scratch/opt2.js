const fs = require('fs');
const path = require('path');
const cp = path.join(process.env.USERPROFILE, '.qclaw', 'openclaw.json');
const config = JSON.parse(fs.readFileSync(cp, 'utf8'));

const keep = ['main', 'ds4ygtfdv3z7mmxn', 'agent-bdd9ff1a'];
const light = 'qclaw/pool-hy3-preview';
let log = [];

// 默认心跳 → 60min
config.agents.defaults.heartbeat.intervalSeconds = 3600;
log.push('默认心跳: 60min');

config.agents.list.forEach(a => {
  // 心跳：只保留3个核心
  if (!keep.includes(a.id)) {
    a.heartbeat = a.heartbeat || {};
    a.heartbeat.enabled = false;
    log.push('心跳OFF: ' + a.name);
  }
  // 模型：非主控全部降级
  if (a.id !== 'main') {
    a.model = a.model || {};
    a.model.primary = light;
    log.push('模型降级: ' + a.name + ' → hy3-preview');
  }
});

fs.writeFileSync(cp, JSON.stringify(config, null, 2), 'utf8');
console.log('✅ 完成 (' + log.length + '项)');
log.forEach(l => console.log('  ', l));
