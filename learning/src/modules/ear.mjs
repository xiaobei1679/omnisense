// 听觉感知模块（耳朵 / 听渊引擎）—— 零 API、零外部依赖。
// 真实本地能力：
//   1) 转录文本 = 真·聆听：从播客/对话转录抽取实体、关系、主题。
//   2) 音频波形 = 真·特征提取：本地解析 WAV(16bit PCM)，计算 RMS 能量、过零率
//      （不调用任何云端 ASR，纯本地信号处理；诚实声明：不做语音转写）。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { extractEntities, extractTriples, detectThemes } from '../nlp.mjs';

// ---------- WAV 编解码（16bit PCM 单声道，用于本地音频特征）----------
export function encodeWav(samples, rate = 8000) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((s, i) => data.writeInt16LE(Math.max(-1, Math.min(1, s)) * 32767, i * 2));
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
// 基频估计（自相关，本地纯计算；诚实声明：对纯音/近纯音有效，复音为近似）
function estimatePitch(samples, rate) {
  const N = samples.length;
  if (N < Math.floor(rate * 0.05)) return null;
  const minLag = Math.max(2, Math.floor(rate / 1000)), maxLag = Math.floor(rate / 60); // 60–1000Hz
  let bestLag = 0, bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0; const len = N - lag;
    for (let i = 0; i < len; i += 4) corr += samples[i] * samples[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return bestLag ? +(rate / bestLag).toFixed(1) : null;
}
// 谱质心近似（DFT 在前 40 频点，粗估"明亮/沉闷"音色）
function spectralCentroid(samples, rate) {
  const N = Math.min(samples.length, Math.floor(rate * 0.1)); // 100ms 窗
  if (!N) return null;
  let num = 0, den = 0; const K = 40;
  for (let k = 1; k <= K; k++) {
    let sr = 0, si = 0;
    for (let nn = 0; nn < N; nn += 4) { const a = 2 * Math.PI * k * nn / N; sr += samples[nn] * Math.cos(a); si -= samples[nn] * Math.sin(a); }
    const mag = Math.sqrt(sr * sr + si * si);
    num += (k * rate / N) * mag; den += mag;
  }
  return den ? +(num / den).toFixed(1) : null;
}
export function analyzeWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是 WAV 文件');
  const rate = buf.readUInt32LE(24), bits = buf.readUInt16LE(34);
  let off = 12, dataOff = -1, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4), sz = buf.readUInt32LE(off + 4);
    if (id === 'data') { dataOff = off + 8; dataLen = sz; break; }
    off += 8 + sz + (sz & 1);
  }
  if (dataOff < 0) throw new Error('无 data 块');
  const n = dataLen / (bits / 8);
  const samples = new Float32Array(n);
  let sum = 0, zc = 0, prev = 0;
  for (let i = 0; i < n; i++) {
    const s = bits === 16 ? buf.readInt16LE(dataOff + i * 2) / 32768 : buf.readUInt8(dataOff + i) / 128 - 1;
    samples[i] = s; sum += s * s;
    if (i > 0 && (s > 0) !== (prev > 0)) zc++;
    prev = s;
  }
  const rms = Math.sqrt(sum / n);
  // 帧能量 → 静音段占比（20ms 帧）
  const frame = Math.max(1, Math.floor(rate * 0.02));
  let silentFrames = 0, totalFrames = 0;
  for (let i = 0; i < n; i += frame) {
    const e = Math.sqrt(samples.subarray(i, i + frame).reduce((a, b) => a + b * b, 0) / frame);
    totalFrames++; if (e < rms * 0.3) silentFrames++;
  }
  return {
    sampleRate: rate, bitsPerSample: bits,
    durationSec: +(n / rate).toFixed(2),
    rmsEnergy: +rms.toFixed(3),
    zeroCrossingRate: +(zc / n).toFixed(3),
    silenceRatio: +(silentFrames / totalFrames).toFixed(2),
    pitchHz: estimatePitch(samples, rate),
    spectralCentroidHz: spectralCentroid(samples, rate),
  };
}

export class EarModule {
  constructor(bus, memory) { this.bus = bus; this.memory = memory; }

  // 真·聆听转录：从真实文本转录抽取结构
  async ingestTranscript(source, text) {
    console.log(`\n[耳] 聆听转录文本(真实本地解析): ${source}`);
    const entities = extractEntities(text);
    const triples = extractTriples(text);
    const themes = detectThemes(text);
    for (const e of entities) this.memory.addEntity(e, 'concept-or-character', 'audio', source);
    for (const t of triples) this.memory.addTriple({ ...t, modality: 'audio', source });
    console.log(`   → 实体 ${entities.length} · 关系 ${triples.length} · 主题 [${themes.join('/') || '—'}]`);
    const p = { modality: 'audio', source, kind: 'transcript', transcript: text, entities, triples, themes };
    this.bus.emit('percept', p);
    return p;
  }

  // 真·分析音频：本地特征提取（无 ASR、无 API）
  async ingestAudio(source, pathOrBuffer) {
    console.log(`\n[耳] 解析音频(本地特征提取,无ASR): ${source}`);
    let feat;
    try {
      const buf = Buffer.isBuffer(pathOrBuffer)
        ? pathOrBuffer
        : (pathOrBuffer && existsSync(pathOrBuffer) ? readFileSync(pathOrBuffer) : Buffer.from(pathOrBuffer, 'base64'));
      feat = analyzeWav(buf);
    } catch (e) {
      console.log(`   ⚠ 音频解码失败(诚实降级): ${e.message}`);
      feat = { error: e.message };
    }
    const p = { modality: 'audio', source, kind: 'audio', audioFeatures: feat };
    if (!feat.error) console.log(`   → 时长 ${feat.durationSec}s · RMS能量 ${feat.rmsEnergy} · 过零率 ${feat.zeroCrossingRate} · 基频≈${feat.pitchHz}Hz · 谱质心≈${feat.spectralCentroidHz}Hz · 静音比 ${feat.silenceRatio}`);
    this.bus.emit('percept', p);
    return p;
  }

  // 生成一段本地测试音（440Hz 正弦音 + 一处静音间隙），便于演示「真·听」与静音段检测
  makeSampleAudio(path, seconds = 0.6, rate = 8000) {
    const n = Math.floor(seconds * rate);
    const samples = [];
    for (let i = 0; i < n; i++) {
      const t = i / rate;
      const gap = t > 0.25 && t < 0.35; // 0.1s 静音间隙
      samples.push(gap ? 0 : Math.sin(2 * Math.PI * 440 * i / rate) * 0.6);
    }
    const buf = encodeWav(samples, rate);
    if (path) writeFileSync(path, buf);
    return buf;
  }
}
