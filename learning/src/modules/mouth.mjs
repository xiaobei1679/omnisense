// 交互对话模块（嘴 / 言枢引擎）—— 零 LLM、零 API、本地主动式 NLG。
//   - 主动表达观点（带置信度与反方论据，避免独断）；表达措辞轮换，避免复读
//   - 基于知识缺口主动追问（思辨起点），同一实体只追问一次；维护对话议程
//   - 收到用户回应后：检测满足信号→停止追问；否则基于已记录问答做「追问延伸」
//   - 汇报从开源项目学到的真实技法，并做 teach-back 复述
//   - respond()：把用户回应作为新的听觉感知喂回脑，形成真·回合对话
export class MouthModule {
  constructor(bus, memory) {
    this.bus = bus;
    this.memory = memory;
    this.turn = 0;
    this.asked = new Set();     // 已追问过的实体，避免重复追问
    this.agenda = [];           // 待追问议程 {target, question, answered}
    this.qa = [];               // 问答记录
    this.done = false;          // 满足信号 → 停止追加追问
  }

  init() {
    this.bus.on('insight', (i) => this.speak(i));
    this.bus.on('gap', (g) => this.ask(g));
    this.bus.on('learned', (l) => this.reportLearning(l));
  }

  speak(ins) {
    if (ins.kind === 'intent') return; // 意图洞察不重复口头陈述（脑已打印）
    this.turn++;
    const conf = Math.round((ins.confidence ?? 0.5) * 100);
    const leads = ['我的判断是', '我认为', '从已知信息看', '目前能推断的是'];
    const lead = leads[this.turn % leads.length];
    console.log(`\n[嘴] 观点 #${this.turn} (置信度 ${conf}%, ${ins.kind || '假设'}):`);
    console.log(`   ${lead}：${ins.belief}`);
    if (ins.counter && ins.counter.length) console.log(`   反方: ${ins.counter.join('; ')}`);
    this.bus.emit('utterance', { type: 'view', text: ins.belief, confidence: ins.confidence });
  }

  ask(gap) {
    const targets = [...new Set(gap.entities)].filter((t) => !this.asked.has(t)).slice(0, 3);
    for (const t of targets) {
      this.asked.add(t);
      const qs = [
        `关于「${t}」：它目前只在单一信息源里出现，我无法交叉验证。你能补充它的来历、或它与谁相关吗？`,
        `我对「${t}」的把握还很低（仅单模态）。能否告诉我它属于哪部作品、与哪些角色有关？`,
        `「${t}」出现了，但语境单薄。你手头有关于它的更多背景吗？`,
      ];
      const q = qs[this.asked.size % qs.length];
      console.log(`\n[嘴] 主动追问(${this.asked.size}): ${q}`);
      this.agenda.push({ target: t, question: q, answered: false });
      this.bus.emit('utterance', { type: 'question', target: t, text: q });
    }
  }

  reportLearning(l) {
    const tech = (l.techniques || []).filter((s) => !/shields\.io|img\.shields|!\[|<img|https?:\/\//.test(s)).slice(0, 4);
    const show = tech.length ? tech.join(' / ') : '(未抽取到具体技法)';
    console.log(`\n[嘴] 汇报学习成果: 从《${l.repo}》学到「${l.topic}」的技法 —— ${show}`);
    this.bus.emit('utterance', { type: 'learning', repo: l.repo, text: show });
    if (tech.length) {
      const tb = `[teach-back] 我理解的核心是：${tech[0]}。下次遇到类似任务，我会优先尝试这个。`;
      console.log(`   ${tb}`);
      this.bus.emit('utterance', { type: 'teachback', text: tb });
    }
  }

  respond(userText) {
    console.log(`\n[嘴] (收到用户回应) ${userText}`);
    // 满足信号：用户表示停/够了 → 停止主动追问
    if (/(明白了|懂了|够了|不用|ok|stop|停|好了|可以了|不用了)/i.test(userText)) {
      this.done = true; this.agenda = [];
      console.log('   → 检测到满足信号，停止主动追问。');
      this.bus.emit('utterance', { type: 'ack', text: '好的，已记录你的补充。' });
      this.bus.emit('user-percept', { text: userText });
      return;
    }
    this.bus.emit('user-percept', { text: userText });
    this._maybeFollowUp(userText);
  }

  // 追问延伸：基于已记录的问答，构造一个「承上启下」的追问
  _maybeFollowUp(answerText) {
    const pending = this.agenda.find((a) => !a.answered);
    if (!pending) return;
    pending.answered = true;
    this.qa.push({ q: pending.question, a: answerText });
    const nb = this.memory.neighbors(pending.target);
    const related = [...nb.out, ...nb.inc].map((e) => (e.from === pending.target ? e.to : e.from));
    let fu;
    if (related.length) {
      const r = related[0];
      fu = `顺着你刚才说的，「${pending.target}」和「${r}」有关联。那「${r}」在我们已知的图谱里又扮演什么角色？`;
    } else {
      fu = `谢谢补充。关于「${pending.target}」，还有没有细节能帮我把它的作用定下来？`;
    }
    console.log(`\n[嘴] 追问延伸: ${fu}`);
    this.bus.emit('utterance', { type: 'followup', target: pending.target, text: fu });
  }
}
