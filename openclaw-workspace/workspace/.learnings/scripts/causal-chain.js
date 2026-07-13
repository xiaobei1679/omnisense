#!/usr/bin/env node
/**
 * 因果链检测器 (Causal Chain Checker)
 * 
 * 用法：
 *   node causal-chain.js add <fromChapter> <toChapter> <cause> <effect>  -- 登记因果
 *   node causal-chain.js check                                           -- 检查断链
 *   node causal-chain.js list                                            -- 列出所有因果
 *   node causal-chain.js graph                                           -- 输出mermaid图谱
 * 
 * 数据文件：.learnings/causal-chain-data.json
 * 
 * 因果类型：
 *   event   — 事件因果（A事件导致B事件）
 *   character — 角色因果（A行为导致B状态变化）
 *   plot    — 剧情因果（A设定导致B发展）
 */

const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', '.learnings', 'causal-chain-data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { chains: [], brokenLinks: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { chains: [], brokenLinks: [] };
  }
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function add(fromChapter, toChapter, cause, effect, type = 'event') {
  const data = loadData();
  const id = `C${String(data.chains.length + 1).padStart(3, '0')}`;
  data.chains.push({
    id,
    fromChapter: parseInt(fromChapter),
    toChapter: parseInt(toChapter),
    cause,
    effect,
    type,
    status: 'active',
    createdDate: new Date().toISOString()
  });
  console.log(`✅ 因果链 ${id} 已登记：`);
  console.log(`   第${fromChapter}章「${cause}」→ 第${toChapter}章「${effect}」`);
  saveData(data);
}

function check() {
  const data = loadData();
  if (data.chains.length === 0) {
    console.log('暂无因果链记录');
    return;
  }
  
  const broken = [];
  const valid = [];
  
  data.chains.forEach(chain => {
    // 检查：toChapter 不应超前 fromChapter
    if (chain.toChapter < chain.fromChapter) {
      broken.push({ ...chain, reason: '结果章节早于原因章节' });
    }
    // 检查：跨度超过15章可能有遗忘风险
    else if (chain.toChapter - chain.fromChapter > 15) {
      broken.push({ ...chain, reason: `跨度过大（${chain.toChapter - chain.fromChapter}章），读者可能遗忘原因` });
    } else {
      valid.push(chain);
    }
  });
  
  // 检查孤儿节点：某个effect没有被其他chain的cause引用
  const allCauses = data.chains.map(c => c.cause);
  const allEffects = data.chains.map(c => c.effect);
  const orphans = data.chains.filter(c => 
    !allCauses.includes(c.effect) && !allEffects.includes(c.cause)
  );
  
  console.log('=== 因果链检测 ===');
  console.log(`总链条：${data.chains.length}条`);
  console.log(`有效：${valid.length}条`);
  console.log(`断裂/风险：${broken.length}条`);
  console.log(`孤儿节点：${orphans.length}条\n`);
  
  if (broken.length > 0) {
    console.log('⚠️ 断裂/风险链条：');
    broken.forEach(b => {
      console.log(`  [${b.id}] 第${b.fromChapter}章→第${b.toChapter}章`);
      console.log(`    ${b.cause} → ${b.effect}`);
      console.log(`    原因：${b.reason}`);
    });
  }
  
  if (orphans.length > 0) {
    console.log('\n🔗 孤儿节点（前后无衔接）：');
    orphans.forEach(o => {
      console.log(`  [${o.id}] 第${o.fromChapter}章「${o.cause}」→ 第${o.toChapter}章「${o.effect}」`);
    });
  }
  
  if (broken.length === 0 && orphans.length === 0) {
    console.log('✅ 所有因果链完整，无断裂');
  }
}

function list() {
  const data = loadData();
  if (data.chains.length === 0) {
    console.log('暂无因果链记录');
    return;
  }
  
  console.log('=== 因果链列表 ===');
  const sorted = [...data.chains].sort((a, b) => a.fromChapter - b.fromChapter);
  sorted.forEach(c => {
    const span = c.toChapter - c.fromChapter;
    console.log(`[${c.id}] 第${c.fromChapter}章→第${c.toChapter}章（跨${span}章）`);
    console.log(`  ${c.cause} → ${c.effect} [${c.type}]`);
  });
  console.log(`\n总计：${data.chains.length}条`);
}

function graph() {
  const data = loadData();
  if (data.chains.length === 0) {
    console.log('暂无因果链记录');
    return;
  }
  
  console.log('```mermaid');
  console.log('graph LR');
  data.chains.forEach(c => {
    const fromNode = `C${c.fromChapter}_${c.id}`;
    const toNode = `E${c.toChapter}_${c.id}`;
    // 转义特殊字符
    const cause = c.cause.replace(/["\[\]]/g, '').substring(0, 20);
    const effect = c.effect.replace(/["\[\]]/g, '').substring(0, 20);
    console.log(`  ${fromNode}["第${c.fromChapter}章: ${cause}"] --> ${toNode}["第${c.toChapter}章: ${effect}"]`);
  });
  console.log('```');
}

// CLI
const [,, cmd, ...args] = process.argv;
const commands = { add, check, list, graph };
if (commands[cmd]) {
  if (cmd === 'add') {
    add(...args);
  } else {
    commands[cmd](...args);
  }
} else {
  console.log('用法: node causal-chain.js [add|check|list|graph]');
}
