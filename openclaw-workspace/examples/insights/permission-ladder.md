# 加 per-tool 权限阶梯配置（deny/ask/allow）
<!-- insight-meta
tags: security
source: 外部调研/AI Agent Security in 2026
-->
2026 agent 安全六层栈第一层是「权限阶梯」（deny→ask→allow），核心论断 "Permission is infrastructure, not prompt"——权限应在工具调用前由基础设施控制，而非靠提示词。当前框架有 `observer.mjs`（路径/密钥/语法门）+ `security-auditor`（OWASP 逻辑层），但缺 per-tool 权限阶梯。落点：新增 `config/permissions.json`（或并入 openclaw.json）声明每工具 deny/ask/allow；`scripts/ci/observer.mjs` 在受保护路径之外多一道 per-tool 权限校验；不可逆动作（git push）维持 escalation-only（已靠「绝不推送」实现）。零依赖、纯 JSON 配置。
