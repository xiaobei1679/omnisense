// 认知思考模块（大脑 / 思源引擎）—— 零 LLM、零 API、纯本地符号推理。
// 真实实现的「思考」：跨模态关联、因果链推理、类比推理、矛盾检测、溯因补缺、
// 知识缺口发现、信念管理（带置信度与反方论据）。
// 关键工程约束：所有洞察带签名去重，同一结论只在「首次出现」时发出，杜绝复读刷屏。
import { IS_CAUSAL } from '../relations.mjs';

export class BrainModule {
  constructor(bus, memory) {
    this.bus = bus;
    this.memory = memory;
    this.seen = new Set();   // 已发出的洞察签名，去重用
  }

  init() { this.bus.on('percept', (p) => this.reason(p)); this.bus.on('user-percept', (p) => this.inferIntent(p.text)); }

  // 签名去重：已发过的洞察不再重复表达
  _emit(ins) {
    const sig = ins.sig || `${ins.kind}:${ins.belief}`;
    if (this.seen.has(sig)) return false;
    this.seen.add(sig);
    if (ins.store !== false && ins.kind) this.memory.addBelief(ins);
    else if (ins.store !== false) this.memory.addHypothesis(ins);
    this.bus.emit('insight', ins);
    return true;
  }

  reason(p) {
    try {
      this._reason(p);
    } catch (e) {
      console.log(`   [脑] ⚠ 推理中断(异常已隔离，不影响其他感知): ${e.message}`);
    }
  }

  _reason(p) {
    const m = this.memory;
    let added = 0;
    for (const t of (p.triples || [])) {
      m.addEdge(t.subj, t.rel, t.obj, { modality: p.modality, source: p.source });
    }

    // 1) 跨模态关联（真实：同一实体在视觉+听觉都出现）
    //    命名空间消歧：同名实体若分布在「不同作品/来源」之间，仅"疑似"交叉验证（待核），不盲目提升置信度
    const links = m.crossModalLinks();
    if (links.length) {
      const sig = `xmodal:${links.slice().sort().join(',')}`;
      if (!this.seen.has(sig)) {
        const crossWork = links.some((n) => m.entityWorks(n).size >= 2);
        const conf = crossWork ? 0.5 : 0.75;
        const verdict = crossWork
          ? '同名实体跨模态且跨作品出现，疑似交叉验证（待核，需确认指代一致性，可能只是同名巧合）'
          : '同名实体在同一作品内跨模态出现，已交叉验证';
        this._emit({
          sig, kind: 'cross-modal',
          belief: `跨模态关联：实体「${links.join('、')}」同时在视觉与听觉中出现。${verdict}。`,
          confidence: conf, pendingVerification: crossWork,
          evidence: links.map((n) => `双模态出现: ${n} (作品: ${[...m.entityWorks(n)].join('/') || '?'})`),
          counter: ['可能为同名巧合，需进一步验证指代一致性'],
        });
        added++;
      }
    }

    // 2) 因果链（仅用 CAUSAL 边，避免把书名/共现当因果）
    for (const c of this.causalChains()) { if (this._emit({ ...c, sig: `causal:${c.linked.join('>')}` })) added++; }

    // 3) 关系信念（每条真实关系边，首次出现时陈述）
    for (const e of m.edges) {
      const sig = `edge:${e.from}|${e.rel}|${e.to}`;
      if (this.seen.has(sig)) continue;
      const verbZh = { discovered: '发现了', warned: '警告了', loved: '爱着', contained: '包含', contains: '包含', told: '告知了', met: '遇见了', is: '是', was: '曾是', had: '拥有', has: '拥有', enabled: '使…得以', caused: '导致了', prevents: '阻止了', 'not_causes': '并未导致', 'not_prevents': '并未阻止', found: '找到了', sought: '追寻', feared: '畏惧', protected: '保护', betrayed: '背叛了', lost: '失去了', entered: '进入了', built: '建造了', remembered: '忆起', became: '成为了', asked: '询问', answered: '回答', saw: '看见', knew: '知晓', opened: '打开', closed: '关闭' }[e.rel] || e.rel;
      this._emit({
        sig, kind: 'relation',
        belief: `关系：从「${e.source || '未知来源'}」得知 —— ${e.from} ${verbZh} ${e.to}。`,
        confidence: IS_CAUSAL.has(e.rel) ? 0.7 : 0.6,
        evidence: [`${e.from} ${e.rel} ${e.to} (${e.modality})`],
        counter: IS_CAUSAL.has(e.rel) ? ['因果基于单一叙述，可能受限于该视角'] : ['关系来自文本表述，需更多证据确认'],
      });
      added++;
    }

    // 4) 类比（共享邻居的实体对）
    for (const a of this.analogies()) { if (this._emit({ ...a, sig: `analogy:${a.linked.slice().sort().join('~')}` })) added++; }

    // 5) 矛盾检测 + 信念修正
    for (const c of this.contradictions()) {
      if (this._emit({ ...c, sig: `contra:${c.linked.join('~')}` })) added++;
      const revised = this.reviseBeliefs(c.linked);
      if (revised > 0) { console.log(`   [脑] 矛盾触发信念修正：${revised} 条相关信念置信度下调并标记存疑`); added++; }
    }

    // 6) 溯因补缺：有真实关系但无因果机制的实体，提出一个中介假设（每个实体仅一次）
    for (const h of this.abduce()) { if (this._emit({ ...h, sig: `abdu:${h.linked[0]}` })) added++; }

    // 6.5) 归纳：多个主体共享同一「关系-客体」→ 一般规律
    for (const ind of this.induce()) { if (this._emit({ ...ind, sig: `ind:${ind.linked.join('~')}` })) added++; }
    // 6.6) 演绎：因果前提 + 中介关系 → 间接结论
    for (const de of this.deduce()) { if (this._emit({ ...de, sig: `ded:${de.linked.join('~')}` })) added++; }

    // 7) 知识缺口 → 触发主动追问
    const gaps = m.openGaps().filter((g) => g.modality !== 'belief');
    if (gaps.length) {
      this.bus.emit('gap', { entities: gaps.map((g) => g.entity) });
    }

    if (added) console.log(`   [脑] 推理完成：新增 ${added} 条洞察（跨模态/因果/关系/类比/矛盾/溯因）`);
  }

  causalChains() {
    const m = this.memory, out = [];
    for (const e of m.edges) {
      if (!IS_CAUSAL.has(e.rel)) continue;
      // 前向：from → ... (最多再走一步)；仅沿正向因果边，避免把关联/共现当因果链
      const fw = m.forwardChain(e.from, 2, true);
      if (fw.length > 1) out.push({
        kind: 'causal-fwd',
        belief: `因果链：${fw.join(' → ')}`,
        confidence: 0.7, linked: fw,
        evidence: ['基于知识图谱因果边'],
        counter: ['因果不等于相关；链中每一环都依赖单一叙述视角'],
      });
      const bw = m.backwardChain(e.to, 2, true);
      if (bw.length > 1) out.push({
        kind: 'causal-bwd',
        belief: `逆向因果：${bw.join(' ← ')}`,
        confidence: 0.65, linked: bw,
        evidence: ['基于知识图谱因果边'],
        counter: ['逆向链仅为可能性，非确证'],
      });
    }
    return out;
  }

  analogies() {
    const m = this.memory, out = [], nodes = [...m.entities.keys()];
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      const a = nodes[i], b = nodes[j];
      const na = m.neighbors(a), nb = m.neighbors(b);
      const nbA = new Set([...na.out, ...na.inc].map((e) => e.to).concat([...na.inc].map((e) => e.from)));
      const nbB = new Set([...nb.out, ...nb.inc].map((e) => e.to).concat([...nb.inc].map((e) => e.from)));
      const shared = [...nbA].filter((x) => nbB.has(x));
      if (shared.length >= 2) out.push({
        kind: 'analogy',
        belief: `类比：实体「${a}」与「${b}」共享邻居 ${shared.join('、')}，结构相似，可互相映射推断。`,
        confidence: 0.5, linked: [a, b],
        evidence: [`共享邻居: ${shared.join('、')}`],
        counter: ['结构相似不保证语义相同，类比结论需实证'],
      });
    }
    return out;
  }

  contradictions() {
    const m = this.memory, out = []; const emitted = new Set();
    const byPair = {};
    for (const e of m.edges) {
      const k = `${e.from}__${e.to}`;
      (byPair[k] = byPair[k] || []).push(e);
    }
    const push = (from, to, detail, ev) => {
      const key = `${from}__${to}`;
      if (emitted.has(key)) return; emitted.add(key);
      out.push({
        kind: 'contradiction',
        belief: `矛盾检测：「${from}」${detail}「${to}」，存在逻辑冲突，需澄清。`,
        confidence: 0.85, linked: [from, to],
        evidence: ev,
        counter: ['可能发生在不同时间/条件下，并非绝对矛盾'],
      });
    };
    // (a) 直接矛盾：同一对 (A,B) 既 cause 又 prevent / not_cause
    for (const [k, es] of Object.entries(byPair)) {
      const [from, to] = k.split('__');
      const hasCause = es.some((e) => e.rel === 'causes');
      const hasNeg = es.some((e) => e.rel === 'prevents' || e.rel === 'not_causes');
      if (hasCause && hasNeg) {
        push(from, to, hasNeg && es.some((e) => e.rel === 'prevents')
          ? '既被推断为导致、又被推断为阻止'
          : '既被推断为导致、又有证据称其并未导致', es.map((e) => `${e.from} ${e.rel} ${e.to}`));
      }
    }
    // (b) 传递性矛盾：A 经因果链导致 C，却有边称 A 阻止/未导致 C
    const closure = {};
    for (const e of m.edges) if (e.rel === 'causes') (closure[e.from] = closure[e.from] || new Set()).add(e.to);
    for (const a of Object.keys(closure)) {
      const direct = [...closure[a]];
      for (const mid of direct) if (closure[mid]) for (const c of closure[mid]) closure[a].add(c);
    }
    for (const [a, set] of Object.entries(closure)) {
      for (const c of set) {
        const neg = m.edges.find((x) => x.from === a && (x.rel === 'prevents' || x.rel === 'not_causes') && x.to === c);
        if (neg) push(a, c, '经因果链导致，但又有证据称其阻止/未导致',
          [`${a} causes…${c} (传递闭包)`, `${neg.from} ${neg.rel} ${neg.to}`]);
      }
    }
    return out;
  }

  abduce() {
    const m = this.memory, out = [], done = new Set();
    // 仅对「有真实关系但无因果边」的实体提一个中介假设，避免每个边都刷
    for (const [name] of m.entities) {
      if (done.has(name)) continue;
      const nb = m.neighbors(name);
      const hasRel = nb.out.length + nb.inc.length > 0;
      const hasCausal = [...nb.out, ...nb.inc].some((e) => IS_CAUSAL.has(e.rel));
      if (hasRel && !hasCausal) {
        done.add(name);
        out.push({
          belief: `溯因假设：关于「${name}」已知若干关联，但缺乏因果机制解释。假设存在中介事件 Z，使得这些关联得以成立，待验证。`,
          confidence: 0.4, linked: [name],
          evidence: [`${name} 的关系: ${[...nb.out, ...nb.inc].map((e) => `${e.from}-${e.rel}-${e.to}`).join('; ')}`],
          counter: ['溯因仅为最可能解释之一，Z 未经验证'],
        });
      }
    }
    return out.slice(0, 4);
  }

  // 归纳：多个主体对同一「关系-客体」出现 → 推出一般规律（带过度泛化警示）
  induce() {
    const m = this.memory, byRelObj = {};
    for (const e of m.edges) {
      const k = `${e.rel}__${e.to}`;
      (byRelObj[k] = byRelObj[k] || new Set()).add(e.from);
    }
    const res = [];
    for (const [k, subs] of Object.entries(byRelObj)) {
      if (subs.size >= 2) {
        const [rel, obj] = k.split('__');
        const arr = [...subs];
        res.push({
          kind: 'induction',
          belief: `归纳：多个主体(${arr.join('、')})都「${rel} ${obj}」，可归纳出一般规律——「${rel} ${obj}」是反复出现的模式。`,
          confidence: 0.55, linked: arr.concat(obj),
          evidence: arr.map((s) => `${s} ${rel} ${obj}`),
          counter: ['归纳依赖样本量，且忽略语境差异，可能过度泛化'],
        });
      }
    }
    return res;
  }

  // 演绎：已知 A 因果 B，且 C 关联 A → 推出 C 可能间接导致 B（条件式结论）
  deduce() {
    const m = this.memory, out = [];
    for (const e of m.edges) {
      if (!IS_CAUSAL.has(e.rel)) continue;
      const A = e.from, B = e.to;
      for (const e2 of m.edges) {
        // 中介关系也必须是因果边，避免把"遇见/看见"等非因果关系当成因果通路
        if (e2.to === A && e2.from !== B && IS_CAUSAL.has(e2.rel)) {
          out.push({
            kind: 'deduction',
            belief: `演绎：已知「${A} ${e.rel} ${B}」，且「${e2.from} ${e2.rel} ${A}」→ 推测「${e2.from} 可能间接导致 ${B}」。`,
            confidence: 0.5, linked: [e2.from, B],
            evidence: [`${A} ${e.rel} ${B}`, `${e2.from} ${e2.rel} ${A}`],
            counter: ['演绎链依赖前提为真，且中介关系可能不唯一'],
          });
        }
      }
    }
    return out.slice(0, 4);
  }

  // 信念修正：仅对「直接冲突的这对实体」相关信念下调置信度并标记存疑，
  // 不株连无关边（避免误伤真信念）；下调因子取 0.7（温和、可解释）。
  reviseBeliefs(entities) {
    let n = 0;
    for (const b of this.memory.beliefs) {
      const linked = b.linked || [];
      const direct = linked.length >= 2 && entities.includes(linked[0]) && entities.includes(linked[1]);
      if (direct && !b.contested) {
        b.confidence = +((b.confidence || 0.5) * 0.7).toFixed(2);
        b.contested = true;
        b.counter = (b.counter || []).concat(['与其他证据矛盾，置信度已下调(仅限直接冲突信念)']);
        n++;
      }
    }
    return n;
  }

  // 意图推断：对用户回应做轻量意图分类（关键词启发式，诚实标注可能误判）
  inferIntent(text) {
    const t = (text || '').toLowerCase();
    let intent = '陈述';
    if (/(为什么|怎么|如何|什么|是否|what|why|how|\?)/.test(t)) intent = '疑问';
    else if (/(不对|错误|纠正|actually|not true|wrong|其实|并不是)/.test(t)) intent = '纠正';
    else if (/(明白了|懂了|够了|不用|ok|stop|停|好了|可以了|不用了)/.test(t)) intent = '满足';
    else if (/(补充|是的|对，|also|because|而且|另外|此外)/.test(t)) intent = '补充';
    this.memory.working.push({ type: 'user-intent', intent, text, ts: Date.now() });
    const ins = {
      sig: `intent:${intent}:${(text || '').slice(0, 16)}`, kind: 'intent', store: false,
      belief: `意图推断：用户这条回应属于「${intent}」。`,
      confidence: 0.6, linked: [],
      evidence: [String(text || '').slice(0, 40)],
      counter: ['意图推断基于关键词启发式，可能误判'],
    };
    if (this._emit(ins)) console.log(`   [脑] 意图推断: 用户回应 → 「${intent}」`);
    this.bus.emit('utterance', { type: 'intent', intent, text });
    return intent;
  }
}
