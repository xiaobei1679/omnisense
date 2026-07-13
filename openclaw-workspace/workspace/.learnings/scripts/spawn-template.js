#!/usr/bin/env node
// spawn-template.js v1.0 — 子Agent spawn任务模板组装器
// 将 compose-context 分区上下文自动拼入任务前缀，替代"全塞一堆"的老方式
// 用法:
//   node spawn-template.js build --task-id <id> [--profile] [--policies] [--lessons] [--task-text "<原文>"]
//   node spawn-template.js build --task-id <id> --task-file <path>  从文件读任务原文
//   node spawn-template.js list-tasks  列出所有注册任务

const fs = require('fs');
const path = require('path');

const composeContext = require(path.join(__dirname, 'compose-context.js'));

const SCRIPTS_DIR = __dirname;
const TASK_STATE_PATH = path.join(SCRIPTS_DIR, '..', 'task-state.json');

function loadTaskState() {
  if (!fs.existsSync(TASK_STATE_PATH)) return null;
  try { return JSON.parse(fs.readFileSync(TASK_STATE_PATH, 'utf-8')); } catch { return null; }
}

function runCompose(taskId, flags) {
  const { buildContext } = composeContext;
  const result = buildContext(taskId, flags);
  return { context: result.system_prompt || '', meta: { zones_populated: result.zones_populated || [], estimated_tokens: result.estimated_tokens || 0 } };
}

function cmdBuild(args) {
  const taskId = args['task-id'];
  const taskText = args['task-text'] || '';
  const taskFile = args['task-file'] || '';

  if (!taskId) {
    console.error('用法: node spawn-template.js build --task-id <id> [--task-text "<原文>"] [--profile] [--policies] [--lessons]');
    process.exit(1);
  }

  let finalTaskText = taskText;
  if (taskFile && fs.existsSync(taskFile)) {
    finalTaskText = fs.readFileSync(taskFile, 'utf-8');
  }

  const taskState = loadTaskState();
  const taskInfo = taskState?.tasks?.[taskId];
  if (!taskInfo) {
    console.error(JSON.stringify({ ok: false, error: `任务 ${taskId} 未注册`, hint: '请在 task-state.json 中注册' }));
    process.exit(1);
  }

  const flags = {
    profile: !!args.profile,
    policies: !!args.policies,
    lessons: !!args.lessons,
  };
  // Default: always include profile + policies for all spawns
  if (!args.profile && !args.policies && !args.lessons) {
    flags.profile = true;
    flags.policies = true;
    flags.lessons = true;
  }

  const { context, meta } = runCompose(taskId, flags);

  // Build the final spawn message
  const separator = '\n\n--- 以上为系统注入的任务上下文，以下为具体任务指令 ---\n\n';
  const fullMessage = context + separator + (finalTaskText || `执行任务: ${taskInfo.goal}`);

  const result = {
    ok: true,
    task_id: taskId,
    zones_populated: meta.zones_populated || [],
    estimated_context_tokens: meta.estimated_tokens || 0,
    task_text_length: finalTaskText.length,
    full_message: fullMessage,
    // For direct use in sessions_spawn sessions_spawn task:
    spawn_task: fullMessage,
  };

  console.log(JSON.stringify(result, null, 2));
}

function cmdListTasks() {
  const taskState = loadTaskState();
  if (!taskState || !taskState.tasks) {
    console.log(JSON.stringify({ ok: true, tasks: [], hint: 'task-state.json 为空或不存在' }));
    return;
  }

  const tasks = Object.entries(taskState.tasks).map(([id, t]) => ({
    id,
    goal: t.goal,
    status: t.status,
    active_since: t.created_since || t.created_at,
    constraints_count: t.constraints ? Object.keys(t.constraints).length : 0,
    open_questions: t.open_questions?.length || 0,
  }));

  console.log(JSON.stringify({ ok: true, count: tasks.length, tasks }, null, 2));
}

// === ARGS ===
const rawArgs = process.argv.slice(2);
const cmd = rawArgs[0];
const args = { _: [] };

for (let i = 1; i < rawArgs.length; i++) {
  if (rawArgs[i].startsWith('--')) {
    const key = rawArgs[i].replace('--', '');
    if (i + 1 < rawArgs.length && !rawArgs[i + 1].startsWith('--')) {
      args[key] = rawArgs[i + 1];
      i++;
    } else {
      args[key] = true;
    }
  } else {
    args._.push(rawArgs[i]);
  }
}

switch (cmd) {
  case 'build': return cmdBuild(args);
  case 'list-tasks': return cmdListTasks();
  default:
    console.log('spawn-template.js v1.0 — 子Agent spawn任务模板组装器');
    console.log('  build --task-id <id> [--task-text "<原文>"] [--profile] [--policies] [--lessons]');
    console.log('       生成带分区上下文的任务消息（可直接用于 sessions_spawn）');
    console.log('  list-tasks  列出所有注册任务');
    console.log('');
    console.log('  使用示例:');
    console.log('    # 1. 生成任务模板');
    console.log('    node spawn-template.js build --task-id novel-ch1-rewrite-v3 --task-text "写异兽学院第1章"');
    console.log('    # 2. 复制 spawn_task 字段，传入 sessions_spawn');
    process.exit(0);
}
