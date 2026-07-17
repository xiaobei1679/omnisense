// 眼睛（Eyes）—— 让 AI 真的去看：网站 / 视频 / 资料 / 热点 / 图像
// 真实部分（本机即可执行，已实测通网）：联网抓取 HTML、解析内容、拉多平台实时热搜、下载视频/抽帧、取图像。
// 理解部分（图里是什么 / 网页讲了啥）：交给在线 VLM / LLM（需 key，缺则诚实降级或由运行体 agent 驱动）。
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { env } from 'node:process';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { UA, httpGet, httpGetBuffer } from '../core/http.mjs';
import { log } from '../core/logger.mjs';
import { TtlCache, CircuitBreaker } from '../core/breaker.mjs';

const run = promisify(execFile);

function stripHtml(html) {
  const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const links = [...html.matchAll(/href=["'](https?:\/\/[^"']+)["']/gi)].map(m => m[1]).slice(0, 20);
  return { title: title.trim(), text: text.slice(0, 2000), links };
}

// 把热搜词构造为可真实访问的搜索 URL（诚实：是各平台真实搜索页，可被 watch 抓摘要）。
function searchUrlFor(source, title) {
  const q = encodeURIComponent(title);
  switch (source) {
    case 'weibo': return `https://s.weibo.com/weibo?q=${q}`;
    case 'baidu': return `https://www.baidu.com/s?wd=${q}`;
    case 'douyin': return `https://www.douyin.com/search/${q}`;
    case 'toutiao': return `https://so.toutiao.com/search?keyword=${q}`;
    case 'bilibili': return `https://search.bilibili.com/all?keyword=${q}`;
    case 'zhihu': return `https://www.zhihu.com/search?type=content&q=${q}`;
    case 'bangumi': return `https://search.bilibili.com/bangumi?keyword=${q}`;
    case 'weixin': return `https://weixin.sogou.com/weixin?type=2&query=${q}`;
    default: return `https://www.baidu.com/s?wd=${q}`;
  }
}

// 零依赖 readability 类正文提取：去噪（脚本/样式/注释）→ 按内容块打分 → 取高分正文。
// 不依赖 jsdom/cheerio，纯正则 + 字符串运算，保证项目「复制即跑、零 npm 依赖」。
export function extractMainText(html, { maxLen = 4000 } = {}) {
  if (!html || typeof html !== 'string') return '';
  let h = html
    .replace(/<!--[\s\S]*?-->/g, ' ')                                   // 注释
    .replace(/<(script|style|noscript|svg|head|meta|link|template)[^>]*>[\s\S]*?<\/\1>/gi, ' ') // 含闭合的块
    .replace(/<script[^>]*\/?>/gi, ' ')
    .replace(/<style[^>]*\/?>/gi, ' ');

  // 候选内容块：常见正文容器标签
  const blocks = [];
  const re = /<(article|main|section|div|p|td)[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(h))) {
    const txt = m[2]
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (txt.length > 25) blocks.push(txt);
  }

  // 打分：长度 + 标点密度（中文/英文句读权重高，噪声块通常又短又没标点）
  const scored = blocks
    .map(t => ({ t, score: t.length + (t.match(/[，。、！？；：,.!?;:""''（）()]/g) || []).length * 8 }))
    .sort((a, b) => b.score - a.score);

  let out = '';
  for (const s of scored) {
    out += s.t + '\n\n';
    if (out.length >= maxLen) break;
  }
  out = out.slice(0, maxLen).trim();

  // 兜底：无候选块时用整页去标签
  if (!out) out = h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLen);
  return out;
}

// ── B站 WBI 签名（pgc 排行等接口强制）── 标准算法，零依赖（仅用内置 crypto）
const BILI_MIXIN_ORDER = [39,37,33,29,8,6,34,20,46,44,40,31,9,36,23,48,49,42,38,35,50,13,51,10,45,41,4,32,47,24,22,19,25,3,28,5,30,15,14,12,2,21,26,1,7,27,16,11,17,54,52,53,43,18,0,56,55,57,58,59,60,61,62,63];
function _biliMixinKey(imgKey, subKey) {
  return (imgKey + subKey).split('').map((c, i) => BILI_MIXIN_ORDER[i]).join('').slice(0, 32);
}
let _biliWbiCache = null;
// mixinKeyOverride 用于离线单测（跳过 nav 联网）
async function biliWbiParams(extra = {}, mixinKeyOverride) {
  let mk = mixinKeyOverride;
  if (!mk) {
    if (!_biliWbiCache) {
      const nav = await httpGet('https://api.bilibili.com/x/web-interface/nav', { headers: { Referer: 'https://www.bilibili.com/' }, as: 'json', timeout: 10000 });
      const imgKey = (nav?.data?.wbi_img?.img_url || '').split('/').pop().split('.')[0];
      const subKey = (nav?.data?.wbi_img?.sub_url || '').split('/').pop().split('.')[0];
      _biliWbiCache = _biliMixinKey(imgKey, subKey);
    }
    mk = _biliWbiCache;
  }
  const q = { ...extra, wts: Math.floor(Date.now() / 1000) };
  const sorted = Object.keys(q).sort().map(k => `${encodeURIComponent(k)}=${encodeURIComponent(q[k])}`).join('&');
  q.w_rid = createHash('md5').update(sorted + mk).digest('hex');
  return q;
}
export { biliWbiParams, _biliMixinKey };

export class Eyes {
  constructor(bus, models) {
    this.bus = bus; this.models = models;
    this._cache = new TtlCache(Number(env.OMNI_HOT_TTL) || 60000);
    this._breakers = new Map();
    this._maxFails = Number(env.OMNI_HOT_MAX_FAILS) || 3;
    this._cooldown = Number(env.OMNI_HOT_COOLDOWN) || 5 * 60 * 1000;
    this._wire();
  }

  _wire() {
    this.bus.register('eyes', 'seeWebsite', p => this.seeWebsite(p.url));
    this.bus.register('eyes', 'seeHotTopics', p => this.seeHotTopics(p.source));
    this.bus.register('eyes', 'seeImage', p => this.seeImage(p.image));
    this.bus.register('eyes', 'watchVideo', p => this.watchVideo(p.url));
    this.bus.register('eyes', 'summarizeWebsite', p => this.summarizeWebsite(p.url, p.maxWords));
  }

  // 真实看一个网站（容错：失败返回感知错误而非抛异常，保证流水线不被打断）
  async seeWebsite(url) {
    log.info(`\n[眼·视觉] 抓取网站: ${url}`);
    try {
      const html = await httpGet(url, { timeout: 15000 });
      const { title, text, links } = stripHtml(html);
      const percept = { modality: 'visual-web', source: url, title, text, links, fetchedAt: Date.now() };
      log.info(`   ✓ 标题: ${title}`);
      log.info(`   ✓ 正文片段: ${text.slice(0, 120)}…`);
      log.info(`   ✓ 提取 ${links.length} 个出站链接`);
      this.bus.emit('percept', percept);
      return percept;
    } catch (e) {
      const percept = { modality: 'visual-web', source: url, error: e.message, fetchedAt: Date.now() };
      log.warn(`   ⚠ 抓取失败(诚实降级): ${e.message}`);
      this.bus.emit('percept', percept);
      return percept;
    }
  }

  // 热搜源定义（免 key 直连；JSON 源用 parse 取标题数组，HTML 源用正则取词）
  // 说明：聚合见 seeAllHot() 用 Promise.allSettled，单个源失败不影响整体（诚实降级）。
  //   - bilibili/toutiao/weibo/baidu/douyin/hongguo：历史实测稳定
  //   - zhihu(知乎热搜词)/bangumi(B站番剧榜)：公开端点，通常稳定
  //   - weixin(微信热文)：搜狗微信页，反爬较强，可能偶发失败——失败即跳过，不伪造
  _hotSources() {
    return {
      bilibili: { url: 'https://api.bilibili.com/x/web-interface/popular?ps=20', as: 'json', parse: j => (j?.data?.list || []).map(v => v.title).filter(Boolean) },
      toutiao:  { url: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc', as: 'json', parse: j => (j?.data || []).map(i => i.Title).filter(Boolean) },
      weibo:    { url: 'https://weibo.com/ajax/side/hotSearch', as: 'json', headers: { Referer: 'https://weibo.com/' }, parse: j => (j?.data?.realtime || []).map(x => x.word).filter(Boolean) },
      baidu:    { url: 'https://top.baidu.com/board?tab=realtime', as: 'text', parse: html => [...(html || '').matchAll(/"(?:word|title)":"([^"]{2,40})"/g)].map(m => m[1]) },
      douyin:   { url: 'https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/', as: 'json', parse: j => (j?.word_list || []).map(v => v.word).filter(Boolean) },
      hongguo:  { url: 'https://duanju.abya.cn/api.php', as: 'json', parse: j => (j?.content || []).map(x => x.playletName).filter(Boolean) },
      // ── 新增源 ──
      // 知乎：top_search.words[].display_query 是热搜词
      zhihu:    { url: 'https://www.zhihu.com/api/v4/search/top_search?limit=20', as: 'json', headers: { Referer: 'https://www.zhihu.com/' }, parse: j => (j?.top_search?.words || []).map(d => d.display_query || d.query).filter(Boolean) },
      // 微信热文：搜狗微信搜索结果页，标题在 <h3><a> 内（含 <em> 高亮与 HTML 实体）
      weixin:   { url: 'https://weixin.sogou.com/weixin?type=2&query=%E7%83%AD%E7%82%B9', as: 'text', headers: { Referer: 'https://weixin.sogou.com/', 'User-Agent': UA }, parse: html => {
        const out = [];
        const re = /<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/g;
        let m;
        while ((m = re.exec(html || ''))) {
          const t = m[1]
            .replace(/<[^>]+>/g, '')
            .replace(/&ldquo;|&rdquo;|&lsquo;|&rsquo;/g, '"')
            .replace(/&hellip;/g, '…').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
            .replace(/\s+/g, ' ').trim();
          if (t.length > 2) out.push(t);
        }
        return out;
      } },
      // B站番剧榜：pgc 排行接口强制 WBI 签名（sign:'wbi'），见 _fetchTopics
      // 注：本沙箱 IP 被 B站风控时返回 -400；正常网络可真取到番剧标题，失败则聚合跳过（诚实降级）
      bangumi:  { url: 'https://api.bilibili.com/pgc/web/rank/list', as: 'json', sign: 'wbi', extra: { season_type: 1 }, headers: { Referer: 'https://www.bilibili.com/' }, parse: j => (j?.data?.list || []).map(x => x.title).filter(Boolean) },
    };
  }

  // 拉单个平台热搜（不 emit，供聚合复用）。带 TTL 缓存 + 单源熔断。
  async _fetchTopics(source, { force = false } = {}) {
    const map = this._hotSources();
    const cfg = map[source];
    if (!cfg) throw new Error(`未知热搜源: ${source}（支持 ${Object.keys(map).join('/')}）`);
    // 熔断：开启期间直接返回空，避免反复无效联网
    let br = this._breakers.get(source);
    if (br && br.open) { log.warn(`[眼·视觉] 热搜源 ${source} 熔断中，临时跳过`); return []; }
    // 缓存：未过期且非强制刷新 → 直接返回
    if (!force) {
      const cached = this._cache.get(source);
      if (cached) { log.debug(`[眼·视觉] ${source} 命中缓存(${cached.length}条)`); return cached; }
    }
    let url = cfg.url;
    let params = '';
    if (cfg.sign === 'wbi') {
      const q = await biliWbiParams(cfg.extra || {});
      params = '?' + Object.entries(q).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    }
    try {
      const body = await httpGet(url + params, { headers: cfg.headers || {}, as: cfg.as, timeout: 12000 });
      const raw = (cfg.parse(body) || []).filter(Boolean).slice(0, 20);
      // 装饰：每条热搜附带可访问的搜索 URL（供 watch 联网抓摘要）
      const topics = raw.map(t => ({ title: String(t), url: searchUrlFor(source, String(t)) }));
      this._cache.set(source, topics);
      if (br) br.success();
      return topics;
    } catch (e) {
      if (!br) { br = new CircuitBreaker(this._maxFails, this._cooldown); this._breakers.set(source, br); }
      br.fail();
      log.warn(`[眼·视觉] 热搜源 ${source} 抓取失败(${br.fails}/${this._maxFails}): ${e.message}`);
      throw e;
    }
  }

  // 真实看热点（默认 B站；all = 多平台并行聚合去重 + 频次排序）
  async seeHotTopics(source = 'bilibili', { force = false } = {}) {
    if (source === 'all') return this.seeAllHot({ force });
    log.info(`\n[眼·视觉] 抓取实时热搜(${source})`);
    const topics = await this._fetchTopics(source, { force });
    const percept = { modality: 'visual-hot', source, topics, fetchedAt: Date.now() };
    log.info(`   ✓ 抓到 ${topics.length} 条热点:`);
    topics.slice(0, 8).forEach((t, i) => log.info(`     ${i + 1}. ${t.title}`));
    this.bus.emit('percept', percept);
    return percept;
  }

  // 多平台并行聚合：去重 + 按跨平台出现频次排序（越热越靠前）
  async seeAllHot({ force = false } = {}) {
    const sources = Object.keys(this._hotSources());
    log.info(`\n[眼·视觉] 并行聚合 ${sources.length} 个平台热搜…`);
    const results = await Promise.allSettled(sources.map(s => this._fetchTopics(s, { force })));
    // 标题归一化：小写 + 去空白与常见分隔/标点，跨平台"同义标题"才能正确去重（如 "A" 与 "A · "）
    const norm = (t) => String(t).toLowerCase().replace(/\s+/g, '').replace(/[·•\-_|【】\[\]()（）"'’‘“”！!?？]/g, '').trim();
    const freq = new Map();      // normTitle -> 跨平台出现次数
    const byNorm = new Map();    // normTitle -> {title, url}（保留首个来源原始标题）
    for (const r of results) {
      if (r.status === 'fulfilled') for (const t of r.value) {
        const title = t.title || String(t);
        const k = norm(title);
        if (!byNorm.has(k)) byNorm.set(k, { title, url: t.url });
        freq.set(k, (freq.get(k) || 0) + 1);
      }
    }
    const ranked = [...byNorm.values()].sort((a, b) => (freq.get(norm(b.title)) || 0) - (freq.get(norm(a.title)) || 0));
    // Top5 自动联网抓首页摘要（零依赖：仅抓首页正文片段，不调用 LLM，离线/失败即降级跳过）
    if (!env.OMNI_HOT_SUMMARY || env.OMNI_HOT_SUMMARY !== 'off') {
      for (const t of ranked.slice(0, 5)) {
        try {
          const p = await this.seeWebsite(t.url);
          if (p && p.text) t.snippet = p.text.slice(0, 140);
        } catch { /* 离线/失败：不阻断聚合 */ }
      }
    }
    const percept = { modality: 'visual-hot-aggregate', source: 'all', topics: ranked.slice(0, 30), freq: Object.fromEntries(freq), platforms: sources.length, fetchedAt: Date.now() };
    log.info(`   ✓ 去重后 ${ranked.length} 条热点（跨平台频次已统计）Top:`);
    ranked.slice(0, 10).forEach((t, i) => log.info(`     ${i + 1}. ${t.title}${freq.get(norm(t.title)) > 1 ? ` (×${freq.get(norm(t.title))})` : ''}${t.snippet ? ` — ${t.snippet}` : ''}`));
    this.bus.emit('percept', percept);
    return percept;
  }

  // 清空热搜缓存（调试/强制刷新用）
  clearHotCache() { this._cache.clear(); this._breakers.clear(); }
  // 热搜源健康状态（熔断状态）
  hotStats() {
    const out = {};
    for (const [k, b] of this._breakers) out[k] = { fails: b.fails, open: b.open };
    return out;
  }

  // 看一张图
  //  - 驱动模式（无本地网关）：describe 会抛出 AGENT_DRIVE，这里把图落到本地临时文件，
  //    交调用方用读图能力真实描述 → 免 key 真看
  //  - 网关模式：走在线 VLM（配了 VLM key 则真跑；无则诚实降级）
  async seeImage(image) {
    log.info(`\n[眼·视觉] 看图`);
    try {
      const desc = await this.models.describe(image, '请客观描述图中可见内容，不超过80字。');
      log.info(`   ✓ VLM: ${desc}`);
      const percept = { modality: 'visual-image', source: typeof image === 'string' && image.startsWith('http') ? image : 'buffer', description: desc, fetchedAt: Date.now() };
      this.bus.emit('percept', percept);
      return percept;
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') {
        try {
          const local = await this._resolveLocalImage(e.image || image);
          const percept = {
            modality: 'visual-image',
            source: (typeof image === 'string' && image.startsWith('http')) ? image : 'local',
            localPath: local,
            agentVision: true,
            fetchedAt: Date.now(),
          };
          log.info(`   ✓ 图像已下载至本地: ${local}`);
          log.info(`   → 请运行体(agent)用读图能力直接描述此图（agent 模式免 key 真看）`);
          this.bus.emit('percept', percept);
          return percept;
        } catch (e2) {
          log.warn(`   ⚠ 图像获取失败(诚实降级): ${e2.message}`);
          return { modality: 'visual-image', error: e2.message };
        }
      }
      log.warn(`   ⚠ 眼睛“看懂”失败(诚实降级): ${e.message}`);
      return { modality: 'visual-image', error: e.message };
    }
  }

  // 把图像解析成本地可读路径：远程 URL → 下载到临时文件；本地文件 → 直接用；buffer → 写出
  async _resolveLocalImage(image) {
    const dir = tmpdir();
    if (typeof image === 'string' && !image.startsWith('http') && existsSync(image)) return image;
    if (Buffer.isBuffer(image)) {
      const p = join(dir, `omni-img-${randomUUID()}.bin`);
      writeFileSync(p, image);
      return p;
    }
    if (typeof image === 'string' && image.startsWith('http')) {
      const buf = await httpGetBuffer(image, { timeout: 20000 });
      const ext = (image.split('?')[0].split('.').pop() || 'img').toLowerCase().replace(/[^a-z]/g, '') || 'img';
      const p = join(dir, `omni-img-${randomUUID()}.${ext}`);
      writeFileSync(p, buf);
      return p;
    }
    throw new Error('无法解析的图像输入（需 http(s) URL / 本地路径 / Buffer）');
  }

  // 看视频：下载信息+抽帧（真实下载；帧理解需 VLM）
  async watchVideo(url) {
    log.info(`\n[眼·视觉] 看视频: ${url}`);
    const ytdlp = env.YTDLP_BIN || 'yt-dlp';
    try {
      const { stdout } = await run(ytdlp, ['-J', url], { timeout: 60000 });
      const meta = JSON.parse(stdout);
      log.info(`   ✓ 标题: ${meta.title}`);
      log.info(`   ✓ 简介: ${(meta.description || '').slice(0, 100)}`);
      const percept = { modality: 'visual-video', source: url, title: meta.title, description: meta.description, duration: meta.duration, fetchedAt: Date.now() };
      this.bus.emit('percept', percept);
      if (meta.thumbnail) { try { await this.seeImage(meta.thumbnail); } catch {} }
      return percept;
    } catch (e) {
      log.warn(`   ⚠ yt-dlp 不可用或未安装(${e.message})；尝试直接探测媒体…`);
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA } });
        if (r.ok && (r.headers.get('content-type') || '').startsWith('video')) {
          log.info(`   ✓ 视频直链可下载(${r.headers.get('content-length') || '?'} bytes)，可用 ffmpeg 抽帧`);
          return { modality: 'visual-video', source: url, note: 'direct-link-ok' };
        }
      } catch {}
      return { modality: 'visual-video', error: e.message };
    }
  }

  // 网页摘要：先提取正文（readability 类），再交给模型概括；agent 模式抛出正文供运行体驱动
  async summarizeWebsite(url, maxWords = 80) {
    log.info(`\n[眼·视觉] 摘要网页: ${url}`);
    let html;
    try {
      html = await httpGet(url, { timeout: 15000 });
    } catch (e) {
      log.warn(`   ⚠ 抓取失败(诚实降级): ${e.message}`);
      return { modality: 'visual-web-summary', source: url, error: e.message };
    }
    const mainText = extractMainText(html);
    const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1]?.trim() || '';
    if (!mainText && !title) {
      return { modality: 'visual-web-summary', source: url, error: '未提取到正文' };
    }
    try {
      const summary = await this.models.summarize(mainText || title, maxWords);
      const percept = { modality: 'visual-web-summary', source: url, title, summary, fetchedAt: Date.now() };
      log.info(`   ✓ 摘要: ${String(summary).slice(0, 160)}`);
      this.bus.emit('percept', percept);
      return percept;
    } catch (e) {
      if (e?.code === 'AGENT_DRIVE') {
        log.info('   （agent 驱动模式）请运行体(agent)基于以下正文生成摘要：');
        log.info(`   标题: ${title}\n   正文: ${String(mainText || '').slice(0, 600)}`);
        return { modality: 'visual-web-summary', source: url, title, agentDrive: true, mainText: mainText.slice(0, 600) };
      }
      log.warn(`   ⚠ 摘要失败(诚实降级): ${e.message}`);
      return { modality: 'visual-web-summary', source: url, title, error: e.message };
    }
  }
}
