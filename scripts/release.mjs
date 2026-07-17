#!/usr/bin/env node
// OmniSense 版本与发布管理器（本地-only，绝不推送）
//
// 设计规则（用户要求）：
//   - 每次更新都有版本号 + 更新内容（CHANGELOG.md / versions.json）
//   - major/minor 由**实际变更规模**决定，而非机械按时间
//   - 可回退：每次发布打 git tag vX.Y.Z；rollback 命令非破坏式还原（新提交，历史保留）
//
// 版本语义（v9.2.0 起重构，2026-07-15 用户反馈"大版本更新并没有实质大更新"后优化）：
//   minor（MAJOR.MINOR+1.0）：日常增量迭代（单层小改动 / monitor 小幅增强 / 文档同步 / 学习心跳）
//   major（MAJOR+1.0.0，MINOR 归零）：架构级变更（新增器官 / 跨2+层大重构 / BREAKING / ≥25文件或≥1200行）
//   skip（不发布）：变更过少（<3文件且<50行），心跳保留版本号不变
//   auto 模式综合判断：diff 量级 + 跨层判定 + notes 关键词 + minor 封顶(25)，不再以时间为因素
//
// 用法:
//   node scripts/release.mjs init-baseline [--notes "..."]   把当前版本登记为首个基线(major)
//   node scripts/release.mjs bump --type minor|major --notes "..."   手动指定类型发布
//   node scripts/release.mjs auto [--notes "..."] [--force-major]   智能判定 minor/major
//   node scripts/release.mjs current                         打印当前 VERSION 与最新 tag
//   node scripts/release.mjs list                            列出所有本地版本(tag)
//   node scripts/release.mjs rollback <tag>                  非破坏式回退到指定 tag（新提交，历史保留）

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION_FILE = join(ROOT, 'VERSION');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const MANIFEST = join(ROOT, 'versions.json');
const PKG = join(ROOT, 'package.json');

// ── major 判定阈值 ─────────────────────────────────────────
// 用户反馈"大版本更新并没有实质大更新"——根因：阈值太低(15文件/500行)，两天从v1暴涨到v9。
// 优化措施：大幅提高阈值 + 跨层检测 + minor 封顶 + 跳过微小变更。
const MAJOR_FILE_THRESHOLD = 25;        // 变更 ≥25 文件 → major（原15）
const MAJOR_LINE_THRESHOLD = 1200;      // 变更 ≥1200 行 → major（原500）
const MINORS_TIL_AUTO_MAJOR = 25;       // 距上次 major 已有 ≥25 个 minor → 自动 consolidating major
const SKIP_MIN_FILES = 3;               // 变更文件 <3 且行数 <50 → skip（不发布，版本号不变）
const MAJOR_KEYWORDS = [                // notes 含以下关键词 → major（去掉过于宽泛的词）
  'BREAKING', 'cor:major', 'cor:breaking',
  '新增器官', '新器官', '架构变更', '破坏性', '重构核心',
];
const LAYERS = ['src/', 'integrations/', 'openclaw-workspace/', 'learning/'];

// ── 纯函数（可被单元测试复用）──────────────────────────────
export function parseVersion(v) {
  const [maj = 0, min = 0, pat = 0] = String(v).split('.').map((n) => parseInt(n, 10) || 0);
  return { maj, min, pat };
}
export function nextVersionOf(cur, type) {
  const { maj, min } = parseVersion(cur);
  if (type === 'major') return `${maj + 1}.0.0`;
  return `${maj}.${min + 1}.0`;
}
export function hasMajorKeywords(notes) {
  if (!notes) return false;
  return MAJOR_KEYWORDS.some(k => notes.includes(k));
}
export function parseDiffStat(text) {
  // 从 `git diff --stat` 输出解析文件数与行数
  const lines = text.trim().split('\n').filter(Boolean);
  const fileCount = lines.filter(l => l.includes('|')).length; // 只计含 "|" 的文件行，忽略总结行
  // 最后一行通常为 "X files changed, Y insertions(+), Z deletions(-)"
  const summary = lines[lines.length - 1] || '';
  const insMatch = summary.match(/(\d+) insertion/);
  const delMatch = summary.match(/(\d+) deletion/);
  const changedLines = (insMatch ? parseInt(insMatch[1]) : 0) + (delMatch ? parseInt(delMatch[1]) : 0);
  return { fileCount, changedLines, raw: text };
}
export function countMinorsSinceMajor(manifest) {
  // 从 manifest 末尾向前数：自上次 major/baseline 以来有多少个 minor
  let count = 0;
  for (let i = manifest.length - 1; i >= 0; i--) {
    const e = manifest[i];
    if (e.type === 'major' || e.type === 'baseline') break;
    if (e.type === 'minor') count++;
  }
  return count;
}
export function detectCrossLayer(rawDiff) {
  // 从 git diff --stat 的原始输出检测变更触及了哪几层
  if (!rawDiff) return { count: 0, layers: [] };
  const touched = new Set();
  for (const line of rawDiff.split('\n')) {
    const t = line.trim();
    if (!t.includes('|')) continue;
    for (const l of LAYERS) {
      if (t.startsWith(l)) {
        touched.add(l.replace(/\/$/, ''));
      }
    }
  }
  return { count: touched.size, layers: [...touched] };
}
export function decideAuto(manifest, opts = {}) {
  // 优先级：
  //   1) --force-major 显式覆写 → major
  //   2) --notes 含 major 关键词 → major
  //   3) git diff 空或不可读 → skip
  //   4) 微小变更（<3文件且<50行） → skip（版本号不变，心跳无意义空转不应消耗版本号）
  //   5) 文件数/行数超阈值 → major
  //   6) 跨2+层 + 一定规模 → major
  //   7) minor 已达封顶 → auto consolidating major
  //   8) 默认 → minor
  if (opts.forceMajor) return { type: 'major', reason: '--force-major' };
  if (hasMajorKeywords(opts.notes)) return { type: 'major', reason: `notes 含 major 关键词` };

  // 读取 diff（支持 _diffStat 注入用于纯函数单测）：
  const diffText = opts._diffStat !== undefined
    ? opts._diffStat
    : (() => { try { return sh('git', ['diff', '--stat', 'HEAD']).trim(); } catch { return ''; } })();
  if (!diffText) return { type: 'skip', reason: '无变更, 跳过发布' };
  const { fileCount, changedLines, raw } = parseDiffStat(diffText);

  // 微小变更 → skip（版本号不变，心跳的"每个自动化轮次都 bump"应当停止）
  if (fileCount < SKIP_MIN_FILES && changedLines < 50) {
    return { type: 'skip', reason: `变更过少(${fileCount}文件${changedLines}行), 跳过发布` };
  }

  // 文件数阈值
  if (fileCount >= MAJOR_FILE_THRESHOLD) {
    return { type: 'major', reason: `diff ${fileCount} 文件(阈值${MAJOR_FILE_THRESHOLD})` };
  }
  // 行数阈值
  if (changedLines >= MAJOR_LINE_THRESHOLD) {
    return { type: 'major', reason: `diff ${changedLines} 行(阈值${MAJOR_LINE_THRESHOLD})` };
  }
  // 跨层检测：触及 2+ 层且文件≥10 或行≥300 → 综合判 major
  const cross = detectCrossLayer(raw);
  if (cross.count >= 2 && (fileCount >= 10 || changedLines >= 300)) {
    return { type: 'major', reason: `跨${cross.count}层(${cross.layers.join(',')}) + ${fileCount}文件${changedLines}行, 综合 major` };
  }
  // minor 封顶：距上次 major 已满 MINORS_TIL_AUTO_MAJOR → 合并为 consolidation major
  const minorsSince = countMinorsSinceMajor(manifest);
  if (minorsSince >= MINORS_TIL_AUTO_MAJOR) {
    return { type: 'major', reason: `距上次 major 已 ${minorsSince} 个 minor(封顶${MINORS_TIL_AUTO_MAJOR}), 合并 consolidation` };
  }
  return { type: 'minor', reason: `diff ${fileCount} 文件 ${changedLines} 行, 未达 major 阈值` };
}

// ── git / 文件 IO 辅助 ──────────────────────────────────────
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}
export function readVersion() {
  return existsSync(VERSION_FILE) ? readFileSync(VERSION_FILE, 'utf8').trim() || '0.0.0' : '0.0.0';
}
function readManifest() {
  return existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : [];
}
function writeManifest(arr) {
  writeFileSync(MANIFEST, JSON.stringify(arr, null, 2) + '\n');
}
function readPkg() {
  return JSON.parse(readFileSync(PKG, 'utf8'));
}
function writePkg(obj) {
  writeFileSync(PKG, JSON.stringify(obj, null, 2) + '\n');
}
function nowISO() {
  return new Date().toISOString();
}

// ── 发布前质量护栏（preflight）─────────────────────────────
// 全量语法自检：递归扫描项目自有源码（src/integrations/scripts/learning）下所有 .mjs，
// 逐个 `node --check`。不放 npm test（零依赖单测偶因 undici keep-alive 挂起），
// 语法门禁足以挡住大多数"改坏文件"的发布。不放 node_modules/.git。
const PREFLIGHT_DIRS = ['src', 'integrations', 'scripts', 'learning'];
const PREFLIGHT_EXTS = ['.mjs'];
function collectSourceFiles() {
  const out = [];
  for (const d of PREFLIGHT_DIRS) {
    const base = join(ROOT, d);
    if (!existsSync(base)) continue;
    const walk = (p) => {
      for (const e of readdirSync(p)) {
        if (e === 'node_modules' || e === '.git') continue;
        const fp = join(p, e);
        let st;
        try { st = statSync(fp); } catch { continue; }
        if (st.isDirectory()) walk(fp);
        else if (PREFLIGHT_EXTS.includes(extname(fp).toLowerCase())) out.push(fp);
      }
    };
    walk(base);
  }
  return out;
}
function doPreflight() {
  const files = collectSourceFiles();
  let fail = 0;
  for (const f of files) {
    try {
      execFileSync(process.execPath, ['--check', f], { cwd: ROOT, stdio: 'pipe' });
    } catch (e) {
      fail++;
      const raw = (e && (e.stderr || e.stdout)) ? String(e.stderr || e.stdout) : String(e.message || e);
      console.error(`  ✗ 语法错误: ${f.replace(ROOT + '/', '')}\n${raw.split('\n').slice(0, 3).join('\n')}`);
    }
  }
  if (fail) {
    console.error(`❌ preflight 失败: ${fail} 个文件语法错误，已阻止发布`);
    process.exit(1);
  }
  console.log(`✅ preflight 通过: ${files.length} 个 .mjs 文件语法 OK`);
  return true;
}
function changelogHeader() {
  return [
    '# OmniSense 更新日志 (Changelog)',
    '',
    '所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。',
    '回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。',
    '版本规则: 基于**实际变更规模**判定——不再按时间（v9.2.0 起，用户反馈后优化）——',
    '  skip: 变更过少(<3文件且<50行) → 版本号不变，避免心跳空转消耗版本号',
    '  minor: 日常增量迭代（单层小改动 / monitor 小幅增强 / 文档同步 / 学习心跳）',
    '  major: 架构级变更（新增器官 / 跨2+层大重构 / BREAKING / ≥25文件或≥1200行 / minor 封顶25触发 consolidation）',
    '版本公开性: 每个条目带 public 字段——major/baseline 为对外可展示版本(public:true)，minor 为内部增量(public:false)。',
    '',
  ].join('\n');
}
function appendChangelog(entry) {
  const content = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : changelogHeader();
  const date = entry.date.slice(0, 10);
  const block = [
    `## v${entry.version} — ${date} (${entry.type})`,
    '',
    ...entry.notes.split('\n').map((n) => `- ${n}`),
    '',
  ].join('\n');
  const idx = content.indexOf('\n## ');
  const next = idx === -1 ? content + '\n' + block : content.slice(0, idx) + '\n' + block + content.slice(idx);
  writeFileSync(CHANGELOG, next);
}

// ── 发布动作 ────────────────────────────────────────────────
function commitAndTag(version, type, isBaseline = false) {
  sh('git', ['add', '-A']);
  const msg = isBaseline ? `chore(release): v${version} (baseline)` : `chore(release): v${version} (${type})`;
  sh('git', ['commit', '-q', '-m', msg]);
  sh('git', ['tag', `v${version}`]);
}
function doBaseline(notes) {
  const cur = readVersion();
  writeFileSync(VERSION_FILE, cur + '\n');
  const entry = { version: cur, type: 'baseline', date: nowISO(), tag: `v${cur}`, public: true, notes: notes || '初始合并后基线。' };
  appendChangelog(entry);
  const manifest = readManifest();
  manifest.push(entry);
  writeManifest(manifest);
  commitAndTag(cur, 'baseline', true);
  console.log(`✅ baseline 发布 v${cur}，tag=v${cur}（本地，未推送）`);
  return cur;
}
function doBump(type, notes, isBaseline = false) {
  doPreflight();   // 质量护栏：发布前全量语法自检，挡住坏文件
  const cur = readVersion();
  const next = nextVersionOf(cur, type);
  const entryType = isBaseline ? 'baseline' : type;
  const entry = { version: next, type: entryType, date: nowISO(), tag: `v${next}`, public: entryType === 'major' || entryType === 'baseline', notes: notes || '(无说明)' };
  writeFileSync(VERSION_FILE, next + '\n');
  const pkg = readPkg();
  pkg.version = next;
  writePkg(pkg);
  appendChangelog(entry);
  const manifest = readManifest();
  manifest.push(entry);
  writeManifest(manifest);
  commitAndTag(next, type, isBaseline);
  console.log(`✅ ${entryType} 发布 v${next}，tag=v${next}（本地，未推送）`);
  return next;
}
function doAuto(notes) {
  const manifest = readManifest();
  const forceMajor = process.argv.includes('--force-major');
  const decision = decideAuto(manifest, { notes, forceMajor });
  if (decision.type === 'skip') {
    console.log(`  → 跳过: ${decision.reason}（版本号不变）`);
    return;
  }
  const result = doBump(decision.type, notes);
  console.log(`  → 判定: ${decision.type}（${decision.reason}）`);
  return result;
}
function doCurrent() {
  const v = readVersion();
  let tag = '';
  try {
    tag = sh('git', ['describe', '--tags', '--abbrev=0']).trim();
  } catch {
    /* 无 tag */
  }
  console.log(`VERSION=${v}`);
  console.log(`latestTag=${tag || '(无)'}`);
}
function doList() {
  const manifest = readManifest();
  if (!manifest.length) {
    console.log('（暂无版本记录）');
    return;
  }
  console.log('版本历史（本地 tag，未推送）:');
  for (const e of manifest) {
    let commit = '';
    try {
      commit = sh('git', ['rev-parse', e.tag]).trim().slice(0, 8);
    } catch {
      /* tag 不存在 */
    }
    console.log(`  v${e.version}  [${e.type}]  ${e.date.slice(0, 19).replace('T', ' ')}  tag=${e.tag}  ${commit}`);
    for (const n of e.notes.split('\n')) console.log(`      - ${n}`);
  }
}
function doRollback(tag) {
  if (!tag) {
    console.error('用法: node scripts/release.mjs rollback <tag>');
    process.exit(1);
  }
  try {
    sh('git', ['rev-parse', `${tag}^{commit}`]);
  } catch {
    console.error(`❌ tag ${tag} 不存在`);
    process.exit(1);
  }
  // 还原被跟踪文件到该 tag 内容（含删后重建）；该 tag 之后新增且仍被跟踪的文件移除，使工作树忠实于该版本
  sh('git', ['checkout', tag, '--', '.']);
  const addedAfter = sh('git', ['diff', '--name-only', '--diff-filter=A', `${tag}..HEAD`])
    .split('\n')
    .filter(Boolean);
  for (const f of addedAfter) {
    try {
      sh('git', ['rm', '-r', '--ignore-unmatch', '--', f]);
    } catch {
      /* 忽略单个失败 */
    }
  }
  const entry = { version: tag.replace(/^v/, ''), type: 'rollback', date: nowISO(), tag, notes: `回退到 ${tag}` };
  appendChangelog(entry);
  const manifest = readManifest();
  manifest.push(entry);
  writeManifest(manifest);
  sh('git', ['add', '-A']);
  sh('git', ['commit', '-q', '-m', `chore(rollback): → ${tag}`]);
  console.log(`✅ 已回退到 ${tag}（新提交，历史保留）。如需彻底丢弃后续更新可用: git reset --hard ${tag}`);
}

// ── CLI 分发 ────────────────────────────────────────────────
function getNotes(rest) {
  const i = rest.indexOf('--notes');
  return i >= 0 ? rest.slice(i + 1).join(' ').trim() : '';
}
function main() {
  const [, , cmd, ...rest] = process.argv;
  const typeIdx = rest.indexOf('--type');
  const type = typeIdx >= 0 ? rest[typeIdx + 1] : 'minor';
  switch (cmd) {
    case 'init-baseline':
      doBaseline(getNotes(rest));
      break;
    case 'bump':
      doBump(type === 'major' ? 'major' : 'minor', getNotes(rest));
      break;
    case 'auto':
      doAuto(getNotes(rest));
      break;
    case 'current':
      doCurrent();
      break;
    case 'list':
      doList();
      break;
    case 'rollback':
      doRollback(rest[0]);
      break;
    case 'preflight':
      doPreflight();
      break;
    default:
      console.error(
        '用法: release.mjs <init-baseline|bump|auto|current|list|rollback|preflight> [--type minor|major] [--notes "..."] [--force-major] [<tag>]'
      );
      process.exit(1);
  }
}

// 仅当作为脚本直接运行时执行（测试可 import 纯函数而不触发 git）
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main();
}
