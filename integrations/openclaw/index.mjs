// integrations/openclaw/index.mjs
// 桥接层统一出口：多智能体工作区直接 import 本文件即可驱动 OmniSense 身体。
// 直接复用 src/ 真实实现，无 shell 中转、可单测。
import { ORGANS as BODY_ORGANS } from '../../src/body.mjs';
export { runOrgan } from './omni-body.mjs';
export { runGoal } from './omnisense-bridge.mjs';

// 器官清单（单一事实来源：从 src/body.mjs 的 ORGANS 派生，避免"七/八器官"描述漂移）。
// 上层只需枚举器官 key 时直接 import ORGANS / listOrgans()。
export const ORGANS = BODY_ORGANS.map(o => o.key);

// 返回器官副本，避免调用方误改常量
export function listOrgans() {
  return [...ORGANS];
}

// A2A 风格 Agent Card：把身体全部能力扁平化为 skills[]，供多智能体工作区做能力发现与委派
export async function agentCard() {
  return runOrgan('card', []);
}

// 技能匹配与委派：基于 Agent Card 能力卡找到最佳器官/方法并自动调用
// 纯关键词匹配，零外部依赖
export async function dispatchSkill(goal) {
  const omni = (await import('../../src/index.mjs')).OmniSense.create();
  return omni.skillDispatch(goal);
}
