#!/usr/bin/env node
// integrations/openclaw/omnisense-bridge.mjs
// ─────────────────────────────────────────────────────────────
// 目标桥接：把"一句话目标"交给 OmniSense 身体去执行（感知→思考→动手）。
// 多智能体工作区可把 omnisense-engine 的"做事"统一收口到这里。
//
// 用法（在仓库根目录执行）：
//   node integrations/openclaw/omnisense-bridge.mjs "记录一条测试记忆" [--json]
//   node integrations/openclaw/omnisense-bridge.mjs "抓取 https://example.com 并摘要" [--json] [--llm]
// ─────────────────────────────────────────────────────────────
import { OmniSense } from '../../src/index.mjs';

// 执行一个目标：先感知环境、再思考、最后用手把结果落盘（默认记到长期记忆）。
// 离线可跑、确定性、不触网（除非目标本身要求联网，如 web_fetch）。
export async function runGoal(goal, { useLLM = false, remember = true, allowShell = false } = {}) {
  const omni = OmniSense.create();
  const body = omni.body;
  const trace = {};
  // 1) 感知：聚合近期眼耳输入 + 实时环境，形成上下文
  trace.perceive = body.perceive();
  // 2) 思考：围绕目标推演该怎么做（离线本地推理；在线时走网关/驱动模型）
  trace.think = await omni.brain.think(`目标：${goal}`, '').catch(e => ({ error: e.message }));
  // 3) 动手：把目标落盘到长期记忆（确定性、离线）
  if (remember) {
    trace.remember = await body.hand('memory_remember', { key: 'goal:' + Date.now(), value: goal })
      .catch(e => ({ error: e.message }));
  }
  return { goal, usedLLM: useLLM, trace };
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const useLLM = argv.includes('--llm');
  const goal = argv.filter(a => !a.startsWith('--')).join(' ').trim();
  if (!goal) {
    process.stdout.write(JSON.stringify({ ok: false, error: '缺少目标参数' }) + '\n');
    process.exit(1);
  }
  try {
    const out = await runGoal(goal, { useLLM });
    process.stdout.write((asJson ? JSON.stringify(out, null, 2) : JSON.stringify(out)) + '\n');
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e?.message || String(e) }) + '\n');
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
