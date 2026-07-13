import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, nextVersionOf, decideAuto, latestMajorTime } from '../scripts/release.mjs';

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

test('decideAuto: 无历史 / 距上次 major≥3h → major；否则 minor', () => {
  // 空历史 → major（首个基线之后应当走 major 判定边界由自动化控制）
  assert.equal(decideAuto([]), 'major');
  const now = Date.now();
  const recent = [{ version: '1.0.0', type: 'major', date: new Date(now - 60 * 60 * 1000).toISOString() }];
  assert.equal(decideAuto(recent, now), 'minor'); // 1h 前 major → minor
  const old = [{ version: '1.0.0', type: 'major', date: new Date(now - 4 * 60 * 60 * 1000).toISOString() }];
  assert.equal(decideAuto(old, now), 'major'); // 4h 前 major → major
  const withBaseline = [{ version: '2.0.0', type: 'baseline', date: new Date(now - 2 * 60 * 60 * 1000).toISOString() }];
  assert.equal(decideAuto(withBaseline, now), 'minor'); // baseline 视作 major 起算点
});

test('latestMajorTime: 取最近 major/baseline 的时间', () => {
  const t = Date.now();
  const m = [
    { type: 'minor', date: new Date(t - 1000).toISOString() },
    { type: 'major', date: new Date(t - 5000).toISOString() },
  ];
  assert.equal(latestMajorTime(m), t - 5000);
  assert.equal(latestMajorTime([]), 0);
});
