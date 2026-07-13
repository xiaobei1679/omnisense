// 嘴巴（Mouth）—— 让 AI 真的去交流：给意见 / 聊天 / 出声
// 真实交流靠在线 LLM；出声靠在线 TTS（均需 key，缺则诚实降级为纯文本输出）。
import { writeFileSync } from 'node:fs';
import { log } from '../core/logger.mjs';

export class Mouth {
  constructor(bus, models) { this.bus = bus; this.models = models; this._wire(); }

  _wire() {
    this.bus.register('mouth', 'speak', p => this.speak(p.text, p));
    this.bus.register('mouth', 'giveOpinion', p => this.giveOpinion(p.topic, p.context));
    this.bus.register('mouth', 'reply', p => this.reply(p.text, p.history));
  }

  // 真实说出一段话（文本输出 + 可选 TTS 出声文件）
  async speak(text, { tts = false, outFile = './mouth-output.mp3' } = {}) {
    log.info(`\n[嘴·表达] 说: ${String(text).slice(0, 120)}`);
    let spokenFile = null;
    if (tts) {
      try {
        const audio = await this.models.speak(String(text).slice(0, 4000));
        writeFileSync(outFile, audio);
        spokenFile = outFile;
        log.info(`   ✓ 已 TTS 出声: ${outFile}`);
      } catch (e) { log.warn(`   ⚠ TTS 失败(诚实降级为文本): ${e.message}`); }
    }
    const u = { text: String(text), spokenFile, t: Date.now() };
    this.bus.emit('utterance', u);
    return u;
  }

  // 就某话题给出真实意见（在线 LLM 生成；agent 模式下由运行体驱动）
  async giveOpinion(topic, context = '') {
    log.info(`\n[嘴·表达] 就「${topic}」形成意见`);
    const prompt = `你是一个有独立判断力的助手。话题：${topic}\n背景：${context}\n请给出一个具体、有依据、不空泛的意见（不超过150字）。`;
    try {
      const opinion = await this.models.chat([{ role: 'user', content: prompt }]);
      log.info(`   ✓ 意见: ${opinion.slice(0, 120)}…`);
      const u = { type: 'opinion', topic, text: opinion, t: Date.now() };
      this.bus.emit('utterance', u);
      return u;
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') {
        log.info('   （agent 驱动模式）请运行体(agent)直接生成意见。提示词:');
        log.info('   ' + prompt);
        return { type: 'opinion', topic, text: '(待 agent 驱动)', t: Date.now() };
      }
      throw e;
    }
  }

  // 真实对话回复（agent 模式下由运行体驱动）
  async reply(text, history = []) {
    log.info(`\n[嘴·表达] 回复用户: ${String(text).slice(0, 60)}`);
    const messages = [...history, { role: 'user', content: String(text) }];
    try {
      const answer = await this.models.chat(messages);
      const u = { type: 'reply', text: answer, t: Date.now() };
      this.bus.emit('utterance', u);
      return u;
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') {
        log.info('   （agent 驱动模式）请运行体(agent)直接基于以上历史回复。最新用户输入:');
        log.info('   ' + String(text).slice(0, 200));
        return { type: 'reply', text: '(待 agent 驱动)', t: Date.now() };
      }
      throw e;
    }
  }
}
