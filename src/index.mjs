// OmniSense —— 通用 AI 感知系统门面
// 所有 claw 只需：import { OmniSense } from 'omni-sense/src/index.mjs'，即可获得眼睛/耳朵/嘴巴/大脑/感知。
import { Bus, EVENTS } from './core/bus.mjs';
import { Memory } from './core/memory.mjs';
import { Models, loadEnv } from './providers/index.mjs';
import { Eyes } from './modules/eyes.mjs';
import { Ears } from './modules/ears.mjs';
import { Mouth } from './modules/mouth.mjs';
import { Brain } from './modules/brain.mjs';
import { Perception } from './modules/perception.mjs';
import { runWatch, runWatchTick } from './core/watch.mjs';
import { runAgent } from './core/agent.mjs';
import { runMultiAgent } from './core/agents.mjs';
import { log } from './core/logger.mjs';
import { env } from 'node:process';

export class OmniSense {
  constructor() {
    this.bus = new Bus();
    this.memory = new Memory(env.OMNI_MEMORY || './.omni-memory.json');
    this.models = new Models();
    this.eyes = new Eyes(this.bus, this.models);
    this.ears = new Ears(this.bus, this.models);
    this.mouth = new Mouth(this.bus, this.models);
    this.brain = new Brain(this.bus, this.models, this.memory);
    this.perception = new Perception(this.bus);
  }

  static create() { loadEnv(); return new OmniSense(); }

  // —— 眼睛 ——
  seeWebsite(url) { return this.eyes.seeWebsite(url); }
  seeHotTopics(source, opts) { return this.eyes.seeHotTopics(source, opts); }
  seeHotAll(opts) { return this.eyes.seeHotTopics('all', opts); }
  summarizeWebsite(url, maxWords) { return this.eyes.summarizeWebsite(url, maxWords); }
  seeImage(image) { return this.eyes.seeImage(image); }
  watchVideo(url) { return this.eyes.watchVideo(url); }
  clearHotCache() { return this.eyes.clearHotCache(); }
  hotStats() { return this.eyes.hotStats(); }

  // —— 耳朵 ——
  hearAudio(input, filename) { return this.ears.hearAudio(input, filename); }
  hearNovel(text, out) { return this.ears.hearNovel(text, out); }
  listenFeedback(text) { return this.ears.listenFeedback(text); }

  // —— 嘴巴 ——
  speak(text, opts) { return this.mouth.speak(text, opts); }
  giveOpinion(topic, context) { return this.mouth.giveOpinion(topic, context); }
  reply(text, history) { return this.mouth.reply(text, history); }

  // —— 大脑 ——
  think(goal, context) { return this.brain.think(goal, context); }
  decide(goal) { return this.brain.decide(goal); }
  plan(goal) { return this.brain.plan(goal); }
  // 行动：把目标交给 Agent 推理闭环执行（真正"做事"，而非仅感知汇报）
  act(goal, opts) { return this.brain.act(goal, opts); }
  agent(goal, opts) { return runAgent(this, { goal, ...opts }); }
  // 多 Agent 协作：协调器拆解目标 → 按角色委派子 agent（复用 Agent 内核）→ 共享黑板 → 综合产出
  multiAgent(goal, opts) { return runMultiAgent(this, { goal, ...opts }); }
  command(target, action, payload) { return this.brain.command(target, action, payload); }
  remember(k, v) { return this.brain.remember(k, v); }
  recall(k) { return this.brain.recall(k); }
  search(q, opts) { return this.memory.search(q, opts); }

  // —— 感知 ——
  sense() { return this.perception.sense(); }

  // —— 常驻感知循环 ——
  watchTick(opts) { return runWatchTick(this, opts); }
  watch(opts) { return runWatch(this, opts); }

  async status() { return this.models.status(); }

  // 真实联网演示（无需 key 即可证明眼睛真能看网站/热搜）
  async demo() {
    log.info('═══════════════════════════════════════════');
    log.info('  OmniSense 通用 AI 感知系统 · 真实联网演示');
    log.info('═══════════════════════════════════════════');
    const st = await this.models.status();
    log.info('运行模式(后端):', st.backend);
    log.info('能力:', JSON.stringify({ think: st.think, seeVision: st.seeVision, webFetch: st.webFetch, hear: st.hear, speak: st.speak }));
    log.info('说明:', st.note);
    log.info('（眼/耳联网抓取本机真实执行，全程免 key；脑/嘴在 QClaw 走网关、在 WorkBuddy 等由运行体 agent 自身驱动）\n');

    // 真实看热点（联网，无需 key）—— 多平台并行聚合演示
    await this.seeHotAll();
    // 真实看一个网站（联网，无需 key）
    await this.seeWebsite('https://example.com');
    // 感知聚合
    this.sense();
    // 大脑思考（QClaw 运行时走框架自带在线模型，否则由运行体 agent 驱动）
    await this.think('用户想了解当前热点与示例站点的关联');
    // 决策与规划
    await this.decide();
    this.plan('为创作者提炼今日可做的选题');

    log.info('\n──────── 演示结束 ────────');
    if (st.runtime === 'agent') {
      log.info('当前为 agent 模式：眼/耳已真抓取(本机联网，含抖音/红果/微博等热搜)；');
      log.info('脑(思考)/嘴(说)由运行体(agent)自身驱动，完全免 key；');
      log.info('看图：图像已落到本地，由运行体(agent)用读图能力真实描述（免 key 真看）。');
    } else {
      log.info('本技能在 QClaw/OpenClaw 运行时中自动免 key 使用框架自带在线大模型，');
      log.info('真正实现：眼真抓网站/热搜(本机联网)、脑真思考、嘴真交流。');
      log.info('看图：配 VLM key 后由在线视觉模型真实描述；未配则诚实降级。');
    }
    log.info('（听/说出声需另行配置外部 key 或本地引擎——当前未配置，已诚实降级。）');
  }
}
