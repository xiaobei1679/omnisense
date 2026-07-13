#!/usr/bin/env node
// 命令行入口
// 用法: node src/cli.mjs <command> [参数] [--json] [--quiet] [--tts]
import { OmniSense } from './index.mjs';
import { log } from './core/logger.mjs';

const omni = OmniSense.create();
const args = process.argv.slice(2);
const cmd = args[0];
const rest = args.slice(1);
// 文本类命令：拼接参数时剔除全局旗标（--json/--quiet/--tts 等），避免污染内容
const textOf = (r) => r.filter(a => !a.startsWith('--')).join(' ');
const flag = (f) => args.includes(f);
const jsonMode = flag('--json');
const quietMode = flag('--quiet');
if (jsonMode || quietMode) log.setLevel('error'); // 结构化输出/静默时关闭过程日志

async function main() {
  let result;
  switch (cmd) {
    case 'demo': await omni.demo(); break;
    case 'status':
      result = await omni.status();
      if (!jsonMode) console.log(JSON.stringify(result, null, 2));
      break;
    case 'hot': result = await omni.seeHotTopics(rest[0] || 'bilibili'); omni.sense(); break;
    case 'all': result = await omni.seeHotAll(); omni.sense(); break;
    case 'see': result = await omni.seeWebsite(rest[0]); omni.sense(); break;
    case 'summarize': result = await omni.summarizeWebsite(rest[0]); break;
    case 'plan': result = omni.plan(textOf(rest)); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break;
    case 'image': result = await omni.seeImage(rest[0]); break;
    case 'video': result = await omni.watchVideo(rest[0]); break;
    case 'hear': result = await omni.hearAudio(rest[0]); break;
    case 'novel': result = await omni.hearNovel(textOf(rest)); break;
    case 'feedback': result = await omni.listenFeedback(textOf(rest)); break;
    case 'speak': result = await omni.speak(textOf(rest), { tts: flag('--tts') }); break;
    case 'opinion': result = await omni.giveOpinion(textOf(rest)); break;
    case 'think': result = await omni.think(textOf(rest)); break;
    case 'agent': {
      // 目标文本不包含命令行旗标（--max/--no-llm/--allow-shell）
      const goal = rest.filter(a => !a.startsWith('--')).join(' ').trim();
      const max = Number((rest.find(a => /^--max=(\d+)$/.test(a)) || '').split('=')[1]) || 8;
      const useLLM = !flag('--no-llm');
      const allowShell = flag('--allow-shell');
      const doReflect = !flag('--no-reflect');
      if (!goal) { console.log('用法: node src/cli.mjs agent "<目标>" [--max=8] [--no-llm] [--allow-shell] [--no-reflect]'); process.exitCode = 1; break; }
      log.info(`[agent] 目标: ${goal} | maxSteps=${max} | useLLM=${useLLM} | shell=${allowShell} | reflect=${doReflect}`);
      result = await omni.act(goal, { maxSteps: max, useLLM, allowShell, reflect: doReflect });
      if (!jsonMode) {
        console.log('\n═══ Agent 执行结果 ═══');
        console.log('目标  :', goal);
        console.log('完成  :', result.completed, '| 用模型:', result.usedLLM, '| 复用:', result.reused, '| 相似度:', result.playbookScore, '| 经验召回:', (result.experienceHints?.length || 0), '| 步数:', result.steps.length);
        const refl = result.reflection;
        if (refl?.enabled) console.log('反思  :', `模式=${refl.mode}${refl.fallback ? '(模型失败已退回离线)' : ''} | 教训 ${refl.lessons?.length || 0} 条${refl.note ? ' (已写入记忆)' : ''}`);
        console.log('结果  :\n' + String(result.result || '').slice(0, 1200));
      }
      break;
    }
    case 'multiagent': {
      const goal = rest.filter(a => !a.startsWith('--')).join(' ').trim();
      const rolesRaw = (rest.find(a => /^--roles=/.test(a)) || '').split('=')[1];
      const roles = rolesRaw ? rolesRaw.split(',').map(s => s.trim()).filter(Boolean) : undefined;
      const useLLM = !flag('--no-llm');
      const allowShell = flag('--allow-shell');
      const parallel = !flag('--no-parallel');
      const coordinator = flag('--coordinator') ? true : undefined;
      if (!goal) { console.log('用法: node src/cli.mjs multiagent "<目标>" [--roles=researcher,analyst,writer] [--no-llm] [--no-parallel] [--coordinator] [--allow-shell]'); process.exitCode = 1; break; }
      log.info(`[multiagent] 目标: ${goal} | roles=${roles || '默认全部'} | useLLM=${useLLM} | parallel=${parallel} | coordinator=${coordinator ? 'LLM' : '确定性'}`);
      result = await omni.multiAgent(goal, { roles, useLLM, allowShell, parallel, coordinator });
      if (!jsonMode) {
        console.log('\n═══ 多 Agent 协作结果 ═══');
        console.log('目标  :', goal);
        console.log('完成  :', result.completed, '| 全部完成:', result.allCompleted, '| 用模型:', result.usedLLM, '| 子任务:', result.subtasks.length);
        console.log('并行  :', result.parallelWorkers, 'worker | 批次:', result.batches, '| 协调器:', result.coordinatorMode);
        for (const s of result.subtasks) console.log(` · [${s.role}] ${s.goal} → ${s.completed ? '✓ 完成' : '✗ 失败'}${s.reused ? ' (复用)' : ''}`);
        console.log('综合  :\n' + String(result.result || '').slice(0, 1200));
      }
      break;
    }
    case 'body': {
      // 打印七器官（像真人一样的身体自检）
      const organs = omni.organs;
      if (jsonMode) { result = organs; break; }
      console.log('\n🧍 OmniSense 身体：七种器官（像真人一样）');
      for (const o of organs) {
        console.log(`  ${o.name} (${o.key})  ${o.module}.mjs`);
        console.log(`      ${o.desc}`);
        console.log(`      能力: ${o.methods.join(', ')}`);
      }
      console.log('\n驱动: omni.body.eye/ear/mouth/brain/hand/perceive/foot(...)');
      console.log('生命循环: omni.live({ ticks, useLLM, speak }) 或 `omni live`\n');
      break;
    }
    case 'live': {
      const ticks = Number((rest.find(a => /^--ticks=(\d+)$/.test(a)) || '').split('=')[1]) || 3;
      const interval = Number((rest.find(a => /^--interval=(\d+)$/.test(a)) || '').split('=')[1]) || 0;
      const useLLM = flag('--llm');
      const speak = flag('--speak');
      const allowShell = flag('--allow-shell');
      log.info(`[live] 启动生命循环: ${ticks} 轮, 间隔 ${interval}s, 模型=${useLLM ? '在线' : '离线'}, 说话=${speak}, shell=${allowShell}`);
      result = await omni.live({ ticks, intervalMs: interval * 1000, useLLM, speak, allowShell });
      if (!jsonMode) console.log('\n═══ 生命循环结果 ═══\n' + (result.trace || []).map(t => `· tick ${t.tick}: 感知 ${t.perceive?.topicCount ?? 0} 话题 | 行动 ${t.act?.completed ? '✓' : '✗'}`).join('\n'));
      break;
    }
    case 'sense': result = omni.sense(); break;
    case 'search': {
      const diversity = Number((rest.find(a => /^--diversity=/.test(a)) || '').split('=')[1]) || 0;
      const topK = Number((rest.find(a => /^--topK=/.test(a)) || '').split('=')[1]) || 20;
      const q = textOf(rest);
      result = omni.search(q, { topK, diversity });
      if (!jsonMode) console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'watch': {
      const interval = Number((rest.find(a => /^--interval=(\d+)$/.test(a)) || '').split('=')[1]) || 60;
      const max = Number((rest.find(a => /^--max=(\d+)$/.test(a)) || '').split('=')[1]) || Infinity;
      const out = (rest.find(a => /^--out=/.test(a)) || '').split('=')[1] || './.omni-watch.json';
      const enableThink = flag('--think');
      const remember = flag('--remember');
      const agentEnabled = flag('--agent');
      const agentCooldown = Number((rest.find(a => /^--agent-cooldown=(\d+)$/.test(a)) || '').split('=')[1]) || 60;
      const agentGoal = (rest.find(a => /^--agent-goal=/.test(a)) || '').split('=')[1] || undefined;
      const agentMode = (rest.find(a => /^--agent-mode=/.test(a)) || '').split('=')[1] || 'remember';
      const summarizeNew = flag('--summarize-new');
      log.info(`[watch] 启动常驻感知循环: 间隔 ${interval}s, 最大 ${max === Infinity ? '∞' : max} 次, 思考=${enableThink}, 落盘=${out}, 自主编排=${agentEnabled}(模式=${agentMode} 冷却${agentCooldown}s) 摘要新增=${summarizeNew}`);
      result = await omni.watch({ interval: interval * 1000, maxTicks: max, enableThink, outFile: out, rememberLatest: remember, agent: agentEnabled, agentCooldownMs: agentCooldown * 1000, agentGoal, agentMode, summarizeNew });
      log.info('[watch] 循环结束。');
      break;
    }
    case 'trace': {
      // Agent 执行轨迹追踪：默认汇总；--list 列表；--get=<id> 回放；--clear 清空
      const limit = Number((rest.find(a => /^--limit=/.test(a)) || '').split('=')[1]) || 10;
      const engine = (rest.find(a => /^--engine=/.test(a)) || '').split('=')[1] || undefined;
      const get = (rest.find(a => /^--get=/.test(a)) || '').split('=')[1];
      if (flag('--clear')) { result = omni.clearTraces(); break; }
      if (get) { result = omni.getTrace(get); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (flag('--list')) { result = omni.traces({ limit, engine }); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      result = omni.traceSummary();
      if (!jsonMode) console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'serve': {
      const { startServer } = await import('./server.mjs');
      const port = Number(rest.find(a => /^\d+$/.test(a))) || 8787;
      startServer(omni, { port });
      if (process.env.OMNI_TOKEN) log.info('[serve] Bearer 鉴权已启用（OMNI_TOKEN 已设置）。按 Ctrl+C 停止。');
      else log.warn('[serve] 无鉴权模式（仅本机）。按 Ctrl+C 停止。切勿暴露公网。');
      return; // 不退出，保持事件循环
    }
    case 'help':
    case undefined:
      console.log(USAGE); return;
    default:
      console.log('未知命令:', cmd, '\n' + USAGE); process.exitCode = 1; return;
  }
  if (jsonMode && result != null) console.log('\n__OMNI_RESULT__\n' + JSON.stringify(result, null, 2));
}

const USAGE = `OmniSense 命令行
用法: node src/cli.mjs <command> [参数] [--json] [--quiet] [--tts]

  demo                 真实联网演示（多平台热搜聚合 + 网站 + 思考 + 决策 + 规划）
  status               查看模型后端与能力（--json 输出结构化）
  hot [源]             看单平台热搜(默认 bilibili；源: bilibili/toutiao/weibo/baidu/douyin/hongguo/zhihu/weixin/bangumi)
  all                  并行聚合全部平台热搜(去重 + 跨平台频次排序，带 TTL 缓存)
  see <url>            看一个网站
  summarize <url>      抓取并用模型摘要网页（需网关/外部 LLM）
  image <url>          看图（agent 模式落本地由运行体读图 / 网关模式走 VLM）
  video <url>          看视频(yt-dlp 元数据)
  hear <file|url>      听音频(ASR 转写)
  novel "<文本>"       听小说(TTS 朗读)
  feedback "<文本>"    听用户意见
  speak "<文本>"       说话(--tts 出声)
  opinion "<话题>"     给意见
  think "<目标>"       大脑思考
  agent "<目标>"       行动：Agent 推理闭环真正执行目标(联网抓取/读写文件/计算/查记忆/热搜…)，有模型走 ReAct、无模型走本地规划器 [--max=8] [--no-llm] [--allow-shell] [--no-reflect]
  multiagent "<目标>"  多 Agent 协作：协调器把目标拆成角色子任务(researcher/analyst/writer/critic)，独立子任务并行执行、共享黑板、协调器综合产出；有在线模型时走 LLM 智能拆解子任务，否则离线拆解 [--roles=researcher,analyst,writer] [--no-llm] [--no-parallel] [--coordinator] [--allow-shell]
  plan "<目标>"        基于当前感知给出下一步行动建议（离线）
  sense                聚合近期感知为环境模型
  body                自检身体：打印七种器官（眼/耳/嘴/脑/手/感知/脚）及各自能力
  live [--ticks=3] [--interval=0] [--llm] [--speak] [--allow-shell]   生命循环：自驱地「感知→思考→动手→说话→移动」，像真人一样活着（默认离线、有限轮次）
  search "<关键词>" [--topK=20] [--diversity=0]   深度语义检索记忆(BM25+时间衰减+复用权重; --diversity 0~1 开启 MMR 去冗余)
  watch [--interval=60] [--max=∞] [--think] [--out=./.omni-watch.json] [--remember] [--agent] [--agent-mode=remember|alert|digest] [--agent-cooldown=60] [--agent-goal=<模板>] [--summarize-new]   常驻感知循环；--agent 开启"变化即行动"自主编排(差异检测+多模式)；--summarize-new 对新增热点联网抓 URL 并摘要(写进 digest)
  serve [port]         启动本地 HTTP 驱动服务(127.0.0.1)，供外部门户驱动能力(设 OMNI_TOKEN 即启用 Bearer 鉴权)
  trace [--summary] [--list] [--get=<id>] [--engine=llm|local|dispatcher] [--limit=10] [--clear]   Agent 执行轨迹追踪(可回放 trace：成功率/平均步数·耗时/工具级耗时/错误归类)
  help                 显示本帮助

选项:
  --json   以 __OMNI_RESULT__ 包裹的结构化 JSON 输出（便于 agent 解析）
  --quiet  静默过程日志（仅错误）
  --tts    出声
  --interval=<秒>  watch 循环间隔(默认60)
  --max=<次数>     watch 最大循环次数(默认∞常驻)
  --think         watch 每轮启用在线思考(默认仅离线规划)
  --out=<文件>     watch 快照落盘路径(默认./.omni-watch.json)
  --remember      watch 把最新一轮摘要写入记忆(lastWatch)
  --agent         watch 开启"变化即行动"自主编排：检测到热点有意义变化且过冷却，自动派发 Agent 把新热点写入记忆
  --agent-cooldown=<秒>  watch --agent 两次自主行动最小间隔(默认60，防刷)
  --agent-mode=<模式>    watch --agent 自主行动模式: remember(默认,记当前/新增/消失) | alert(仅突变触发,写告警记忆) | digest(写 markdown 摘要落盘)
  --agent-goal=<模板>     watch --agent 自定义目标模板，可用 {date}{top3}{topics}{added}{removed}{count} 占位(覆盖默认模式目标)

所有抓取均本机真实联网、零 key；文本推理免 key 双模式（框架网关 / 运行体驱动）。
serve 安全：仅监听 127.0.0.1；设 OMNI_TOKEN 环境变量后要求 Authorization: Bearer <token>，切勿用 -h 0.0.0.0 或端口转发暴露公网。
日志级别: 环境变量 OMNI_LOG_LEVEL=trace|debug|info|warn|error|silent。`;

main().then(() => { if (cmd !== 'serve') process.exit(0); })
  .catch(e => { console.error('错误:', e.message); process.exit(1); });
