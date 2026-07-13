#!/usr/bin/env node
// auto-heal.js — 心跳自愈流程
// 用法: node auto-heal.js [check|fix]
// check = 只检测不修复（纯只读，不触发任何写入）, fix = 检测+修复

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SCRIPTS_DIR = __dirname;
const WORKSPACE = path.resolve(SCRIPTS_DIR, '..', '..');
const LEARNINGS = path.join(WORKSPACE, '.learnings');

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { encoding: 'utf-8', timeout: opts.timeout || 30000, stdio: ['pipe', 'pipe', 'pipe'] });
  } catch (e) {
    return e.stderr || e.stdout || e.message;
  }
}

function runNode(scriptName, scriptArgs = []) {
  const nodePath = process.execPath;
  return run(nodePath, [path.join(SCRIPTS_DIR, scriptName), ...scriptArgs]);
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch { return null; }
}

function writeJson(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

function heal(mode = 'fix') {
  const results = { fixed: [], skipped: [], needsAttention: [], readonly: mode === 'check' };
  const willFix = mode === 'fix';

  // 1. 经验池pending
  try {
    const stats = runNode('experience-pool.js', ['stats']);
    const parsed = JSON.parse(stats);
    if (parsed.pending > 0) {
      if (willFix) {
        runNode('experience-pool.js', ['push-all']);
        results.fixed.push(`经验池：推送${parsed.pending}条pending经验`);
      } else {
        results.needsAttention.push(`经验池：有${parsed.pending}条pending经验待推送`);
      }
    }
  } catch (e) { results.skipped.push('经验池检查失败'); }

  // 2. Skill进化
  try {
    if (willFix) {
      runNode('skill-evolution.js', ['apply-all']);
      results.fixed.push('Skill进化：已执行apply-all');
    } else {
      results.needsAttention.push('Skill进化：check模式不执行apply-all');
    }
  } catch (e) { results.skipped.push('Skill进化检查失败'); }

  // 3. KBI扫描
  try {
    const kbi = readJson(path.join(LEARNINGS, 'kbi-tracker.json'));
    if (kbi) {
      const lastScan = new Date(kbi.lastScan);
      const daysSince = (Date.now() - lastScan.getTime()) / 86400000;
      if (daysSince > 2) {
        if (willFix) {
          kbi.lastScan = new Date().toISOString();
          writeJson(path.join(LEARNINGS, 'kbi-tracker.json'), kbi);
          results.fixed.push(`KBI：更新lastScan（距上次${daysSince.toFixed(1)}天）`);
        } else {
          results.needsAttention.push(`KBI：lastScan已过期${daysSince.toFixed(1)}天，待更新`);
        }
      }
    }
  } catch (e) { results.skipped.push('KBI检查失败'); }

  // 4. gbrain热点检查
  try {
    const gbrainOut = run('gbrain', ['search', '热点', '--limit', '3']);
    if (!gbrainOut || gbrainOut.includes('0 results') || gbrainOut.includes('No results')) {
      const today = new Date();
      const yesterday = new Date(today.getTime() - 86400000);
      const yDateStr = yesterday.toISOString().slice(0, 10).replace(/-/g, '');
      const hotDir = path.join(os.homedir(), 'Desktop', '每日热点', `qclaw${yDateStr}`);
      if (fs.existsSync(hotDir)) {
        if (willFix) {
          runNode('knowledge-loop.js', ['hot-ingest', '--dir', hotDir]);
          results.fixed.push(`gbrain：补入热点数据（${yDateStr}）`);
        } else {
          results.needsAttention.push(`gbrain：可补入热点数据（${yDateStr}），check模式跳过`);
        }
      } else {
        results.needsAttention.push(`gbrain：无热点数据且目录${yDateStr}不存在`);
      }
    }
  } catch (e) { results.skipped.push('gbrain检查失败'); }

  // 5. ERRORS.md同类错误检测（只读）
  try {
    const errors = fs.readFileSync(path.join(LEARNINGS, 'ERRORS.md'), 'utf-8');
    const recentErrors = errors.split('\n').filter(l => l.includes('2026-07-0')).slice(-10);
    const errorTypes = {};
    recentErrors.forEach(line => {
      const match = line.match(/\[(.*?)\]/);
      if (match) {
        errorTypes[match[1]] = (errorTypes[match[1]] || 0) + 1;
        if (errorTypes[match[1]] >= 2) {
          results.needsAttention.push(`同类错误[${match[1]}]出现${errorTypes[match[1]]}次，需修复`);
        }
      }
    });
  } catch (e) { results.skipped.push('ERRORS检查失败'); }

  // 输出
  const summary = `自愈结果[${mode}]：修复${results.fixed.length}项，跳过${results.skipped.length}项，待关注${results.needsAttention.length}项`;
  console.log(summary);
  if (results.fixed.length) console.log('\n已修复:\n' + results.fixed.map(r => '  ✅ ' + r).join('\n'));
  if (results.needsAttention.length) console.log('\n⚠️ 待关注:\n' + results.needsAttention.map(r => '  ' + r).join('\n'));
  return results;
}

const action = process.argv[2] || 'fix';
const mode = (action === 'check') ? 'check' : 'fix';
heal(mode);
