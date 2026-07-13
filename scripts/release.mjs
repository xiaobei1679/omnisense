#!/usr/bin/env node
// OmniSense 版本与发布管理器（本地-only，绝不推送）
//
// 设计规则（用户要求）：
//   - 每小时一个小版本更新  →  minor（MAJOR.MINOR+1.0）
//   - 每 3 小时一个大版本更新 → major（MAJOR+1.0.0，MINOR 归零）
//   - 每次更新都有版本号 + 更新内容（CHANGELOG.md / versions.json）
//   - 可回退：每次发布打 git tag vX.Y.Z；rollback 命令非破坏式还原（新提交，历史保留）
//
// 用法:
//   node scripts/release.mjs init-baseline [--notes "..."]   把当前版本登记为首个基线(major)
//   node scripts/release.mjs bump --type minor|major --notes "..."   手动指定类型发布
//   node scripts/release.mjs auto [--notes "..."]            自动判定 minor/major(距上次 major ≥3h 则 major)
//   node scripts/release.mjs current                         打印当前 VERSION 与最新 tag
//   node scripts/release.mjs list                            列出所有本地版本(tag)
//   node scripts/release.mjs rollback <tag>                  非破坏式回退到指定 tag（新提交，历史保留）

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const VERSION_FILE = join(ROOT, 'VERSION');
const CHANGELOG = join(ROOT, 'CHANGELOG.md');
const MANIFEST = join(ROOT, 'versions.json');
const PKG = join(ROOT, 'package.json');
const MAJOR_INTERVAL_MS = 3 * 60 * 60 * 1000;

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
export function latestMajorTime(manifest) {
  for (let i = manifest.length - 1; i >= 0; i--) {
    if (manifest[i].type === 'major' || manifest[i].type === 'baseline') {
      const t = new Date(manifest[i].date).getTime();
      return Number.isNaN(t) ? 0 : t;
    }
  }
  return 0;
}
export function decideAuto(manifest, now = Date.now()) {
  const last = latestMajorTime(manifest);
  if (!last || now - last >= MAJOR_INTERVAL_MS) return 'major';
  return 'minor';
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
function changelogHeader() {
  return [
    '# OmniSense 更新日志 (Changelog)',
    '',
    '所有版本均为**本地提交 + git tag**，**未推送**（推送需用户明确下令）。',
    '回退命令: `node scripts/release.mjs rollback <tag>`（非破坏式，历史保留）。',
    '版本规则: 每小时 minor 小版本；距上次 major 满 3 小时则 major 大版本（minor 归零）。',
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
  const entry = { version: cur, type: 'baseline', date: nowISO(), tag: `v${cur}`, notes: notes || '初始合并后基线。' };
  appendChangelog(entry);
  const manifest = readManifest();
  manifest.push(entry);
  writeManifest(manifest);
  commitAndTag(cur, 'baseline', true);
  console.log(`✅ baseline 发布 v${cur}，tag=v${cur}（本地，未推送）`);
  return cur;
}
function doBump(type, notes, isBaseline = false) {
  const cur = readVersion();
  const next = nextVersionOf(cur, type);
  const entryType = isBaseline ? 'baseline' : type;
  const entry = { version: next, type: entryType, date: nowISO(), tag: `v${next}`, notes: notes || '(无说明)' };
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
  const type = decideAuto(manifest);
  return doBump(type, notes);
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
    default:
      console.error(
        '用法: release.mjs <init-baseline|bump|auto|current|list|rollback> [--type minor|major] [--notes "..."] [<tag>]'
      );
      process.exit(1);
  }
}

// 仅当作为脚本直接运行时执行（测试可 import 纯函数而不触发 git）
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main();
}
