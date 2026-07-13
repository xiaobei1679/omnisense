// 感知（Perception）—— 把眼/耳的感知汇成整体环境理解
import { EVENTS } from '../core/bus.mjs';
import { log } from '../core/logger.mjs';

export class Perception {
  constructor(bus) { this.bus = bus; this._wire(); }

  _wire() { this.bus.register('perception', 'sense', () => this.sense()); }

  sense() {
    const percepts = this.bus.recent(EVENTS.PERCEPT, 30).map(e => e.payload);
    const topics = new Set();
    const sources = new Set();
    const modalities = new Set();
    for (const p of percepts) {
      if (p.modality) modalities.add(p.modality);
      if (p.source) sources.add(p.source);
      if (p.topics) p.topics.forEach(t => topics.add(t));
      if (p.title) topics.add(p.title);
    }
    const model = {
      topicCount: topics.size,
      topics: [...topics].slice(0, 12),
      sources: [...sources],
      modalities: [...modalities],
      lastUpdate: Date.now(),
      attention: topics.size ? `当前最值得关注: ${[...topics][0]}` : '尚无输入，建议先让眼睛看热点/网站',
    };
    log.info(`\n[感知] 环境模型: ${modalities.size} 种模态, ${topics.size} 个话题, ${sources.size} 个来源`);
    if (model.attention) log.info(`   → 注意力建议: ${model.attention}`);
    this.bus.emit(EVENTS.SITUATION, model);
    return model;
  }
}
