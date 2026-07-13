#!/usr/bin/env node
/**
 * 写法引擎 (Writing Style Engine)
 * 
 * 用法：
 *   node style-engine.js extract <file.md>           -- 从文本提取写法特征
 *   node style-engine.js save <name> <file.md>       -- 保存为可复用写法资产
 *   node style-engine.js list                        -- 列出所有写法资产
 *   node style-engine.js apply <name> <file.md>      -- 检查文本是否符合指定写法
 *   node style-engine.js diff <name1> <name2>        -- 对比两种写法
 * 
 * 数据目录：.learnings/style-assets/
 */

const fs = require('fs');
const path = require('path');
const { countCJK, isDialogueLine } = require('./lib/common.js');

const ASSET_DIR = path.join(__dirname, '..', '.learnings', 'style-assets');

// AI腔检测词库（去重：'不禁' 曾重复3次）
const AI_WORDS = [
  '不禁', '忍不住', '心中一动', '暗暗', '微微一笑', '嘴角微扬', '眼中闪过',
  '一股', '一丝', '仿佛', '宛如', '犹如', '似乎', '赫然',
  '顿时', '霎时', '刹那间', '一瞬间', '心中暗想', '暗自',
  '毫无疑问', '不言而喻', '显而易见', '众所周知', '事实上',
  '总而言之', '综上所述', '由此可见', '不可否认',
  '缓缓', '徐徐', '静静地', '默默地', '悄悄地',
  '震撼', '震惊', '不可思议', '难以置信',
  '然而', '不过', '但是', '可是', '虽然',
  '不仅...而且', '既...又', '无论...都'
];

// 节奏标记
const PACING_FAST = ['突然', '猛', '瞬间', '刹那', '立刻', '马上', '急', '冲', '扑', '抓', '砸', '踢', '撞'];
const PACING_SLOW = ['缓缓', '慢慢', '静静', '默默', '悄悄', '轻轻', '渐渐', '徐徐'];

// 情绪标记
const EMOTION_ANGER = ['怒', '愤', '恨', '咬牙', '冷哼', '暴', '吼', '骂'];
const EMOTION_FEAR = ['怕', '惧', '恐', '颤', '抖', '退', '躲', '畏'];
const EMOTION_JOY = ['笑', '喜', '乐', '兴奋', '开心', '高兴'];
const EMOTION_SAD = ['悲', '哀', '痛', '哭', '泪', '伤'];

function ensureDir() {
  if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });
}

function extractFeatures(text) {
  const totalCJK = countCJK(text);
  const lines = text.split('\n').filter(l => l.trim());
  
  // AI腔检测
  const aiHits = AI_WORDS.filter(w => text.includes(w));
  const aiRatio = totalCJK > 0 ? ((aiHits.length / (totalCJK / 1000)) * 100).toFixed(2) : 0;
  
  // 句式分析
  const sentences = text.split(/[。！？\n]/).filter(s => s.trim());
  const avgSentLen = sentences.length > 0 ? Math.round(sentences.reduce((a, s) => a + countCJK(s), 0) / sentences.length) : 0;
  const shortSentences = sentences.filter(s => countCJK(s) <= 15).length;
  const longSentences = sentences.filter(s => countCJK(s) > 50).length;
  const shortRatio = sentences.length > 0 ? ((shortSentences / sentences.length) * 100).toFixed(1) : 0;
  
  // 节奏分析
  const fastHits = PACING_FAST.filter(w => text.includes(w));
  const slowHits = PACING_SLOW.filter(w => text.includes(w));
  
  // 情绪分析
  const anger = EMOTION_ANGER.filter(w => text.includes(w)).length;
  const fear = EMOTION_FEAR.filter(w => text.includes(w)).length;
  const joy = EMOTION_JOY.filter(w => text.includes(w)).length;
  const sad = EMOTION_SAD.filter(w => text.includes(w)).length;
  
  // 对话分析
  const dialogueLines = lines.filter(isDialogueLine);
  const dialogueRatio = lines.length > 0 ? ((dialogueLines.length / lines.length) * 100).toFixed(1) : 0;
  
  // 段落分析
  const paraLengths = lines.map(l => l.length);
  const avgParaLen = paraLengths.length > 0 ? Math.round(paraLengths.reduce((a, b) => a + b, 0) / paraLengths.length) : 0;
  
  // 排比检测（连续3+句相同句式）
  const parallelism = (text.match(/(.{5,15}[，。])\1{2,}/g) || []).length;
  
  return {
    totalCJK,
    aiScore: {
      hits: aiHits,
      count: aiHits.length,
      ratioPer1000: parseFloat(aiRatio),
      level: aiRatio < 3 ? 'clean' : aiRatio < 8 ? 'moderate' : 'heavy'
    },
    sentence: {
      avg: avgSentLen,
      shortRatio: parseFloat(shortRatio),
      longCount: longSentences
    },
    pacing: {
      fast: fastHits,
      slow: slowHits,
      ratio: `${fastHits.length}:${slowHits.length}`,
      verdict: fastHits.length > slowHits.length ? 'fast-leaning' : slowHits.length > fastHits.length ? 'slow-leaning' : 'balanced'
    },
    emotion: { anger, fear, joy, sad },
    dialogue: { ratio: parseFloat(dialogueRatio), lines: dialogueLines.length },
    paragraph: { avg: avgParaLen },
    parallelism
  };
}

function extract(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const features = extractFeatures(content);
  
  console.log(`\n=== 写法特征提取：${path.basename(filePath)} ===`);
  console.log(`字数：${features.totalCJK} CJK`);
  
  console.log(`\n📋 AI腔检测：${features.aiScore.level}（${features.aiScore.count}个/千字${features.aiScore.ratioPer1000}）`);
  if (features.aiScore.hits.length > 0) {
    console.log(`  命中词：${features.aiScore.hits.join('、')}`);
  }
  
  console.log(`\n📐 句式：`);
  console.log(`  平均句长：${features.sentence.avg}字`);
  console.log(`  短句占比：${features.sentence.shortRatio}%`);
  console.log(`  超长句（>50字）：${features.sentence.longCount}个`);
  
  console.log(`\n⚡ 节奏：${features.pacing.verdict}（快${features.pacing.fast.length}:慢${features.pacing.slow.length}）`);
  if (features.pacing.fast.length > 0) console.log(`  快：${features.pacing.fast.join('、')}`);
  if (features.pacing.slow.length > 0) console.log(`  慢：${features.pacing.slow.join('、')}`);
  
  console.log(`\n🎭 情绪：怒${features.emotion.anger} 惧${features.emotion.fear} 喜${features.emotion.joy} 悲${features.emotion.sad}`);
  
  console.log(`\n💬 对话：${features.dialogue.ratio}%（${features.dialogue.lines}行）`);
  console.log(`📝 段落：平均${features.paragraph.avg}字`);
  console.log(`🔁 排比句式：${features.parallelism}处`);
  
  return features;
}

function save(name, filePath) {
  ensureDir();
  const content = fs.readFileSync(filePath, 'utf-8');
  const features = extractFeatures(content);
  const asset = {
    name,
    sourceFile: path.basename(filePath),
    extractedDate: new Date().toISOString(),
    features
  };
  const assetPath = path.join(ASSET_DIR, `${name}.json`);
  fs.writeFileSync(assetPath, JSON.stringify(asset, null, 2), 'utf-8');
  console.log(`\n✅ 写法资产 "${name}" 已保存到 ${assetPath}`);
}

function list() {
  ensureDir();
  const files = fs.readdirSync(ASSET_DIR).filter(f => f.endsWith('.json'));
  if (files.length === 0) {
    console.log('暂无写法资产');
    return;
  }
  console.log('=== 写法资产列表 ===');
  files.forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join(ASSET_DIR, f), 'utf-8'));
    console.log(`  📝 ${data.name} (来源: ${data.sourceFile}, AI腔: ${data.features.aiScore.level}, 对话: ${data.features.dialogue.ratio}%)`);
  });
}

function apply(name, filePath) {
  const assetPath = path.join(ASSET_DIR, `${name}.json`);
  if (!fs.existsSync(assetPath)) {
    console.log(`❌ 写法资产 "${name}" 不存在`);
    process.exit(1);
  }
  const asset = JSON.parse(fs.readFileSync(assetPath, 'utf-8'));
  const content = fs.readFileSync(filePath, 'utf-8');
  const current = extractFeatures(content);
  
  console.log(`\n=== 写法合规检查：${path.basename(filePath)} vs "${name}" ===`);
  
  const checks = [
    { name: 'AI腔等级', target: asset.features.aiScore.level, current: current.aiScore.level, pass: current.aiScore.ratioPer1000 <= asset.features.aiScore.ratioPer1000 * 1.5 },
    { name: '对话比例', target: `${asset.features.dialogue.ratio}%`, current: `${current.dialogue.ratio}%`, pass: Math.abs(current.dialogue.ratio - asset.features.dialogue.ratio) < 15 },
    { name: '平均句长', target: `${asset.features.sentence.avg}字`, current: `${current.sentence.avg}字`, pass: Math.abs(current.sentence.avg - asset.features.sentence.avg) < 10 },
    { name: '节奏倾向', target: asset.features.pacing.verdict, current: current.pacing.verdict, pass: current.pacing.verdict === asset.features.pacing.verdict },
    { name: '排比控制', target: `≤${asset.features.parallelism + 2}`, current: current.parallelism, pass: current.parallelism <= asset.features.parallelism + 2 }
  ];
  
  checks.forEach(c => {
    const status = c.pass ? '✅' : '⚠️';
    console.log(`  ${status} ${c.name}：目标${c.target} | 当前${c.current}`);
  });
}

function diff(name1, name2) {
  const p1 = path.join(ASSET_DIR, `${name1}.json`);
  const p2 = path.join(ASSET_DIR, `${name2}.json`);
  if (!fs.existsSync(p1) || !fs.existsSync(p2)) {
    console.log('❌ 写法资产不存在');
    process.exit(1);
  }
  const a1 = JSON.parse(fs.readFileSync(p1, 'utf-8'));
  const a2 = JSON.parse(fs.readFileSync(p2, 'utf-8'));
  
  console.log(`\n=== 写法对比：${name1} vs ${name2} ===`);
  console.log(`           ${name1.padEnd(15)} | ${name2}`);
  console.log(`字数:       ${String(a1.features.totalCJK).padEnd(15)} | ${a2.features.totalCJK}`);
  console.log(`AI腔:       ${a1.features.aiScore.level.padEnd(15)} | ${a2.features.aiScore.level}`);
  console.log(`AI词数:     ${String(a1.features.aiScore.count).padEnd(15)} | ${a2.features.aiScore.count}`);
  console.log(`对话比例:   ${String(a1.features.dialogue.ratio + '%').padEnd(15)} | ${a2.features.dialogue.ratio}%`);
  console.log(`平均句长:   ${String(a1.features.sentence.avg + '字').padEnd(15)} | ${a2.features.sentence.avg}字`);
  console.log(`短句占比:   ${String(a1.features.sentence.shortRatio + '%').padEnd(15)} | ${a2.features.sentence.shortRatio}%`);
  console.log(`节奏:       ${a1.features.pacing.verdict.padEnd(15)} | ${a2.features.pacing.verdict}`);
  console.log(`情绪:       ${`怒${a1.features.emotion.anger}惧${a1.features.emotion.fear}喜${a1.features.emotion.joy}悲${a1.features.emotion.sad}`.padEnd(15)} | 怒${a2.features.emotion.anger}惧${a2.features.emotion.fear}喜${a2.features.emotion.joy}悲${a2.features.emotion.sad}`);
  console.log(`排比:       ${String(a1.features.parallelism).padEnd(15)} | ${a2.features.parallelism}`);
}

// CLI
const [,, cmd, ...args] = process.argv;
const commands = { extract, save, list, apply, diff };
// 各命令所需最少参数数（防止缺参导致 readFileSync(undefined) 等未捕获异常）
const ARG_MIN = { extract: 1, save: 2, list: 0, apply: 2, diff: 2 };
if (!commands[cmd]) {
  console.log('用法: node style-engine.js [extract|save|list|apply|diff]');
  process.exit(cmd ? 1 : 0);
} else if ((ARG_MIN[cmd] || 0) > args.length) {
  console.error(`错误: 命令 '${cmd}' 需要至少 ${ARG_MIN[cmd]} 个参数`);
  process.exit(1);
} else {
  commands[cmd](...args);
}
