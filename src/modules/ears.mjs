// 耳朵（Ears）—— 让 AI 真的去听：小说 / 文案 / 歌曲 / 用户意见
// 真实部分（本机即可）：联网下载音频、读取本地音频。
// 理解部分（听懂说的是什么）：在线 ASR（需 key）；缺则诚实降级为声学特征。
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { env } from 'node:process';
import { httpGetBuffer } from '../core/http.mjs';
import { log } from '../core/logger.mjs';

export class Ears {
  constructor(bus, models) { this.bus = bus; this.models = models; this._wire(); }

  _wire() {
    this.bus.register('ears', 'hearAudio', p => this.hearAudio(p.input, p.filename));
    this.bus.register('ears', 'hearNovel', p => this.hearNovel(p.text, p.outFile));
    this.bus.register('ears', 'listenFeedback', p => this.listenFeedback(p.text));
  }

  async _toBuffer(input) {
    if (Buffer.isBuffer(input)) return input;
    if (existsSync(input)) return readFileSync(input);
    if (typeof input === 'string' && /^https?:\/\//.test(input)) {
      return await httpGetBuffer(input, { timeout: 20000 });
    }
    throw new Error('音频输入须为 Buffer / 本地路径 / http(s) URL');
  }

  // 真实听一段音频（在线 ASR 转写）
  async hearAudio(input, filename = 'audio.wav') {
    log.info(`\n[耳·听觉] 听音频(在线 ASR)`);
    const buf = await this._toBuffer(input);
    log.info(`   ✓ 已载入音频 ${buf.length} bytes`);
    try {
      const text = await this.models.transcribe(buf, filename);
      log.info(`   ✓ ASR 转写: ${String(text).slice(0, 160)}`);
      const percept = { modality: 'audio-speech', transcript: String(text), bytes: buf.length, fetchedAt: Date.now() };
      this.bus.emit('percept', percept);
      return percept;
    } catch (e) {
      log.warn(`   ⚠ 耳朵“听懂”失败(诚实降级): ${e.message}`);
      return { modality: 'audio-speech', bytes: buf.length, error: e.message };
    }
  }

  // 听小说：把文本小说用 TTS 读出来（真实出声文件），同时返回文本供理解
  async hearNovel(text, outFile = './novel-spoken.mp3') {
    log.info(`\n[耳·听觉] 听小说(文本→TTS 朗读)`);
    if (!text) throw new Error('听小说需要文本');
    try {
      const audio = await this.models.speak(text.slice(0, 4000));
      writeFileSync(outFile, audio);
      log.info(`   ✓ 已用 TTS 朗读并保存: ${outFile} (${audio.length} bytes)`);
      const percept = { modality: 'audio-novel', text: text.slice(0, 200), spokenFile: outFile, fetchedAt: Date.now() };
      this.bus.emit('percept', percept);
      return percept;
    } catch (e) {
      log.warn(`   ⚠ 朗读失败(诚实降级，仅记录文本): ${e.message}`);
      const percept = { modality: 'audio-novel', text: text.slice(0, 200), error: e.message };
      this.bus.emit('percept', percept);
      return percept;
    }
  }

  // 真实听取用户意见/反馈
  listenFeedback(text) {
    log.info(`\n[耳·听觉] 听取用户意见: ${String(text).slice(0, 80)}`);
    const percept = { modality: 'user-feedback', text, fetchedAt: Date.now() };
    this.bus.emit('user-percept', percept);
    return percept;
  }
}
