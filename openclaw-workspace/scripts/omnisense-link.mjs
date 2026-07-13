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

// 能力自描述：借鉴 Google A2A Protocol 的 Agent Card 思想，让工作区智能体能「发现」身体全部能力。
// describe → 七器官树（含每能力 desc/net/examples）；card → A2A 扁平技能卡（id/name/description/tags/examples/net）。
export async function runDescribe() {
  return await withTimeout(runOrgan('describe', []), TIMEOUT_MS);
}
export async function runCard() {
  return await withTimeout(runOrgan('card', []), TIMEOUT_MS);
}
// 能力委派：输入 A2A 风格 skillId（organ.method），路由到对应器官/方法。
// 例：route brain.think "我该关注什么"  /  route hand.calc '{"expression":"2+2"}'
// 统一返回契约：hand 自带 {ok} 透传；其余器官原始输出包成 {ok:true, result}，便于上层 client 一致处理。
export async function routeSkill(skillId, rest = []) {
  const parts = String(skillId || '').split('.');
  if (parts.length < 2) {
    return { ok: false, error: 'skillId 格式应为 organ.method，例如 eye.seeWebsite / hand.calc' };
  }
  const [organ, method] = parts;
  const raw = await withTimeout(runOrgan(organ, [method, ...rest]), TIMEOUT_MS);
  if (raw && typeof raw === 'object' && 'ok' in raw) return raw;
  return { ok: true, result: raw };
}

// 工作区侧可观测性入口：直接复用 OmniSense 引擎的 tracer（与内核同一份实现，无壳、可单测）。
// 让工作区智能体也能"回放对比 / 检索同目标运行 / 导出回归数据集 / 跑回归门禁"——合并后新项目里，
// 工作区不只是被动委派，更能对身体的行为做可观测性分析（对齐 LangSmith trace→dataset / Forkline 分歧检测思想）。
export async function runTrace(subArgs = []) {
  const omni = (await import('../../src/index.mjs')).OmniSense.create();
  const has = (f) => subArgs.some(a => a.startsWith(f));
  const val = (f, d) => { const m = subArgs.find(a => a.startsWith(f)); return m ? m.split('=')[1] : d; };
  if (has('--clear')) return omni.clearTraces();
  const get = val('--get=', '');
  if (has('--get=')) return omni.getTrace(get);
  if (has('--diff=')) {
    const [a, b] = val('--diff=', '').split(',').map(s => s.trim());
    return omni.compareTraces(a, b);
  }
  const goal = val('--find=', '');
  if (has('--find=')) return omni.findTracesByGoal(goal, { limit: Number(val('--limit=', '10')) || 10 });
  const exp = val('--export=', '');
  if (has('--export=')) {
    return omni.exportTraceDataset({
      path: exp === '-' ? undefined : exp,
      format: val('--export-format=', 'json'),
      goal: has('--find=') ? goal : undefined,
      limit: Number(val('--limit=', '10')) || 10,
    });
  }
  if (has('--baseline=')) return omni.setTraceBaseline(val('--baseline=', ''));
  if (has('--regression')) return omni.traceRegression();
  if (has('--list')) return { ok: true, runs: omni.traces({ limit: Number(val('--limit=', '10')) || 10 }) };
  return omni.traceSummary();
}

// 纯逻辑入口（可单测，不直接碰 process）。args 为去掉 node 脚本名后的参数数组。
export async function runLink(args) {
  const [cmd, ...rest] = args;
  if (!cmd || cmd === '--help' || cmd === '-h') {
    return {
      ok: true,
      usage: 'omnisense-link <organ> <args...> | goal "<text>" | list | describe | card | route <organ.method> [args...] | dispatch "<target>" | autopilot [ticks] | trace [--summary|--list|--get=<id>|--diff=<a>,<b>|--find="<goal>"|--export=<file|--export-format=json|jsonl|otlp>|--baseline=<id>|--regression|--clear]',
      organs: listOrgans(),
    };
  }
  if (cmd === 'list') {
    return { ok: true, organs: listOrgans() };
  }
  if (cmd === 'describe') {
    return { ok: true, organs: await runDescribe() };
  }
  if (cmd === 'card') {
    return { ok: true, ...(await runCard()) };
  }
  if (cmd === 'route') {
    const sub = rest[0];
    if (!sub || sub === '--list' || sub === 'list') {
      const card = await runCard();
      const skills = (card.skills || []).map((s) => ({ id: s.id, name: s.name, net: s.net, description: s.description }));
      return { ok: true, count: skills.length, skills };
    }
    const out = await routeSkill(sub, rest.slice(1));
    return out;
  }
  if (cmd === 'goal') {
    const text = rest.join(' ').trim();
    if (!text) return { ok: false, error: 'goal 需要文本参数' };
    return await withTimeout(runGoal(text, { useLLM: false }), TIMEOUT_MS);
  }
  if (cmd === 'dispatch') {
    const text = rest.join(' ').trim();
    if (!text) return { ok: false, error: 'dispatch 需要文本目标' };
    const omni = (await import('../../src/index.mjs')).OmniSense.create();
    const r = await withTimeout(omni.skillDispatch(text), TIMEOUT_MS);
    return r;
  }
  if (cmd === 'autopilot') {
    // 自主循环：身体用自身能力卡 skillResolve 自己决定每轮做什么并离线执行。
    // 工作区侧驱动证据：合并后的新项目里，工作区能真正让身体"自驱"而非只被动委派。
    const ticks = Number(rest[0]) || 2;
    const omni = (await import('../../src/index.mjs')).OmniSense.create();
    const r = await withTimeout(omni.autopilot({ ticks }), TIMEOUT_MS);
    return r;
  }
  if (cmd === 'trace') {
    // 工作区侧可观测性：让工作区真正消费身体的 Agent 轨迹（回放对比/检索/导出/回归门禁）。
    const out = await withTimeout(runTrace(rest), TIMEOUT_MS);
    return out;
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
