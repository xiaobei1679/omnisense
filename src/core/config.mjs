// 配置健壮性：安全读取本地模型网关配置文件，缺失/损坏均返回 {}，绝不抛出。
// 统一配置读取入口，llm.mjs / providers 复用，避免各处重复 try/catch 与不一致。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
// 网关配置路径：默认 ~/.omnisense/gateway.json，可用 OMNI_GATEWAY_CONFIG 环境变量覆盖。
export const CONFIG_PATH = process.env.OMNI_GATEWAY_CONFIG
  || join(HOME, '.omnisense', 'gateway.json');

let _gwCache = undefined;

export function readGatewayConfig() {
  if (_gwCache !== undefined) return _gwCache;
  try {
    if (existsSync(CONFIG_PATH)) {
      const d = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      _gwCache = (d && typeof d === 'object') ? d : {};
    } else {
      _gwCache = {};
    }
  } catch {
    _gwCache = {};
  }
  return _gwCache;
}

export function resetConfig() { _gwCache = undefined; }

// 配置优先级：环境变量 > 默认值（网关配置仅作补充读取，不覆盖 env）。
export function cfg(key, fallback = '') {
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  return fallback;
}
