// OmniSense —— 通用 AI 感知系统门面
// 任意宿主/调用方只需：import { OmniSense } from 'omnisense/src/index.mjs'，即可获得眼睛/耳朵/嘴巴/大脑/感知。
import { Bus, EVENTS } from './core/bus.mjs';
import { Memory } from './core/memory.mjs';
import { Tracer } from './core/tracer.mjs';
import { Models, loadEnv } from './providers/index.mjs';
import { Eyes } from './modules/eyes.mjs';
import { Ears } from './modules/ears.mjs';
import { Mouth } from './modules/mouth.mjs';
import { Brain } from './modules/brain.mjs';
import { Perception } from './modules/perception.mjs';
import { runWatch, runWatchTick } from './core/watch.mjs';
import { runAgent } from './core/agent.mjs';
import { toolCacheStats, clearToolCache, toolBreakerStatus } from './core/tools.mjs';
import { runMultiAgent } from './core/agents.mjs';
import { Body } from './body.mjs';
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
    this.brain.omni = this; // 反向引用，使 brain.act → runAgent 能访问 tracer 等父级能力
    this.perception = new Perception(this.bus);
    // 身体：把七种器官整合成一个像真人一样的智能体
    this.body = new Body(this);
    // 可观测性：Agent 执行轨迹追踪（落盘，可回放 / 聚合指标）
    this.tracer = new Tracer(env.OMNI_TRACES || './.omni-traces.json');
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

  // —— 可观测性：Agent 执行轨迹追踪（LangSmith/OTel 式，离线落盘）——
  // trace = 一次运行；step = 可回放因果事件（thought/action/observation/耗时）。
  traces(opts) { return this.tracer.listRuns(opts); }
  traceSummary() { return this.tracer.summarize(); }
  getTrace(id) { return this.tracer.getRun(id); }
  clearTraces() { return this.tracer.clear(); }
  // 回放对比：两次运行的行为分歧点（first-divergence 思想，离线确定性）
  compareTraces(aId, bId) { return this.tracer.compareRuns(aId, bId); }
  // 按目标检索历史运行（"同目标多次运行"对比前提）
  findTracesByGoal(goal, opts) { return this.tracer.findRunsByGoal(goal, opts); }
  // 导出回归数据集（LangSmith 式 trace→dataset，供 CI 反复对比行为退化；format='otlp' 返回 OTLP/JSON）
  exportTraceDataset(opts) { return this.tracer.exportDataset(opts); }
  // 导出 OTLP/JSON（OTel-native，可对接 Grafana Tempo / Phoenix / Jaeger / OTel Collector）
  exportTraceOtlp(opts) { return this.tracer.exportOtlp(opts); }
  // 基线 / 回归门禁：固定某 run 为基线，后续 run 退化即判 FAIL（CI 门禁用）
  setTraceBaseline(runId) { return this.tracer.setBaseline(runId); }
  getTraceBaseline() { return this.tracer.getBaseline(); }
  traceRegression(opts) { return this.tracer.regressionCheck(opts); }

  // —— 常驻感知循环 ——
  watchTick(opts) { return runWatchTick(this, opts); }
  watch(opts) { return runWatch(this, opts); }

  // —— 工具级缓存/熔断（复用 breaker 基础设施，扩展到 Agent 工具调用）——
  // web_fetch / summarize_url / hot_topics 命中缓存直接返回（避免重复联网），持续失败则熔断（避免反复超时）。
  toolCacheStats() { return toolCacheStats(); }
  clearToolCache() { return clearToolCache(); }
  toolBreakerStatus() { return toolBreakerStatus(); }

  // —— 身体：像真人一样的七器官 ——
  // 七器官：眼 eye / 耳 ear / 嘴 mouth / 脑 brain / 手 hand / 感知 perceive / 脚 foot
  // 直接以真人隐喻驱动既有能力：omni.body.eye('seeWebsite', url) / omni.body.hand('web_fetch', {...}) …
  get organs() { return this.body.describe(); }
  // A2A 风格能力卡：把七器官能力扁平化为 skills[]，供多智能体工作区做能力发现与委派
  agentCard() { return this.body.agentCard(); }
  // 生命循环：感知→思考→动手→说话→移动，自驱地在世界里活着（默认离线、有限轮次）
  live(opts) { return this.body.live(opts); }
  // 自主循环：身体用自身能力卡 skillResolve 自己决定每轮做什么并离线执行（借鉴 BabyAGI 自生成任务队列）
  autopilot(opts) { return this.body.autopilot(opts); }

  // 技能匹配与委派（基于能力卡的能力发现闭环）
  // skillResolve(goal) 纯关键词匹配 → 返回排名 top-3
  // skillDispatch(goal, opts) 找最佳技能并自动调用
  skillResolve(goal) { return this.body.skillResolve(goal); }
  skillDispatch(goal, opts) { return this.body.skillDispatch(goal, opts); }

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
    // 身体自检：像真人一样的七器官
    const organs = this.organs;
    log.info(`身体自检: ${organs.length} 种器官 → ` + organs.map(o => `${o.name}(${o.key})`).join(' '));
    log.info('（眼/耳联网抓取本机真实执行，全程免 key；脑/嘴在网关模式走本地模型网关、在驱动模式由调用方自身驱动）\n');

    // 真实看热点（联网，无需 key）—— 多平台并行聚合演示
    await this.seeHotAll();
    // 真实看一个网站（联网，无需 key）
    await this.seeWebsite('https://example.com');
    // 感知聚合
    this.sense();
    // 大脑思考（网关模式走本地模型网关，否则由调用方驱动）
    await this.think('用户想了解当前热点与示例站点的关联');
    // 决策与规划
    await this.decide();
    this.plan('为创作者提炼今日可做的选题');

    log.info('\n──────── 演示结束 ────────');
    if (st.runtime === 'driver') {
      log.info('当前为驱动模式：眼/耳已真抓取(本机联网，含抖音/红果/微博等热搜)；');
      log.info('脑(思考)/嘴(说)由调用方自身驱动，完全免 key；');
      log.info('看图：图像已落到本地，由调用方用读图能力真实描述（免 key 真看）。');
    } else {
      log.info('当前为网关模式：自动免 key 使用本地模型网关，');
      log.info('真正实现：眼真抓网站/热搜(本机联网)、脑真思考、嘴真交流。');
      log.info('看图：配 VLM key 后由在线视觉模型真实描述；未配则诚实降级。');
    }
    log.info('（听/说出声需另行配置外部 key 或本地引擎——当前未配置，已诚实降级。）');
  }
}
