#!/usr/bin/env node
/**
 * 节奏诊断器 (Pace Diagnostics)
 * 
 * 用法：
 *   node pace-diagnose.js <file.md>           -- 诊断单章节奏
 *   node pace-diagnose.js <dir>               -- 批量诊断目录下所有章节
 * 
 * 检查项：
 *   1. 前800字是否有冲突/悬念标记
 *   2. 字数是否达标（≥2200 CJK字）
 *   3. 章尾是否有钩子（悬念/反转/未解问题）
 *   4. 对话/叙述比例
 *   5. 段落长度分布（避免大段叙述墙）
 *   6. 情绪曲线（正面/负面词频分布）
 */

const fs = require('fs');
const path = require('path');
const { countCJK, getCJKArray, isDialogueLine } = require('./lib/common.js');

// 冲突/悬念关键词
const CONFLICT_WORDS = ['冲突', '对抗', '危险', '威胁', '危机', '揭露', '秘密', '震惊', '不可能', '怎么会', '竟然', '居然', '但是', '然而', '偏偏', '不巧', '突然', '猛然', '猛地', '刹那', '瞬间', '暴怒', '冷笑', '嘲讽', '讥讽', '挑衅', '逼问', '质问', '怒吼', '低吼', '杀意', '敌意', '寒意', '恐惧', '绝望'];
const HOOK_WORDS = ['？', '...', '……', '未完', '究竟', '到底', '难道', '莫非', '莫非是', '莫非这', '可惜', '不幸', '偏偏在', '就在这时', '话音未落', '话音刚落', '话还没说完', '话音刚歇'];
const POSITIVE_WORDS = ['笑', '喜', '乐', '赢', '胜', '成功', '突破', '领悟', '开心', '兴奋', '骄傲', '自信', '轻松'];
const NEGATIVE_WORDS = ['怒', '恨', '怕', '惧', '败', '输', '失', '绝望', '痛苦', '压抑', '屈辱', '嘲讽', '讥讽', '冷漠', '冰冷', '阴沉'];

function analyzeChapter(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`❌ 文件不存在：${filePath}`);
    return null;
  }
  
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter(l => l.trim());
  const totalCJK = countCJK(content);
  
  // 前800字内容
  let first800 = '';
  let charCount = 0;
  for (const line of lines) {
    const lineCJK = countCJK(line);
    if (charCount + lineCJK > 800) {
      const remaining = 800 - charCount;
      const chars = getCJKArray(line);
      first800 += chars.slice(0, remaining).join('');
      break;
    }
    first800 += line + '\n';
    charCount += lineCJK;
  }
  
  // 检查冲突
  const first800Conflicts = CONFLICT_WORDS.filter(w => first800.includes(w));
  const hasConflictEarly = first800Conflicts.length > 0;
  
  // 检查章尾钩子（最后300字）
  let last300 = '';
  const allCJK = getCJKArray(content);
  last300 = allCJK.slice(-300).join('');
  const endingHooks = HOOK_WORDS.filter(w => last300.includes(w));
  const hasHook = endingHooks.length > 0;
  
  // 对话/叙述比例
  const dialogueLines = lines.filter(isDialogueLine);
  const dialogueRatio = lines.length > 0 ? (dialogueLines.length / lines.length * 100).toFixed(1) : 0;
  
  // 段落长度分布
  const paraLengths = lines.map(l => l.length).sort((a, b) => b - a);
  const maxPara = paraLengths[0] || 0;
  const avgPara = paraLengths.length > 0 ? Math.round(paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length) : 0;
  const longParas = paraLengths.filter(l => l > 150).length;
  
  // 情绪曲线（每500字一段）
  const segments = [];
  const segSize = 500;
  for (let i = 0; i < allCJK.length; i += segSize) {
    const seg = allCJK.slice(i, i + segSize).join('');
    const pos = POSITIVE_WORDS.filter(w => seg.includes(w)).length;
    const neg = NEGATIVE_WORDS.filter(w => seg.includes(w)).length;
    segments.push({ pos, neg, valence: pos - neg });
  }
  
  // 评分
  let score = 100;
  const issues = [];
  const passes = [];
  
  if (!hasConflictEarly) {
    score -= 25;
    issues.push('前800字无冲突/悬念标记 — 读者可能弃读');
  } else {
    passes.push(`前800字有冲突词：${first800Conflicts.join('、')}`);
  }
  
  if (totalCJK < 2200) {
    score -= 20;
    issues.push(`字数不足：${totalCJK} < 2200`);
  } else {
    passes.push(`字数达标：${totalCJK}`);
  }
  
  if (!hasHook) {
    score -= 20;
    issues.push('章尾无悬念钩子 — 缺乏追读动力');
  } else {
    passes.push(`章尾钩子：${endingHooks.join('、')}`);
  }
  
  if (parseFloat(dialogueRatio) < 20) {
    score -= 10;
    issues.push(`对话比例过低（${dialogueRatio}%）— 可能叙述墙`);
  } else if (parseFloat(dialogueRatio) > 70) {
    score -= 5;
    issues.push(`对话比例过高（${dialogueRatio}%）— 缺少描写`);
  } else {
    passes.push(`对话比例合理（${dialogueRatio}%）`);
  }
  
  if (longParas > 5) {
    score -= 10;
    issues.push(`${longParas}个超长段落（>150字）— 建议拆分`);
  }
  
  if (segments.length > 0 && segments.every(s => s.valence === 0)) {
    score -= 10;
    issues.push('情绪曲线平直 — 全章无情绪起伏');
  }
  
  // 输出
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`📖 ${path.basename(filePath)}`);
  console.log(`${'═'.repeat(60)}`);
  console.log(`字数：${totalCJK} CJK | 段落：${lines.length} | 对话：${dialogueRatio}%`);
  console.log(`最长段落：${maxPara}字 | 平均段落：${avgPara}字 | 超长段：${longParas}个`);
  
  if (segments.length > 0) {
    const curve = segments.map(s => s.valence > 0 ? '↑' : s.valence < 0 ? '↓' : '─').join('');
    console.log(`情绪曲线：${curve}`);
  }
  
  console.log(`\n评分：${score}/100`);
  
  if (passes.length > 0) {
    console.log('\n✅ 通过项：');
    passes.forEach(p => console.log(`  + ${p}`));
  }
  
  if (issues.length > 0) {
    console.log('\n⚠️ 问题项：');
    issues.forEach(i => console.log(`  - ${i}`));
  }
  
  return { file: path.basename(filePath), score, totalCJK, issues, passes };
}

function diagnoseDir(dirPath) {
  const files = fs.readdirSync(dirPath)
    .filter(f => f.endsWith('.md') && (f.includes('第') || f.includes('chapter')))
    .sort()
    .map(f => path.join(dirPath, f));
  
  if (files.length === 0) {
    console.log('未找到章节文件');
    return;
  }
  
  console.log(`批量诊断 ${files.length} 个章节\n`);
  const results = files.map(f => analyzeChapter(f)).filter(Boolean);
  
  // 汇总
  const avgScore = Math.round(results.reduce((a, r) => a + r.score, 0) / results.length);
  const worstChapter = results.reduce((a, r) => r.score < a.score ? r : a);
  const bestChapter = results.reduce((a, r) => r.score > a.score ? r : a);
  
  console.log(`\n${'═'.repeat(60)}`);
  console.log('📊 批量诊断汇总');
  console.log(`${'═'.repeat(60)}`);
  console.log(`平均分：${avgScore}/100`);
  console.log(`最佳：${bestChapter.file}（${bestChapter.score}分）`);
  console.log(`最差：${worstChapter.file}（${worstChapter.score}分）`);
  
  // 通用问题
  const allIssues = results.flatMap(r => r.issues.map(i => ({ issue: i, chapter: r.file })));
  const issueCounts = {};
  allIssues.forEach(({ issue }) => {
    const key = issue.split('：')[0].split('—')[0].trim();
    issueCounts[key] = (issueCounts[key] || 0) + 1;
  });
  
  if (Object.keys(issueCounts).length > 0) {
    console.log('\n高频问题：');
    Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
      console.log(`  ${k} × ${v}章`);
    });
  }
}

// CLI
const [,, target] = process.argv;
if (!target) {
  console.log('用法: node pace-diagnose.js <file.md|dir>');
  process.exit(1);
}

if (fs.statSync(target).isDirectory()) {
  diagnoseDir(target);
} else {
  analyzeChapter(target);
}
