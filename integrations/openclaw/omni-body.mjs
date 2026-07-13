#!/usr/bin/env node
// integrations/openclaw/omni-body.mjs
// ─────────────────────────────────────────────────────────────
// 七器官桥接：让多智能体工作区以"真人身体"方式驱动 OmniSense。
// 同仓库 ESM，直接 import OmniSense 的 Body，无需 shell 调用 CLI。
//
// 用法（在仓库根目录执行）：
//   node integrations/openclaw/omni-body.mjs hand calc '{"expression":"2+2"}' [--json]
//   node integrations/openclaw/omni-body.mjs perceive [--json]
//   node integrations/openclaw/omni-body.mjs describe [--json]
//   node integrations/openclaw/omni-body.mjs live '{"ticks":2}' [--json]
//   node integrations/openclaw/omni-body.mjs eye seeHotTopics bilibili [--json]   # 联网（离线降级）
//   node integrations/openclaw/omni-body.mjs ear listenFeedback "用户说…" [--json]
//   node integrations/openclaw/omni-body.mjs mouth giveOpinion "AI 感知" [--json]
//   node integrations/openclaw/omni-body.mjs brain think "我该关注什么" [--json]
//   node integrations/openclaw/omni-body.mjs foot watch '{"max":3}' [--json]
//
// 器官→方法映射（详见 src/body.mjs）：
//   eye/ear/mouth/brain/foot → body[organ](method, ...args)
//   hand <tool> '<jsonArgs>' → body.hand(tool, jsonArgs)
//   perceive / describe / live 为身体级便捷入口
// ─────────────────────────────────────────────────────────────
import { OmniSense } from '../../src/index.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEOUT_MS = 120000;

function parseJsonArg(s) {
  if (s == null) return {};
  if (typeof s !== 'string') return s;
  try { return JSON.parse(s); } catch { return {}; }
}

// 供测试与脚本复用：执行一个器官动作，返回结果对象
export async function runOrgan(organ, rawArgs = []) {
  const omni = OmniSense.create();
  const body = omni.body;
  const args = rawArgs.filter(a => a !== '--json');
  switch (organ) {
    case 'hand': {
      const tool = args[0];
      const toolArgs = parseJsonArg(args[1]);
      return await body.hand(tool, toolArgs);
    }
    case 'perceive': return body.perceive();
    case 'describe': return body.describe();
    case 'live': return await body.live(parseJsonArg(args[0]) || {});
    case 'foot': return await body.foot(args[0], parseJsonArg(args[1]));
    case 'eye':
    case 'ear':
    case 'mouth':
    case 'brain':
      return await body[organ](args[0], ...args.slice(1));
    default:
      throw new Error(`未知器官: ${organ}（可选 eye/ear/mouth/brain/hand/perceive/foot/describe/live）`);
  }
}

async function withTimeout(p, ms) {
  let t;
  const to = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`器官调用超时(${ms}ms)`)), ms); });
  try { return await Promise.race([p, to]); } finally { clearTimeout(t); }
}

async function main() {
  const argv = process.argv.slice(2);
  const asJson = argv.includes('--json');
  const organ = argv[0];
  const rest = argv.slice(1);
  try {
    const out = await withTimeout(runOrgan(organ, rest), TIMEOUT_MS);
    const text = asJson ? JSON.stringify(out, null, 2) : String(JSON.stringify(out)).slice(0, 2000);
    process.stdout.write(text + '\n', () => process.exit(0));
  } catch (e) {
    const err = { ok: false, error: e?.message || String(e) };
    process.stdout.write((asJson ? JSON.stringify(err, null, 2) : JSON.stringify(err)) + '\n', () => process.exit(1));
  }
}

// 直接以 `node integrations/openclaw/omni-body.mjs ...` 调用时 process.argv[1] 是相对路径，
// 必须 resolve 后再与 import.meta.url 比较，否则 main() 不会执行。
const __invoked = process.argv[1] ? resolve(process.argv[1]) : '';
if (__invoked && fileURLToPath(import.meta.url) === __invoked) {
  main();
}
