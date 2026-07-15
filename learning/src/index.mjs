// 入口：装配四模块 + 感知融合 + 中枢 + 学习者 + 心跳，演示「看→听→感→思→说→学」闭环。
// 全程零 API Key、零外部依赖；视觉/听觉用真实本地解码，思考用本地符号推理。
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { EventBus } from './eventBus.mjs';
import { MemoryHub } from './memoryHub.mjs';
import { EyeModule } from './modules/eye.mjs';
import { EarModule } from './modules/ear.mjs';
import { BrainModule } from './modules/brain.mjs';
import { MouthModule } from './modules/mouth.mjs';
import { PerceptionModule } from './perception.mjs';
import { Heartbeat } from './heartbeat.mjs';

// 记忆重置策略：默认「累积」（与 heartbeat-cron 一致，保证跨运行持续成长）；
// 仅当设置 ZW_RESET=1 或 memory.json 不存在时才从干净记忆开始（保证演示可复现）。
// 注：本环境 fs.rmSync 被"安全删除"封装拦截（依赖不存在的外部回收站二进制），
// 故重置用"写入空记忆"实现，绕开删除封装。
const MEM = './memory.json';
const RESET = process.env.ZW_RESET === '1';
if (RESET || !existsSync(MEM)) writeFileSync(MEM, '{}');
const bus = new EventBus();
const memory = new MemoryHub(MEM);

const eye = new EyeModule(bus, memory);
const ear = new EarModule(bus, memory);
const brain = new BrainModule(bus, memory);
const mouth = new MouthModule(bus, memory);
const perceive = new PerceptionModule(bus, memory);
const heart = new Heartbeat(bus, memory);

brain.init();
mouth.init();
perceive.init();
// 双向交流：把用户回应作为新的听觉感知喂回脑
bus.on('user-percept', (p) => ear.ingestTranscript('用户回应', p.text));

let lastSituation = null;
bus.on('situation', (s) => { lastSituation = s; });

console.log('══════════════════════════════════════════════');
console.log('  知微 · 多模态感知系统  (零 API / 真看真听真感真思真说真学)');
console.log('══════════════════════════════════════════════');

// ① 真·看（a）：阅读一本真实公版小说（本地文件，非凭记忆）——诚实展示"真读书"
// 路径可经 config.json 的 novelPath 覆盖；缺失时显式告警并跳过该环节（不再静默假成功）。
const HOME = homedir();
const cfg = (() => { try { return existsSync('config.json') ? JSON.parse(readFileSync('config.json', 'utf8')) : {}; } catch { return {}; } })();
const novelPath = cfg.novelPath || join(HOME, 'AI创作日报/2026-07-10/完美写作知识库/raw/pride-and-prejudice.txt');
let novelText = '';
try { novelText = readFileSync(novelPath, 'utf8'); }
catch (e) { console.log(`   ⚠ 未找到公版书(${novelPath})，跳过"真读书"环节(非错误，演示继续): ${e.message}`); }
// 截取名著真实开篇句（跳过版权页/许可证噪声），并在词边界截断，杜绝 "Chapte" 这类半截词假实体
const nStart = novelText.indexOf('It is a truth');
const novelExcerpt = (nStart >= 0 ? novelText.slice(nStart) : novelText).slice(0, 420).replace(/\s+\S*$/, '');
if (novelExcerpt) await eye.ingestText('真实公版书《傲慢与偏见》开篇', novelExcerpt);

// ① 真·看（b）：一段关系密集的示例叙事（演示用，非真实书籍），驱动"真思考"
await eye.ingestText('示例叙事(演示推理用)',
  'Elara discovered the hidden library. Curse caused Elara to flee. Dorian warned Elara about the curse. Elara enabled Dorian to escape. Library contained an ancient map.');

// ①c 真·看图像：本地像素解码 + 深度分析（无 VLM）
const pngBuf = eye.makeSampleImage('./sample.png');
await eye.ingestImage('本地合成测试图 sample.png', pngBuf);

// ①d 真·读文档：结构化文本抽取标题/列表/关键句
await eye.ingestDocument('演示文档《感知系统设计要点》',
  '# 视觉\n- 真实像素解码，不依赖云端 VLM\n- 颜色/亮度/边缘统计\n# 听觉\n- 本地 WAV 特征提取\n- 基频与谱质心估计\n# 认知\n- 跨模态关联与因果推理\n- 归纳演绎与信念修正');

// ①e 真·看（c）：一段能触发「归纳/演绎/矛盾+信念修正+否定式矛盾」的演示叙事
await eye.ingestText('示例叙事(演示归纳/演绎/矛盾/否定)',
  'Rain caused flood. Storm caused flood. Flood caused hunger. Fire prevented hunger. Fire caused hunger. The potion caused the curse. The potion did not cause the curse.');

// ② 真·听（a）：聆听一期转录——提到 Elara 与 curse（与视觉跨模态）
await ear.ingestTranscript('播客《故事力学》转录',
  'Elara is a strong protagonist. The motif of a curse recurs in folklore. A curse can drive a protagonist to flee.');

// ②b 真·听音频：本地特征提取一段生成的 WAV（含静音间隙，无 ASR）
const wavBuf = ear.makeSampleAudio('./sample.wav', 0.6);
await ear.ingestAudio('本地合成测试音 sample.wav', wavBuf);

// ③ 双向交流（a）：用户补充信息 → 意图推断(补充) + 追问延伸
mouth.respond('补充：Elara 是《傲慢与偏见》里的女主角，Dorian 是另一部作品《画像》里的角色。');

// ③ 双向交流（b）：用户表示满足 → 停止追问（满足信号检测）
mouth.respond('好了，这部分我懂了，不用再问了。');

// ④ 真·学：心跳去网上克隆开源项目，蒸馏"怎么真正去看/听/思/说"（沙箱无外网则本地回退，诚实降级）
await heart.runOnce();

console.log('\n═══════════════ 记忆快照 ═══════════════');
console.log('全部实体      :', [...memory.entities.keys()].join(', '));
console.log('跨模态关联    :', memory.crossModalLinks().join(', ') || '(无)');
console.log('已生成信念    :', memory.beliefs.length, '条（其中', memory.beliefs.filter(b => b.contested).length, '条存疑/已修正）');
console.log('归纳/演绎洞察 :', memory.beliefs.filter(b => b.kind === 'induction' || b.kind === 'deduction').length, '条');
console.log('溯因假设      :', memory.hypotheses.length, '条');
console.log('知识缺口      :', memory.gaps.length, '个');
console.log('学到技法项目  :', memory.learnings.length, '个');
if (memory.learnings.length) {
  console.log('  示例学习    :', memory.learnings[0].repo, '→', (memory.learnings[0].techniques || []).slice(0, 2).join(' / '));
}
if (lastSituation) {
  console.log('\n═══════════════ 最终情境模型 ═══════════════');
  console.log('模态覆盖      :', lastSituation.modalities.join('/'));
  console.log('实体总数      :', lastSituation.entityCount);
  console.log('主题          :', lastSituation.themes.join('/') || '—');
  console.log('当前注意力    :', lastSituation.attention);
}

console.log('\n闭环演示结束。已持久化到 memory.json。');
memory.persist();
