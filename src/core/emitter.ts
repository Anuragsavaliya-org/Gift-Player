/** Minimal typed event emitter. A throwing listener is reported and never breaks the others. */
export class Emitter<Events extends object> {
  private readonly listeners = new Map<keyof Events, Set<(payload: never) => void>>();

  on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): () => void {
    let set = this.listeners.get(event);
    if (!set) this.listeners.set(event, (set = new Set()));
    set.add(fn as (payload: never) => void);
    return () => this.off(event, fn);
  }

  off<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): void {
    this.listeners.get(event)?.delete(fn as (payload: never) => void);
  }

  /** True when someone listens (lets hot paths skip building a payload). */
  has(event: keyof Events): boolean {
    return (this.listeners.get(event)?.size ?? 0) > 0;
  }

  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as (p: Events[K]) => void)(payload);
      } catch (e) {
        console.error('[gift-player] an event listener threw', e);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
