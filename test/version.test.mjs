import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, nextVersionOf, decideAuto, hasMajorKeywords, parseDiffStat } from '../scripts/release.mjs';

test('parseVersion 解析 MAJOR.MINOR.PATCH', () => {
  assert.deepEqual(parseVersion('1.2.3'), { maj: 1, min: 2, pat: 3 });
  assert.deepEqual(parseVersion('0.0.0'), { maj: 0, min: 0, pat: 0 });
  // 缺段兜底为 0
  assert.deepEqual(parseVersion('2'), { maj: 2, min: 0, pat: 0 });
});

test('nextVersionOf: minor 自增 MINOR，major 归零 MINOR', () => {
  assert.equal(nextVersionOf('1.2.3', 'minor'), '1.3.0');
  assert.equal(nextVersionOf('1.2.3', 'major'), '2.0.0');
  assert.equal(nextVersionOf('0.9.9', 'major'), '1.0.0');
});

test('hasMajorKeywords: 检测 notes 中的 major 关键词', () => {
  assert.equal(hasMajorKeywords('BREAKING: 改 API'), true);
  assert.equal(hasMajorKeywords('cor:major 大版本'), true);
  assert.equal(hasMajorKeywords('新增器官 monitor'), true);
  assert.equal(hasMajorKeywords('重构核心框架'), true);
  // 以下不在 MAJOR_KEYWORDS 中（太宽泛，去掉后不应误判为 major）
  assert.equal(hasMajorKeywords('架构级重构'), false);
  assert.equal(hasMajorKeywords('跨三层重大重构'), false);
  assert.equal(hasMajorKeywords('日常迭代'), false);
  assert.equal(hasMajorKeywords(''), false);
  assert.equal(hasMajorKeywords(null), false);
});

test('parseDiffStat: 解析 git diff --stat 输出', () => {
  const sample = ` src/modules/monitor.mjs | 42 ++++++++++++++++++++
 src/cli.mjs              | 10 +++++
 2 files changed, 52 insertions(+)
`;
  const result = parseDiffStat(sample);
  assert.equal(result.fileCount, 2);
  assert.equal(result.changedLines, 52);
});

test('parseDiffStat: 空输出', () => {
  const result = parseDiffStat('');
  assert.equal(result.fileCount, 0);
  assert.equal(result.changedLines, 0);
});

test('decideAuto: --force-major 直接返回 major', () => {
  const result = decideAuto([], { forceMajor: true });
  assert.equal(result.type, 'major');
  assert.ok(result.reason);
});

test('decideAuto: notes 含 major 关键词 → major', () => {
  const result = decideAuto([], { notes: 'BREAKING: 接口变更' });
  assert.equal(result.type, 'major');
});

test('decideAuto: 小改动(1文件3行) → skip（变更过少）', () => {
  const smallDiff = ` src/cli.mjs | 3 ++
 1 file changed, 3 insertions(+)
`;
  const result = decideAuto([], { _diffStat: smallDiff });
  assert.equal(result.type, 'skip');
  assert.ok(result.reason);
});

test('decideAuto: 中等改动(12文件120行) → minor（文件/行数未达 major 阈值）', () => {
  const lines = [];
  for (let i = 0; i < 12; i++) lines.push(` src/file${i}.mjs | 10 +-`);
  lines.push('12 files changed, 120 insertions(+)');
  const result = decideAuto([], { _diffStat: lines.join('\n') });
  assert.equal(result.type, 'minor');
});

test('decideAuto: 大 diff(≥25文件) → major', () => {
  const lines = [];
  for (let i = 0; i < 26; i++) lines.push(` src/file${i}.mjs | 2 +-`);
  lines.push('26 files changed, 52 insertions(+)');
  const result = decideAuto([], { _diffStat: lines.join('\n') });
  assert.equal(result.type, 'major');
});

test('decideAuto: 大 diff(≥1200行) → major', () => {
  const bigDiff = ` src/modules/monitor.mjs | 500 ++++++++++++++++++++++++
 src/cli.mjs              | 400 ++++++++++++++++++
 src/body.mjs             | 300 +++++++++++++++++
 3 files changed, 1200 insertions(+)
`;
  const result = decideAuto([], { _diffStat: bigDiff });
  assert.equal(result.type, 'major');
});

test('decideAuto: 空 diff → skip（无变更不发布）', () => {
  const result = decideAuto([], { _diffStat: '' });
  assert.equal(result.type, 'skip');
});

test('decideAuto: diff 不可读 → skip 不崩溃', () => {
  const result = decideAuto([], {}); // 无 _diffStat → 尝试 git diff，可能空或失败
  assert.ok(result.type === 'skip' || result.type === 'minor' || result.type === 'major');
  assert.ok(result.reason);
});

test('decideAuto: 跨层检测 → 触及2层且≥10文件 → major', () => {
  const lines = [];
  for (let i = 0; i < 8; i++) lines.push(` src/modules/mod${i}.mjs | 10 +-`);
  lines.push(` integrations/openclaw/omni-body.mjs | 15 ++`);
  lines.push(` integrations/openclaw/omnisense-bridge.mjs | 8 +`);
  lines.push(`10 files changed, 103 insertions(+)`);
  const result = decideAuto([], { _diffStat: lines.join('\n') });
  assert.equal(result.type, 'major');
});

test('countMinorsSinceMajor: 正确计数距上次 major 的 minor 数', async () => {
  const { countMinorsSinceMajor } = await import('../scripts/release.mjs');
  const manifest = [
    { version: '1.0.0', type: 'baseline' },
    { version: '1.1.0', type: 'minor' },
    { version: '1.2.0', type: 'minor' },
    { version: '2.0.0', type: 'major' },
    { version: '2.1.0', type: 'minor' },
    { version: '2.2.0', type: 'minor' },
  ];
  assert.equal(countMinorsSinceMajor(manifest), 2);
  assert.equal(countMinorsSinceMajor([]), 0);
  assert.equal(countMinorsSinceMajor([{ version: '1.0.0', type: 'major' }]), 0);
});
