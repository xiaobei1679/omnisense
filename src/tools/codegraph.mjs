// src/tools/codegraph.mjs — CodeGraph 代码知识图谱查询工具
//
// 包装 CodeGraph CLI（colbymchenry/codegraph，MIT），将预建好的代码知识图谱
// 暴露为 hand 器官的工具。Agent 无需反复 grep/read 文件来了解代码结构，
// 直接查询图表获取符号定义、调用链、导入关系。
//
// 依赖：全局安装 @colbymchenry/codegraph，且项目已初始化（codegraph init）
// 安装：npm i -g @colbymchenry/codegraph && cd <project> && codegraph init
//
// 基准测试（官方 7 项目实测）：工具调用减少 58%，Token 减少 47%，费用降低 16%
// 来源：github.com/colbymchenry/codegraph

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync } from 'node:fs';

/** 项目根目录（由 OMNI_ROOT 环境变量或自动检测决定） */
function getProjectRoot() {
  // 允许运行时覆盖
  const env = process.env.OMNI_ROOT || process.env.INIT_CWD;
  if (env) return env;
  // 向上查找 .codegraph/ 目录
  let dir = process.cwd();
  while (dir !== resolve(dir, '..')) {
    if (existsSync(resolve(dir, '.codegraph', 'codegraph.db'))) return dir;
    dir = resolve(dir, '..');
  }
  return process.cwd();
}

/**
 * 执行 codegraph CLI 命令并返回 JSON 结果
 * @param {string[]} args CLI 参数数组
 * @returns {object} 解析后的结果
 */
function cg(args) {
  const root = getProjectRoot();
  const cmd = ['codegraph', ...args, '--path', root, '--json'].join(' ');
  try {
    const out = execSync(cmd, { encoding: 'utf-8', timeout: 15000 });
    return JSON.parse(out.trim());
  } catch (e) {
    // 尝试从 stderr 提取部分结果
    if (e.stdout) {
      try { return JSON.parse(e.stdout.trim()); } catch {}
    }
    throw new Error(`CodeGraph 查询失败: ${e.message}`);
  }
}

export default {
  name: 'codegraph',
  description: '查询代码知识图谱 — 符号定义、调用链、导入关系。基于预建的 tree-sitter AST 索引，比反复 grep+read 省 58% 工具调用。支持 explore（深度探索）/ query（符号搜索）/ node（符号详情）/ callers（谁调用它）/ callees（它调用了谁）',
  parameters: {
    type: 'object',
    properties: {
      mode: {
        type: 'string',
        enum: ['explore', 'query', 'node', 'callers', 'callees'],
        description: '查询模式：explore=深度探索（含源码+调用路径），query=符号搜索，node=单个符号详情，callers=谁调用了它，callees=它调用了谁',
      },
      query: {
        type: 'string',
        description: '查询内容：explore/query/node 模式的搜索词（符号名、函数名、类名等）',
      },
      limit: {
        type: 'number',
        description: '结果数量上限（默认 10）',
      },
    },
    required: ['mode', 'query'],
  },
  run: async ({ mode = 'explore', query, limit = 10 }) => {
    if (!query || !query.trim()) {
      return { ok: false, error: 'query 不能为空' };
    }

    switch (mode) {
      case 'explore': {
        // codegraph explore 不支持 --json，用 node 模式+callers/callees 组合
        const nodeRaw = execSync(
          `codegraph node "${query}" --path "${getProjectRoot()}" --json`,
          { encoding: 'utf-8', timeout: 15000 }
        );
        const nodeData = JSON.parse(nodeRaw.trim());

        // 获取调用者
        let callers = [];
        try {
          const cRaw = execSync(
            `codegraph node "${query}" --path "${getProjectRoot()}" --json --callers`,
            { encoding: 'utf-8', timeout: 10000 }
          );
          callers = JSON.parse(cRaw.trim());
        } catch {}

        return {
          ok: true,
          mode: 'explore',
          symbol: query,
          definition: nodeData,
          callers,
          tip: '可用 mode=callers / mode=callees 查看详细调用链',
        };
      }

      case 'query':
      case 'node': {
        const raw = execSync(
          `codegraph ${mode} "${query}" --path "${getProjectRoot()}" --json --limit ${limit}`,
          { encoding: 'utf-8', timeout: 15000 }
        );
        return { ok: true, mode, results: JSON.parse(raw.trim()) };
      }

      case 'callers': {
        const raw = execSync(
          `codegraph node "${query}" --path "${getProjectRoot()}" --json --callers --limit ${limit}`,
          { encoding: 'utf-8', timeout: 15000 }
        );
        return { ok: true, mode: 'callers', symbol: query, callers: JSON.parse(raw.trim()) };
      }

      case 'callees': {
        const raw = execSync(
          `codegraph node "${query}" --path "${getProjectRoot()}" --json --callees --limit ${limit}`,
          { encoding: 'utf-8', timeout: 15000 }
        );
        return { ok: true, mode: 'callees', symbol: query, callees: JSON.parse(raw.trim()) };
      }

      default:
        return { ok: false, error: `未知模式: ${mode}，可用: explore/query/node/callers/callees` };
    }
  },
};
