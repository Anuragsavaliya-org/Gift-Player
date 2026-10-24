import { Emitter } from '../core/emitter';
import { GiftPlayerError } from '../core/errors';
import type { GiftSource } from '../core/source';
import { sourceIdentity } from '../player/asset';
import type { GiftPlayer, Replacements } from '../player/player';

/** Options for `new GiftQueue(player, options)`. */
export interface GiftQueueOptions {
  /** Most items waiting at once (the one playing does not count). Default: unlimited. */
  maxLength?: number;
  /** How many of the next items to fetch, parse and decode while the current one plays. Default 2. */
  preloadAhead?: number;
  /** Merge identical consecutive waiting items into one with a `count`. Default false. */
  coalesce?: boolean;
  /**
   * Plays per gift when the item does not say. Default 1: a GIF/WebP that loops forever would otherwise hold the queue for good.
   * Pass `loops: 0` on an item to loop it forever on purpose.
   */
  defaultLoops?: number;
}

/** Options for `queue.add(src, options)`. */
export interface QueueAddOptions {
  /** Higher plays first; equal priorities are first come, first served. Default 0. */
  priority?: number;
  /** Applied before the first frame (see `LoadOptions.replacements`). */
  replacements?: Replacements;
  /** Number of plays for this gift. */
  loops?: number;
}

/** Where an item is in its life: waiting, playing, or one of the final states. */
export type QueueItemStatus = 'pending' | 'playing' | 'done' | 'failed' | 'cancelled' | 'dropped';
/** Why an item left the queue without playing: the queue was full, it was cancelled, or the queue was cleared. */
export type DropReason = 'overflow' | 'cancelled' | 'cleared';

/** Returned by `add()`. */
export interface QueueHandle {
  readonly id: number;
  readonly status: QueueItemStatus;
  /** How many `add()` calls were merged into the item this handle belongs to (1 unless `coalesce`). */
  readonly count: number;
  /** Removes this gift from the queue, or stops it if it is playing. No effect once it is finished. */
  cancel(): void;
  /** Resolves with the final status; never rejects. */
  readonly done: Promise<QueueItemStatus>;
}

/** Describes an item in events. */
export interface QueueItemInfo {
  id: number;
  src: GiftSource;
  priority: number;
  /** Number of merged adds (the "x10" of a combo). */
  count: number;
}

/** Queue events and their payloads (`queue.on(name, fn)`). */
export interface GiftQueueEvents {
  /** The item was taken off the queue and its loading began. */
  'item-begin': QueueItemInfo;
  /** The item's first frame is on screen. */
  'item-start': QueueItemInfo;
  'item-end': QueueItemInfo & { status: QueueItemStatus };
  /** The item could not be loaded or played; the queue moves on. */
  'item-error': QueueItemInfo & { error: GiftPlayerError };
  /** The item left the queue without playing. */
  'item-dropped': QueueItemInfo & { reason: DropReason };
  /** Anything changed: waiting count, playing, paused. */
  change: { pending: number; playing: boolean; paused: boolean };
  /** Nothing is playing and nothing is waiting. */
  idle: undefined;
}

/** Running totals and transition timings of a queue (`queue.stats`). */
export interface QueueStats {
  played: number;
  failed: number;
  cancelled: number;
  dropped: number;
  /** Time from one gift ending to the next gift's first frame being on screen, for gifts that were already waiting. */
  gapsMs: number[];
  /** Time the canvas was blank between two gifts (previous removed, next first frame drawn) for the same transitions. */
  blankMs: number[];
}

interface Item {
  id: number;
  src: GiftSource;
  priority: number;
  seq: number;
  replacements: Replacements | undefined;
  loops: number | undefined;
  signature: string;
  handles: Handle[];
  status: QueueItemStatus;
  hold: { release(): void } | null;
  holding: Promise<void> | null;
  holdAbort: AbortController | null;
  preloadError: GiftPlayerError | null;
  abort: AbortController | null;
}

class Handle implements QueueHandle {
  status: QueueItemStatus = 'pending';
  readonly done: Promise<QueueItemStatus>;
  private resolve!: (s: QueueItemStatus) => void;
  constructor(
    readonly id: number,
    private readonly queue: GiftQueue,
    public item: Item,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
  }
  get count(): number {
    return this.item.handles.length;
  }
  cancel(): void {
    this.queue['cancelHandle'](this);
  }
  finish(status: QueueItemStatus): void {
    if (this.status === 'done' || this.status === 'failed' || this.status === 'cancelled' || this.status === 'dropped') return;
    this.status = status;
    this.resolve(status);
  }
}

const aborted = (e: unknown) => e instanceof GiftPlayerError && e.code === 'aborted';

function signatureOf(replacements: Replacements | undefined): string {
  if (!replacements) return '';
  return JSON.stringify(replacements, (_k, v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype ? sourceIdentity(v as Blob) : v));
}

/**
 * Plays gifts one at a time on a `GiftPlayer`: priorities, a length limit, preloading of the next gifts, optional merging of
 * repeats, and a queue that never stalls (a gift that fails is reported and skipped).
 *
 * ```ts
 * const queue = new GiftQueue(player, { maxLength: 50, preloadAhead: 2, coalesce: true });
 * queue.on('item-start', (i) => badge.show(i.count));
 * queue.add('https://cdn.example/rocket.svga', { priority: 5, replacements: { name: { text: 'Rahul' } } });
 * ```
 */
export class GiftQueue {
  private readonly events = new Emitter<GiftQueueEvents>();
  private readonly waiting: Item[] = []; // kept in play order
  private readonly maxLength: number;
  private readonly preloadAhead: number;
  private readonly coalesce: boolean;
  private readonly defaultLoops: number;
  private current: Item | null = null;
  private running = false;
  private kicked = false;
  private paused = false;
  private destroyed = false;
  private nextId = 1;
  private seq = 0;
  private lastEndAt: number | null = null;
  /** True once something was processed since the last `idle`. */
  private sinceIdle = false;
  private currentStartedAt = 0;
  private readonly unsubscribe: () => void;
  readonly stats: QueueStats = { played: 0, failed: 0, cancelled: 0, dropped: 0, gapsMs: [], blankMs: [] };

  constructor(
    private readonly player: GiftPlayer,
    options: GiftQueueOptions = {},
  ) {
    this.maxLength = options.maxLength ?? Infinity;
    this.preloadAhead = options.preloadAhead ?? 2;
    this.coalesce = options.coalesce ?? false;
    this.defaultLoops = options.defaultLoops ?? 1;
    this.unsubscribe = player.on('start', () => this.onFirstFrame());
  }

  // ---- adding ------------------------------------------------------------------------------------------------------

  /** Queues a gift. Returns a handle to cancel it or to wait for its outcome. */
  add(src: GiftSource, options: QueueAddOptions = {}): QueueHandle {
    const priority = options.priority ?? 0;
    const signature = `${sourceIdentity(src)}|${priority}|${options.loops ?? ''}|${signatureOf(options.replacements)}`;
    const handleId = this.nextId++;
    const placeholder = { handles: [] } as unknown as Item;
    const handle = new Handle(handleId, this, placeholder);
    if (this.destroyed) {
      handle.finish('dropped');
      return handle;
    }
    // Where the new item would go: after every waiting item of equal or higher priority.
    let at = this.waiting.length;
    while (at > 0 && this.waiting[at - 1]!.priority < priority) at--;
    const before = at > 0 ? this.waiting[at - 1] : undefined;
    if (this.coalesce && before && before.signature === signature) {
      handle.item = before;
      before.handles.push(handle);
      this.emitChange();
      return handle;
    }
    const item: Item = { id: handleId, src, priority, seq: this.seq++, replacements: options.replacements, loops: options.loops, signature, handles: [handle], status: 'pending', hold: null, holding: null, holdAbort: null, preloadError: null, abort: null };
    handle.item = item;
    if (this.waiting.length >= this.maxLength) {
      // Full: the lowest priority goes, the oldest first. The new item is the newest, so it only goes when it is the lowest.
      let victim: Item | null = null;
      for (const w of this.waiting) if (!victim || w.priority < victim.priority || (w.priority === victim.priority && w.seq < victim.seq)) victim = w;
      if (!victim || priority <= victim.priority) {
        this.finishItem(item, 'dropped', { reason: 'overflow' });
        return handle;
      }
      this.removeWaiting(victim);
      this.finishItem(victim, 'dropped', { reason: 'overflow' });
      at = this.waiting.length;
      while (at > 0 && this.waiting[at - 1]!.priority < priority) at--;
    }
    this.waiting.splice(at, 0, item);
    this.emitChange();
    this.updatePreloads();
    this.kick();
    return handle;
  }

  // ---- control -----------------------------------------------------------------------------------------------------

  /** Stops starting new gifts and pauses the current one. */
  pause(): void {
    if (this.paused) return;
    this.paused = true;
    if (this.current) this.player.pause();
    this.emitChange();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.current && this.player.current) this.player.resume();
    this.emitChange();
    this.kick();
  }

  /** Removes every waiting gift (the current one keeps playing; use `skip()` to stop it too). */
  clear(): void {
    for (const item of this.waiting.splice(0)) this.finishItem(item, 'dropped', { reason: 'cleared' });
    this.emitChange();
  }

  /** Stops the current gift and moves on to the next. */
  skip(): void {
    const item = this.current;
    if (!item) return;
    item.abort?.abort();
    this.player.stop();
  }

  /** Detaches from the player (which is not destroyed): drops all waiting gifts, stops the current one, releases preloads. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsubscribe();
    this.clear();
    this.skip();
    this.events.clear();
  }

  get length(): number {
    return this.waiting.length;
  }

  get isPlaying(): boolean {
    return this.current !== null;
  }

  on<K extends keyof GiftQueueEvents>(event: K, fn: (payload: GiftQueueEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  off<K extends keyof GiftQueueEvents>(event: K, fn: (payload: GiftQueueEvents[K]) => void): void {
    this.events.off(event, fn);
  }

  // ---- internals ---------------------------------------------------------------------------------------------------

  private info(item: Item): QueueItemInfo {
    return { id: item.id, src: item.src, priority: item.priority, count: item.handles.length };
  }

  private emitChange(): void {
    this.events.emit('change', { pending: this.waiting.length, playing: this.current !== null, paused: this.paused });
  }

  private removeWaiting(item: Item): void {
    const i = this.waiting.indexOf(item);
    if (i >= 0) this.waiting.splice(i, 1);
  }

  private cancelHandle(handle: Handle): void {
    const item = handle.item;
    if (handle.status !== 'pending' && handle.status !== 'playing') return;
    if (item.handles.length > 1) {
      item.handles.splice(item.handles.indexOf(handle), 1);
      handle.finish('cancelled');
      this.stats.cancelled++;
      this.emitChange();
      return;
    }
    if (item === this.current) {
      item.abort?.abort();
      this.player.stop();
      return; // process() reports the status
    }
    this.removeWaiting(item);
    this.finishItem(item, 'cancelled', { reason: 'cancelled' });
    this.emitChange();
  }

  /** Marks an item that never played as finished, releases its preload, and tells listeners. */
  private finishItem(item: Item, status: 'dropped' | 'cancelled', extra: { reason: DropReason }): void {
    item.status = status;
    this.releaseHold(item);
    const info = this.info(item);
    for (const h of item.handles) h.finish(status);
    if (status === 'dropped') this.stats.dropped += 1;
    else this.stats.cancelled += 1;
    this.events.emit('item-dropped', { ...info, reason: extra.reason });
    this.updatePreloads();
  }

  private releaseHold(item: Item): void {
    item.holdAbort?.abort();
    item.holdAbort = null;
    item.hold?.release();
    item.hold = null;
    item.holding = null;
  }

  /** Keeps exactly the next `preloadAhead` waiting gifts fetched, parsed and decoded (and released when they leave that window). */
  private updatePreloads(): void {
    if (this.destroyed) return;
    const wanted = new Set(this.waiting.slice(0, this.preloadAhead));
    for (const item of this.waiting) {
      if (!wanted.has(item)) {
        if (item.hold || item.holding) this.releaseHold(item);
        continue;
      }
      if (item.hold || item.holding || item.preloadError) continue;
      if (typeof item.src !== 'string') continue; // direct files are not cached; they are decoded when their turn comes
      const ctl = (item.holdAbort = new AbortController());
      item.holding = this.player.hold(item.src, ctl.signal).then(
        (lease) => {
          if (item.holdAbort !== ctl || item.status !== 'pending') lease.release();
          else item.hold = lease;
        },
        (e) => {
          if (!aborted(e) && item.holdAbort === ctl) item.preloadError = e instanceof GiftPlayerError ? e : new GiftPlayerError('decode-failed', String(e), { cause: e });
        },
      );
    }
  }

  /** Starts the loop after the current synchronous block, so a burst of `add()` calls is ordered by priority before the first gift starts. */
  private kick(): void {
    if (this.kicked || this.running) return;
    this.kicked = true;
    queueMicrotask(() => {
      this.kicked = false;
      void this.run();
    });
  }

  private async run(): Promise<void> {
    if (this.running || this.destroyed) return;
    this.running = true;
    try {
      while (!this.paused && !this.destroyed && this.waiting.length > 0) {
        const item = this.waiting.shift()!;
        this.sinceIdle = true;
        await this.process(item);
      }
    } finally {
      this.running = false;
    }
    if (this.sinceIdle && !this.paused && !this.current && this.waiting.length === 0 && !this.destroyed) {
      this.sinceIdle = false;
      this.emitChange();
      this.events.emit('idle', undefined);
    }
  }

  private async process(item: Item): Promise<void> {
    item.status = 'playing';
    for (const h of item.handles) h.status = 'playing';
    this.current = item;
    this.updatePreloads();
    this.emitChange();
    this.events.emit('item-begin', this.info(item));
    const ctl = (item.abort = new AbortController());
    const gapStart = this.lastEndAt;
    let outcome: QueueItemStatus = 'done';
    let error: GiftPlayerError | null = null;
    try {
      if (item.preloadError) throw item.preloadError;
      await this.player.load(item.src, { replacements: item.replacements, loops: item.loops ?? this.defaultLoops, clearOnEnd: false, signal: ctl.signal });
      this.releaseHold(item); // the player now holds the gift itself
      if (gapStart !== null && item.status === 'playing') {
        this.stats.gapsMs.push(performance.now() - gapStart);
        this.stats.blankMs.push(this.player.lastSwapMs);
      }
      this.currentStartedAt = performance.now();
      const playing = this.player.play();
      if (this.paused) this.player.pause();
      await playing;
    } catch (e) {
      if (aborted(e)) outcome = 'cancelled';
      else {
        outcome = 'failed';
        error = e instanceof GiftPlayerError ? e : new GiftPlayerError('decode-failed', String(e), { cause: e });
      }
    }
    this.releaseHold(item);
    item.status = outcome;
    this.stats[outcome === 'done' ? 'played' : outcome === 'failed' ? 'failed' : 'cancelled']++;
    const info = this.info(item);
    for (const h of item.handles) h.finish(outcome);
    this.current = null;
    // Hand-over: when the next gift is already prepared (held in the cache) its load swaps the canvas within a few ms, so the last
    // frame stays until then. Otherwise (nothing waiting, or the next one still downloading, or this one failed) the canvas goes blank.
    const next = this.waiting[0];
    if (!(outcome === 'done' && next && next.hold && !this.paused)) this.player.clear();
    this.lastEndAt = outcome === 'done' && this.waiting.length > 0 ? performance.now() : null;
    if (error) this.events.emit('item-error', { ...info, error });
    this.events.emit('item-end', { ...info, status: outcome });
    this.updatePreloads();
    this.emitChange();
  }

  private onFirstFrame(): void {
    const item = this.current;
    if (item && item.status === 'playing') this.events.emit('item-start', this.info(item));
  }
}
