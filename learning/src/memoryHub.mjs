// 记忆中枢：短期(工作记忆) + 长期(知识图谱 + 信念 + 假设 + 学习 + 缺口)。
// 所有模块读写同一处，避免信息孤岛。可落盘持久化。
import { writeFileSync, readFileSync, existsSync, renameSync } from 'node:fs';
import { IS_CAUSAL } from './relations.mjs';

export class MemoryHub {
  constructor(persistPath) {
    this.working = [];                                   // 短期上下文
    this.triples = [];                                   // 视觉/听觉抽取的三元组
    this.entities = new Map();                           // name -> {type, modalities:Set, mentions}
    this.edges = [];                                     // 知识图谱边 {from,rel,to,modality,source}
    this.beliefs = [];                                   // 脑的推理结论(带置信度+反方)
    this.hypotheses = [];                                // 溯因假设
    this.learnings = [];                                 // 心跳从开源项目学到的技法
    this.gaps = [];                                      // 知识缺口 {entity, modality, status}
    this.persistPath = persistPath || null;

    if (this.persistPath && existsSync(this.persistPath)) {
      try {
        const d = JSON.parse(readFileSync(this.persistPath, 'utf8'));
        this.triples = d.triples || [];
        this.beliefs = d.beliefs || [];
        this.hypotheses = d.hypotheses || [];
        this.learnings = d.learnings || [];
        this.gaps = d.gaps || [];
        this.entities = new Map((d.entities || []).map(([k, v]) => [k, { ...v, modalities: new Set(v.modalities), works: new Set(v.works || []) }]));
        this.edges = d.edges || [];
      } catch { /* 损坏则忽略，从空开始 */ }
    }
  }

  addEntity(name, type, modality, work) {
    const e = this.entities.get(name) || { type: type || 'unknown', modalities: new Set(), mentions: 0, works: new Set() };
    e.modalities.add(modality);
    if (work) e.works.add(work);   // 命名空间：记录该实体出自哪部作品/来源，用于跨模态消歧
    e.mentions++;
    this.entities.set(name, e);
    return e;
  }

  addTriple(t) { this.triples.push(t); }

  // 边图去重：同一 (from|rel|to|modality|source) 只入一次，避免重跑/跨源重复污染推理计数
  addEdge(from, rel, to, meta = {}) {
    const key = `${from}|${rel}|${to}|${meta.modality || 'unknown'}|${meta.source || ''}`;
    if (this.edges.some(e => `${e.from}|${e.rel}|${e.to}|${e.modality}|${e.source}` === key)) return;
    this.edges.push({ from, rel, to, modality: meta.modality || 'unknown', source: meta.source || '' });
  }

  // 查询某实体出现的作品/来源集合（用于跨模态消歧）
  entityWorks(name) { return this.entities.get(name)?.works || new Set(); }

  addBelief(b) { this.beliefs.push(b); }
  addHypothesis(h) { this.hypotheses.push(h); }
  addLearning(l) { this.learnings.push(l); }

  recordGap(entity, modality) {
    if (!this.gaps.find(g => g.entity === entity)) {
      this.gaps.push({ entity, modality, status: 'open' });
    }
  }

  // 跨模态关联：同一实体在视觉与听觉中都出现过
  crossModalLinks() {
    const links = [];
    for (const [name, e] of this.entities) {
      if (e.modalities.has('visual') && e.modalities.has('audio')) links.push(name);
    }
    return links;
  }

  // 知识图谱：某节点的出/入邻居（按关系类型）
  neighbors(node) {
    const out = [], inc = [];
    for (const e of this.edges) {
      if (e.from === node) out.push(e);
      if (e.to === node) inc.push(e);
    }
    return { out, inc };
  }

  forwardChain(node, depth = 2, causalOnly = false) {
    const seen = [node];
    let frontier = [node];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const n of frontier) {
        for (const e of this.edges) {
          if (causalOnly && !IS_CAUSAL.has(e.rel)) continue; // 因果链只走正向因果边，避免把关联当因果
          if (e.from === n && !seen.includes(e.to)) { seen.push(e.to); next.push(e.to); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return seen;
  }

  backwardChain(node, depth = 2, causalOnly = false) {
    const seen = [node];
    let frontier = [node];
    for (let d = 0; d < depth; d++) {
      const next = [];
      for (const n of frontier) {
        for (const e of this.edges) {
          if (causalOnly && !IS_CAUSAL.has(e.rel)) continue;
          if (e.to === n && !seen.includes(e.from)) { seen.push(e.from); next.push(e.from); }
        }
      }
      frontier = next;
      if (!frontier.length) break;
    }
    return seen;
  }

  // 开放缺口：仅单模态出现、或低置信度信念
  openGaps() {
    const out = [];
    for (const [name, e] of this.entities) {
      if (e.modalities.size === 1) out.push({ entity: name, modality: [...e.modalities][0], reason: '单模态' });
    }
    for (const b of this.beliefs) {
      if ((b.confidence || 1) < 0.5) out.push({ entity: b.belief?.slice(0, 30) || '?', modality: 'belief', reason: '低置信度' });
    }
    return out.slice(0, 8);
  }

  persist() {
    if (!this.persistPath) return;
    const data = {
      triples: this.triples,
      beliefs: this.beliefs,
      hypotheses: this.hypotheses,
      learnings: this.learnings,
      gaps: this.gaps,
      entities: [...this.entities].map(([k, v]) => [k, { ...v, modalities: [...v.modalities], works: [...v.works] }]),
      edges: this.edges,
    };
    // 原子写：先写 .tmp 再 rename，避免进程中断导致 memory.json 损坏
    const tmp = `${this.persistPath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, this.persistPath);
  }
}
