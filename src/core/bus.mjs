// 事件总线 + 命令调度（大脑的神经通路）
// 模块间只通过事件契约耦合；大脑通过 command() 向眼/耳/嘴下发指令。
import { log } from './logger.mjs';

export class Bus {
  constructor() {
    this._listeners = new Map();   // event -> Set<fn>
    this._wild = new Set();        // '*' 通配符订阅
    this._handlers = new Map();    // "target:action" -> fn
    this._log = [];
  }

  // 订阅某事件；event='*' 订阅全部事件。返回取消订阅函数。
  on(event, fn) {
    if (event === '*') { this._wild.add(fn); return () => this._wild.delete(fn); }
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(fn);
    return () => this.off(event, fn);
  }

  // 只触发一次，触发后自动取消
  once(event, fn) {
    const wrap = (payload, e) => { this.off(event, wrap); fn(payload, e); };
    return this.on(event, wrap);
  }

  // 取消指定订阅（event='*' 取消通配符订阅）
  off(event, fn) {
    if (event === '*') { this._wild.delete(fn); return; }
    const ls = this._listeners.get(event);
    if (ls) ls.delete(fn);
  }

  // 清空某事件或全部监听
  clear(event) {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
  }

  // 监听数（event='*' 返回通配符订阅数）
  count(event) {
    if (event === '*') return this._wild.size;
    return this._listeners.get(event)?.size || 0;
  }

  emit(event, payload) {
    const e = { event, payload, t: Date.now() };
    this._log.push(e);
    if (this._log.length > 1000) this._log.shift();
    const ls = this._listeners.get(event);
    if (ls) for (const fn of [...ls]) {
      try { fn(payload, e); }
      catch (err) { log.error(`[bus] listener ${event} 出错:`, err?.message || err); }
    }
    for (const fn of [...this._wild]) {
      try { fn(payload, e); }
      catch (err) { log.error('[bus] wildcard listener 出错:', err?.message || err); }
    }
    return e;
  }

  // 模块注册可被大脑指挥的能力
  register(target, action, fn) {
    this._handlers.set(`${target}:${action}`, fn);
  }

  async command(target, action, payload = {}) {
    const fn = this._handlers.get(`${target}:${action}`);
    if (!fn) throw new Error(`未注册指令 ${target}:${action}`);
    return await fn(payload);
  }

  // 同步查询最近若干事件
  recent(event, n = 20) {
    return this._log.filter(e => !event || e.event === event).slice(-n);
  }
}

export const EVENTS = {
  PERCEPT: 'percept',          // 眼/耳产生的感知
  INSIGHT: 'insight',          // 脑的洞察
  GAP: 'gap',                  // 信息缺口
  DECISION: 'decision',        // 脑的决策
  UTTERANCE: 'utterance',      // 嘴的输出
  USER_PERCEPT: 'user-percept',// 来自用户的输入
  SITUATION: 'situation',      // 感知层的环境模型
  LEARNED: 'learned',          // 学到的东西
};
