#!/usr/bin/env node
// 命令行入口
// 用法: node src/cli.mjs <command> [参数] [--json] [--quiet] [--tts]
import { OmniSense } from './index.mjs';
import { log } from './core/logger.mjs';
import { writeFileSync } from 'node:fs';

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
        console.log(`      能力: ${o.methods.map(m => m.name).join(', ')}`);
      }
      console.log('\n驱动: omni.body.eye/ear/mouth/brain/hand/perceive/foot(...)');
      console.log('生命循环: omni.live({ ticks, useLLM, speak }) 或 `omni live`\n');
      break;
    }
    case 'card': {
      // A2A 风格 Agent Card：把身体全部能力扁平化为 skills[]，供多智能体工作区做能力发现与委派
      const card = omni.agentCard();
      if (jsonMode) { result = card; break; }
      console.log('\n🪪 OmniSense Agent Card（A2A 风格能力自描述）');
      console.log(`  名称: ${card.name} | 版本: ${card.version} | 技能数: ${card.skills.length}`);
      console.log(`  描述: ${card.description}`);
      console.log('  技能:');
      for (const s of card.skills) console.log(`   · ${s.id}  ${s.net ? '(联网)' : '(离线)'}  ${s.description}`);
      console.log('\n能力发现: 多智能体工作区可依据 skills[].id / tags / net 委派任务（omni.agentCard()）。\n');
      break;
    }
    case 'live': {
      const ticks = Number((rest.find(a => /^--ticks=(\d+)$/.test(a)) || '').split('=')[1]) || 3;
      const interval = Number((rest.find(a => /^--interval=(\d+)$/.test(a)) || '').split('=')[1]) || 0;
      const useLLM = flag('--llm');
      const speak = flag('--speak');
      const allowShell = flag('--allow-shell');
      // 默认：每拍由身体自身能力卡自主决策（autopilot 自驱，借鉴 Stanford Generative Agents 持续自驱生命周期）；
      // --no-autopilot 回到写死步骤；--no-dynamic/--dynamic 控制动态议程重排（仅 autopilot 路径生效）。
      const autopilotMode = !flag('--no-autopilot');
      const dynamic = rest.includes('--no-dynamic') ? false : (rest.includes('--dynamic') ? true : undefined);
      log.info(`[live] 启动生命循环: ${ticks} 轮, 间隔 ${interval}s, 模型=${useLLM ? '在线' : '离线'}, 说话=${speak}, shell=${allowShell}, 自驱=${autopilotMode ? 'autopilot' : 'legacy'}`);
      result = await omni.live({ ticks, intervalMs: interval * 1000, useLLM, speak, allowShell, autopilot: autopilotMode, dynamic });
      if (!jsonMode) {
        console.log('\n═══ 生命循环结果（' + (result.mode === 'live(autopilot)' ? 'autopilot 自驱 · 借鉴 Stanford Generative Agents 持续自驱生命周期' : 'legacy 写死步骤') + '）═══');
        for (const t of (result.trace || [])) {
          const topicN = t.perceive?.topicCount ?? 0;
          if (t.executed) {
            const w = t.agendaWeights ? ` | 权重[${t.agendaWeights.map(q => q.w.toFixed(2)).join(',')}]` : '';
            console.log(`· tick ${t.tick}: 感知 ${topicN} 话题 | 委派 ${t.executed}${t.fallback ? ` (降级:${t.fallback})` : ''}${w}`);
          } else {
            console.log(`· tick ${t.tick}: 感知 ${topicN} 话题 | 行动 ${t.act?.completed ? '✓' : '✗'}`);
          }
        }
      }
      break;
    }
    case 'autopilot': {
      const ticks = Number((rest.find(a => /^--ticks=(\d+)$/.test(a)) || '').split('=')[1]) || 3;
      const interval = Number((rest.find(a => /^--interval=(\d+)$/.test(a)) || '').split('=')[1]) || 0;
      const useLLM = flag('--llm');
      const allowShell = flag('--allow-shell');
      const dynamic = !flag('--no-dynamic'); // 默认开启动态议程重排（据结果调权）；--no-dynamic 尊重用户顺序
      const recordTrace = rest.includes('--trace') ? true : (rest.includes('--no-trace') ? false : false); // 默认不记录（显式 --trace 开启可观测性闭环）
      log.info(`[autopilot] 启动自主循环: ${ticks} 轮, 间隔 ${interval}s, 模型=${useLLM ? '在线' : '离线'}, shell=${allowShell}, 动态议程=${dynamic ? '开' : '关'}${recordTrace ? ', 记录轨迹' : ''}`);
      result = await omni.autopilot({ ticks, intervalMs: interval * 1000, useLLM, allowShell, dynamic, recordTrace });
      if (!jsonMode) {
        console.log('\n═══ 自主循环结果（身体自驱决策 · 借鉴 BabyAGI 自生成任务队列 · 结果驱动重排）═══');
        for (const t of (result.trace || [])) {
          const w = t.agendaWeights ? ` | 权重[${t.agendaWeights.map(q => q.w.toFixed(2)).join(',')}]` : '';
          console.log(`· tick ${t.tick}: 意图「${t.intent}」 → 委派 ${t.executed}${t.fallback ? ` (降级:${t.fallback})` : ' (基于能力卡)'}${w}`);
        }
      }
      break;
    }
    case 'sense': result = omni.sense(); break;
    case 'dispatch': {
      // 技能匹配与委派：基于 Agent Card 的能力发现闭环
      const goal = rest.filter(a => !a.startsWith('--')).join(' ').trim();
      const detail = flag('--detail');
      if (!goal) { console.log('用法: node src/cli.mjs dispatch "<目标>" [--detail] [--json]'); process.exitCode = 1; break; }
      // 先展示匹配到的候选技能
      const resolved = omni.skillResolve(goal);
      if (resolved.length === 0) {
        result = { ok: false, error: '未匹配到任何可用技能。试试更具体的目标：计算/搜索/思考/看热搜/写文件/读文件/…' };
        if (!jsonMode) console.log(`[dispatch] ${result.error}`);
        break;
      }
      if (!jsonMode) {
        console.log(`\n[dispatch] 目标: "${goal}"`);
        console.log(`[dispatch] 技能匹配 (top-${resolved.length}):`);
        for (const s of resolved) console.log(`  · ${s.skill.id}  (评分 ${s.score})  → 匹配词: ${s.matched.join(', ')}`);
      }
      if (detail) { result = { ok: true, goal, candidates: resolved }; break; }
      // 自动委派到最佳技能
      const dispatchResult = await omni.skillDispatch(goal);
      if (!dispatchResult.resolved) {
        result = { ok: false, goal, error: dispatchResult.error };
        if (!jsonMode) console.log(`[dispatch] × ${dispatchResult.error}`);
        break;
      }
      if (dispatchResult.needsJsonArgs) {
        const skill = dispatchResult.resolvedSkill;
        result = { ok: false, goal, resolved: true, skill, prompt: dispatchResult.prompt, candidates: dispatchResult.candidates };
        if (!jsonMode) {
          console.log(`[dispatch] 最佳匹配: ${skill.id} (评分 ${skill.score})`);
          console.log(`[dispatch] ${dispatchResult.prompt}`);
          console.log(`[dispatch] 候选技能:`);
          for (const c of dispatchResult.candidates) console.log(`  · ${c.skill.id} (评分 ${c.score})`);
        }
        break;
      }
      result = { ok: true, goal, skill: dispatchResult.resolvedSkill, result: dispatchResult.result };
      if (!jsonMode) console.log(`[dispatch] ✓ 已委派至 ${dispatchResult.resolvedSkill.id} (评分 ${dispatchResult.resolvedSkill.score})`);
      break;
    }
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
      const useLLM = flag('--llm');
      const agentEnabled = flag('--agent');
      const agentCooldown = Number((rest.find(a => /^--agent-cooldown=(\d+)$/.test(a)) || '').split('=')[1]) || 60;
      const agentGoal = (rest.find(a => /^--agent-goal=/.test(a)) || '').split('=')[1] || undefined;
      const agentMode = (rest.find(a => /^--agent-mode=/.test(a)) || '').split('=')[1] || 'remember';
      const summarizeNew = flag('--summarize-new');
      const autopilotEnabled = flag('--autopilot');
      const autopilotDynamic = rest.includes('--no-dynamic') ? false : (rest.includes('--dynamic') ? true : undefined);
      const autopilotAgenda = (rest.find(a => /^--autopilot-agenda=/.test(a)) || '').split('=')[1] || undefined;
      // --trace / --no-trace：常驻自驱身体每 tick 自驱决策是否记录为可回放 trace（可观测性闭环；默认跟随 autopilot）
      const apTrace = rest.includes('--trace') ? true : (rest.includes('--no-trace') ? false : undefined);
      log.info(`[watch] 启动常驻感知循环: 间隔 ${interval}s, 最大 ${max === Infinity ? '∞' : max} 次, 思考=${enableThink}, 落盘=${out}, 自主编排=${agentEnabled}(模式=${agentMode} 冷却${agentCooldown}s) 摘要新增=${summarizeNew} 常驻自驱身体=${autopilotEnabled}${apTrace ? ` 记录轨迹=${apTrace}` : ''}`);
      result = await omni.watch({ interval: interval * 1000, maxTicks: max, enableThink, outFile: out, rememberLatest: remember, agent: agentEnabled, agentCooldownMs: agentCooldown * 1000, agentGoal, agentMode, summarizeNew, autopilot: autopilotEnabled, autopilotTicks: 1, autopilotDynamic, autopilotAgenda: autopilotAgenda ? autopilotAgenda.split(',').map(s => s.trim()).filter(Boolean) : undefined, autopilotRecordTrace: apTrace, autopilotUseLLM: useLLM });
      log.info('[watch] 循环结束。');
      break;
    }
    case 'trace': {
      // Agent 执行轨迹追踪：默认汇总；--list 列表；--get=<id> 回放；--clear 清空；
      // 新增回放对比/检索/导出/回归门禁：--diff=<a>,<b> / --find="<goal>" / --export=<file> / --baseline=<id> / --regression
      const limit = Number((rest.find(a => /^--limit=/.test(a)) || '').split('=')[1]) || 10;
      const engine = (rest.find(a => /^--engine=/.test(a)) || '').split('=')[1] || undefined;
      const get = (rest.find(a => /^--get=/.test(a)) || '').split('=')[1];
      const has = (f) => rest.some(a => a.startsWith(f));
      const val = (f, d) => { const m = rest.find(a => a.startsWith(f)); return m ? m.split('=')[1] : d; };
      const diff = val('--diff=', '');
      const findGoal = val('--find=', '');
      const exportPath = val('--export=', '');
      const exportFormat = val('--export-format=', 'json');
      const baseline = val('--baseline=', '');
      if (flag('--clear')) { result = omni.clearTraces(); break; }
      if (get) { result = omni.getTrace(get); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (has('--diff=')) {
        const [a, b] = diff.split(',').map(s => s.trim());
        result = omni.compareTraces(a, b);
        if (result.ok && !jsonMode) {
          console.log(`\n🔬 Trace 回放对比 (${a} ↔ ${b})`);
          console.log(`  A: ${result.a.goal} | 引擎 ${result.a.engine} | 完成 ${result.a.completed} | ${result.a.stepCount} 步 | ${result.a.durationMs}ms`);
          console.log(`  B: ${result.b.goal} | 引擎 ${result.b.engine} | 完成 ${result.b.completed} | ${result.b.stepCount} 步 | ${result.b.durationMs}ms`);
          console.log(`  差异数: ${result.divergenceCount} | 首次分歧: ${result.firstDivergence ?? '无'} | 判定: ${result.verdict}`);
          if (result.divergences.length) {
            console.log('  分歧明细:');
            for (const d of result.divergences) {
              const extra = (d.actionA ? ` A=${d.actionA}` : '') + (d.actionB ? ` B=${d.actionB}` : '');
              console.log(`   · 第 ${d.step} 步 [${d.type}]${extra}`);
            }
          }
        }
        if (result.ok && result.verdict === 'regressed') process.exitCode = 1; // 回归即非零退出（CI 门禁）
        break;
      }
      if (has('--find=')) {
        result = omni.findTracesByGoal(findGoal, { limit });
        if (!jsonMode) {
          console.log(`\n🔍 同目标「${findGoal}」的运行 (${result.length} 条):`);
          for (const r of result) console.log(`  · ${r.runId} 完成=${r.completed} 引擎=${r.engine} ${r.stepCount}步 ${r.durationMs}ms`);
        }
        break;
      }
      if (has('--export=')) {
        result = omni.exportTraceDataset({ path: exportPath === '-' ? undefined : exportPath, format: exportFormat, goal: has('--find=') ? findGoal : undefined, limit });
        if (!jsonMode) console.log(`\n📤 导出轨迹(${result.format}): ${result.count} 条 → ${result.path || 'stdout'}`);
        break;
      }
      if (has('--baseline=')) {
        result = omni.setTraceBaseline(baseline);
        if (!jsonMode) console.log(result.ok ? `✓ 已设置基线: ${result.runId} (${result.goal})` : `× ${result.error}`);
        break;
      }
      if (flag('--regression')) {
        result = omni.traceRegression();
        if (result.ok && !jsonMode) console.log(`\n🚦 回归门禁: ${result.passed ? 'PASS' : 'FAIL'} (基线 ${result.baseline} ↔ 当前 ${result.current} | 判定 ${result.verdict} | 差异 ${result.divergenceCount}${result.firstDivergence ? ' @第' + result.firstDivergence + '步' : ''})`);
        if (result.ok && !result.passed) process.exitCode = 1;
        break;
      }
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
    case 'cache': {
      // 工具级缓存/熔断状态（web_fetch/summarize_url/hot_topics 命中缓存直接返回、避免重复联网；持续失败熔断防反复超时）
      if (flag('--clear')) { result = omni.clearToolCache(); if (!jsonMode) console.log(JSON.stringify(result)); break; }
      result = { cache: omni.toolCacheStats(), breakers: omni.toolBreakerStatus() };
      if (!jsonMode) {
        console.log('\n🔧 工具级缓存 / 熔断状态（复用 breaker 基础设施 · 扩展到 Agent 工具调用）');
        console.log('  缓存条目:', result.cache.size);
        if (result.cache.keys.length) console.log('   · ' + result.cache.keys.slice(0, 12).join('\n   · '));
        const triggered = result.breakers.filter(b => b.fails > 0);
        console.log('  熔断器:', result.breakers.length ? result.breakers.map(b => `${b.name}(open=${b.open},fails=${b.fails}/${b.maxFails})`).join('  ') : '（均未触发）');
        if (triggered.length) console.log('  ⚠ 已触发熔断的工具:', triggered.map(b => b.name).join(', '));
      }
      break;
    }
    case 'monitor': {
      // 监控器官：统一状态快照 / Agent 健康 / 多种状态检测告警 / 延迟 / 状态网格 / 记忆健康 / 异常
      // --config-file=<path>：从 JSON 文件加载阈值配置（Observability-as-Code，优先级低于环境变量）
      const cfgFile = (rest.find(a => /^--config-file=/.test(a)) || '').split('=')[1];
      if (cfgFile) omni.monitor.loadConfigFile(cfgFile);
      const asAlerts = flag('--alerts');
      const asHealth = flag('--health');
      const asLatency = flag('--latency');
      const asGrid = flag('--grid');
      const asMemory = flag('--memory');
      const asAnomalies = flag('--anomalies');
      const asRuns = flag('--runs');
      const asTools = flag('--tools');
      const asTrends = flag('--trends');
      const asConfig = flag('--config');
      const asThresholdHealth = flag('--threshold-health');
      const asThresholdAlerts = flag('--threshold-alerts');
      if (asConfig) { result = omni.monitor.config(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asThresholdHealth) { result = omni.monitor.thresholdHealth(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asThresholdAlerts) { result = omni.monitor.thresholdAlerts(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asAlerts) { result = omni.monitor.alerts(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asTools) { result = omni.monitor.toolHealth(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asTrends) { result = omni.monitor.trends(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asHealth) { result = omni.monitor.agentHealth(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asLatency) { result = omni.monitor.latencyStats(omni.monitor._tracerRuns ? omni.monitor._tracerRuns() : undefined); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asGrid) { result = omni.monitor.statusGrid(omni.monitor._tracerRuns ? omni.monitor._tracerRuns() : undefined); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asMemory) { result = omni.monitor.memoryHealth(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asAnomalies) { result = omni.monitor.detectAnomalies(); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      if (asRuns) { result = omni.monitor.recentRuns(12); if (!jsonMode) console.log(JSON.stringify(result, null, 2)); break; }
      result = omni.monitor.snapshot();
      if (!jsonMode) console.log(JSON.stringify(result, null, 2));
      break;
    }
    case 'dashboard': {
      // 生成零依赖静态 HTML 仪表盘（可视化 Agent 状态/记忆/活动/告警）
      const out = (rest.find(a => /^--out=/.test(a)) || '').split('=')[1] || './.omni-dashboard.html';
      const html = omni.monitor.renderDashboard();
      try { writeFileSync(out, html, 'utf8'); } catch (e) { console.error('仪表盘写盘失败:', e.message); process.exitCode = 1; break; }
      result = { ok: true, out, bytes: html.length };
      if (!jsonMode) console.log(`📊 监控仪表盘已生成: ${out} (${html.length} bytes)\n用浏览器打开即可查看 Agent 状态/记忆/活动/告警可视化。`);
      break;
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
  card                打印 A2A 风格 Agent Card（七器官能力扁平化为 skills[]，供多智能体工作区发现与委派）
  live [--ticks=3] [--interval=0] [--llm] [--speak] [--allow-shell] [--no-autopilot] [--no-dynamic]   生命循环：身体每拍用自身能力卡自主决策（autopilot 自驱，像真人一样活着；默认）；--no-autopilot 回到写死步骤（感知→思考→动手→说话→移动）
  autopilot [--ticks=3] [--interval=0] [--llm] [--allow-shell] [--no-dynamic]   自主循环：身体用自身能力卡 skillResolve 自己决定每轮做什么并离线执行（借鉴 BabyAGI 自生成任务队列；默认动态议程——每轮结果回写议程、据结果重排下一步；--no-dynamic 关闭重排、尊重用户顺序）
  search "<关键词>" [--topK=20] [--diversity=0]   深度语义检索记忆(BM25+时间衰减+复用权重; --diversity 0~1 开启 MMR 去冗余)
  dispatch "<目标>" [--detail]   技能匹配与自动委派：基于 Agent Card 能力卡找到最佳器官/方法并执行（纯关键词匹配，零外部依赖）；--detail 仅展示不执行
  watch [--interval=60] [--max=∞] [--think] [--out=./.omni-watch.json] [--remember] [--agent] [--agent-mode=remember|alert|digest] [--agent-cooldown=60] [--agent-goal=<模板>] [--summarize-new] [--autopilot] [--autopilot-agenda="a,b,c"]   常驻感知循环；--agent 开启"变化即行动"自主编排(差异检测+多模式)；--autopilot 升级为"常驻自驱身体"：每 tick 由身体自身能力卡自主决策并离线执行(像真人一样活着，借鉴 OpenClaw 心跳闭环/Sophia System3)；--summarize-new 对新增热点联网抓 URL 并摘要(写进 digest)
  cache [--clear]      工具级缓存/熔断状态（web_fetch/summarize_url/hot_topics 命中缓存直接返回、避免重复联网；持续失败熔断防反复超时）
  monitor [--alerts|--health|--latency|--grid|--memory|--anomalies|--runs|--tools|--trends|--config|--threshold-health] [--config-file=<path>]   监控器官：统一状态快照 / --alerts 统一告警(含异常) / --health Agent健康 / --latency P50/P95/P99 / --grid 引擎状态网格 / --memory 记忆健康 / --anomalies 异常检测 / --runs 运行时间线 / --tools 工具管线健康(缓存/熔断/工具级延迟) / --trends 随时间变化的指标趋势基线(sparkline) / --config 生效的告警阈值配置(值/来源/环境变量名/配置文件路径，可用 OMNI_MONITOR_* 或 ~/.omnisense/monitor.json 覆盖) / --threshold-health 当前测量值 vs 阈值 红黄绿着色(ok/warn/over/na) / --config-file=<path> 从指定 JSON 文件加载阈值(Observability-as-Code)
  dashboard [--out=./.omni-dashboard.html]   生成零依赖可视化 HTML 仪表盘(Agent状态/记忆四层/活动/告警)，浏览器打开即看
  serve [port]         启动本地 HTTP 驱动服务(127.0.0.1)，供外部门户驱动能力(设 OMNI_TOKEN 即启用 Bearer 鉴权)
  trace [--summary] [--list] [--get=<id>] [--engine=llm|local|dispatcher] [--limit=10] [--clear]   Agent 执行轨迹追踪(可回放 trace：成功率/平均步数·耗时/工具级耗时/错误归类)
  trace --diff=<idA>,<idB>          回放对比两次运行，定位行为首次分歧点(verdict: identical/similar/improved/regressed；regressed 退出码 1)
  trace --find="<目标>" [--limit=10] 按目标检索历史运行(同目标多次运行对比前提)
  trace --export=<file|-> [--export-format=json|jsonl|otlp] [--find="<目标>"] [--limit=10]   导出轨迹(json/jsonl 回归数据集 或 otlp OTLP/JSON 直投 Grafana Tempo/Phoenix/Jaeger；- 表示 stdout)
  trace --baseline=<id>             把某次 run 固定为基线(落盘 .omni-traces.json.baseline)
  trace --regression                回归门禁：用基线对比最新 run，退化则退出码 1(可接 CI)
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
  --autopilot           watch 升级为"常驻自驱身体"：每 tick 由身体自身能力卡自主决策并离线执行(脚不再只巡逻，而是持续自我驱动的活身体；借鉴 OpenClaw 心跳闭环/Sophia System3 持久自驱层)；可与 --agent 同开(互补)
  --autopilot-agenda=<逗号分隔>   watch --autopilot 自定义自驱议程(如 "思考当前环境,规划下一步")；不传用身体默认离线议程
  --no-dynamic / --dynamic   watch --autopilot 控制动态议程重排(默认议程开启动态、自定义议程尊重顺序)

所有抓取均本机真实联网、零 key；文本推理免 key 双模式（框架网关 / 运行体驱动）。
serve 安全：仅监听 127.0.0.1；设 OMNI_TOKEN 环境变量后要求 Authorization: Bearer <token>，切勿用 -h 0.0.0.0 或端口转发暴露公网。
日志级别: 环境变量 OMNI_LOG_LEVEL=trace|debug|info|warn|error|silent。`;

main().then(() => { if (cmd !== 'serve') process.exit(process.exitCode || 0); })
  .catch(e => { console.error('错误:', e.message); process.exit(1); });
