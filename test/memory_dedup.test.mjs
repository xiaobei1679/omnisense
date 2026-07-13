// 记忆去重压缩离线单测（node --test，不触网）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Memory } from '../src/core/memory.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = () => join(tmpdir(), `omni-dedup-${Math.random().toString(36).slice(2)}.json`);

test('Memory.dedupNotes 合并完全重复的 note', () => {
  const m = new Memory(tmp());
  m.notes = [];
  m.note('重复经验A'); m.note('重复经验A'); m.note('另一条');
  const removed = m.dedupNotes();
  assert.equal(removed, 1);
  assert.equal(m.notes.length, 2);
  const aNotes = m.notes.filter(n => n.text === '重复经验A');
  assert.equal(aNotes.length, 1, '重复项应只保留一条');
});

test('Memory.dedupNotes 保留最早时间戳', () => {
  const m = new Memory(tmp());
  m.notes = [];
  const t0 = Date.now();
  m.notes.push({ t: t0 + 5000, text: 'X' });
  m.notes.push({ t: t0, text: 'X' }); // 更早
  m.dedupNotes();
  assert.equal(m.notes[0].t, t0, '应保留更早的重复项时间戳');
});

test('Memory.compact 超过上限删除最旧', () => {
  const m = new Memory(tmp());
  m.notes = [];
  const now = Date.now();
  for (let i = 0; i < 5; i++) m.notes.push({ t: now - i * 1000, tag: '', text: 'n' + i });
  const { removed, notes } = m.compact(3);
  assert.equal(removed, 2);
  assert.equal(notes, 3);
});

test('Memory.dedupNotes 不动 store/playbook', () => {
  const m = new Memory(tmp());
  m.notes = [];
  m.remember('playbook:x', { goal: 'g', steps: [] });
  m.note('a'); m.note('a');
  m.dedupNotes();
  assert.ok(m.store['playbook:x'], 'playbook 不应被去重影响');
  assert.equal(m.notes.length, 1);
});
