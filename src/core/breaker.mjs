// 零依赖的轻量基础设施：TTL 缓存 + 熔断器。
// 用于热搜抓取，降低重复联网、在源持续失败时快速跳过（诚实降级而非反复超时）。

// 内存 TTL 缓存：get 命中且未过期返回 value，否则 undefined（并清理）。
export class TtlCache {
  constructor(ttlMs = 60000) { this.ttl = ttlMs; this.m = new Map(); }
  get(k) {
    const e = this.m.get(k);
    if (!e) return undefined;
    if (Date.now() - e.t > this.ttl) { this.m.delete(k); return undefined; }
    return e.v;
  }
  set(k, v) { this.m.set(k, { t: Date.now(), v }); }
  has(k) { return this.get(k) !== undefined; }
  clear() { this.m.clear(); }
}

// 熔断器：连续失败达到阈值后进入「开启」状态持续 cooldownMs，期间 open=true。
// 任意一次成功复位。用于避免对持续不可达的源反复发起超时请求。
export class CircuitBreaker {
  constructor(maxFails = 3, cooldownMs = 5 * 60 * 1000) {
    this.maxFails = maxFails;
    this.cooldown = cooldownMs;
    this.fails = 0;
    this.openUntil = 0;
  }
  get open() { return this.openUntil > Date.now(); }
  success() { this.fails = 0; this.openUntil = 0; }
  fail() {
    this.fails++;
    if (this.fails >= this.maxFails) this.openUntil = Date.now() + this.cooldown;
  }
}
