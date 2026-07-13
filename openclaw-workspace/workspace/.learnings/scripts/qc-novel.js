// qc-novel.js v1.2 — 小说章节质检脚本（增强版）
// 新增：解锁表对照 + 跨章一致性快照 + 单文件支持 + 中文路径自动修复
// 用法: node qc-novel.js <章节目录路径|单文件.md路径>

const fs = require('fs');
const path = require('path');

// === 中文路径自动修复（Windows PowerShell 编码问题） ===
function fixPathEncoding(raw) {
  if (!raw) return raw;
  if (fs.existsSync(raw)) return raw;
  // Windows PowerShell 可能以 UCS-2/UTF-16 传递中文
  const decoders = [
    () => Buffer.from(raw, 'ucs2').toString('utf8'),
    () => Buffer.from(raw, 'utf16le').toString('utf8'),
  ];
  for (const decode of decoders) {
    try {
      const fixed = decode();
      if (fixed && fixed !== raw && fs.existsSync(fixed)) {
        console.log(`[fix] 中文路径已自动修复: ${fixed}`);
        return fixed;
      }
    } catch (e) { /* skip */ }
  }
  return raw;
}

const DISABLED_NAMES = ['永夜', '苍玄', '阿古', '灵契', '本源会', '龙渊'];
const COMPLIANCE_MARK = '本文经AI辅助创作';
const CJK_MIN = 2000;
const CJK_TARGET = 2200;

// UNLOCK_TABLE v1.1 — 每章应解锁设定（基于信息解锁表C版）
const UNLOCK_TABLE = {
  '第1章': ['异常E级', '书院伪装', '小黑初现'],
  '第2章': ['校园地理', '宿舍初见'],
  '第3章': ['宿舍潜规则', '世家鄙视链'],
  '第4章': ['灵线概念', '小黑鳞片初现', '林氏世家身份'],
  '第5章': ['地中级标记', '林氏封印提及', '封印三态'],
  '第6章': ['新生试炼规则', '真异常讨伐'],
  '第7章': ['战术模拟林', '灵线战斗', '小黑实战'],
  '第8章': ['超规格异常D级', '人为投放线索', '代价初现'],
  '第9章': ['地中级确认', '养神期', '灵线损耗'],
  '第10章': ['裂缝经济学', '宿舍关系解冻', '瀛洲预告'],
  '第11章': ['系内交流月', '瀛洲交换生', '七系'],
  '第12章': ['七系切磋', '高丽首次提及', '世家暗斗'],
  '第13章': ['式神', '阴阳道'],
  '第14章': ['阴阳道三分支', '渡航道', '弃人会定义'],
  '第15章': ['交换生日常', '禁地铜铃'],
  '第16章': ['暗流', '世家张力'],
  '第17章': ['苏晓发现', '命契'],
  '第18章': ['保密', '土御门'],
  '第19章': ['院城对抗赛'],
  '第20章': ['名单', '小黑=古神碎片'],
};

function countCJK(text) {
  const cjkRe = /[\u4E00-\u9FFF\u3400-\u4DBF]/gu;
  return (text.match(cjkRe) || []).length;
}

function checkOldNames(text) {
  const found = [];
  for (const name of DISABLED_NAMES) {
    if (text.includes(name)) found.push(name);
  }
  return found;
}

function checkCompliance(text) {
  return text.includes(COMPLIANCE_MARK);
}

function statusLabel(cjk) {
  if (cjk >= CJK_TARGET) return 'green';
  if (cjk >= CJK_MIN) return 'yellow';
  return 'red';
}

function checkUnlocks(text, chapterName) {
  const expected = UNLOCK_TABLE[chapterName] || [];
  const found = [];
  const missing = [];
  for (const item of expected) {
    // Simple keyword check — keywords extracted from unlock item
    const keywords = item.split(/[，,、\s]+/).filter(k => k.length > 1);
    const matched = keywords.some(kw => text.includes(kw));
    if (matched) found.push(item);
    else missing.push(item);
  }
  return { found, missing };
}

// === Cross-chapter consistency snapshot ===
function extractEvents(text) {
  const events = [];
  const timeRe = /第[一二三四五六七八九十\d]+[天周日月年]|早上|中午|下午|晚上|凌晨|次日|翌日/g;
  const match = text.match(timeRe);
  if (match) events.push(...match.filter((v, i, a) => a.indexOf(v) === i));
  return events;
}

function extractCharacters(text) {
  const chars = [];
  const nameRe = /林远|小黑|苏晓|赵峰|王磊|沈默|沈彧|顾灯|慕容夜/g;
  const match = text.match(nameRe);
  if (match) {
    const unique = [...new Set(match)];
    chars.push(...unique);
  }
  return chars;
}

// === MAIN ===
const rawArg = process.argv[2];
const inputPath = fixPathEncoding(rawArg);

if (!inputPath || !fs.existsSync(inputPath)) {
  console.log('Usage: node qc-novel.js <章节目录路径|单文件.md路径>');
  console.log('  目录模式: node qc-novel.js "C:\\path\\小说正文"');
  console.log('  文件模式: node qc-novel.js "C:\\path\\第21章_开场.md"');
  process.exit(1);
}

let scanDir, files;
const stat = fs.statSync(inputPath);

if (stat.isDirectory()) {
  scanDir = inputPath;
  files = fs.readdirSync(scanDir)
    .filter(f => f.endsWith('.md') && f.match(/^第\d+章/))
    .sort();
} else if (stat.isFile() && inputPath.endsWith('.md')) {
  scanDir = path.dirname(inputPath);
  files = [path.basename(inputPath)];
} else {
  console.log(`错误: ${inputPath} 不是目录也不是 .md 文件`);
  process.exit(1);
}

console.log('=== 小说质检报告 v1.1 ===\n');

let totalIssues = 0;
const snapshot = [];

for (const file of files) {
  const filePath = path.join(scanDir, file);
  const text = fs.readFileSync(filePath, 'utf-8');
  const cjk = countCJK(text);
  const oldNames = checkOldNames(text);
  const compliant = checkCompliance(text);
  const chapterName = file.replace('.md', '');
  const expectedUnlocks = UNLOCK_TABLE[chapterName] || [];

  const issues = [];
  const st = statusLabel(cjk);
  if (st !== 'green') issues.push(`字数${cjk}/${CJK_TARGET} ${st === 'yellow' ? '⚠️ 黄' : '🔴 红'}`);
  if (oldNames.length > 0) issues.push(`🔴 旧名残留: ${oldNames.join(', ')}`);
  if (!compliant) issues.push('🔴 AI合规标注缺失');

  // Unlock check
  const { found, missing } = checkUnlocks(text, chapterName);
  if (expectedUnlocks.length > 0) {
    if (found.length > 0) issues.push(`✅ 已解锁: ${found.join(' / ')}`);
    if (missing.length > 0) issues.push(`🔴 应解锁但未出现: ${missing.join(' / ')}`);
  }

  // Consistency snapshot
  const events = extractEvents(text);
  const characters = extractCharacters(text);
  snapshot.push({ chapter: chapterName, cjk, events, characters, issues });

  const hasRed = issues.some(i => i.includes('🔴'));
  const hasYellow = issues.some(i => i.includes('⚠️'));
  const status = hasRed ? '🔴 有问题' : hasYellow ? '⚠️ 需关注' : '✅ 全过';

  console.log(`${file} | CJK=${cjk} | ${status}`);
  for (const i of issues) console.log(`  ${i}`);
  if (hasRed) totalIssues++;
  console.log('');
}

console.log(`=== 总计: ${files.length}章 | 问题章: ${totalIssues} ===`);

// Output snapshot for cross-chapter reference
console.log('\n=== 跨章一致性快照（供后续章参照） ===');
for (const s of snapshot) {
  console.log(`${s.chapter}: CJK=${s.cjk} | 人物: [${s.characters.join(', ')}] | 时间线: [${s.events.join(', ')}]`);
}
