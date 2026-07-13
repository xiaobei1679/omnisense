#!/usr/bin/env node
// skill-discovery.js — 技能发现+验证+集成闭环
// 用法:
//   node skill-discovery.js scan  — 扫描本周知识库更新文件，提取可集成的工具/方法
//   node skill-discovery.js verify --tool "<工具名>"  — 验证工具是否可用
//   node skill-discovery.js integrate --tool "<工具名>" --target <target>  — 集成到目标
//   node skill-discovery.js status  — 查看发现→集成流水线状态

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { PROJECT_DIR } = require('./lib/common.js');

const STATE_PATH = path.join(__dirname, '..', 'skill-discovery-state.json');
// 路径由环境变量覆盖，缺省回退到当前用户 Desktop（跨用户/跨平台不再写死 Administrator）
const KNOWLEDGE_DIR = process.env.QCLAW_KNOWLEDGE_DIR
  || path.join(PROJECT_DIR, '知识库');
const HOT_DIR = process.env.QCLAW_HOT_DIR
  || path.join(os.homedir(), 'Desktop', '每日热点');
const WORKSPACE = path.resolve(__dirname, '..', '..');

// 跨平台命令/重定向
const NULL_REDIR = process.platform === 'win32' ? '2>nul' : '2>/dev/null';
const WHERE_CMD = process.platform === 'win32' ? 'where' : 'command -v';

function loadState() {
  if (!fs.existsSync(STATE_PATH)) {
    return {
      discovered: [],
      verified: [],
      integrated: [],
      rejected: [],
      lastScan: null
    };
  }
  return JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8'));
}

function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf-8');
}

function scanKnowledge() {
  const state = loadState();
  state.lastScan = new Date().toISOString();
  
  // 扫描知识库目录下最近7天的文件
  const cutoff = Date.now() - 7 * 86400000;
  let files = [];
  
  if (fs.existsSync(KNOWLEDGE_DIR)) {
    files = fs.readdirSync(KNOWLEDGE_DIR)
      .filter(f => f.endsWith('.md'))
      .map(f => {
        const fullPath = path.join(KNOWLEDGE_DIR, f);
        const stat = fs.statSync(fullPath);
        return { name: f, path: fullPath, mtime: stat.mtime };
      })
      .filter(f => f.mtime.getTime() > cutoff);
  }
  
  // 也扫描每日热点中的🎯标记项
  if (fs.existsSync(HOT_DIR)) {
    const hotDirs = fs.readdirSync(HOT_DIR).filter(d => d.startsWith('qclaw'));
    for (const dir of hotDirs.slice(-3)) { // 最近3天
      const dirPath = path.join(HOT_DIR, dir);
      const mdFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.md'));
      for (const mdFile of mdFiles) {
        const fullPath = path.join(dirPath, mdFile);
        const stat = fs.statSync(fullPath);
        if (stat.mtime.getTime() > cutoff) {
          files.push({ name: `${dir}/${mdFile}`, path: fullPath, mtime: stat.mtime });
        }
      }
    }
  }
  
  // 从文件内容中提取🎯标记的工具/方法
  const newTools = [];
  for (const file of files) {
    const content = fs.readFileSync(file.path, 'utf-8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (line.includes('🎯')) {
        // 提取工具名（简单启发式：🎯后面的第一个词）
        const match = line.match(/🎯[^\w]*([\w\u4e00-\u9fff\-\.]+)/);
        if (match) {
          const toolName = match[1];
          // 检查是否已发现/已集成
          const existing = [...state.discovered, ...state.integrated, ...state.rejected];
          if (!existing.find(t => t.name === toolName)) {
            newTools.push({
              name: toolName,
              source: file.name,
              line: line.trim().slice(0, 100),
              discovered: new Date().toISOString(),
              status: 'pending_verification'
            });
          }
        }
      }
    }
  }
  
  state.discovered.push(...newTools);
  saveState(state);
  
  console.log(JSON.stringify({
    scanned: files.length,
    newTools: newTools.length,
    totalDiscovered: state.discovered.length,
    totalIntegrated: state.integrated.length,
    totalRejected: state.rejected.length
  }, null, 2));
}

function verifyTool(toolName) {
  const state = loadState();
  const tool = state.discovered.find(t => t.name === toolName);
  if (!tool) {
    console.log(JSON.stringify({ ok: false, reason: '未找到该工具' }));
    return;
  }
  
  const results = { name: toolName, checks: [] };
  
  // 1. 检查是否已安装
  try {
    const npmList = execSync(`npm list -g --depth=0 ${NULL_REDIR}`, { encoding: 'utf-8' });
    if (npmList.includes(toolName)) {
      results.checks.push({ check: 'npm_global', status: 'installed' });
    } else {
      results.checks.push({ check: 'npm_global', status: 'not_installed' });
    }
  } catch (e) {
    results.checks.push({ check: 'npm_global', status: 'check_failed' });
  }
  
  // 2. 检查是否在PATH中（跨平台：Windows=where，其他=command -v）
  try {
    execSync(`${WHERE_CMD} ${toolName} ${NULL_REDIR}`, { encoding: 'utf-8' });
    results.checks.push({ check: 'path', status: 'available' });
  } catch (e) {
    results.checks.push({ check: 'path', status: 'not_in_path' });
  }
  
  // 3. GitHub搜索验证：本地无法可靠联网检索，标记需人工核验（不再用空 try/catch 伪装）
  results.checks.push({ check: 'github_search', status: 'manual_verification_needed' });
  
  tool.verification = results;
  tool.status = 'verified';
  saveState(state);
  
  console.log(JSON.stringify(results, null, 2));
}

function integrateTool(toolName, target) {
  const state = loadState();
  const tool = state.discovered.find(t => t.name === toolName && t.status === 'verified');
  if (!tool) {
    console.log(JSON.stringify({ ok: false, reason: '工具未验证或不存在' }));
    return;
  }
  
  const integration = {
    name: toolName,
    target: target,
    integratedAt: new Date().toISOString(),
    source: tool.source
  };
  
  state.integrated.push(integration);
  state.discovered = state.discovered.filter(t => t.name !== toolName);
  saveState(state);
  
  console.log(JSON.stringify({ ok: true, integrated: integration }));
}

function showStatus() {
  const state = loadState();
  console.log(JSON.stringify({
    lastScan: state.lastScan,
    pendingVerification: state.discovered.filter(t => t.status === 'pending_verification').length,
    verified: state.discovered.filter(t => t.status === 'verified').length,
    integrated: state.integrated.length,
    rejected: state.rejected.length
  }, null, 2));
}

const cmd = process.argv[2];
switch (cmd) {
  case 'scan':
    scanKnowledge();
    break;
  case 'verify': {
    // 支持两种传参: verify --tool "名称" 或 verify "名称"
    const toolIdx = process.argv.indexOf('--tool');
    const verifyName = toolIdx >= 0 ? process.argv[toolIdx + 1] : process.argv[3];
    verifyTool(verifyName);
    break;
  }
  case 'integrate': {
    const iToolIdx = process.argv.indexOf('--tool');
    const iTargetIdx = process.argv.indexOf('--target');
    const iName = iToolIdx >= 0 ? process.argv[iToolIdx + 1] : process.argv[3];
    const iTarget = iTargetIdx >= 0 ? process.argv[iTargetIdx + 1] : process.argv[4];
    integrateTool(iName, iTarget);
    break;
  }
  case 'status':
    showStatus();
    break;
  default:
    console.log('skill-discovery.js — 技能发现+验证+集成闭环');
    console.log('  scan                          扫描知识库→提取可集成工具');
    console.log('  verify --tool "<name>"        验证工具可用性');
    console.log('  integrate --tool "<name>" --target <target>  集成到目标');
    console.log('  status                        查看流水线状态');
}
