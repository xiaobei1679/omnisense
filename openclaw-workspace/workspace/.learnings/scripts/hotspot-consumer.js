#!/usr/bin/env node
// hotspot-consumer.js — 自动消费昨日热点
// 用法: node hotspot-consumer.js [check|consume]
// check = 只检查不执行, consume = 检查+执行行动

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const { WORKSPACE_ROOT, PROJECT_DIR } = require('./lib/common.js');

// 路径由环境变量覆盖，缺省回退到当前用户 Desktop（跨用户/跨平台不再写死 Administrator）
const HOTSPOT_BASE = process.env.QCLAW_HOT_DIR
  || path.join(os.homedir(), 'Desktop', '每日热点');
const WORKSPACE = WORKSPACE_ROOT;

// 跨平台关键词搜索（替代 Windows 专用 findstr /s /i）
function searchKeywordInDirs(keyword, dirs) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    let found = false;
    const walk = (d) => {
      if (found) return;
      let entries;
      try { entries = fs.readdirSync(d, { withFileTypes: true }); }
      catch { return; }
      for (const e of entries) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) { walk(full); if (found) return; }
        else if (e.name.endsWith('.md')) {
          try {
            if (fs.readFileSync(full, 'utf-8').includes(keyword)) { found = true; return; }
          } catch { /* 跳过不可读文件 */ }
        }
      }
    };
    walk(dir);
    if (found) return true;
  }
  return false;
}

function getYesterdayDir() {
  const yesterday = new Date(Date.now() - 86400000);
  const dateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');
  return path.join(HOTSPOT_BASE, `qclaw${dateStr}`);
}

function checkHotspot() {
  const dir = getYesterdayDir();
  if (!fs.existsSync(dir)) {
    console.log(JSON.stringify({ ok: false, reason: '昨日热点目录不存在', dir }));
    return;
  }
  
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  const actionFile = files.find(f => f.includes('行动'));
  const hotspotFile = files.find(f => f.includes('热点'));
  
  if (!actionFile) {
    console.log(JSON.stringify({ ok: false, reason: '无行动清单', dir, files }));
    return;
  }
  
  // 读取行动清单
  const actionContent = fs.readFileSync(path.join(dir, actionFile), 'utf-8');
  const actions = actionContent.split('\n')
    .filter(l => l.match(/^[-*]\s|\d+\./))
    .map(l => l.replace(/^[-*]\s*|\d+\.\s*/, '').trim())
    .filter(l => l.length > 5);
  
  // 检查执行率
  let executed = 0;
  for (const action of actions) {
    // 简单检查：搜索workspace文件中是否包含关键词
    const keywords = action.slice(0, 8);
    const searchPaths = [
      WORKSPACE,
      path.join(WORKSPACE, '.learnings'),
      PROJECT_DIR
    ];
    if (searchKeywordInDirs(keywords, searchPaths)) executed++;
  }
  
  const rate = actions.length ? (executed / actions.length * 100).toFixed(0) + '%' : 'N/A';
  console.log(JSON.stringify({
    ok: true,
    dir,
    totalActions: actions.length,
    executed,
    rate,
    actions: actions.slice(0, 5) // 只显示前5条
  }, null, 2));
}

function consumeHotspot() {
  const dir = getYesterdayDir();
  if (!fs.existsSync(dir)) {
    console.log('昨日热点目录不存在: ' + dir);
    return;
  }
  
  // 1. 读取行动清单
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  const actionFile = files.find(f => f.includes('行动'));
  
  if (actionFile) {
    const content = fs.readFileSync(path.join(dir, actionFile), 'utf-8');
    console.log('📋 行动清单:');
    console.log(content);
    console.log('\n---\n');
  }
  
  // 2. gbrain入库检查
  try {
    const gbrainOut = execSync('gbrain search "热点" --limit 3', { encoding: 'utf-8', timeout: 10000 });
    if (gbrainOut && !gbrainOut.includes('0 results')) {
      console.log('✅ gbrain已有热点数据');
    } else {
      console.log('⚠️ gbrain无热点数据，执行hot-ingest...');
      try {
        execFileSync(process.execPath, [
          path.join(WORKSPACE, '.learnings', 'scripts', 'knowledge-loop.js'),
          'hot-ingest', '--dir', dir
        ], { encoding: 'utf-8', timeout: 30000 });
        console.log('✅ 热点已入库');
      } catch (e) {
        console.log('❌ hot-ingest失败: ' + e.message);
      }
    }
  } catch (e) {
    console.log('⚠️ gbrain检查失败: ' + e.message);
  }
  
  // 3. 输出待执行行动
  console.log('\n📊 请手动执行未完成的行动项');
}

const cmd = process.argv[2] || 'check';
if (cmd === 'check') {
  checkHotspot();
} else {
  consumeHotspot();
}
