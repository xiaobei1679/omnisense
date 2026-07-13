#!/usr/bin/env node
// creation-feedback.js — 创作反馈学习闭环
// 用法:
//   node creation-feedback.js record --chapter <num> --feedback "<用户反馈>" --satisfied <true|false>
//   node creation-feedback.js extract --chapter <num>  — 从质量诊断报告提取经验
//   node creation-feedback.js patterns  — 查看跨章节问题模式
//   node creation-feedback.js push --chapter <num>  — 推送经验到相关Agent

const fs = require('fs');
const path = require('path');

const FEEDBACK_PATH = path.join(__dirname, '..', 'creation-feedback.json');
const SCRIPTS_DIR = __dirname;

function loadFeedback() {
  if (!fs.existsSync(FEEDBACK_PATH)) {
    return { entries: [], patterns: [], meta: { created: new Date().toISOString() } };
  }
  return JSON.parse(fs.readFileSync(FEEDBACK_PATH, 'utf-8'));
}

function saveFeedback(data) {
  fs.writeFileSync(FEEDBACK_PATH, JSON.stringify(data, null, 2), 'utf-8');
}

function record(chapter, feedback, satisfied) {
  const data = loadFeedback();
  const entry = {
    id: `fb-${Date.now()}`,
    chapter: parseInt(chapter),
    feedback: feedback,
    satisfied: satisfied === 'true',
    timestamp: new Date().toISOString(),
    issues: [], // 将由extract填充（如有质检报告）
    lessons: [], // 将由extract或自动生成填充
    pushed: false
  };
  
  // 如果没有后续extract调用，直接从feedback生成基础经验
  if (feedback && feedback.length > 5) {
    const category = classifyIssue(feedback);
    entry.lessons.push({
      lesson: `${category}：${feedback}`,
      category: category,
      confidence: satisfied === 'true' ? 0.7 : 0.85
    });
  }
  
  data.entries.push(entry);
  saveFeedback(data);
  console.log(JSON.stringify({ ok: true, id: entry.id, chapter: entry.chapter, lessons: entry.lessons.length }));
}

function extract(chapter, diagnosticReport) {
  const data = loadFeedback();
  const entry = data.entries.find(e => e.chapter === parseInt(chapter) && !e.issues.length);
  if (!entry) {
    console.log(JSON.stringify({ ok: false, reason: '未找到对应章节的反馈记录' }));
    return;
  }
  
  // 如果传入了诊断报告，从中提取问题
  if (diagnosticReport) {
    const issues = [];
    const lines = diagnosticReport.split('\n');
    for (const line of lines) {
      // 匹配问题清单格式：[⭐⭐⭐] [问题] → [修复方案]
      const match = line.match(/\[(⭐+)\]\s*(.+?)\s*→\s*(.+)/);
      if (match) {
        issues.push({
          severity: match[1].length, // 星数=严重度
          problem: match[2].trim(),
          fix: match[3].trim(),
          category: classifyIssue(match[2])
        });
      }
    }
    entry.issues = issues;
    
    // 提取教训
    entry.lessons = issues.map(issue => ({
      lesson: `${issue.category}：${issue.problem}→${issue.fix}`,
      category: issue.category,
      confidence: 0.8
    }));
    
    saveFeedback(data);
    console.log(JSON.stringify({ ok: true, extracted: issues.length, lessons: entry.lessons.length }));
  } else {
    console.log(JSON.stringify({ ok: false, reason: '无诊断报告' }));
  }
}

function classifyIssue(problemText) {
  if (/节奏|开头|结尾|悬念|伏笔|章节|结构/.test(problemText)) return '结构';
  if (/角色|人设|对话|动机|行为/.test(problemText)) return '人设';
  if (/AI腔|重复|描写|文笔|信息倾倒/.test(problemText)) return '文笔';
  if (/世界观|设定|规则|逻辑/.test(problemText)) return '设定';
  return '其他';
}

function detectPatterns() {
  const data = loadFeedback();
  const allIssues = [];
  data.entries.forEach(e => e.issues.forEach(i => allIssues.push({ ...i, chapter: e.chapter })));
  
  // 按category+problem关键词分组
  const groups = {};
  allIssues.forEach(issue => {
    const key = issue.category + ':' + issue.problem.slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(issue);
  });
  
  // 找出出现≥2次的模式
  const patterns = [];
  for (const [key, items] of Object.entries(groups)) {
    if (items.length >= 2) {
      patterns.push({
        pattern: key,
        occurrences: items.length,
        chapters: items.map(i => i.chapter),
        category: items[0].category,
        fix: items[0].fix,
        severity: Math.max(...items.map(i => i.severity))
      });
    }
  }
  
  data.patterns = patterns;
  saveFeedback(data);
  
  console.log(JSON.stringify({ 
    totalEntries: data.entries.length,
    totalIssues: allIssues.length,
    patterns: patterns.length,
    recurringPatterns: patterns.filter(p => p.occurrences >= 2)
  }, null, 2));
}

function push(chapter) {
  const data = loadFeedback();
  const entry = data.entries.find(e => e.chapter === parseInt(chapter) && !e.pushed && e.lessons.length);
  if (!entry) {
    console.log(JSON.stringify({ ok: false, reason: '无待推送的经验' }));
    return;
  }

  // 调用experience-pool.js add
  const { execFileSync } = require('child_process');
  const nodePath = process.execPath;

  let okCount = 0, failCount = 0;
  for (const lesson of entry.lessons) {
    try {
      execFileSync(nodePath, [
        path.join(SCRIPTS_DIR, 'experience-pool.js'),
        'add',
        '--agent', 'novel-creator',
        '--learning', lesson.lesson,
        '--category', lesson.category,
        '--confidence', lesson.confidence.toString(),
        '--source', `第${chapter}章创作反馈`,
        '--ttl-days', '180'
      ], { encoding: 'utf-8', timeout: 10000 });
      okCount++;
    } catch (e) {
      failCount++;
      console.error(`推送失败 (lesson: ${lesson.category}): ${e.message || e}`);
    }
  }

  // 仅当全部推送成功才标记已推送；有失败则保留以便重试，绝不伪造成功
  const allDone = failCount === 0 && okCount > 0;
  if (allDone) entry.pushed = true;
  saveFeedback(data);
  console.log(JSON.stringify({ ok: allDone, pushed: okCount, failed: failCount, all_done: allDone }));
}

// === 统一参数解析 ===
function parseArgs() {
  const raw = process.argv.slice(2);
  const args = {};
  for (let i = 1; i < raw.length; i++) {
    if (raw[i].startsWith('--')) {
      const key = raw[i].slice(2);
      if (i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
        args[key] = raw[i + 1];
        i++;
      } else {
        args[key] = true;
      }
    }
  }
  return args;
}

function requireArg(args, name) {
  if (args[name] === undefined) {
    console.error(`错误: 缺少必填参数 --${name}`);
    process.exit(1);
  }
  return args[name];
}

const args = parseArgs();
const cmd = process.argv[2];
switch (cmd) {
  case 'record': {
    const chapter = requireArg(args, 'chapter');
    const feedback = args['feedback']; // 可选
    const satisfied = requireArg(args, 'satisfied');
    record(chapter, feedback, satisfied);
    break;
  }
  case 'extract': {
    const chapter = requireArg(args, 'chapter');
    extract(chapter);
    break;
  }
  case 'patterns':
    detectPatterns();
    break;
  case 'push': {
    const chapter = requireArg(args, 'chapter');
    push(chapter);
    break;
  }
  default:
    console.log('creation-feedback.js — 创作反馈学习闭环');
    console.log('  record --chapter <N> --feedback "<text>" --satisfied <true|false>');
    console.log('  extract --chapter <N>  (需配合质量诊断报告)');
    console.log('  patterns  (查看跨章节问题模式)');
    console.log('  push --chapter <N>  (推送经验到Agent)');
}
