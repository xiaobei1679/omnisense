// 独立使用 OmniSense 的最小示例（不依赖 QClaw 网关）
//
// 运行：node examples/standalone.mjs
//
// 行为说明：
//   - 眼/耳 的联网抓取是真实本地执行，零 key。
//   - 若项目根目录或 src/ 下存在 .env 并配置了 LLM_BASE_URL/LLM_KEY/LLM_MODEL，
//     则脑/嘴走你配置的 OpenAI 兼容端点做真实推理。
//   - 否则自动进入 agent 模式：脑/嘴会把真实感知上下文打印出来，
//     由你的运行体 / 调用方(agent)直接思考、直接说——同样免 key。
//
// 也可强制模式：OMNI_RUNTIME=agent node examples/standalone.mjs

import { OmniSense } from '../src/index.mjs';

const omni = OmniSense.create();

// 眼：真实联网抓取热搜（零 key）
await omni.seeHotTopics('bilibili');
await omni.seeWebsite('https://example.com');

// 感知聚合：把近期感知汇总为情境
omni.sense();

// 脑：若配置了外部 LLM，则真推理；否则打印感知上下文供调用方(agent)驱动
await omni.think('当前热点与示例站点的关联');

// 嘴：给一条意见（同样免 key 双模式）
await omni.giveOpinion('AI 该不该有真实感知');

const st = await omni.status();
console.log('\n运行后端:', st.backend);
console.log('能力:', JSON.stringify({ think: st.think, webFetch: st.webFetch, seeVision: st.seeVision, hear: st.hear, speak: st.speak }));
console.log('说明:', st.note);
