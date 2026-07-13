# LLM 适配层示例 — 在多个 provider 间切换

本仓库的自主智能体只讲 **OpenAI Chat Completions 协议**（`POST {baseUrl}/chat/completions`）。
Ollama、DeepSeek、通义 Qwen、Moonshot(Kimi)、SiliconFlow 都暴露**兼容端点**，
因此同一套 `scripts/agent/respond.mjs` 无需改写即可在它们之间切换——靠 `LLM_PROVIDER` 一个变量。

> 适配层代码：`scripts/llm/adapter.mjs`（零依赖、可单测）
> 看全部 provider：`node scripts/llm/adapter.mjs --list`
> 看某个 provider 解析出的配置：`node scripts/llm/adapter.mjs --provider deepseek`

## 切换方式（任选其一）

### 1) 本地免密钥（Ollama）
```bash
ollama serve   # 默认 http://127.0.0.1:11434/v1
LLM_PROVIDER=ollama node scripts/agent/respond.mjs
```
默认模型 `qwen2.5-coder:3b`，无需任何 key。

### 2) DeepSeek（免费额度）
```bash
LLM_PROVIDER=deepseek DEEPSEEK_API_KEY=sk-xxx node scripts/agent/respond.mjs
```
默认模型 `deepseek-chat`。密钥从 `DEEPSEEK_API_KEY` 自动读取。

### 3) 通义 Qwen / DashScope
```bash
LLM_PROVIDER=qwen DASHSCOPE_API_KEY=sk-xxx node scripts/agent/respond.mjs
```
默认模型 `qwen-plus`（兼容模式端点）。

### 4) Moonshot (Kimi)
```bash
LLM_PROVIDER=moonshot MOONSHOT_API_KEY=sk-xxx node scripts/agent/respond.mjs
```

### 5) 自定义 / 任意 OpenAI 兼容代理
仍可用旧式显式覆盖（优先级高于 provider 默认值）：
```bash
LLM_BASE_URL=https://my-proxy.example.com/v1 LLM_MODEL=my-model LLM_API_KEY=sk-xxx node scripts/agent/respond.mjs
```

## 在你的脚本里复用适配层
```js
import { buildConfig, createClient } from '../llm/adapter.mjs';

const cfg = buildConfig({ provider: process.env.LLM_PROVIDER });
// cfg = { provider, baseUrl, model, apiKey, isLocal, keyRequired }
const { chat } = createClient(cfg);
const text = await chat('You are a helpful agent.', 'Refactor this function.');
```

## provider 一览
| 名（别名） | 默认 baseUrl | 默认模型 | 密钥环境变量 |
| --- | --- | --- | --- |
| `openai` (gpt) | https://api.openai.com/v1 | gpt-4o-mini | `LLM_API_KEY` |
| `deepseek` | https://api.deepseek.com/v1 | deepseek-chat | `DEEPSEEK_API_KEY` |
| `qwen` (dashscope/tongyi) | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen-plus | `DASHSCOPE_API_KEY` |
| `moonshot` (kimi) | https://api.moonshot.cn/v1 | moonshot-v1-8k | `MOONSHOT_API_KEY` |
| `siliconflow` (silicon) | https://api.siliconflow.cn/v1 | deepseek-ai/DeepSeek-V3 | `SILICONFLOW_API_KEY` |
| `ollama` (local) | http://127.0.0.1:11434/v1 | qwen2.5-coder:3b | （无需） |
