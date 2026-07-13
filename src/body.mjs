// 身体（Body）—— 把七种器官整合成一个像真人一样的智能体
// ───────────────────────────────────────────────────────────
// 七器官映射（真人隐喻）：
//   眼   eye      → eyes       ：看网站 / 热搜 / 图像 / 视频
//   耳   ear      → ears       ：听音频 / 小说 / 用户反馈
//   嘴   mouth    → mouth      ：说话 / 表达观点 / 回复
//   脑   brain    → brain      ：思考 / 决策 / 规划 / 指挥
//   手   hand     → tools      ：真正动手（联网抓 / 读写文件 / 计算 / 记忆 / 总结）
//   感知 perceive → perception  ：把眼耳输入汇成整体环境理解
//   脚   foot     → watch      ：常驻感知、在世界里移动与监视
// ───────────────────────────────────────────────────────────
// 设计要点：
//   1) 零新增依赖，全部委托给既有模块（eyes/ears/mouth/brain/perception/watch/tools）。
//   2) 手（hand）是一等公民：直接 hand('web_fetch', {...}) 调用真实能力。
//   3) live() 是「和真人一样」的核心：不是被动等命令，而是自驱地
//      感知→思考→动手→说话→移动，在世界里活着。默认离线、有限轮次，绝不挂起。
//   4) 自描述（describe / agentCard）：借鉴 Google A2A Protocol 的 Agent Card 思想——
//      每个能力带 description / tags / examples，供上层 client（多智能体工作区）发现与调用；
//      OmniSense 额外加 net 字段诚实标注「是否需要联网」（离线环境会降级）。
import { runWatch, runWatchTick } from './core/watch.mjs';
import { buildDefaultTools, executeTool, toolSpecs } from './core/tools.mjs';
import { log } from './core/logger.mjs';
import { readFileSync } from 'node:fs';

// 读取仓库版本（与根目录 VERSION 保持同步），用于 Agent Card 的 version 字段
let CARD_VERSION = '0.0.0';
try { CARD_VERSION = readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim(); } catch {}

// 七器官清单（供文档 / demo / 自检）。顺序即"真人身体"自上而下。
export const ORGANS = [
  { key: 'eye',      name: '眼',   module: 'eyes',      desc: '看：网站 / 热搜 / 图像 / 视频' },
  { key: 'ear',      name: '耳',   module: 'ears',      desc: '听：音频转写 / 小说朗读 / 用户反馈' },
  { key: 'mouth',    name: '嘴',   module: 'mouth',     desc: '说：表达观点 / 回复 / 朗读' },
  { key: 'brain',    name: '脑',   module: 'brain',     desc: '思：思考 / 决策 / 规划 / 指挥' },
  { key: 'hand',     name: '手',   module: 'tools',     desc: '做：联网抓 / 读写文件 / 计算 / 记忆 / 总结' },
  { key: 'perceive', name: '感知', module: 'perception', desc: '感：把眼耳输入汇成环境理解' },
  { key: 'foot',     name: '脚',   module: 'watch',     desc: '行：常驻感知、在世界里移动与监视' },
];

// ── 能力自描述元数据（借鉴 A2A Protocol 的 Agent Card：每个技能带 desc / tags / examples）──
// 额外 net 字段：该能力是否需要联网（诚实标注，离线环境会降级）。
// 手（hand）工具的元数据来自运行时 toolSpecs，故此处不列；联网子集见 NET_HAND。
const METHOD_META = {
  eye: {
    seeWebsite:      { desc: '抓取并摘要网页正文', net: true,  examples: ['看 https://example.com'] },
    seeHotTopics:    { desc: '抓取单平台实时热搜', net: true,  examples: ['看 B站热搜'] },
    seeHotAll:       { desc: '多平台热搜并行聚合并去重', net: true },
    summarizeWebsite:{ desc: '网页正文提取 + 摘要', net: true },
    seeImage:        { desc: '识图 / 描述图像', net: false },
    watchVideo:      { desc: '看视频 / 抽帧信息', net: true },
    clearHotCache:   { desc: '清空热搜缓存', net: false },
    hotStats:        { desc: '热搜抓取统计', net: false },
  },
  ear: {
    hearAudio:       { desc: '音频转写', net: false },
    hearNovel:       { desc: '小说朗读 / 听书', net: false },
    listenFeedback:  { desc: '聆听用户反馈', net: false },
  },
  mouth: {
    speak:           { desc: '说话 / 朗读', net: false },
    giveOpinion:     { desc: '表达观点', net: false },
    reply:           { desc: '回复', net: false },
  },
  brain: {
    think:           { desc: '思考 / 推理', net: false },
    decide:          { desc: '决策', net: false },
    plan:            { desc: '规划', net: false },
    act:             { desc: '行动', net: false },
    agent:           { desc: '运行体驱动(agent 模式)', net: false },
    multiAgent:      { desc: '多智能体协调', net: false },
    command:         { desc: '命令调度', net: false },
    remember:        { desc: '记忆', net: false },
    recall:          { desc: '回忆', net: false },
    search:          { desc: '记忆 / 知识检索', net: false },
  },
  perceive: { sense: { desc: '把眼耳输入汇成整体环境理解', net: false } },
  foot: {
    watch:           { desc: '常驻感知巡逻', net: false },
    watchTick:       { desc: '单次移动快照', net: false },
  },
};
// 手（hand）工具中需要联网的子集（其余离线）
const NET_HAND = new Set(['web_fetch', 'summarize_url', 'hot_topics']);

export class Body {
  constructor(omni) {
    this.omni = omni;
    // 手：默认工具箱（动手能力），shell 需显式授权（OMNI_ALLOW_SHELL=1 或 allowShell:true）
    this.tools = buildDefaultTools(omni, { allowShell: !!process.env.OMNI_ALLOW_SHELL });
  }

  // ── 七器官（以真人隐喻暴露，底层委托给既有模块）──
  eye(action, ...rest)    { return this.omni.eyes[action](...rest); }
  ear(action, ...rest)    { return this.omni.ears[action](...rest); }
  mouth(action, ...rest)  { return this.omni.mouth[action](...rest); }
  brain(action, ...rest)  { return this.omni.brain[action](...rest); }
  perceive()              { return this.omni.perception.sense(); }
  // 脚：watch=常驻巡逻（长循环），watchTick=单次移动快照
  foot(action = 'watch', o) {
    return action === 'watchTick' ? runWatchTick(this.omni, o) : runWatch(this.omni, o);
  }

  // 手：直接调用真实动手能力（web_fetch / read_file / write_file / list_dir / memory_* / calc / now / hot_topics / summarize_url）
  hand(name, args = {}) {
    return executeTool(this.tools, name, args, { allowShell: !!process.env.OMNI_ALLOW_SHELL });
  }
  handList() { return toolSpecs(this.tools); }

  // 身体自检：以 A2A Agent Card 风格返回七器官及其各自能力的结构化清单
  // （含每个能力的描述 / 是否联网 / 示例），供上层 client 发现与调用。
  describe() {
    return ORGANS.map(o => ({ ...o, methods: this._methodsOf(o.key) }));
  }

  _methodsOf(key) {
    if (key === 'hand') {
      return this.handList().map(t => ({
        name: t.name,
        desc: t.description || '',
        net: NET_HAND.has(t.name),
        examples: [],
      }));
    }
    const meta = METHOD_META[key];
    if (!meta) return [];
    return Object.entries(meta).map(([name, m]) => ({ name, desc: m.desc, net: m.net, examples: m.examples || [] }));
  }

  // A2A 风格 Agent Card：把身体全部能力扁平化为 skills[]（id/name/description/tags/examples/net），
  // 供多智能体工作区做「能力发现 + 委派」（灵感来自 Google A2A Protocol 的 AgentCard.skills：
  // https://github.com/google/A2A —— 仅借鉴结构与字段语义，未引入其传输/协议依赖）。
  // net=true 表示该能力需要联网，离线环境会诚实降级（OmniSense 的诚实扩展字段）。
  agentCard() {
    const skills = [];
    for (const o of ORGANS) {
      const organKey = o.key;
      const organName = o.name;
      for (const m of this._methodsOf(organKey)) {
        skills.push({
          id: `${organKey}.${m.name}`,
          name: m.name,
          description: m.desc || `${organName} 的 ${m.name} 能力`,
          tags: [organKey, organName],
          examples: m.examples || [],
          net: m.net,
        });
      }
    }
    return {
      schema: 'omnisense-agent-card/1.0',
      name: 'OmniSense Body',
      description: '通用 AI 身体：眼/耳/嘴/脑/手/感知/脚 七器官，像真人一样感知、思考、行动',
      version: CARD_VERSION,
      skills,
    };
  }

  // ── 生命循环：像真人一样持续「感知→思考→动手→说话→移动」──
  // 这是"和真人一样"的本质：不是被动接收指令，而是自驱地在世界里活着。
  // 默认离线、有限轮次、所有步骤带 catch 兜底，绝不因无模型而挂起。
  async live(opts = {}) {
    const {
      ticks = 3,
      intervalMs = 0,
      useLLM = false,
      speak = false,
      allowShell = false,
      onTick,
    } = opts;
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const trace = [];
    log.info(`\n[身体·生命循环] 启动：${ticks} 轮 | 模型=${useLLM ? '在线' : '离线'} | 说话=${speak} | shell=${allowShell}`);
    for (let i = 1; i <= ticks; i++) {
      const step = { tick: i };
      // 1) 感知：聚合近期眼耳输入 + 实时热搜，合成环境理解
      step.perceive = this.perceive();
      // 2) 思考：基于当前环境，决定这一轮该关注 / 做什么
      step.think = await this.omni.brain.think(`第 ${i} 轮：基于当前感知，我该关注或做什么`, '').catch(e => ({ error: e.message }));
      // 3) 动手（脑·行动）：把"下一步"转成可执行目标，离线确定性执行
      const goal = `基于本轮感知，做一件具体的事：把最值得关注的话题记入长期记忆`;
      step.act = await this.omni.brain.act(goal, { useLLM, allowShell, maxSteps: 4, remember: true }).catch(e => ({ completed: false, result: e.message }));
      // 4) 说话：表达一句本轮观察（默认静默，--speak 开启）
      if (speak) {
        const top = (step.perceive?.topics || [])[0] || '当前环境';
        step.speak = await this.omni.mouth.speak(`第 ${i} 轮：我注意到「${top}」。`, { tts: false }).catch(e => ({ error: e.message }));
      }
      // 5) 移动 / 监视（脚）：本轮快照已通过 act 的 remember 落盘，这里标记完成
      step.foot = `第 ${i} 轮完成`;
      trace.push(step);
      log.info(`[身体·生命循环] tick ${i}/${ticks}：感知 ${step.perceive?.topicCount ?? 0} 话题 | 行动 ${step.act?.completed ? '✓' : '✗'}`);
      if (onTick) onTick(step);
      if (i < ticks && intervalMs) await sleep(intervalMs);
    }
    log.info('[身体·生命循环] 结束。');
    return { ticks, trace, stopped: false };
  }
}
