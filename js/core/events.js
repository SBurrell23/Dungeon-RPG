/** Minimal synchronous event bus. Used to keep UI decoupled from simulation. */
export class EventBus {
  constructor() { this.map = new Map(); }

  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, new Set());
    this.map.get(type).add(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (...a) => { off(); fn(...a); });
    return off;
  }

  off(type, fn) { this.map.get(type)?.delete(fn); }

  emit(type, ...args) {
    const set = this.map.get(type);
    if (!set) return;
    // Copy so handlers may unsubscribe during dispatch.
    for (const fn of [...set]) {
      try { fn(...args); } catch (err) { console.error(`[events] ${type}`, err); }
    }
  }
}

export const bus = new EventBus();
