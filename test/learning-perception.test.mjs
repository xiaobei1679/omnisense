// 学习子系统（learning/src/modules/{eye,ear,brain}.mjs）确定性单元测试：
// 覆盖视觉/听觉本地信号处理纯函数 + 大脑符号推理纯逻辑。
// 全部离线、零网络、零外部依赖；只测纯函数（不触真·聆听/阅读的网络路径）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePng, decodePng, analyzeImageDeep, EyeModule } from '../learning/src/modules/eye.mjs';
import { encodeWav, analyzeWav, EarModule } from '../learning/src/modules/ear.mjs';
import { BrainModule } from '../learning/src/modules/brain.mjs';
import { MemoryHub } from '../learning/src/memoryHub.mjs';

// ---------- 眼睛（视觉感知）：本地 PNG 编解码 + 深度分析 ----------
test('encodePng → decodePng 往返：尺寸/颜色一致', () => {
  const w = 4, h = 4;
  const rgb = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgb.push([(x * 40) % 256, (y * 40) % 256, ((x + y) * 30) % 256]);
  const buf = encodePng(w, h, rgb);
  const feat = decodePng(buf);
  assert.equal(feat.width, w);
  assert.equal(feat.height, h);
  assert.ok(Array.isArray(feat.avgColor) && feat.avgColor.length === 3);
  assert.ok(feat.brightness >= 0 && feat.brightness <= 255);
});

test('decodePng：非 PNG 缓冲抛错', () => {
  assert.throws(() => decodePng(Buffer.from('not a png file at all')), /不是 PNG 文件/);
});

test('analyzeImageDeep：真实特征返回结构化构图描述', () => {
  const feat = decodePng(encodePng(4, 4, [[10, 20, 30], [200, 10, 10], [10, 200, 10], [10, 10, 200],
    [200, 200, 10], [10, 200, 200], [200, 10, 200], [120, 120, 120], [30, 30, 30], [90, 90, 90], [60, 60, 60], [150, 150, 150],
    [20, 80, 160], [160, 80, 20], [80, 160, 20], [80, 20, 160]]));
  const d = analyzeImageDeep(feat);
  assert.equal(d.shape, '方形'); // 4x4 aspect=1
  assert.ok(['低', '中', '高'].includes(d.colorVariety));
  assert.ok(/清晰|中等|平滑/.test(d.sharpness));
  assert.ok(typeof d.description === 'string' && d.description.length > 0);
  assert.ok(typeof d.spatial === 'string' && d.spatial.length > 0);
});

test('analyzeImageDeep：错误特征诚实降级', () => {
  const d = analyzeImageDeep({ error: '解码失败' });
  assert.equal(d.description, '(图像不可用，已诚实降级)');
});

test('EyeModule.makeSampleImage：返回可被 decodePng 解析的合法 PNG', () => {
  const eye = new EyeModule({}, {});
  const buf = eye.makeSampleImage(null); // 不落盘
  const feat = decodePng(buf);
  assert.equal(feat.width, 8);
  assert.equal(feat.height, 8);
});

// ---------- 耳朵（听觉感知）：本地 WAV 编解码 + 特征提取 ----------
test('encodeWav → analyzeWav 往返：纯音基频与时长正确', () => {
  const rate = 8000, secs = 0.5;
  const n = Math.floor(secs * rate);
  const samples = [];
  for (let i = 0; i < n; i++) samples.push(Math.sin(2 * Math.PI * 440 * i / rate) * 0.6);
  const buf = encodeWav(samples, rate);
  const feat = analyzeWav(buf);
  assert.equal(feat.sampleRate, rate);
  assert.ok(Math.abs(feat.durationSec - secs) < 0.05);
  assert.ok(feat.rmsEnergy > 0);
  assert.ok(feat.pitchHz !== null && feat.pitchHz >= 400 && feat.pitchHz <= 480); // 440Hz 纯音
});

test('analyzeWav：非 WAV 缓冲抛错', () => {
  assert.throws(() => analyzeWav(Buffer.from('RIFF but not wave really')), /不是 WAV 文件/);
});

test('EarModule.makeSampleAudio：含静音间隙 → silenceRatio>0 且仍能估基频', () => {
  const ear = new EarModule({}, {});
  const buf = ear.makeSampleAudio(null, 0.6, 8000); // 440Hz + 0.1s 静音间隙
  const feat = analyzeWav(buf);
  assert.ok(feat.silenceRatio > 0.05); // 静音间隙被检出
  assert.ok(feat.pitchHz !== null && feat.pitchHz > 0);
  assert.ok(Math.abs(feat.durationSec - 0.6) < 0.05);
});

// ---------- 大脑（认知推理）：意图分类 + 信念修正 + 矛盾检测 ----------
const fakeBus = { on() {}, emit() {} };

test('inferIntent：疑问（含为什么/?）', () => {
  const brain = new BrainModule(fakeBus, { working: [] });
  assert.equal(brain.inferIntent('为什么会出现这种情况？'), '疑问');
});

test('inferIntent：纠正（不对/其实）', () => {
  const brain = new BrainModule(fakeBus, { working: [] });
  assert.equal(brain.inferIntent('你说的不对，其实是这样'), '纠正');
});

test('inferIntent：满足（明白了/够了）', () => {
  const brain = new BrainModule(fakeBus, { working: [] });
  assert.equal(brain.inferIntent('明白了，够了'), '满足');
});

test('inferIntent：补充（另外/补充）', () => {
  const brain = new BrainModule(fakeBus, { working: [] });
  assert.equal(brain.inferIntent('另外补充一点细节'), '补充');
});

test('inferIntent：默认陈述（无关键词）', () => {
  const brain = new BrainModule(fakeBus, { working: [] });
  assert.equal(brain.inferIntent('今天天气真不错'), '陈述');
});

test('reviseBeliefs：直接冲突信念置信度下调并标记存疑，无关信念不动', () => {
  const mem = { working: [], beliefs: [
    { linked: ['A', 'B'], confidence: 0.8, contested: false },
    { linked: ['X', 'Y'], confidence: 0.9 },
  ] };
  const brain = new BrainModule(fakeBus, mem);
  const n = brain.reviseBeliefs(['A', 'B']);
  assert.equal(n, 1);
  assert.equal(mem.beliefs[0].confidence, 0.56); // 0.8 * 0.7
  assert.equal(mem.beliefs[0].contested, true);
  assert.equal(mem.beliefs[1].confidence, 0.9); // 未株连
});

test('reviseBeliefs：已存疑不再重复下调（幂等）', () => {
  const mem = { working: [], beliefs: [{ linked: ['A', 'B'], confidence: 0.56, contested: true }] };
  const brain = new BrainModule(fakeBus, mem);
  assert.equal(brain.reviseBeliefs(['A', 'B']), 0);
  assert.equal(mem.beliefs[0].confidence, 0.56);
});

test('contradictions：A 既 cause 又 not_cause B 被检出（基于真实 MemoryHub 图）', () => {
  const mem = new MemoryHub(null);
  mem.addEdge('A', 'causes', 'B', { modality: 'visual', source: 's1' });
  mem.addEdge('A', 'not_causes', 'B', { modality: 'visual', source: 's2' });
  const brain = new BrainModule(fakeBus, mem);
  const cs = brain.contradictions();
  assert.equal(cs.length, 1);
  assert.deepEqual(cs[0].linked, ['A', 'B']);
  assert.equal(cs[0].kind, 'contradiction');
});
