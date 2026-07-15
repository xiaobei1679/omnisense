// perception.mjs — 感知融合层（觉知引擎）：汇聚眼/耳的 percept，
// 构建统一「情境模型」，决定注意力优先级，产出可解释的关注建议。
// 零依赖：只做聚合与统计，不引入新推理，所有判断可追溯到具体 percept。
export class PerceptionModule {
  constructor(bus, memory) {
    this.bus = bus;
    this.memory = memory;
    this.scene = {
      percepts: 0,
      modalities: new Set(),
      entities: new Map(),   // name -> { modalities:Set, sources:Set }
      themes: new Set(),
      lastFocus: null,
    };
    this.lastSituation = null;
  }

  init() { this.bus.on('percept', (p) => this.fuse(p)); }

  fuse(p) {
    const s = this.scene;
    s.percepts++;
    if (p.modality) s.modalities.add(p.modality);
    for (const e of (p.entities || [])) {
      const rec = s.entities.get(e) || { modalities: new Set(), sources: new Set() };
      if (p.modality) rec.modalities.add(p.modality);
      if (p.source) rec.sources.add(p.source);
      s.entities.set(e, rec);
    }
    for (const t of (p.themes || [])) s.themes.add(t);

    // 注意力优先级：模态覆盖最少的实体优先（单模态=最不可信，最需核实）
    let focus = null, best = Infinity;
    for (const [name, rec] of s.entities) {
      if (rec.modalities.size < best) { best = rec.modalities.size; focus = name; }
    }
    s.lastFocus = focus;

    const attention = best === 1
      ? `建议优先核实单模态实体「${focus}」（仅 ${(focus && [...s.entities.get(focus).modalities]) || ''} 出现，尚未交叉验证）`
      : '多模态已交叉验证，可深入因果/类比/归纳推理';

    const snapshot = {
      percepts: s.percepts,
      modalities: [...s.modalities],
      entityCount: s.entities.size,
      themes: [...s.themes],
      focus,
      attention,
    };
    this.lastSituation = snapshot;
    this.bus.emit('situation', snapshot);
    console.log(`\n[感知] 情境融合：模态[${snapshot.modalities.join('/')}] · 实体${snapshot.entityCount} · 主题[${snapshot.themes.join('/') || '—'}] · 关注→${focus || '—'}`);
    console.log(`   注意力建议: ${attention}`);
  }
}
