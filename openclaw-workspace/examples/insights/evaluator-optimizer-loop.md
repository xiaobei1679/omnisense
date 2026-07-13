# 把 reviewer 门禁升级为显式 Evaluator-Optimizer 精炼循环
<!-- insight-meta
tags: eval
source: 外部调研/Anthropic Building Effective Agents
-->
Anthropic 第 5 种 workflow「Evaluator-Optimizer」：一个 LLM 生成响应，另一个在循环里评估并给反馈，迭代精炼。当前 `scripts/ci/reviewer.mjs` 是**单次门禁**（FAIL 即拦下，不重新生成）。可借鉴做成显式循环：reviewer 输出结构化反馈 → 带着反馈重新生成提案 → 再评估，直到 PASS 或达最大迭代。落点：`scripts/ci/reviewer.mjs` 增加 `refineLoop()`（保持纯函数、零依赖、可单测；注意防无限循环，设 maxRounds）；`scripts/evolve/ingest.mjs` 的 `toProposal` 可消费反馈。务必保留「FAIL 绝不提交」铁律。
