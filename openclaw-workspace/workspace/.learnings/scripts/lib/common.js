// 公共工具库 — 消除路径硬编码、提供原子写入、统一错误处理
const fs = require('fs');
const path = require('path');
const os = require('os');

// 自动解析 workspace 根目录（消除硬编码 C:\Users\Administrator\.qclaw\workspace）
const WORKSPACE_ROOT = path.resolve(__dirname, '..', '..', '..');
const LEARNINGS_DIR = path.join(WORKSPACE_ROOT, '.learnings');
const DECISIONS_DIR = path.join(WORKSPACE_ROOT, '.decisions');
const HEALTH_DIR = path.join(WORKSPACE_ROOT, '.health');

// 用户项目产出根目录（小说/方案/知识库等），由环境变量覆盖，缺省回退到当前用户 Desktop
// 这样任何人 clone 后无需改代码即可用自己的目录；原使用者设 QCLAW_PROJECT_DIR 沿用旧目录
const PROJECT_DIR = process.env.QCLAW_PROJECT_DIR
  || path.join(os.homedir(), 'Desktop', '项目产出');
const HOT_DIR = process.env.QCLAW_HOT_DIR
  || path.join(os.homedir(), 'Desktop', '每日热点');

// 安全读取 JSON 文件（返回 null 而非崩溃）
function readJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error(`[readJson error] ${filePath}: ${e.message}`);
    return null;
  }
}

// 原子写入 JSON 文件（写临时→校验→rename，防止中途崩溃损坏原文件）
function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + Date.now();
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    // 校验：读回验证可解析
    JSON.parse(fs.readFileSync(tmp, 'utf8'));
    // 原子 rename（Windows 上 rename 是原子的）
    fs.renameSync(tmp, filePath);
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    console.error(`[writeJson error] ${filePath}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// 安全读取文本文件
function readText(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    console.error(`[readText error] ${filePath}: ${e.message}`);
    return null;
  }
}

// 原子写入文本文件
function writeText(filePath, content) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp.' + Date.now();
  try {
    fs.writeFileSync(tmp, content, 'utf8');
    fs.renameSync(tmp, filePath);
    return { ok: true };
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch {}
    console.error(`[writeText error] ${filePath}: ${e.message}`);
    return { ok: false, error: e.message };
  }
}

// 统一 CJK 字数统计（仅计汉字，不含假名/标点）——中文小说字数口径
// 所有脚本共用此定义，避免跨脚本字数对比偏差
function getCJKArray(text) {
  if (!text) return [];
  return String(text).match(/[\u4e00-\u9fff]/g) || [];
}
function countCJK(text) {
  return getCJKArray(text).length;
}

// 对话行判定用引号字符集（含中英文双引号与直角引号，闭合符「」不再遗漏）
const QUOTE_CHARS = ['"', '"', '"', '「', '」'];
function isDialogueLine(line) {
  return QUOTE_CHARS.some(q => String(line).includes(q));
}

module.exports = {
  WORKSPACE_ROOT, LEARNINGS_DIR, DECISIONS_DIR, HEALTH_DIR,
  PROJECT_DIR, HOT_DIR,
  readJson, writeJson, readText, writeText,
  getCJKArray, countCJK, QUOTE_CHARS, isDialogueLine
};
