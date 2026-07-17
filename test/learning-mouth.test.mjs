// learning/src/modules/mouth.mjs 行为单测（零依赖、离线、不触网）
// 用假 bus（记录 emit 事件） + 假 memory（neighbors 默认空）做断言。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MouthModule } from '../learning/src/modules/mouth.mjs';

// 静默 console.log，保证测试输出干净
const _log = console.log;
console.log = () => {};

function fakeBus() {
  const handlers = {};
  return {
    _events: [],
    on(ev, fn) { (handlers[ev] ||= []).push(fn); },
    emit(ev, payload) { this._events.push({ ev, payload }); for (const fn of handlers[ev] || []) fn(payload); },
  };
}
function fakeMemory() {
  return { neighbors: () => ({ out: [], inc: [] }) };
}

test('speak intent 类洞察不发声、不增 turn', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.speak({ kind: 'intent', belief: 'x' });
  assert.equal(m.turn, 0);
  assert.equal(bus._events.filter((e) => e.ev === 'utterance').length, 0);
});

test('speak 普通洞察发声 view + 置信度透传 + turn 自增', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.speak({ kind: 'hypothesis', belief: 'B', confidence: 0.8, counter: ['c1'] });
  assert.equal(m.turn, 1);
  const u = bus._events.find((e) => e.ev === 'utterance');
  assert.equal(u.payload.type, 'view');
  assert.equal(u.payload.text, 'B');
  assert.equal(u.payload.confidence, 0.8);
});

test('speak 措辞按 turn 轮换（4 轮用到 4 种不同 lead）', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  const texts = [];
  for (let i = 0; i < 4; i++) {
    m.speak({ kind: 'hypothesis', belief: 'b' + i });
    texts.push(bus._events.filter((e) => e.ev === 'utterance').pop().payload.text);
  }
  assert.equal(m.turn, 4);
  assert.equal(new Set(texts).size, 4); // 4 条 view 文本彼此不同 = 轮换生效
});

test('ask 实体去重 + 上限 3 + 跳过已追问', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.ask({ entities: ['A', 'A', 'B', 'C', 'D', 'E'] }); // 含重复 A
  assert.equal(m.agenda.length, 3); // 上限 3
  assert.deepEqual([...m.asked], ['A', 'B', 'C']);
  const qs = bus._events.filter((e) => e.ev === 'utterance' && e.payload.type === 'question');
  assert.equal(qs.length, 3);

  m.ask({ entities: ['A', 'D', 'E'] }); // A 已问过跳过，D/E 新
  assert.equal(m.agenda.length, 5);
  assert.deepEqual([...m.asked].sort(), ['A', 'B', 'C', 'D', 'E']);
});

test('ask 同实体不重复追问（asked 集合去重）', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.ask({ entities: ['X'] });
  m.ask({ entities: ['X'] });
  const qs = bus._events.filter((e) => e.ev === 'utterance' && e.payload.type === 'question');
  assert.equal(qs.length, 1);
});

test('respond 满足信号 → done + 清空议程 + ack + user-percept', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.ask({ entities: ['A', 'B'] });
  assert.equal(m.agenda.length, 2);
  m.respond('明白了，够了');
  assert.equal(m.done, true);
  assert.equal(m.agenda.length, 0);
  assert.ok(bus._events.find((e) => e.ev === 'utterance' && e.payload.type === 'ack'));
  const up = bus._events.find((e) => e.ev === 'user-percept');
  assert.equal(up.payload.text, '明白了，够了');
});

test('respond 非满足信号 → 保留议程 + 标记已答 + 追问延伸', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  m.ask({ entities: ['A'] });
  m.respond('A 是某角色');
  assert.equal(m.done, false);
  assert.equal(m.agenda[0].answered, true);
  assert.equal(m.qa.length, 1);
  const up = bus._events.find((e) => e.ev === 'user-percept');
  assert.equal(up.payload.text, 'A 是某角色');
  assert.ok(bus._events.find((e) => e.ev === 'utterance' && e.payload.type === 'followup'));
});

test('reportLearning 过滤 shields.io/徽章噪声 + 技法上限 4 + teach-back', () => {
  const bus = fakeBus();
  const m = new MouthModule(bus, fakeMemory());
  const l = {
    repo: 'r', topic: 't',
    techniques: ['good1', 'good2', '![badge](https://img.shields.io/x)', 'https://example.com', 'good3', 'good4', 'good5'],
  };
  m.reportLearning(l);
  const u = bus._events.find((e) => e.ev === 'utterance' && e.payload.type === 'learning');
  const shown = u.payload.text;
  assert.ok(!/shields\.io|img\.shields|!\[|<img|https?:\/\//.test(shown));
  assert.equal(shown.split(' / ').length, 4); // 截断到 4 项
  assert.ok(bus._events.find((e) => e.ev === 'utterance' && e.payload.type === 'teachback'));
});

console.log = _log;
