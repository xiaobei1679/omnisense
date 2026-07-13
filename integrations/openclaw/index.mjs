// integrations/openclaw/index.mjs
// 桥接层统一出口：多智能体工作区直接 import 本文件即可驱动 OmniSense 身体。
// 直接复用 src/ 真实实现，无 shell 中转、可单测。
export { runOrgan } from './omni-body.mjs';
export { runGoal } from './omnisense-bridge.mjs';

// 七器官清单（与 body.describe() 一致，供上层枚举/校验）
export const ORGANS = ['eye', 'ear', 'mouth', 'brain', 'hand', 'perceive', 'foot'];

// 返回器官副本，避免调用方误改常量
export function listOrgans() {
  return [...ORGANS];
}
