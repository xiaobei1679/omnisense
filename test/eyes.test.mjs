// Eyes 单元测试：仅覆盖纯逻辑（_hotSources 源定义 + parse 解析、extractMainText 正文提取）。
// 不触发任何真实联网（不调用 seeHotTopics/seeAllHot/summarizeWebsite）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { Eyes, extractMainText } from '../src/modules/eyes.mjs';

// 最小桩 bus：构造 Eyes 时需要，但不做任何真实动作
const fakeBus = { register() {}, emit() {} };
const eyes = new Eyes(fakeBus, {});

test('_hotSources 含全部已知源，且每项有 url 与 parse 函数', () => {
  const src = eyes._hotSources();
  const expected = ['bilibili', 'toutiao', 'weibo', 'baidu', 'douyin', 'hongguo', 'zhihu', 'weixin', 'bangumi'];
  for (const key of expected) {
    assert.ok(src[key], `缺少热搜源: ${key}`);
    assert.equal(typeof src[key].url, 'string', `${key}.url 应为字符串`);
    assert.equal(typeof src[key].parse, 'function', `${key}.parse 应为函数`);
  }
});

test('_hotSources.parse 对离线 fixture 正确提取标题', () => {
  const src = eyes._hotSources();
  // bilibili
  assert.deepEqual(
    src.bilibili.parse({ data: { list: [{ title: 'A' }, { title: 'B' }, { title: '' }] } }),
    ['A', 'B']
  );
  // toutiao
  assert.deepEqual(src.toutiao.parse({ data: [{ Title: 'T1' }, { Title: 'T2' }] }), ['T1', 'T2']);
  // weibo
  assert.deepEqual(src.weibo.parse({ data: { realtime: [{ word: 'W1' }, { word: 'W2' }] } }), ['W1', 'W2']);
  // baidu（HTML 正则）
  assert.deepEqual(
    src.baidu.parse('x "word":"热搜词一" y "title":"热搜词二" z'),
    ['热搜词一', '热搜词二']
  );
  // douyin
  assert.deepEqual(src.douyin.parse({ word_list: [{ word: 'D1' }, { word: 'D2' }] }), ['D1', 'D2']);
  // hongguo
  assert.deepEqual(src.hongguo.parse({ content: [{ playletName: 'P1' }, { playletName: 'P2' }] }), ['P1', 'P2']);
  // zhihu（知乎热搜词：top_search.words[].display_query）
  assert.deepEqual(src.zhihu.parse({ top_search: { words: [{ display_query: '如何学习' }, { query: 'AI 是什么' }] } }), ['如何学习', 'AI 是什么']);
  // bangumi（B站番剧榜：data.list[].title）
  assert.deepEqual(src.bangumi.parse({ data: { list: [{ title: '番剧1' }, { title: '番剧2' }] } }), ['番剧1', '番剧2']);
  // weixin（搜狗微信：标题在 <h3><a> 内，含 <em> 高亮与 HTML 实体）
  const wxHtml = '<div class="txt-box"><h3><a href="/link?x=1"><em><!--red_beg-->热点<!--red_end--></em>  为了这个日子 鸟巢&ldquo;披&rdquo;风</a></h3></div>';
  const wxTitles = src.weixin.parse(wxHtml);
  assert.ok(wxTitles.some(t => t.includes('鸟巢') && t.includes('热点')), '微信应提取出含关键词与正文的标题');
});

test('_hotSources.parse 对脏数据鲁棒（不抛异常）', () => {
  const src = eyes._hotSources();
  assert.deepEqual(src.bilibili.parse({}), []);
  assert.deepEqual(src.bilibili.parse(null), []);
  assert.deepEqual(src.bilibili.parse({ data: { list: [{}, { title: null }] } }), []);
  assert.deepEqual(src.baidu.parse('没有任何匹配的词'), []);
});

test('extractMainText 提取正文并去除脚本/样式噪声', () => {
  const html = `<html><head><title>测试页</title><style>.x{color:red}</style></head>
  <body><nav>顶部导航不应出现</nav><script>var secret=1;</script>
  <article><p>这是第一段正文，包含中文标点，应当被提取出来作为主要内容。</p>
  <p>这是第二段正文，同样包含有用的信息与标点符号，用于打分排序。</p></article>
  <div class="ad">广告文字很短</div></body></html>`;
  const text = extractMainText(html);
  assert.ok(text.includes('这是第一段正文'), '应包含第一段正文');
  assert.ok(text.includes('这是第二段正文'), '应包含第二段正文');
  assert.ok(!text.includes('var secret=1'), '不应含脚本内容');
  assert.ok(!text.includes('顶部导航不应出现'), '不应含 nav 文本');
  assert.ok(!text.includes('广告文字很短'), '短广告块应被过滤');
});

test('extractMainText 对纯文本/无正文兜底整页去标签', () => {
  const html = '<div>只有一段很短的文字没有标点</div>';
  const text = extractMainText(html);
  assert.ok(text.includes('只有一段很短的文字'), '兜底应返回去标签后的整页文本');
});

test('extractMainText 空/非字符串输入安全返回空串', () => {
  assert.equal(extractMainText(''), '');
  assert.equal(extractMainText(null), '');
  assert.equal(extractMainText(undefined), '');
});

test('extractMainText 受 maxLen 截断', () => {
  const html = '<div>' + '内容'.repeat(3000) + '</div>';
  const text = extractMainText(html, { maxLen: 100 });
  assert.ok(text.length <= 120, '应受 maxLen 约束');
});

test('B站 WBI 签名：离线生成合法 w_rid/wts（mixinKeyOverride 跳过联网）', async () => {
  const { biliWbiParams, _biliMixinKey } = await import('../src/modules/eyes.mjs');
  assert.equal(_biliMixinKey('a'.repeat(32), 'b'.repeat(32)).length, 32, 'mixinKey 应为 32 位');
  const q = await biliWbiParams({ season_type: 1 }, 'fixedmixinkey1234567890abcdef1234567890');
  assert.match(q.w_rid, /^[a-f0-9]{32}$/, 'w_rid 应为 32 位 md5 hex');
  assert.ok(typeof q.wts === 'number' && q.wts > 0, '应含 wts 时间戳');
  assert.equal(q.season_type, 1, '原参数应保留');
  // 不同参数 → 不同签名（验证拼接+排序参与计算）
  const q2 = await biliWbiParams({ season_type: 2 }, 'fixedmixinkey1234567890abcdef1234567890');
  assert.notEqual(q.w_rid, q2.w_rid, '不同参数应得到不同 w_rid');
});
