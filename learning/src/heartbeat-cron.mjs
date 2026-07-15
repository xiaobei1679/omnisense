// heartbeat-cron.mjs — 供 WorkBuddy「每小时自动化」调用的单周期入口。
// 只跑一次学习周期即退出（不让进程常驻），便于被调度器反复触发。
// 零 API Key：优先 git clone 公开仓库；沙箱网络受限时本地回退已策展项目。
import { EventBus } from './eventBus.mjs';
import { MemoryHub } from './memoryHub.mjs';
import { MouthModule } from './modules/mouth.mjs';
import { Heartbeat } from './heartbeat.mjs';

// 保留 memory.json：让每小时运行之间持续累积学习与记忆（真正"持续成长"）。
// 仅当 ZW_RESET=1 时才从干净记忆开始（与 index.mjs 一致）。
const MEM = './memory.json';
if (process.env.ZW_RESET === '1') { try { writeFileSync(MEM, '{}'); } catch { /* 忽略 */ } }
const bus = new EventBus();
const memory = new MemoryHub(MEM);
new MouthModule(bus, memory).init();
// maxPerCycle：默认 2/周期（避免单次慢克隆阻塞整轮）；可用 MAX_PER_CYCLE 环境变量临时提高（如一次性补齐）。
const heart = new Heartbeat(bus, memory, { maxPerCycle: process.env.MAX_PER_CYCLE ? Number(process.env.MAX_PER_CYCLE) : 2 });

const learned = await heart.runOnce();
memory.persist();
console.log(`\n[心跳-cron] 完成：本周期学到 ${learned} 项，累计 ${memory.learnings.length} 项。已写入 memory.json。`);
process.exit(0);
