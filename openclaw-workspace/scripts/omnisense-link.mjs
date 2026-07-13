// openclaw-workspace/scripts/omnisense-link.mjs
// 合并后「新项目」的一体化入口：让多智能体工作区的智能体直接驱动 OmniSense 身体（七器官 + 目标）。
// 这是两个项目真正"长在一起"的证明——工作区不再是死的静态子包，而是能调用身体的活组件。
// 直接 import 同仓库桥接层（integrations/openclaw/index.mjs），无 shell 中转、可单测。
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOrgan, runGoal, listOrgans } from '../../integrations/openclaw/index.mjs';

const TIMEOUT_MS = 120000;

function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout ${ms}ms`)), ms)),
  ]);
}

// 纯逻辑入口（可单测，不直接碰 process）。args 为去掉 node 脚本名后的参数数组。
export async function runLink(args) {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    return {
      ok: true,
      usage: 'omnisense-link <organ> <args...> | goal "<text>" | list',
      organs: listOrgans(),
    };
  }
  if (cmd === 'list') {
    return { ok: true, organs: listOrgans() };
  }
  if (cmd === 'goal') {
    const text = rest.join(' ').trim();
    if (!text) return { ok: false, error: 'goal 需要文本参数' };
    return await withTimeout(runGoal(text, { useLLM: false }), TIMEOUT_MS);
  }
  // 其余默认当作器官调用：omnisense-link hand calc '{"expression":"2+2"}'
  const organ = cmd;
  return await withTimeout(runOrgan(organ, rest), TIMEOUT_MS);
}

function main() {
  const asJson = process.argv.includes('--json');
  const args = process.argv.slice(2).filter((a) => a !== '--json');
  runLink(args)
    .then((out) => {
      const text = asJson ? JSON.stringify(out, null, 2) : JSON.stringify(out);
      const code = out && out.ok === false ? 1 : 0;
      process.stdout.write(text + '\n', () => process.exit(code));
    })
    .catch((e) => {
      const err = { ok: false, error: e?.message || String(e) };
      process.stdout.write((asJson ? JSON.stringify(err, null, 2) : JSON.stringify(err)) + '\n', () => process.exit(1));
    });
}

// 相对路径调用（node openclaw-workspace/scripts/x.mjs）下，必须用 resolve 后比较，否则 main 永不执行。
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || '')) {
  main();
}
