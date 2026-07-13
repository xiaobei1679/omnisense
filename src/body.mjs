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
import { runWatch, runWatchTick } from './core/watch.mjs';
import { buildDefaultTools, executeTool, toolSpecs } from './core/tools.mjs';
import { log } from './core/logger.mjs';

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

  // 身体自检：列出七器官及其各自能力（demo / 文档 / CLI `body` 用）
  describe() {
    return ORGANS.map(o => ({ ...o, methods: this._methodsOf(o.key) }));
  }

  _methodsOf(key) {
    switch (key) {
      case 'eye':      return ['seeWebsite', 'seeHotTopics', 'seeHotAll', 'summarizeWebsite', 'seeImage', 'watchVideo', 'clearHotCache', 'hotStats'];
      case 'ear':      return ['hearAudio', 'hearNovel', 'listenFeedback'];
      case 'mouth':    return ['speak', 'giveOpinion', 'reply'];
      case 'brain':    return ['think', 'decide', 'plan', 'act', 'agent', 'multiAgent', 'command', 'remember', 'recall', 'search'];
      case 'hand':     return this.handList().map(t => t.name);
      case 'perceive': return ['sense'];
      case 'foot':     return ['watch', 'watchTick'];
      default:         return [];
    }
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
