// 大脑记忆中枢：文件落盘的键值 + 事件流 + 图谱（轻量）
// v2：检索从"字符串包含匹配"升级为 BM25-lite 相关性排序（零 key 可跑），
//     让 recall/search 真正基于语义相关度而非字面子串，支撑 Agent 的 playbook 复用与经验检索。
// v3：深度检索——BM25 相关性叠加①时间衰减(recency，新记忆更重要)②复用权重(hitCount，高频打法排更前)
//     ③可选 MMR 去冗余(diversity，避免 topK 里全是近重复)。三者对"无时间戳/无 hitCount"的记忆零影响，向后兼容。
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';

// 中英混合轻量分词：中文按单字、英文/数字按词（长度>1）、URL/路径作为整体实体 token；去停用虚词、小写。
const STOP = new Set('的 了 和 与 把 在 到 我 你 他 她 它 们 这 那 个 是 有 就 也 都 而 即 若 请 用 为 以 上 下 中 后 前 该 此 每 各 其 要 把 将 给 让 对 从 被 着 过 等 啊 吧 呢 吗 嘛 们 之 其 及 或 但 则 故 因 如 若 若 使 令 使 得 可 能 会 可 以 进行 执行 目标 任务 一个 一些 并 且 又 再 才 the a an and or of to for in on at by with is are be this that it its as if'.split(/\s+/));
export function tokenize(text) {
  const s = String(text || '').toLowerCase();
  const out = [];
  const en = s.match(/[a-z0-9]+/g) || [];
  for (const w of en) if (w.length > 1 && !STOP.has(w)) out.push(w);
  const zh = s.match(/[一-龥]/g) || [];
  for (const c of zh) if (!STOP.has(c)) out.push(c);
  // 关键实体（URL / 文件路径）作为整体 token 保留，提升同类任务检索命中
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
    this.store = {};       // key -> value
    this.facts = [];       // {subj, rel, obj, source}
    this.notes = [];       // 自由记忆
    this._load();
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

  _save() {
    try {
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify({ store: this.store, facts: this.facts, notes: this.notes }, null, 2));
      // 原子 rename 替代 rmSync（本环境 rmSync 被安全删除封装拦截）
      renameSync(tmp, this.path);
    } catch (e) { console.error('[记忆] 落盘失败:', e.message); }
  }

  remember(key, value) { this.store[key] = value; this._save(); return value; }
  recall(key) { return this.store[key]; }

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
  snapshot() { return { keys: Object.keys(this.store), facts: this.facts.length, notes: this.notes.length }; }
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
