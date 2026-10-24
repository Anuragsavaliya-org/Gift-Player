import { describe, expect, it } from 'vitest';
import { GiftPlayerError } from '../src/core/errors';
import { GiftQueue, type GiftQueueOptions } from '../src/queue';
import type { GiftPlayer } from '../src/player';

/** A stand-in for GiftPlayer: "playing" a gift takes `playMs`; names starting with "bad" fail to load. */
class FakePlayer {
  played: string[] = [];
  holds: string[] = [];
  released: string[] = [];
  loaded: unknown[] = [];
  current: object | null = null;
  lastSwapMs = 1;
  clears = 0;
  clear() { this.clears++; }
  playMs = 8;
  private startListeners = new Set<() => void>();
  private pending: { resolve(): void; reject(e: unknown): void; timer: ReturnType<typeof setTimeout> } | null = null;
  private name = '';
  on(event: string, fn: () => void) {
    if (event === 'start') this.startListeners.add(fn);
    return () => this.startListeners.delete(fn);
  }
  async hold(src: string, signal?: AbortSignal) {
    this.holds.push(src);
    if (src.startsWith('bad')) throw new GiftPlayerError('parse-failed', 'corrupt');
    await new Promise((r) => setTimeout(r, 2));
    if (signal?.aborted) throw new GiftPlayerError('aborted', 'x');
    return { release: () => this.released.push(src) };
  }
  async load(src: string, opts: { signal?: AbortSignal; replacements?: unknown; loops?: number }) {
    this.loaded.push({ src, ...opts, signal: undefined });
    await new Promise((r) => setTimeout(r, 2));
    if (opts.signal?.aborted) throw new GiftPlayerError('aborted', 'x');
    if (src.startsWith('bad')) throw new GiftPlayerError('parse-failed', 'corrupt');
    this.name = src;
    this.current = {};
  }
  play() {
    const p = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending = null; this.played.push(this.name); resolve(); }, this.playMs);
      this.pending = { resolve, reject, timer };
    });
    queueMicrotask(() => this.startListeners.forEach((f) => f()));
    return p;
  }
  pause() {}
  resume() {}
  stop() {
    if (!this.pending) return;
    clearTimeout(this.pending.timer);
    this.pending.reject(new GiftPlayerError('aborted', 'stopped'));
    this.pending = null;
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const setup = (options: GiftQueueOptions = {}, playMs = 8) => {
  const player = new FakePlayer();
  player.playMs = playMs;
  const queue = new GiftQueue(player as unknown as GiftPlayer, options);
  const idle = new Promise<void>((r) => queue.on('idle', () => r()));
  return { player, queue, idle };
};

describe('GiftQueue', () => {
  it('plays by priority, equal priorities first come first served', async () => {
    const { player, queue, idle } = setup();
    for (const [n, p] of [['a', 0], ['b', 5], ['c', 0], ['d', 5], ['e', 9]] as const) queue.add(n, { priority: p });
    await idle;
    // a burst added in one go is ordered as a whole: priority first, then arrival
    expect(player.played).toEqual(['e', 'b', 'd', 'a', 'c']);
  });

  it('a full queue drops the lowest priority, oldest first, and says why', async () => {
    const { queue, player, idle } = setup({ maxLength: 2 }, 20);
    const dropped: { src: string; reason: string }[] = [];
    queue.on('item-dropped', (i) => dropped.push({ src: i.src as string, reason: i.reason }));
    queue.add('first');
    await tick(); // it is playing now: it does not count towards maxLength
    queue.add('p1', { priority: 1 });
    queue.add('p1b', { priority: 1 });
    const h = queue.add('low', { priority: 0 }); // full, and lowest: it is the one dropped
    expect(h.status).toBe('dropped');
    queue.add('p2', { priority: 2 }); // evicts the oldest of the lowest priority (p1)
    await idle;
    expect(dropped).toEqual([{ src: 'low', reason: 'overflow' }, { src: 'p1', reason: 'overflow' }]);
    expect(player.played).toEqual(['first', 'p2', 'p1b']);
  });

  it('a failing gift is reported and skipped; the queue never stalls', async () => {
    const { queue, player, idle } = setup();
    const errors: string[] = [];
    queue.on('item-error', (e) => errors.push(`${e.src}:${e.error.code}`));
    queue.add('one');
    queue.add('bad1');
    queue.add('two');
    queue.add('bad2');
    queue.add('three');
    await idle;
    expect(player.played).toEqual(['one', 'two', 'three']);
    expect(errors).toEqual(['bad1:parse-failed', 'bad2:parse-failed']);
    expect(queue.stats).toMatchObject({ played: 3, failed: 2 });
  });

  it('cancel removes a waiting item; cancelling the playing one stops it and moves on', async () => {
    const { queue, player, idle } = setup({}, 30);
    const a = queue.add('a');
    await tick();
    const b = queue.add('b');
    queue.add('c');
    b.cancel();
    expect(b.status).toBe('cancelled');
    await new Promise((r) => setTimeout(r, 10));
    expect(a.status).toBe('playing');
    a.cancel();
    expect(await a.done).toBe('cancelled');
    await idle;
    expect(player.played).toEqual(['c']);
    expect(queue.stats).toMatchObject({ played: 1, cancelled: 2 });
  });

  it('coalesce merges identical consecutive waiting items into one with a count', async () => {
    const { queue, player, idle } = setup({ coalesce: true }, 15);
    const counts: number[] = [];
    queue.on('item-start', (i) => counts.push(i.count));
    queue.add('blocker');
    await tick();
    const rose = [queue.add('rose'), queue.add('rose'), queue.add('rose')];
    queue.add('lion');
    queue.add('rose'); // not consecutive with the earlier roses: separate item
    queue.add('rose', { replacements: { name: { text: 'Rahul' } } }); // different replacements: separate
    expect(rose[2]!.count).toBe(3);
    await idle;
    expect(player.played).toEqual(['blocker', 'rose', 'lion', 'rose', 'rose']);
    expect(counts).toEqual([1, 3, 1, 1, 1]);
  });

  it('coalesce is off by default', async () => {
    const { queue, player, idle } = setup();
    for (let i = 0; i < 4; i++) queue.add('rose');
    await idle;
    expect(player.played).toEqual(['rose', 'rose', 'rose', 'rose']);
  });

  it('cancelling one of several merged adds only lowers the count', async () => {
    const { queue, player, idle } = setup({ coalesce: true }, 15);
    queue.add('blocker');
    await tick();
    const a = queue.add('rose');
    const b = queue.add('rose');
    expect(a.count).toBe(2);
    b.cancel();
    expect(a.count).toBe(1);
    expect(b.status).toBe('cancelled');
    await idle;
    expect(player.played).toEqual(['blocker', 'rose']);
  });

  it('preloads the next N waiting gifts (holds them) and releases the holds when they play', async () => {
    const { queue, player, idle } = setup({ preloadAhead: 2 }, 25);
    queue.add('a');
    await tick();
    for (const n of ['b', 'c', 'd', 'e']) queue.add(n);
    await new Promise((r) => setTimeout(r, 12));
    expect(player.holds.sort()).toEqual(['a', 'b', 'c']); // the next two while a plays, never d and e yet
    await idle;
    expect(player.holds.sort()).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(player.released.sort()).toEqual(['a', 'b', 'c', 'd', 'e']); // every hold was given back
  });

  it('pass-through of replacements and loops; pause stops the next gift from starting; clear drops waiting gifts', async () => {
    const { queue, player, idle } = setup({}, 10);
    queue.add('a', { replacements: { name: { text: 'Rahul' } }, loops: 3 });
    await tick();
    queue.add('b');
    queue.add('c');
    queue.pause();
    await new Promise((r) => setTimeout(r, 40));
    expect(player.played).toEqual(['a']); // a was already running; b did not start
    expect(queue.length).toBe(2);
    queue.clear();
    expect(queue.length).toBe(0);
    queue.resume();
    await idle;
    expect(player.loaded[0]).toMatchObject({ src: 'a', replacements: { name: { text: 'Rahul' } }, loops: 3 });
    expect(player.played).toEqual(['a']);
  });

  it('plays each gift once unless the item or the queue says otherwise', async () => {
    const { queue, player, idle } = setup();
    queue.add('x');
    queue.add('y', { loops: 0 });
    await new Promise((r) => setTimeout(r, 5));
    queue.clear();
    await idle;
    expect(player.loaded[0]).toMatchObject({ src: 'x', loops: 1 });
    const other = setup({ defaultLoops: 4 });
    other.queue.add('z');
    await other.idle;
    expect(other.player.loaded[0]).toMatchObject({ loops: 4 });
  });

  it('blanks the canvas when the next gift is not ready, keeps the last frame for a prepared hand-over', async () => {
    const { queue, player, idle } = setup({ preloadAhead: 1 }, 25);
    queue.add('a');
    await tick();
    queue.add('b'); // preloaded while a plays: the hand-over keeps a's last frame
    await new Promise((r) => setTimeout(r, 40)); // a ended, b is playing
    expect(player.clears).toBe(0);
    await idle;
    expect(player.clears).toBe(1); // after the last gift: blank
    const second = setup({ preloadAhead: 0 }, 10); // nothing is ever prepared: every end blanks
    second.queue.add('x');
    await tick();
    second.queue.add('y');
    await second.idle;
    expect(second.player.clears).toBe(2);
    const failing = setup({ preloadAhead: 1 }, 10);
    failing.queue.add('p');
    failing.queue.add('bad1');
    await failing.idle;
    expect(failing.player.clears).toBeGreaterThanOrEqual(2); // a failed gift also blanks (the previous frame must not linger)
  });

  it('records the time between consecutive gifts that were already waiting', async () => {
    const { queue, idle } = setup();
    for (let i = 0; i < 5; i++) queue.add(`g${i}`);
    await idle;
    expect(queue.stats.gapsMs).toHaveLength(4);
    expect(queue.stats.blankMs).toHaveLength(4);
    expect(queue.stats.gapsMs.every((g) => g >= 0 && g < 200)).toBe(true);
  });
});
