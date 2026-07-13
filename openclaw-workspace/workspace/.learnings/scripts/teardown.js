#!/usr/bin/env node
/**
 * 拆书工作台 (Novel Teardown Workbench)
 * 
 * 用法：
 *   node teardown.js analyze <file.md>           -- 拆解单本/单章
 *   node teardown.js character <file.md>         -- 提取角色档案
 *   node teardown.js plot <file.md>              -- 提取剧情结构
 *   node teardown.js pacing <file.md>            -- 分析节奏分布
 *   node teardown.js hooks <file.md>             -- 提取钩子/爽点
 *   node teardown.js compare <file1> <file2>     -- 对比两本
 * 
 * 数据目录：.learnings/teardown/
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '.learnings', 'teardown');

function countCJK(text) {
  const cjk = text.match(/[\u4e00-\u9fff]/g);
  return cjk ? cjk.length : 0;
}

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 角色提取正则
const CHARACTER_PATTERNS = [
  /(?:主角|男主|女主|主人公)[：:]\s*(\S+)/g,
  /(?:配角|次要角色)[：:]\s*(\S+)/g,
];

// 钩子关键词
const HOOK_OPENERS = ['突然', '就在这时', '话音未落', '话音刚落', '然而', '偏偏', '不料', '谁知', '哪知', '没想到', '谁知到', '岂料', '乍然', '猛地'];
const HOOK_CLOSERS = ['究竟', '到底', '难道', '莫非', '可惜', '不幸', '偏偏', '然而', '但是', '不过', '？', '……', '...', '未完'];

// 爽点关键词  
const COOL_POINTS = ['打脸', '震惊', '倒吸', '瞪大', '不敢置信', '怎么可能', '他竟然', '她竟然', '这不可能', '太强了', '好厉害', '天哪', '我的天'];

function analyze(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const totalCJK = countCJK(content);
  
  // 基础统计
  const stats = {
    file: path.basename(filePath),
    totalCJK,
    paragraphs: lines.length,
    avgParaLen: Math.round(totalCJK / lines.length),
  };
  
  // 结构分析（按章节标记分割）
  const chapterMarkers = content.match(/第[\d一二三四五六七八九十百]+章[^\n]*/g) || [];
  stats.chapters = chapterMarkers.length;
  
  // 角色提取
  const characters = new Set();
  // 从引号对话中提取说话者
  const dialogues = content.match(/[「""]([^「""」]+)[」""]/g) || [];
  // 从"XX说""XX道"提取
  const speakers = content.match(/([\u4e00-\u9fff]{2,4})(?:说道|说|道|喊道|叫道|冷声道|低声道|怒道|笑道|问道)/g) || [];
  speakers.forEach(s => {
    const name = s.match(/([\u4e00-\u9fff]{2,4})/)[1];
    if (!['他们', '我们', '你们', '自己', '这个', '那个', '什么', '怎么'].includes(name)) {
      characters.add(name);
    }
  });
  stats.characters = [...characters];
  
  // 钩子分析
  const hooks = { openers: [], closers: [] };
  HOOK_OPENERS.forEach(w => {
    const count = (content.match(new RegExp(w, 'g')) || []).length;
    if (count > 0) hooks.openers.push({ word: w, count });
  });
  HOOK_CLOSERS.forEach(w => {
    const count = (content.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
    if (count > 0) hooks.closers.push({ word: w, count });
  });
  stats.hooks = hooks;
  
  // 爽点分析
  const coolPoints = [];
  COOL_POINTS.forEach(w => {
    const count = (content.match(new RegExp(w, 'g')) || []).length;
    if (count > 0) coolPoints.push({ word: w, count });
  });
  stats.coolPoints = coolPoints;
  
  // 节奏分布（每1000字一段）
  const segments = [];
  const allCJK = content.match(/[\u4e00-\u9fff]/g) || [];
  for (let i = 0; i < allCJK.length; i += 1000) {
    const seg = allCJK.slice(i, i + 1000).join('');
    const dialogue = (seg.match(/[「""]/g) || []).length;
    const action = seg.split(/[,。！？]/).filter(s => s.length > 3).length;
    segments.push({ dialogue, action });
  }
  stats.pacing = segments;
  
  // 对话密度
  const dialogueCount = (content.match(/[「""]/g) || []).length / 2;
  stats.dialogueDensity = totalCJK > 0 ? ((dialogueCount / totalCJK) * 1000).toFixed(2) : 0;
  
  // 输出
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📚 拆书分析：${stats.file}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`字数：${stats.totalCJK} | 段落：${stats.paragraphs} | 章节：${stats.chapters}`);
  console.log(`平均段落：${stats.avgParaLen}字 | 对话密度：${stats.dialogueDensity}/千字`);
  
  console.log(`\n👤 角色（${stats.characters.length}个）：`);
  stats.characters.slice(0, 20).forEach(c => console.log(`  - ${c}`));
  
  console.log(`\n🎣 钩子分析：`);
  console.log(`  开篇钩子：${stats.hooks.openers.reduce((a, h) => a + h.count, 0)}次`);
  stats.hooks.openers.forEach(h => console.log(`    "${h.word}" × ${h.count}`));
  console.log(`  结尾钩子：${stats.hooks.closers.reduce((a, h) => a + h.count, 0)}次`);
  stats.hooks.closers.forEach(h => console.log(`    "${h.word}" × ${h.count}`));
  
  console.log(`\n🔥 爽点分析：`);
  stats.coolPoints.forEach(p => console.log(`  "${p.word}" × ${p.count}`));
  
  console.log(`\n📊 节奏分布（每千字）：`);
  const pacingChart = stats.pacing.map(s => {
    const level = s.dialogue > 5 ? 'D' : s.action > 15 ? 'A' : '─';
    return level;
  }).join('');
  console.log(`  ${pacingChart}`);
  console.log(`  (D=对话密集, A=动作密集, ─=平稳)`);
  
  // 保存
  ensureDir();
  const savePath = path.join(DATA_DIR, `${path.basename(filePath, '.md')}_teardown.json`);
  fs.writeFileSync(savePath, JSON.stringify(stats, null, 2), 'utf-8');
  console.log(`\n💾 已保存到 ${savePath}`);
  
  return stats;
}

function character(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const characters = new Map();
  
  // 提取所有"XX说/道"模式
  const speakerMatches = [...content.matchAll(/([\u4e00-\u9fff]{2,4})(?:冷声说|低声说|怒道|笑道|说道|说|道|喊道|叫道|冷声道|低声道|问道|沉声道|淡淡说|厉声道)/g)];
  speakerMatches.forEach(m => {
    const name = m[1];
    if (['他们', '我们', '你们', '自己', '这个', '那个'].includes(name)) return;
    if (!characters.has(name)) characters.set(name, { mentions: 0, dialogues: 0 });
    characters.get(name).mentions++;
    characters.get(name).dialogues++;
  });
  
  // 提取"XX的"描写
  const descMatches = [...content.matchAll(/([\u4e00-\u9fff]{2,4})的(?:眼|脸|手|脚|身|背|头|嘴|声音|表情|目光|神色|动作)/g)];
  descMatches.forEach(m => {
    const name = m[1];
    if (!characters.has(name)) characters.set(name, { mentions: 0, dialogues: 0, descriptions: [] });
    if (!characters.get(name).descriptions) characters.get(name).descriptions = [];
    characters.get(name).descriptions.push(m[0]);
  });
  
  console.log(`\n=== 角色档案：${path.basename(filePath)} ===`);
  const sorted = [...characters.entries()].sort((a, b) => b[1].mentions - a[1].mentions);
  sorted.forEach(([name, data]) => {
    console.log(`\n👤 ${name}（提及${data.mentions}次，对话${data.dialogues || 0}次）`);
    if (data.descriptions && data.descriptions.length > 0) {
      console.log(`  描写：${[...new Set(data.descriptions)].slice(0, 5).join('、')}`);
    }
  });
  
  return Object.fromEntries(sorted);
}

function hooks(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  
  console.log(`\n=== 钩子提取：${path.basename(filePath)} ===`);
  
  // 检查每章开头
  const chapterStarts = [];
  let currentChapter = 0;
  let currentStart = [];
  
  lines.forEach((line, i) => {
    if (line.match(/第[\d一二三四五六七八九十百]+章/)) {
      if (currentStart.length > 0) {
        chapterStarts.push({ chapter: currentChapter, opening: currentStart.join('') });
      }
      currentChapter++;
      currentStart = [];
    } else if (currentStart.length < 5) {
      currentStart.push(line);
    }
  });
  if (currentStart.length > 0) {
    chapterStarts.push({ chapter: currentChapter, opening: currentStart.join('') });
  }
  
  chapterStarts.forEach(cs => {
    const openingCJK = countCJK(cs.opening);
    const hasHook = HOOK_OPENERS.some(w => cs.opening.includes(w));
    const status = hasHook ? '✅' : '⚠️';
    console.log(`\n${status} 第${cs.chapter}章开篇（前${openingCJK}字）：`);
    console.log(`  ${cs.opening.substring(0, 100).replace(/\n/g, ' ')}...`);
  });
  
  // 检查每章结尾
  console.log(`\n--- 章节结尾 ---`);
  const chapterEnds = [];
  let currentEnd = [];
  
  lines.forEach((line, i) => {
    currentEnd.push(line);
    if (currentEnd.length > 3) currentEnd.shift();
    if (i === lines.length - 1 || (i < lines.length - 1 && lines[i + 1].match(/第[\d一二三四五六七八九十百]+章/))) {
      chapterEnds.push({ chapter: chapterEnds.length + 1, ending: currentEnd.join('') });
    }
  });
  
  chapterEnds.forEach(ce => {
    const hasHook = HOOK_CLOSERS.some(w => ce.ending.includes(w));
    const status = hasHook ? '✅' : '⚠️';
    console.log(`${status} 第${ce.chapter}章结尾：${ce.ending.substring(ce.ending.length - 80).replace(/\n/g, ' ')}`);
  });
}

function compare(file1, file2) {
  const a = analyze(file1);
  const b = analyze(file2);
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 对比分析');
  console.log(`${'═'.repeat(60)}`);
  console.log(`${'指标'.padEnd(15)} | ${a.file.padEnd(25)} | ${b.file}`);
  console.log(`${'─'.repeat(70)}`);
  console.log(`${'字数'.padEnd(15)} | ${String(a.totalCJK).padEnd(25)} | ${b.totalCJK}`);
  console.log(`${'角色数'.padEnd(15)} | ${String(a.characters.length).padEnd(25)} | ${b.characters.length}`);
  console.log(`${'开篇钩子'.padEnd(15)} | ${String(a.hooks.openers.reduce((s, h) => s + h.count, 0)).padEnd(25)} | ${b.hooks.openers.reduce((s, h) => s + h.count, 0)}`);
  console.log(`${'结尾钩子'.padEnd(15)} | ${String(a.hooks.closers.reduce((s, h) => s + h.count, 0)).padEnd(25)} | ${b.hooks.closers.reduce((s, h) => s + h.count, 0)}`);
  console.log(`${'爽点'.padEnd(15)} | ${String(a.coolPoints.reduce((s, p) => s + p.count, 0)).padEnd(25)} | ${b.coolPoints.reduce((s, p) => s + p.count, 0)}`);
  console.log(`${'对话密度/千字'.padEnd(15)} | ${String(a.dialogueDensity).padEnd(25)} | ${b.dialogueDensity}`);
}

// CLI
const [,, cmd, ...args] = process.argv;
const commands = { analyze: (f) => analyze(f), character: (f) => character(f), hooks: (f) => hooks(f), compare };
if (commands[cmd]) {
  commands[cmd](...args);
} else {
  console.log('用法: node teardown.js [analyze|character|hooks|compare]');
}
