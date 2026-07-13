# 给 .learnings/ 加 write-path 规范与 temporal 分层
<!-- insight-meta
tags: memory
source: 外部调研/arXiv 2026 Memory for Autonomous LLM Agents
-->
arXiv 2026 记忆论文提出三维分类（temporal: working/episodic/semantic/procedural × substrate × control）与 write-manage-read 循环：管理不是简单追加，需过滤/规范化/去重/优先级/元数据（时间·源·置信度）。当前 `workspace/.learnings/` 是扁平知识库（LEARNINGS.md 单文件 + 一堆 json），缺显式 write-path 与分层。落点：在 `scripts/evolve/ingest.mjs` 的 ingest 阶段加 write-path 规范（过滤低信号、去重、打元数据），并把 LEARNINGS.md 按 working/episodic/semantic/procedural 分层；保持零依赖（文件/json，不引向量库）。
