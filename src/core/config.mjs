// 配置健壮性：安全读取框架网关配置(openclaw.json)，缺失/损坏均返回 {}，绝不抛出。
// 统一配置读取入口，llm.mjs / providers 复用，避免各处重复 try/catch 与不一致。
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const HOME = process.env.USERPROFILE || process.env.HOME || '';
export const CONFIG_PATH = join(HOME, '.qclaw', 'openclaw.json');

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

// 配置优先级：环境变量 > 默认值（框架 config 仅作补充读取，不覆盖 env）。
export function cfg(key, fallback = '') {
  if (process.env[key] != null && process.env[key] !== '') return process.env[key];
  return fallback;
}
