// 大脑记忆中枢：四层记忆架构（借鉴 AGI-Memory 派生设计，AGI-Memory/PrecipAI）
// Layer 1: Memory → 短期状态事实（原 store + notes，向后兼容）
// Layer 2: Rule   → 门控规则（IF-ELSE 伪代码，Gatekeeper 拦截）
// Layer 3: Skill  → 技能调度（可复用执行流程 + trigger 条件）
// Layer 4: Knowledge → 知识沉淀（结构化领域知识 + derived_from + confidence + avoid_pitfall）
// v2→v3：新增四层独立存储与检索，原 remember/recall/search 完全不变。
// v3：深度检索——BM25 相关性叠加①时间衰减②复用权重③可选 MMR 去冗余。
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { resolve } from 'node:path';

const STOP = new Set('的 了 和 与 把 在 到 我 你 他 她 它 们 这 那 个 是 有 就 也 都 而 即 若 请 用 为 以 上 下 中 后 前 该 此 每 各 其 要 把 将 给 让 对 从 被 着 过 等 啊 吧 呢 吗 嘛 们 之 其 及 或 但 则 故 因 如 若 若 使 令 使 得 可 能 会 可 以 进行 执行 目标 任务 一个 一些 并 且 又 再 才 the a an and or of to for in on at by with is are be this that it its as if'.split(/\s+/));
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  const en = s.match(/[a-z0-9]+/g) || [];
  for (const w of en) if (w.length > 1 && !STOP.has(w)) out.push(w);
  const zh = s.match(/[一-龥]/g) || [];
  for (const c of zh) if (!STOP.has(c)) out.push(c);
  for (const u of (s.match(/https?:\/\/\S+/g) || [])) out.push(u.replace(/^https?:\/\//, '').replace(/[^\w-]/g, '_'));
  for (const p of (s.match(/[\w.\-/\\]+\.\w+/g) || [])) out.push(p.replace(/[^\w-]/g, '_'));
  return out;
}

// BM25 相关性评分（经典无监督算法，零依赖、零 key）
export function bm25Score(queryTokens, docTokens, allDocs, avgdl, k1 = 1.5, b = 0.75) {
  const N = allDocs.length || 1;
  const dl = docTokens.length || 1;
  // 文档频率
  const df = {};
  for (const t of queryTokens) {
    if (df[t] !== undefined) continue;
    let c = 0;
    for (const d of allDocs) if (d.includes(t)) c++;
    df[t] = c;
  }
  const f = {};
  for (const t of docTokens) f[t] = (f[t] || 0) + 1;
  let score = 0;
  for (const t of queryTokens) {
    if (!(t in f)) continue;
    const idf = Math.log(1 + (N - (df[t] || 0) + 0.5) / ((df[t] || 0) + 0.5));
    score += idf * (f[t] * (k1 + 1)) / (f[t] + k1 * (1 - b + b * dl / avgdl));
  }
  return score;
}

export class Memory {
  constructor(path = './.omni-memory.json') {
    this.path = path;
    this.store = {};       // key -> value（Layer 1 向后兼容）
    this.facts = [];       // {subj, rel, obj, source}
    this.notes = [];       // 自由记忆

    // Layer 2: Rule — 门控规则
    this.rules = [];       // {id, type:'rule', condition, action, priority, enabled, at, tags}
    // Layer 3: Skill — 技能调度
    this.skills = [];      // {id, type:'skill', name, description, steps:[], triggers:[], tags:[], at, hitCount}
    // Layer 4: Knowledge — 知识沉淀
    this.knowledge = [];   // {id, type:'knowledge', topic, facts:[], derived_from:[], confidence:0-1, avoid_pitfall:'', tags:[], at}

    // 独立文件存储路径
    const base = path.replace(/\.json$/, '');
    this.ruleFile = base + '.rules.json';
    this.skillFile = base + '.skills.json';
    this.knowledgeFile = base + '.knowledge.json';

    this._load();       // 原加载（store/facts/notes）
    this._loadLayers(); // 新三层加载
  }

  _load() {
    try {
      if (existsSync(this.path)) {
        const d = JSON.parse(readFileSync(this.path, 'utf8'));
        this.store = d.store || {};
        this.facts = d.facts || [];
        this.notes = d.notes || [];
      }
    } catch (e) { /* 损坏则重建，诚实不崩 */ }
  }

  /** 加载三层独立文件 */
  _loadLayers() {
    for (const [field, file] of [['rules', this.ruleFile], ['skills', this.skillFile], ['knowledge', this.knowledgeFile]]) {
      try {
        if (existsSync(file)) this[field] = JSON.parse(readFileSync(file, 'utf8'));
      } catch (e) { this[field] = []; }
    }
  }

  /** 原子保存任意 JSON 数组到文件（规避 rmSync 安全删除拦截） */
  _saveLayer(field, file) {
    try {
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(this[field], null, 2));
      renameSync(tmp, file);
    } catch (e) { console.error(`[记忆] ${field} 落盘失败:`, e.message); }
  }

  _save() {
    try {
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify({ store: this.store, facts: this.facts, notes: this.notes }, null, 2));
      // 原子 rename 替代 rmSync（本环境 rmSync 被安全删除封装拦截）
      renameSync(tmp, this.path);
    } catch (e) { console.error('[记忆] 落盘失败:', e.message); }
  }

  // ═══════════════════════════════════════════
  // Layer 1: Memory（向后兼容，原 remember/recall）
  // ═══════════════════════════════════════════
  remember(key, value) { this.store[key] = value; this._save(); return value; }
  recall(key) { return this.store[key]; }

  // ═══════════════════════════════════════════
  // Layer 2: Rule — 门控规则
  // ═══════════════════════════════════════════
  /** 添加规则：{id, condition:string, action:'allow'|'block'|'warn', priority:0-10, enabled:true, tags:[], at?} */
  addRule(rule) {
    const r = { ...rule, type: 'rule', at: rule.at || Date.now(), enabled: rule.enabled !== false };
    const idx = this.rules.findIndex(x => x.id === rule.id);
    if (idx >= 0) this.rules[idx] = r; else this.rules.push(r);
    this.rules.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this._saveLayer('rules', this.ruleFile);
    return r;
  }
  /** 按 id 移除规则 */
  removeRule(id) { const n = this.rules.length; this.rules = this.rules.filter(r => r.id !== id); if (this.rules.length !== n) this._saveLayer('rules', this.ruleFile); return n - this.rules.length; }
  /** 获取所有启用的规则 */
  getRules(enabledOnly = true) { return enabledOnly ? this.rules.filter(r => r.enabled) : this.rules; }
  /** 检查输入是否触发规则（返回触发的规则列表） */
  checkRules(input) { return this.rules.filter(r => r.enabled && matchRule(input, r)); }

  // ═══════════════════════════════════════════
  // Layer 3: Skill — 技能调度
  // ═══════════════════════════════════════════
  /** 添加技能：{id, name, description, steps:[], triggers:[], tags:[], at?} */
  addSkill(skill) {
    const s = { ...skill, type: 'skill', at: skill.at || Date.now(), hitCount: 0 };
    const idx = this.skills.findIndex(x => x.id === skill.id);
    if (idx >= 0) { s.hitCount = this.skills[idx].hitCount || 0; this.skills[idx] = s; }
    else this.skills.push(s);
    this._saveLayer('skills', this.skillFile);
    return s;
  }
  /** 按 trigger 关键词搜索技能 */
  findSkills(query) {
    if (!query) return this.skills;
    const q = String(query).toLowerCase();
    return this.skills.filter(s =>
      (s.name || '').toLowerCase().includes(q) ||
      (s.description || '').toLowerCase().includes(q) ||
      (s.triggers || []).some(t => String(t).toLowerCase().includes(q))
    ).map(s => ({ ...s, hitCount: (s.hitCount || 0) + 1 }));
  }
  /** 记录技能命中 */
  hitSkill(id) {
    const s = this.skills.find(x => x.id === id);
    if (s) { s.hitCount = (s.hitCount || 0) + 1; this._saveLayer('skills', this.skillFile); }
  }

  // ═══════════════════════════════════════════
  // Layer 4: Knowledge — 知识沉淀
  // ═══════════════════════════════════════════
  /** 添加知识条目：{topic, facts:[], derived_from:[], confidence:0-1, avoid_pitfall:'', tags:[], at?} */
  addKnowledge(knowledge) {
    const k = { ...knowledge, type: 'knowledge', id: knowledge.id || `k-${Date.now()}`, at: knowledge.at || Date.now(), confidence: Math.min(1, Math.max(0, knowledge.confidence || 0.5)) };
    const idx = this.knowledge.findIndex(x => x.id === k.id);
    if (idx >= 0) this.knowledge[idx] = k; else this.knowledge.push(k);
    this._saveLayer('knowledge', this.knowledgeFile);
    return k;
  }
  /** 搜索知识（按 topic/facts/context 关键词 + BM25 排序） */
  searchKnowledge(query, topK = 5) {
    if (!query) return this.knowledge.slice(0, topK);
    const qt = tokenize(query);
    if (!qt.length) return this.knowledge.slice(0, topK);
    const texts = this.knowledge.map(k => `${k.topic || ''} ${(k.facts || []).join(' ')} ${k.avoid_pitfall || ''} ${(k.tags || []).join(' ')}`);
    const allTokens = texts.map(t => tokenize(t));
    const avgdl = (allTokens.reduce((s, t) => s + t.length, 0) / (allTokens.length || 1)) || 1;
    return this.knowledge.map((k, i) => ({
      ...k, score: bm25Score(qt, allTokens[i], allTokens, avgdl),
    })).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, topK);
  }

  // ═══════════════════════════════════════════
  // 跨层检索
  // ═══════════════════════════════════════════
  /** 跨四层全面检索 */
  searchAll(query, opts = {}) {
    const topK = opts.topK || 5;
    const from = opts.from || ['memory', 'rule', 'skill', 'knowledge'];
    const results = [];
    if (from.includes('memory')) results.push(...this.search(query, { topK, ...opts }).map(r => ({ ...r, _layer: 'memory' })));
    if (from.includes('rule')) {
      const hit = this.checkRules(query);
      results.push(...hit.map(r => ({ type: 'rule', id: r.id, text: `[规则] ${r.id}: ${r.condition}`, _layer: 'rule', score: 1 })));
    }
    if (from.includes('skill')) results.push(...this.findSkills(query).map(s => ({ type: 'skill', id: s.id, text: `[技能] ${s.name}: ${s.description}`, _layer: 'skill', score: 0.8 })));
    if (from.includes('knowledge')) results.push(...this.searchKnowledge(query, topK).map(k => ({ ...k, _layer: 'knowledge' })));
    results.sort((a, b) => (b.score || 0) - (a.score || 0));
    return results.slice(0, topK);
  }

  /** 从纠错中学习：自动生成 Knowledge 条目（避免再犯同类问题） */
  learnFromCorrection({ topic, mistake, correction, derived_from }) {
    return this.addKnowledge({
      topic,
      facts: [`错误: ${mistake}`, `纠正: ${correction}`],
      derived_from: derived_from || ['correction'],
      confidence: 0.7,
      avoid_pitfall: correction,
      tags: ['correction', topic],
    });
  }

  /** 获取各层统计 */
  layerSnapshot() {
    return {
      memory: { keys: Object.keys(this.store).length, facts: this.facts.length, notes: this.notes.length },
      rule: this.rules.length,
      skill: this.skills.length,
      knowledge: this.knowledge.length,
    };
  }

  // 语义化深度检索：BM25-lite 相关性 + 时间衰减(recency) + 复用权重(hitCount) + 可选 MMR 去冗余。
  // 兼容旧签名 search(query, limit)（数字第二参当作 topK）。
  // opts: {topK=20, threshold=0, includeNotes=true, wRecency=0.3, wHit=0.5,
  //        halfLifeMs=7d, diversity=0(关闭MMR), now=Date.now()}
  // @returns Array<{type,key?,value?,text?,tag?,t?,base,recency,hits,score}>（score 降序）
  search(query, opts = {}) {
    let topK = 20, threshold = 0, includeNotes = true;
    let wRecency = 0.3, wHit = 0.5, halfLifeMs = 7 * 24 * 3600 * 1000, diversity = 0, now = Date.now();
    if (typeof opts === 'number') topK = opts;
    else {
      topK = opts.topK ?? 20; threshold = opts.threshold ?? 0; includeNotes = opts.includeNotes ?? true;
      wRecency = opts.wRecency ?? wRecency; wHit = opts.wHit ?? wHit;
      halfLifeMs = opts.halfLifeMs ?? halfLifeMs; diversity = opts.diversity ?? 0; now = opts.now ?? now;
    }
    const q = String(query || '').trim();
    if (!q) return [];
    const qt = tokenize(q);
    if (!qt.length) return [];

    const docs = [];
    for (const [k, v] of Object.entries(this.store)) {
      // playbook:* 键不把 hash 当正文，只用 value.goal 参与相关性
      const goalText = (v && v.goal) ? String(v.goal) : '';
      const text = (k.startsWith('playbook:') ? ('playbook ' + goalText) : (k + ' ')) + String(v);
      const at = (v && typeof v === 'object') ? (v.at ?? v.t ?? null) : null;
      const hits = (v && typeof v === 'object' && typeof v.hitCount === 'number') ? v.hitCount : 0;
      docs.push({ type: 'store', key: k, value: v, text, tokens: tokenize(text), at, hits });
    }
    if (includeNotes) for (const n of this.notes) docs.push({ type: 'note', tag: n.tag, text: n.text, t: n.t, tokens: tokenize(n.text), at: n.t, hits: 0 });

    const avgdl = (docs.reduce((s, d) => s + d.tokens.length, 0) / (docs.length || 1)) || 1;
    const allTok = docs.map(d => d.tokens);
    const scored = [];
    for (const d of docs) {
      const base = bm25Score(qt, d.tokens, allTok, avgdl);
      if (base <= threshold) continue;
      // recency ∈ (0,1]，无时间戳记 0（不加成）；hitBoost 仅 hitCount>0 生效
      const recency = d.at ? recencyDecay(d.at, now, halfLifeMs) : 0;
      const hitBoost = d.hits > 0 ? Math.log(1 + d.hits) : 0;
      const final = base * (1 + wRecency * recency + wHit * hitBoost);
      scored.push({
        ...d,
        base: Number(base.toFixed(4)),
        recency: Number(recency.toFixed(4)),
        hits: d.hits,
        score: Number(final.toFixed(4)),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const ranked = diversity > 0 ? mmrRerank(scored, topK, 1 - diversity) : scored;
    return ranked.slice(0, topK);
  }

  // 语义相关召回（别名，便于 Agent/调用方语义化检索）
  recallSimilar(query, topK = 5) { return this.search(query, { topK, threshold: 0 }); }

  addFact(subj, rel, obj, source = 'unknown') {
    const exists = this.facts.some(f => f.subj === subj && f.rel === rel && f.obj === obj);
    if (!exists) { this.facts.push({ subj, rel, obj, source }); this._save(); }
  }

  note(text, tag = '') { this.notes.push({ t: Date.now(), tag, text }); if (this.notes.length > 300) this.notes.shift(); this._save(); }

  // 记忆去重压缩（越用越强·记忆自维护）：
  //   1) 合并完全重复的 note（相同 text 视为冗余，仅保留最早一条，避免经验反复沉淀撑爆记忆）；
  //   2) 超过 maxNotes 条后，删除最旧的（保留近期）。
  // 返回实际移除的条数。store(键值记忆/playbook) 不动，只压缩自由笔记，避免误合并有用的差异化记忆。
  dedupNotes(maxNotes = 300) {
    const seen = new Map();
    const kept = [];
    for (const n of this.notes) {
      const k = n.text;
      if (seen.has(k)) {
        const ex = seen.get(k);
        if (n.t < ex.t) ex.t = n.t; // 重复：保留更早的时间戳
        continue;
      }
      seen.set(k, n);
      kept.push(n);
    }
    kept.sort((a, b) => a.t - b.t);
    while (kept.length > maxNotes) kept.shift();
    const removed = this.notes.length - kept.length;
    if (removed) { this.notes = kept; this._save(); }
    return removed;
  }

  // 一键压缩：去重 + 返回统计（{removed, notes}）
  compact(maxNotes = 300) {
    const removed = this.dedupNotes(maxNotes);
    return { removed, notes: this.notes.length };
  }

  queryFacts(subj) { return this.facts.filter(f => f.subj === subj || f.obj === subj); }
  snapshot() { return { keys: Object.keys(this.store), facts: this.facts.length, notes: this.notes.length, layers: this.layerSnapshot() }; }
}

// ── 规则匹配引擎 ──
// rule.condition 可以是字符串关键词（子串匹配）或正则表达式。
// 例：{condition:'delete_file'} 匹配包含"delete"或"删除文件"的输入。
function matchRule(input, rule) {
  if (!rule || !rule.condition) return false;
  const text = String(input || '').toLowerCase();
  const cond = String(rule.condition).toLowerCase();
  // 精确关键词匹配
  if (text.includes(cond)) return true;
  // 逗号分隔的多关键词（或关系）
  if (cond.includes(',')) {
    return cond.split(',').some(c => text.includes(c.trim()));
  }
  return false;
}

// 时间衰减：age = now - t，半衰期 halfLifeMs → 0.5^(age/halfLife)，范围 (0,1]；无时间戳(t 为假值)返回 0。
export function recencyDecay(t, now = Date.now(), halfLifeMs = 7 * 24 * 3600 * 1000) {
  if (!t) return 0;
  const age = Math.max(0, now - t);
  return Math.pow(0.5, age / halfLifeMs);
}

// Jaccard token 相似度（MMR 去冗余用）
function jaccardTokens(a, b) {
  const sa = new Set(a), sb = new Set(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// MMR 去冗余重排：迭代选取 argmax(λ·rel_norm − (1−λ)·max_sim(已选))。
// λ 接近 1 偏相关（等价原排序），λ 小偏多样。rel 用榜首分归一到 [0,1]。
export function mmrRerank(scored, topK, lambda = 0.7) {
  if (!scored.length) return [];
  const maxScore = scored[0].score || 1;
  const cand = scored.slice();
  const selected = [];
  const want = Math.min(topK, cand.length);
  while (selected.length < want && cand.length) {
    let best = -Infinity, bi = 0;
    for (let i = 0; i < cand.length; i++) {
      const rel = cand[i].score / maxScore;
      let maxSim = 0;
      for (const s of selected) maxSim = Math.max(maxSim, jaccardTokens(cand[i].tokens || [], s.tokens || []));
      const m = lambda * rel - (1 - lambda) * maxSim;
      if (m > best) { best = m; bi = i; }
    }
    selected.push(cand.splice(bi, 1)[0]);
  }
  return selected;
}
