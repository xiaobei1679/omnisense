// 事件总线（神经系统）：零依赖 pub/sub。
// 模块之间只通过事件契约耦合，互不直接调用。
export class EventBus {
  constructor() {
    this.handlers = new Map();
  }
  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.handlers.get(type)?.delete(fn);
  }
  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus:${type}] handler error:`, e.message);
      }
    }
  }
}
