#!/usr/bin/env node
// knowledge-loop.js v1.1 — 知识环自动注入（修复版）
// 修复：gbrain put用--content而非stdin重定向，修正误报错误逻辑
// 三合一：热点→gbrain入库 + 协作文件→gbrain同步 + 定期embed
// 用法:
//   node knowledge-loop.js hot-ingest --dir <热点汇总目录>   热点汇总→gbrain自动入库
//   node knowledge-loop.js hot-ingest-today                  快捷：自动用今天日期构建路径
//   node knowledge-loop.js sync-team --source qclaw-team     同步协作基础设施到gbrain
//   node knowledge-loop.js sync-workspace                    同步workspace核心文件
//   node knowledge-loop.js embed-all                         全量embed更新
//   node knowledge-loop.js run-all                           一键三连
//   node knowledge-loop.js status                            查看知识库状态

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const GBRAIN_CMD = 'gbrain';
const WORKSPACE = path.resolve(__dirname, '..', '..');
const DESKTOP = path.join(os.homedir(), 'Desktop');

/**
 * 执行gbrain命令
 * v1.1修复：gbrain向stderr输出警告(含"error"字样)但实际成功，
 * 因此不再用stderr内容判断错误，改为检查exit code和stdout中的JSON
 */
function gbrain(args, opts = {}) {
  const cmd = GBRAIN_CMD + ' ' + args;
  try {
    const stdout = execSync(cmd, {
      encoding: 'utf-8',
      timeout: opts.timeout || 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024 // 10MB for large content
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    // gbrain exits with code 1 when there are warnings on stderr,
    // but the operation may still have succeeded.
    // Check if stdout has valid JSON response.
    const stdout = e.stdout || '';
    const stderr = e.stderr || '';
    
    // If stdout contains JSON with status field, it's likely a success
    if (stdout.includes('"status"') || stdout.includes('"slug"') || stdout.includes('"chunks"')) {
      return { ok: true, stdout: stdout.trim(), warning: stderr.trim() };
    }
    
    // Real error: ENOENT, page_not_found, etc.
    if (stderr.includes('ENOENT') || stderr.includes('page_not_found') || stderr.includes('Error [')) {
      return { ok: false, error: stderr.trim(), stdout: stdout.trim() };
    }
    
    // If stdout has content but no clear error markers, treat as success
    if (stdout.trim().length > 0 && !stdout.includes('Error')) {
      return { ok: true, stdout: stdout.trim(), warning: stderr.trim() };
    }
    
    return { ok: false, error: (stderr || e.message).trim(), stdout: stdout.trim() };
  }
}

/**
 * gbrain put with content (v1.1修复：用execFileSync+--content，不用shell重定向)
 * execFileSync绕过shell，正确传递多行内容（含换行符的YAML frontmatter）
 */
function gbrainPut(slug, content) {
  try {
    const stdout = execFileSync('gbrain', ['put', slug, '--content', content], {
      encoding: 'utf-8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024
    });
    return { ok: true, stdout: stdout.trim() };
  } catch (e) {
    const stdout = e.stdout || '';
    const stderr = e.stderr || '';
    // gbrain exits 1 with warnings but operation may succeed
    if (stdout.includes('"status"') || stdout.includes('"slug"') || stdout.includes('"chunks"')) {
      return { ok: true, stdout: stdout.trim(), warning: stderr.trim() };
    }
    if (stderr.includes('ENOENT') || stderr.includes('page_not_found') || stderr.includes('Error [')) {
      return { ok: false, error: stderr.trim(), stdout: stdout.trim() };
    }
    if (stdout.trim().length > 0 && !stdout.includes('Error')) {
      return { ok: true, stdout: stdout.trim(), warning: stderr.trim() };
    }
    return { ok: false, error: (stderr || e.message).trim(), stdout: stdout.trim() };
  }
}

// === HOT INGEST ===
function hotIngest(dir) {
  const targetDir = dir;
  console.log('[hot-ingest] 扫描目录: ' + targetDir);

  if (!fs.existsSync(targetDir)) {
    console.log('[hot-ingest] ⚠️ 目录不存在: ' + targetDir);
    return { ok: false, reason: '目录不存在', dir: targetDir };
  }

  const files = fs.readdirSync(targetDir).filter(f => f.endsWith('.md'));
  console.log('[hot-ingest] 发现 ' + files.length + ' 个文件');

  if (files.length === 0) {
    return { ok: false, reason: '目录中无.md文件', dir: targetDir };
  }

  const results = [];

  for (const file of files) {
    const filePath = path.join(targetDir, file);
    const stat = fs.statSync(filePath);
    const slug = 'hot-' + file.replace(/\.md$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff\-]/g, '-').toLowerCase().slice(0, 60);

    // Read file content
    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (e) {
      console.error('  ❌ 读取失败 ' + file + ': ' + e.message);
      results.push({ slug, file, imported: false, error: '读取失败: ' + e.message });
      continue;
    }

    // Build enriched content with frontmatter
    const enriched = [
      '---',
      'type: hotspot',
      'imported_at: ' + new Date().toISOString(),
      'source_file: ' + file,
      'source_path: ' + filePath,
      'file_mtime: ' + stat.mtime.toISOString(),
      '---',
      '',
      content
    ].join('\n');

    // Write to gbrain using --content (v1.1修复)
    const putResult = gbrainPut(slug, enriched);
    
    if (putResult.ok) {
      results.push({ slug, file, imported: true, lines: content.split('\n').length });
      console.log('  ✅ ' + slug + ' (' + file + ')');
      if (putResult.warning) {
        console.log('     (warning: ' + putResult.warning.slice(0, 80) + '...)');
      }
    } else {
      results.push({ slug, file, imported: false, error: putResult.error || 'unknown' });
      console.error('  ❌ ' + slug + ': ' + (putResult.error || 'unknown'));
    }
  }

  const imported = results.filter(r => r.imported).length;
  const failed = results.filter(r => !r.imported).length;
  console.log('[hot-ingest] 完成: ✅ ' + imported + ' 成功, ❌ ' + failed + ' 失败');
  
  return { ok: true, imported, failed, results };
}

/**
 * 快捷命令：自动用今天日期构建热点目录路径
 */
function hotIngestToday() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const dateStr = yyyy + mm + dd;
  
  const dir = DESKTOP + '\\每日热点\\qclaw' + dateStr;
  console.log('[hot-ingest-today] 日期: ' + dateStr + ', 目录: ' + dir);
  
  // 如果今天的目录不存在，尝试昨天
  if (!fs.existsSync(dir)) {
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yYYYY = yesterday.getFullYear();
    const yMM = String(yesterday.getMonth() + 1).padStart(2, '0');
    const yDD = String(yesterday.getDate()).padStart(2, '0');
    const yDateStr = yYYYY + yMM + yDD;
    const yDir = DESKTOP + '\\每日热点\\qclaw' + yDateStr;
    
    if (fs.existsSync(yDir)) {
      console.log('[hot-ingest-today] 今日目录不存在，使用昨天: ' + yDir);
      return hotIngest(yDir);
    }
    
    console.log('[hot-ingest-today] ⚠️ 今日和昨日目录都不存在');
    return { ok: false, reason: '热点目录不存在', tried: [dir, yDir] };
  }
  
  return hotIngest(dir);
}

// === SYNC TEAM ===
function syncTeam() {
  console.log('[sync-team] 同步协作基础设施...');
  const result = gbrain('sync --source qclaw-team');
  if (result.ok) {
    console.log(result.stdout);
  } else {
    console.error('[sync-team] 失败: ' + (result.error || 'unknown'));
  }
  return { ok: result.ok, output: result.stdout || result.error };
}

// === SYNC WORKSPACE ===
function syncWorkspace() {
  console.log('[sync-workspace] 同步workspace核心文件到gbrain...');

  const learningsDir = path.join(WORKSPACE, '.learnings');
  const coreFiles = [
    'MEMORY.md', 'AGENTS.md', 'SOUL.md', 'USER.md', 'TOOLS.md',
  ];
  
  // Add .learnings/*.md files
  if (fs.existsSync(learningsDir)) {
    for (const f of fs.readdirSync(learningsDir)) {
      if (f.endsWith('.md')) coreFiles.push('.learnings/' + f);
    }
  }

  const results = [];
  for (const file of coreFiles) {
    const actualPath = file.startsWith('.learnings/') 
      ? path.join(WORKSPACE, file) 
      : path.join(WORKSPACE, file);

    if (!fs.existsSync(actualPath)) continue;

    const slug = 'ws-' + file.replace(/\.md$/, '').replace(/[^a-zA-Z0-9\u4e00-\u9fff\-]/g, '-').toLowerCase().slice(0, 60);
    
    let content;
    try {
      content = '// Source: ' + actualPath + '\n' + fs.readFileSync(actualPath, 'utf-8');
    } catch (e) {
      results.push({ slug, file, synced: false, error: e.message });
      continue;
    }

    const putResult = gbrainPut(slug, content);
    if (putResult.ok) {
      results.push({ slug, file, synced: true });
      console.log('  ✅ ' + slug);
    } else {
      results.push({ slug, file, synced: false, error: putResult.error });
      console.error('  ❌ ' + slug + ': ' + (putResult.error || 'unknown'));
    }
  }

  return { ok: true, synced: results.filter(r => r.synced).length, failed: results.filter(r => !r.synced).length, results };
}

// === EMBED ALL ===
function embedAll() {
  console.log('[embed-all] 全量生成/刷新embeddings...');
  const result = gbrain('embed --all', { timeout: 120000 });
  if (result.ok) {
    console.log(result.stdout);
    return { ok: true, output: result.stdout.slice(-500) };
  } else {
    console.error('[embed-all] 失败: ' + (result.error || 'unknown'));
    return { ok: false, error: result.error };
  }
}

// === RUN ALL ===
function runAll() {
  const results = {};

  console.log('=== 1/3: 同步协作基础设施 ===');
  results.sync_team = syncTeam();

  console.log('\n=== 2/3: 同步workspace核心文件 ===');
  results.sync_workspace = syncWorkspace();

  console.log('\n=== 3/3: 热点自动入库 ===');
  results.hot_ingest = hotIngestToday();

  console.log('\n=== 附加: 全量embed ===');
  results.embed = embedAll();

  return { ok: true, results };
}

// === STATUS ===
function showStatus() {
  console.log('=== gbrain 知识库状态 ===');
  
  const listResult = gbrain('list -n 10');
  if (listResult.ok) {
    console.log(listResult.stdout);
  } else {
    console.error('list失败: ' + (listResult.error || 'unknown'));
  }
  
  const statsResult = gbrain('stats');
  if (statsResult.ok) {
    console.log(statsResult.stdout);
  } else {
    console.error('stats失败: ' + (statsResult.error || 'unknown'));
  }
  
  // 显示热点类型页面
  const hotResult = gbrain('list --type hotspot');
  if (hotResult.ok && hotResult.stdout) {
    console.log('\n=== 热点页面 ===');
    console.log(hotResult.stdout);
  }
  
  return { ok: true };
}

// === ARGS PARSER ===
// 支持带空格和中文的路径参数
function parseArgs(argv) {
  const args = { cmd: null, dir: null, source: null };
  args.cmd = argv[2];
  
  for (let i = 3; i < argv.length; i++) {
    if (argv[i] === '--dir' && i + 1 < argv.length) {
      args.dir = argv[i + 1];
      i++;
    } else if (argv[i] === '--source' && i + 1 < argv.length) {
      args.source = argv[i + 1];
      i++;
    }
  }
  
  return args;
}

// === MAIN ===
const args = parseArgs(process.argv);

switch (args.cmd) {
  case 'hot-ingest':
    if (!args.dir) {
      console.error('用法: node knowledge-loop.js hot-ingest --dir <热点汇总目录>');
      process.exit(1);
    }
    console.log(JSON.stringify(hotIngest(args.dir), null, 2));
    break;
  case 'hot-ingest-today':
    console.log(JSON.stringify(hotIngestToday(), null, 2));
    break;
  case 'sync-team':
    console.log(JSON.stringify(syncTeam(), null, 2));
    break;
  case 'sync-workspace':
    console.log(JSON.stringify(syncWorkspace(), null, 2));
    break;
  case 'embed-all':
    console.log(JSON.stringify(embedAll(), null, 2));
    break;
  case 'run-all':
    console.log(JSON.stringify(runAll(), null, 2));
    break;
  case 'status':
    showStatus();
    break;
  default:
    console.log('knowledge-loop.js v1.1 — 知识环自动注入（修复版）');
    console.log('  hot-ingest --dir <path>      热点汇总→gbrain入库');
    console.log('  hot-ingest-today             快捷：自动用今天日期');
    console.log('  sync-team [--source name]    同步协作基础设施');
    console.log('  sync-workspace               同步workspace核心文件');
    console.log('  embed-all                    全量embed更新');
    console.log('  run-all                      一键全部');
    console.log('  status                       知识库状态');
}
