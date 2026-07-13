#!/usr/bin/env node
/**
 * 伏笔追踪器 (Foreshadow Tracker)
 * 
 * 用法：
 *   node foreshadow-tracker.js add <chapter> <id> <description>  -- 登记新伏笔
 *   node foreshadow-tracker.js resolve <chapter> <id>            -- 标记伏笔已回收
 *   node foreshadow-tracker.js list                              -- 列出所有伏笔
 *   node foreshadow-tracker.js check <file>                      -- 扫描章节文件检测标记
 *   node foreshadow-tracker.js report                            -- 生成伏笔状态报告
 * 
 * 标记语法（写在章节md文件中）：
 *   [foreshadow:id] 描述   -- 埋伏笔
 *   [resolve:id]            -- 回收伏笔
 * 
 * 数据文件：.learnings/foreshadow-data.json
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { PROJECT_DIR } = require('./lib/common.js');

const DATA_FILE = path.join(__dirname, '..', '.learnings', 'foreshadow-data.json');
const NOVEL_DIR = PROJECT_DIR;

function loadData() {
  if (!fs.existsSync(DATA_FILE)) return { foreshadows: [], log: [] };
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
  } catch {
    return { foreshadows: [], log: [] };
  }
}

function saveData(data) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function add(chapter, id, description) {
  const data = loadData();
  const existing = data.foreshadows.find(f => f.id === id);
  if (existing) {
    console.log(`⚠️  伏笔 ${id} 已存在，更新描述`);
    existing.description = description;
    existing.plantedChapter = parseInt(chapter);
  } else {
    data.foreshadows.push({
      id,
      description,
      plantedChapter: parseInt(chapter),
      plantedDate: new Date().toISOString(),
      resolvedChapter: null,
      resolvedDate: null,
      status: 'planted'
    });
    console.log(`✅ 伏笔 ${id} 已埋设（第${chapter}章）：${description}`);
  }
  saveData(data);
}

function resolve(chapter, id) {
  const data = loadData();
  const f = data.foreshadows.find(x => x.id === id);
  if (!f) {
    console.log(`❌ 伏笔 ${id} 不存在`);
    process.exit(1);
  }
  f.resolvedChapter = parseInt(chapter);
  f.resolvedDate = new Date().toISOString();
  f.status = 'resolved';
  console.log(`🎉 伏笔 ${id} 已回收（第${chapter}章）`);
  saveData(data);
}

function list() {
  const data = loadData();
  if (data.foreshadows.length === 0) {
    console.log('暂无伏笔记录');
    return;
  }
  console.log('=== 伏笔列表 ===');
  data.foreshadows.forEach(f => {
    const status = f.status === 'resolved' ? '✅' : '⏳';
    const resolveInfo = f.resolvedChapter ? ` → 第${f.resolvedChapter}章回收` : '';
    console.log(`${status} [${f.id}] 第${f.plantedChapter}章${resolveInfo}`);
    console.log(`   ${f.description}`);
  });
  const planted = data.foreshadows.filter(f => f.status === 'planted').length;
  const resolved = data.foreshadows.filter(f => f.status === 'resolved').length;
  console.log(`\n总计：${data.foreshadows.length}条（已回收${resolved}，待回收${planted}）`);
}

function checkFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 文件不存在：${filePath}`);
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, 'utf-8');
  const planted = [...content.matchAll(/\[foreshadow:(\S+?)\]\s*(.+?)(?:\n|$)/g)];
  const resolved = [...content.matchAll(/\[resolve:(\S+?)\]/g)];
  
  console.log(`=== 扫描结果：${path.basename(filePath)} ===`);
  if (planted.length > 0) {
    console.log('\n📌 埋设的伏笔：');
    planted.forEach(m => console.log(`  [${m[1]}] ${m[2].trim()}`));
  }
  if (resolved.length > 0) {
    console.log('\n🎉 回收的伏笔：');
    resolved.forEach(m => console.log(`  [${m[1]}]`));
  }
  if (planted.length === 0 && resolved.length === 0) {
    console.log('未发现伏笔标记');
  }
  console.log(`\n合计：埋设${planted.length}条，回收${resolved.length}条`);
}

function report() {
  const data = loadData();
  console.log('=== 伏笔状态报告 ===');
  console.log(`生成时间：${new Date().toLocaleString('zh-CN')}\n`);
  
  if (data.foreshadows.length === 0) {
    console.log('暂无伏笔记录');
    return;
  }
  
  // 按状态分组
  const planted = data.foreshadows.filter(f => f.status === 'planted');
  const resolved = data.foreshadows.filter(f => f.status === 'resolved');
  
  if (planted.length > 0) {
    console.log(`⏳ 待回收（${planted.length}条）：`);
    planted.forEach(f => {
      const chaptersAgo = resolved.length > 0 ? '' : '';
      console.log(`  [${f.id}] 第${f.plantedChapter}章埋设 - ${f.description}`);
    });
  }
  
  if (resolved.length > 0) {
    console.log(`\n✅ 已回收（${resolved.length}条）：`);
    resolved.forEach(f => {
      const span = f.resolvedChapter - f.plantedChapter;
      console.log(`  [${f.id}] 第${f.plantedChapter}章→第${f.resolvedChapter}章（跨${span}章）- ${f.description}`);
    });
  }
  
  // 超期预警（超过10章未回收）
  const maxChapter = Math.max(...data.foreshadows.map(f => f.plantedChapter), 0);
  const overdue = planted.filter(f => maxChapter - f.plantedChapter > 10);
  if (overdue.length > 0) {
    console.log(`\n⚠️ 超期预警（超过10章未回收）：`);
    overdue.forEach(f => {
      console.log(`  [${f.id}] 第${f.plantedChapter}章埋设，已过${maxChapter - f.plantedChapter}章`);
    });
  }
}

// CLI
const [,, cmd, ...args] = process.argv;
const commands = { add, resolve, list, check: checkFile, report };
if (commands[cmd]) {
  commands[cmd](...args);
} else {
  console.log('用法: node foreshadow-tracker.js [add|resolve|list|check|report]');
}
