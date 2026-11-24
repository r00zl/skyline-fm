// Tiny event bus. Everything in the game talks through this:
// the player emits moves, the commentator and DJ listen, the radio reports tracks.
class Bus {
  constructor() { this.map = new Map(); }
  on(type, fn) {
    if (!this.map.has(type)) this.map.set(type, []);
    this.map.get(type).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this.map.get(type);
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, data = {}) {
    const list = this.map.get(type);
    if (list) for (const fn of [...list]) {
      try { fn(data); } catch (err) { console.error(`[bus] ${type}`, err); }
    }
    const any = this.map.get('*');
    if (any) for (const fn of [...any]) {
      try { fn(type, data); } catch (err) { console.error('[bus] *', err); }
    }
  }
}

export const bus = new Bus();
