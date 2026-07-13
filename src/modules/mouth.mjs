// 嘴巴（Mouth）—— 让 AI 真的去交流：给意见 / 聊天 / 出声
// 真实交流靠在线 LLM；出声靠在线 TTS（均需 key，缺则诚实降级为纯文本输出）。
//
// Caveman 输出压缩（可选）：借鉴 JuliusBrussee/caveman（MIT, 88K★）的输出压缩思想，
// 在不影响技术准确度的前提下减少 65-75% 输出 Token。
// 等级: normal(默认)/lite(去填充词)/full(原始人风格)/ultra(电报缩写)
import { writeFileSync } from 'node:fs';
import { log } from '../core/logger.mjs';

/** Caveman 压缩等级的 system prompt 后缀 */
const CAVEMAN_PROMPTS = {
  normal: '',
  lite: '\n回答要简洁专业：去掉填充词、废话、不必要的礼貌用语。直接给答案。',
  full: '\n用穴居人方式回答：只给关键信息。去掉冠词、填充词、从句。用短句和片段。代码和技术术语保持不变。',
  ultra: '\n极简电报风格：最大压缩。用符号→替代因果，缩写。代码完整保留，解释极度精简。',
};

export class Mouth {
  constructor(bus, models) {
    this.bus = bus;
    this.models = models;
    this._style = 'normal';   // 默认正常输出
    this._wire();
  }

  /** 设置输出压缩等级 */
  setStyle(level) {
    if (CAVEMAN_PROMPTS[level]) {
      this._style = level;
      log.info(`[嘴·风格] 切换到「${level}」模式`);
      return { ok: true, style: level };
    }
    return { ok: false, error: `未知压缩等级：${level}，可选: ${Object.keys(CAVEMAN_PROMPTS).join('/')}` };
  }

  /** 获取当前输出风格 */
  getStyle() { return this._style; }

  _wire() {
    this.bus.register('mouth', 'speak', p => this.speak(p.text, p));
    this.bus.register('mouth', 'giveOpinion', p => this.giveOpinion(p.topic, p.context));
    this.bus.register('mouth', 'reply', p => this.reply(p.text, p.history));
    this.bus.register('mouth', 'setStyle', p => this.setStyle(p.level));
    this.bus.register('mouth', 'getStyle', () => ({ style: this._style }));
  }

  /** 附加当前压缩规则到 prompt 末尾 */
  _cavemanSuffix() {
    return this._style !== 'normal' ? CAVEMAN_PROMPTS[this._style] : '';
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
    const u = { text: String(text), spokenFile, style: this._style, t: Date.now() };
    this.bus.emit('utterance', u);
    return u;
  }

  // 就某话题给出真实意见（在线 LLM 生成；agent 模式下由运行体驱动）
  async giveOpinion(topic, context = '') {
    log.info(`\n[嘴·表达] 就「${topic}」形成意见（风格: ${this._style}）`);
    const prompt = `你是一个有独立判断力的助手。话题：${topic}\n背景：${context}\n请给出一个具体、有依据、不空泛的意见（不超过150字）。${this._cavemanSuffix()}`;
    try {
      const opinion = await this.models.chat([{ role: 'user', content: prompt }]);
      log.info(`   ✓ 意见: ${opinion.slice(0, 120)}…`);
      const u = { type: 'opinion', topic, text: opinion, style: this._style, t: Date.now() };
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
    log.info(`\n[嘴·表达] 回复用户: ${String(text).slice(0, 60)}（风格: ${this._style}）`);
    const system = this._cavemanSuffix() ? { role: 'system', content: '你是一个简洁直接的助手。' + this._cavemanSuffix() } : null;
    const messages = system ? [system, ...history, { role: 'user', content: String(text) }]
                            : [...history, { role: 'user', content: String(text) }];
    try {
      const answer = await this.models.chat(messages);
      const u = { type: 'reply', text: answer, style: this._style, t: Date.now() };
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
