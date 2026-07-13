// src/tools/hash.mjs — 内置示例插件：安全哈希（离线，node:crypto）
//
// 这是「工具自发现」机制的示范：任何放在 src/tools/（或 OMNI_PLUGINS_DIR）下的
// .mjs 模块，只要默认导出一个 { name, description, parameters, run } 工具对象，
// 就会被 buildDefaultTools 自动注册为 hand 工具，无需改动核心代码。
// 借鉴自 Nanobot / OpenSquilla 的「技能/工具自动加载」模式。
import { createHash } from 'node:crypto';

export default {
  name: 'hash',
  description: '计算文本的哈希摘要（离线，node:crypto）。用于内容指纹与去重。默认 sha256。',
  parameters: {
    type: 'object',
    properties: {
      text: { type: 'string', description: '待哈希文本' },
      algo: { type: 'string', description: '哈希算法，默认 sha256（如 sha1/md5/sha512）' },
    },
    required: ['text'],
  },
  run: async ({ text, algo = 'sha256' }) => ({
    algo,
    text: String(text),
    digest: createHash(algo).update(String(text)).digest('hex'),
  }),
};
