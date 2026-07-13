# 去 AI 腔：删除客套开场与空洞过渡
<!-- insight-meta
tags: qa
source: 中立采集/文风质检
-->
质检发现 AI 输出常带「很高兴为你」「值得注意的是」「毋庸置疑」等客套 / 空洞词。应作为框架级文风规则，由智能体输出前自检。落点：workspace/.learnings/scripts/style-engine.mjs（追加规则，保持零依赖）。
