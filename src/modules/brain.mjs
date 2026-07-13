// 大脑（Brain）—— 思考 / 记忆 / 向眼·耳·嘴 下发命令的汇总中枢
import { EVENTS } from '../core/bus.mjs';
import { runAgent } from '../core/agent.mjs';
import { log } from '../core/logger.mjs';

// 纯函数：把若干感知合成结构化情境（不依赖在线模型，可离线测试）。
// 统计各模态数量、跨源话题频次、时间跨度，供 think/plan 复用。
export function synthesize(percepts = []) {
  const byModality = {};
  const topics = new Map();
  let newest = 0, oldest = Infinity;
  for (const p of percepts) {
    const mod = p.modality || 'unknown';
    byModality[mod] = (byModality[mod] || 0) + 1;
    const ts = p.fetchedAt || p.t || 0;
    if (ts > newest) newest = ts;
    if (ts && ts < oldest) oldest = ts;
    const add = (t) => { if (t) topics.set(t, (topics.get(t) || 0) + 1); };
    if (Array.isArray(p.topics)) p.topics.forEach(add);
    if (p.title) add(p.title);
    if (p.word) add(p.word);
    if (p.transcript) add(String(p.transcript).slice(0, 40));
  }
  const topTopics = [...topics.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([t]) => t);
  return {
    count: percepts.length,
    modalities: byModality,
    topTopics,
    recencyMs: newest && oldest !== Infinity ? newest - oldest : 0,
    newestAt: newest || 0,
  };
}

export class Brain {
  constructor(bus, models, memory) {
    this.bus = bus; this.models = models; this.memory = memory; this._wire();
  }

  _wire() {
    this.bus.register('brain', 'think', p => this.think(p.goal, p.context));
    this.bus.register('brain', 'decide', p => this.decide(p.goal));
    this.bus.register('brain', 'command', p => this.command(p.target, p.action, p.payload));
    this.bus.register('brain', 'plan', p => this.plan(p.goal));
  }

  remember(key, value) { return this.memory.remember(key, value); }
  recall(key) { return this.memory.recall(key); }
  note(text, tag) { return this.memory.note(text, tag); }

  // 大脑向任意感官/表达下发命令（眼/耳/嘴的行动都来自这里）
  async command(target, action, payload = {}) {
    log.info(`\n[脑·指挥] → ${target}.${action}`);
    return await this.bus.command(target, action, payload);
  }

  // 思考：汇聚近期感知 + 记忆，用在线 LLM 推理，产出洞察
  async think(goal = '理解当前环境', context = '') {
    log.info(`\n[脑·思考] 目标: ${goal}`);
    const percepts = this.bus.recent(EVENTS.PERCEPT, 15).map(e => e.payload);
    const syn = synthesize(percepts);
    const mem = this.memory.snapshot();
    const summary = percepts.map(p => {
      if (p.modality === 'visual-web') return `网站《${p.title}》: ${String(p.text).slice(0, 80)}`;
      if (p.modality === 'visual-web-summary') return `网页《${p.title}》摘要: ${String(p.summary || '').slice(0, 80)}`;
      if (p.modality === 'visual-hot' || p.modality === 'visual-hot-aggregate') return `热点: ${(p.topics || []).slice(0, 5).join('、')}`;
      if (p.modality === 'visual-image') return `图像: ${p.description || '未识别'}`;
      if (p.modality === 'audio-speech') return `音频: ${String(p.transcript || '').slice(0, 80)}`;
      if (p.modality === 'audio-novel') return `小说: ${String(p.text || '').slice(0, 80)}`;
      if (p.modality === 'user-feedback' || p.modality === 'user-percept') return `用户: ${String(p.text || '').slice(0, 80)}`;
      return JSON.stringify(p).slice(0, 80);
    }).join('\n');
    const prompt = `你是一个具备多模态感知的 AI 大脑。已知记忆键: ${mem.keys.join(',') || '无'}。\n` +
      `感知统计: ${syn.count} 条，模态分布 ${JSON.stringify(syn.modalities)}，高频话题 ${syn.topTopics.join('、') || '无'}。\n` +
      `近期感知明细:\n${summary}\n额外背景: ${context}\n目标: ${goal}\n` +
      `请输出 JSON: {"insight": "一句话核心洞察", "nextLook": "建议下一步去看/听什么", "confidence": 0-1}。`;
    let out;
    try {
      const raw = await this.models.chat([{ role: 'user', content: prompt }], { json: true });
      // chat({json:true}) 返回已解析对象；若返回字符串则再解析一次
      out = (raw && typeof raw === 'object') ? raw : JSON.parse(raw);
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') {
        // agent 模式：脑/嘴由运行体(agent)自身驱动，把真实感知上下文交出去
        log.info('   （agent 驱动模式 · 无 QClaw 网关）已汇聚真实感知，请运行体(agent)直接思考并给出 insight/nextLook/confidence：');
        log.info('   ── 感知上下文 ──\n' + (summary || '（暂无感知输入）'));
        log.info('   ── 思考提示词 ──\n' + prompt);
        out = { insight: '(待 agent 驱动)', nextLook: '(待 agent 驱动)', confidence: 0.5 };
      } else {
        out = { insight: `（在线模型暂不可用，使用本地符号推理）感知到 ${percepts.length} 条输入`, nextLook: '在 QClaw 运行时中加载本技能，即可由框架自带在线大模型深度思考', confidence: 0.3 };
      }
    }
    this.memory.note(out.insight || '', 'insight');
    log.info(`   ✓ 洞察: ${out.insight}`);
    log.info(`   ✓ 建议下一步: ${out.nextLook}`);
    this.bus.emit(EVENTS.INSIGHT, out);
    return out;
  }

  // 决策：基于感知与记忆，决定下一步行动
  async decide(goal = '') {
    log.info(`\n[脑·决策] 生成决策`);
    const percepts = this.bus.recent(EVENTS.PERCEPT, 10).map(e => e.payload);
    const decision = {
      action: percepts.length ? 'continue-sensing' : 'observe',
      focus: goal || (percepts[0]?.title || percepts[0]?.topics?.[0] || null),
      confidence: percepts.length ? 0.6 : 0.3,
      rationale: percepts.length ? '已有感知输入，继续整合。' : '信息不足，先观察积累。',
    };
    this.bus.emit(EVENTS.DECISION, decision);
    return decision;
  }

  // 行动（Act）：让大脑真正"做事"——把目标交给 Agent 推理闭环去执行工具、达成目标。
  // 有在线模型(网关/key)时走 LLM ReAct 动态推理；无模型时走本地确定性规划器完成具体多步任务。
  async act(goal, opts = {}) {
    log.info(`\n[脑·行动] 目标: ${goal || '(空)'}`);
    const res = await runAgent(this, { goal, ...opts });
    log.info(`   ✓ 完成=${res.completed} 用模型=${res.usedLLM} 步数=${res.steps.length}`);
    if (res.result != null) log.info(`   ✓ 结果: ${String(res.result).slice(0, 400)}`);
    return res;
  }

  // 轻量规划：基于当前感知合成结果，给出建议的下一步行动（离线、不依赖模型）
  plan(goal = '') {
    const percepts = this.bus.recent(EVENTS.PERCEPT, 20).map(e => e.payload);
    const syn = synthesize(percepts);
    const actions = [];
    if (!syn.modalities['visual-hot'] && !syn.modalities['visual-hot-aggregate']) actions.push('read-hot');
    if (!syn.modalities['visual-web']) actions.push('read-web');
    if (syn.count === 0) actions.push('observe');
    if (this.memory.snapshot().keys.length === 0) actions.push('remember');
    const plan = { goal, actions, synopsis: syn };
    log.info(`\n[脑·规划] 目标: ${goal || '(无)'} → 建议: ${actions.join(', ') || '(无需行动)'}`);
    this.bus.emit(EVENTS.DECISION, { action: 'plan', goal, actions });
    return plan;
  }
}
