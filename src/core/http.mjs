// 统一 HTTP 客户端：浏览器 UA + 超时 + 重试 + 自动 JSON/Buffer
// 供 eyes / ears 等模块复用，集中超时与重试策略，消除重复的 fetch 样板与不一致。
export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';

/**
 * @param {string} url
 * @param {object} [opt]
 * @param {Record<string,string>} [opt.headers]
 * @param {number} [opt.timeout=15000]  单次请求超时(ms)
 * @param {number} [opt.retries=1]      失败重试次数（不含首次）
 * @param {'text'|'json'|'buffer'} [opt.as='text']
 */
export async function httpGet(url, { headers = {}, timeout = 15000, retries = 1, as = 'text' } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': UA, 'Connection': 'close', ...headers },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeout),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      if (as === 'json') return await r.json();
      if (as === 'buffer') return Buffer.from(await r.arrayBuffer());
      return await r.text();
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise(r => setTimeout(r, 300));
    }
  }
  throw lastErr;
}

export const httpGetJson = (url, opt = {}) => httpGet(url, { ...opt, as: 'json' });
export const httpGetBuffer = (url, opt = {}) => httpGet(url, { ...opt, as: 'buffer' });
