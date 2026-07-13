#!/usr/bin/env node
// cjk-counter.js — 精确统计中文汉字数（不含标点/英文/数字）
// 用法: node cjk-counter.js <file1> [file2...]
// 输出: JSON { file: string, totalChars: number, cjkChars: number, status: "green"|"yellow"|"red" }

const fs = require('fs');

function countCJK(text) {
  // CJK统一汉字 + 中文兼容汉字 + 扩展区
  const cjkRe = /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\u{20000}-\u{2A6DF}\u{2A700}-\u{2B73F}\u{2B740}-\u{2B81F}\u{2B820}-\u{2CEAF}\u{2CEB0}-\u{2EBEF}]/gu;
  const cjkMatches = text.match(cjkRe);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  return { totalChars: text.length, cjkCount };
}

function checkStatus(cjkCount) {
  if (cjkCount >= 2200) return 'green';   // ✅ 达标
  if (cjkCount >= 2000) return 'yellow';  // ⚠️ 接近下限
  return 'red';                            // 🔴 不达标
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.log('Usage: node cjk-counter.js <file1> [file2...]');
  process.exit(1);
}

const results = [];
for (const file of args) {
  try {
    const text = fs.readFileSync(file, 'utf-8');
    const { totalChars, cjkCount } = countCJK(text);
    const status = checkStatus(cjkCount);
    results.push({ file, totalChars, cjkCount, status });
  } catch (e) {
    results.push({ file, totalChars: 0, cjkCount: 0, status: 'error', error: e.message });
  }
}

console.log(JSON.stringify(results, null, 2));
