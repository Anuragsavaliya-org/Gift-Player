// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createElement, StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GiftPlayerError } from '../src/core/errors';
import { diffReplacements } from '../src/react/replacements';

// A scripted stand-in for the player and the queue, so the React lifecycle can be checked without a browser.
const h = vi.hoisted(() => {
  interface Fake {
    id: number;
    destroyed: boolean;
    loads: { src: unknown; options: { signal: AbortSignal; replacements?: unknown; loops?: number } & Record<string, unknown>; resolve(v?: unknown): void; reject(e: unknown): void }[];
    plays: number;
    calls: string[];
    listeners: Map<string, ((p: unknown) => void)[]>;
    resolvePlay: (() => void) | null;
  }
  return { players: [] as Fake[], queues: [] as { player: unknown; destroyed: boolean; listeners: Map<string, ((p: unknown) => void)[]>; length: number; isPlaying: boolean; stats: Record<string, number> }[] };
});

vi.mock('@gift-player/root', () => {
  class GiftPlayer {
    f = { id: h.players.length, destroyed: false, loads: [], plays: 0, calls: [], listeners: new Map(), resolvePlay: null } as (typeof h.players)[number];
    constructor(public el: HTMLElement, public options: unknown) {
      h.players.push(this.f);
      this.f.calls.push('new');
    }
    on(ev: string, fn: (p: unknown) => void) { const a = this.f.listeners.get(ev) ?? []; a.push(fn); this.f.listeners.set(ev, a); return () => {}; }
    load(src: unknown, options: (typeof h.players)[number]['loads'][number]['options']) {
      return new Promise((resolve, reject) => {
        this.f.loads.push({ src, options, resolve, reject });
        options.signal.addEventListener('abort', () => reject(new GiftPlayerError('aborted', 'x')));
      });
    }
    play() { this.f.plays++; return new Promise<void>((r) => (this.f.resolvePlay = r)); }
    setText(k: string, t: string) { this.f.calls.push(`setText:${k}:${t}`); }
    setImage(k: string) { this.f.calls.push(`setImage:${k}`); return Promise.resolve(); }
    setHidden(k: string, v: boolean) { this.f.calls.push(`setHidden:${k}:${v}`); }
    clearReplacement(k: string) { this.f.calls.push(`clear:${k}`); }
    setContentMode(m: string) { this.f.calls.push(`mode:${m}`); }
    destroy() { this.f.destroyed = true; this.f.calls.push('destroy'); }
  }
  class GiftQueue {
    f = { player: null as unknown, destroyed: false, listeners: new Map(), length: 0, isPlaying: false, stats: { played: 0, failed: 0, cancelled: 0, dropped: 0 } };
    constructor(player: unknown) { this.f.player = player; h.queues.push(this.f); }
    get length() { return this.f.length; }
    get isPlaying() { return this.f.isPlaying; }
    get stats() { return this.f.stats; }
    on(ev: string, fn: (p: unknown) => void) { const a = this.f.listeners.get(ev) ?? []; a.push(fn); this.f.listeners.set(ev, a); return () => { this.f.listeners.set(ev, (this.f.listeners.get(ev) ?? []).filter((x: unknown) => x !== fn)); }; }
    destroy() { this.f.destroyed = true; }
  }
  return { GiftPlayer, GiftQueue };
});

const { GiftPlayerView, useGiftQueue } = await import('../src/react');
const info = { format: 'svga', width: 1, height: 1, frameCount: 2, durationMs: 100, editableKeys: [] };
const live = () => h.players.filter((p) => !p.destroyed);
const tick = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

beforeEach(() => { h.players.length = 0; h.queues.length = 0; });
afterEach(() => cleanup());

const view = (props: Record<string, unknown> = {}): ReactElement => createElement(GiftPlayerView as never, { src: '/a.svga', ...props });

describe('GiftPlayerView lifecycle', () => {
  it('creates one player, loads and plays once the gift is loaded, and reports the end', async () => {
    const onLoad = vi.fn(), onEnd = vi.fn();
    render(view({ onLoad, onEnd, loops: 2, replacements: { name: { text: 'Rahul' } } }));
    const p = h.players[0]!;
    expect(h.players).toHaveLength(1);
    expect(p.loads).toHaveLength(1);
    expect(p.loads[0]!.options).toMatchObject({ loops: 2, replacements: { name: { text: 'Rahul' } } });
    await act(async () => p.loads[0]!.resolve(info));
    expect(onLoad).toHaveBeenCalledWith(info);
    expect(p.plays).toBe(1);
    await act(async () => p.resolvePlay!());
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('unmount destroys the player and aborts a load in flight without calling back', async () => {
    const onLoad = vi.fn(), onError = vi.fn();
    const { unmount } = render(view({ onLoad, onError }));
    const p = h.players[0]!;
    unmount();
    expect(p.destroyed).toBe(true);
    expect(p.loads[0]!.options.signal.aborted).toBe(true);
    await tick();
    expect(onLoad).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled(); // an abort is not an error
  });

  it('changing src reloads on the same player; the first load is aborted and its result discarded', async () => {
    const onLoad = vi.fn();
    const { rerender } = render(view({ onLoad }));
    const p = h.players[0]!;
    rerender(view({ onLoad, src: '/b.svga' }));
    expect(h.players).toHaveLength(1);
    expect(p.loads.map((l) => l.src)).toEqual(['/a.svga', '/b.svga']);
    expect(p.loads[0]!.options.signal.aborted).toBe(true);
    await act(async () => p.loads[0]!.resolve(info)); // A finishing late must not surface
    expect(onLoad).not.toHaveBeenCalled();
    expect(p.plays).toBe(0);
    await act(async () => p.loads[1]!.resolve(info));
    expect(onLoad).toHaveBeenCalledOnce();
    expect(p.plays).toBe(1);
  });

  it('StrictMode (mount, unmount, mount): exactly one live player, one canvas owner, plays once', async () => {
    const { unmount } = render(createElement(StrictMode, null, view()));
    expect(h.players.length).toBeGreaterThanOrEqual(2); // StrictMode really did the double mount
    expect(live()).toHaveLength(1); // ...and the discarded one was destroyed
    const alive = live()[0]!;
    expect(h.players.filter((p) => p.destroyed).every((p) => p.loads.every((l) => l.options.signal.aborted))).toBe(true);
    await act(async () => { for (const p of h.players) for (const l of p.loads) l.resolve(info); });
    expect(h.players.reduce((n, p) => n + p.plays, 0)).toBe(1);
    expect(alive.plays).toBe(1);
    unmount();
    expect(live()).toHaveLength(0);
  });

  it('changing replacements updates in place, with no reload', async () => {
    const { rerender } = render(view({ replacements: { name: { text: 'Rahul' }, tag: { hidden: false }, pic: { image: 'x.png' } } }));
    const p = h.players[0]!;
    await act(async () => p.loads[0]!.resolve(info));
    p.calls.length = 0;
    rerender(view({ replacements: { name: { text: 'Anurag' }, pic: { image: 'x.png' } } })); // name changed, tag removed, pic unchanged
    expect(p.loads).toHaveLength(1);
    expect(p.calls).toEqual(['clear:tag', 'setText:name:Anurag']); // removals first
    p.calls.length = 0;
    rerender(view({ replacements: { name: { text: 'Anurag' }, pic: { image: 'x.png' } } })); // a new object with the same content: nothing to do
    expect(p.calls).toEqual([]);
  });

  it('replacements that change while the gift is still loading are applied right after it loads', async () => {
    const { rerender } = render(view({ replacements: { name: { text: 'A' } } }));
    const p = h.players[0]!;
    rerender(view({ replacements: { name: { text: 'B' } } }));
    expect(p.loads).toHaveLength(1);
    expect(p.calls).not.toContain('setText:name:B');
    await act(async () => p.loads[0]!.resolve(info));
    expect(p.calls).toContain('setText:name:B');
  });

  it('contentMode changes re-fit without a reload; errors reach onError, aborts do not; autoPlay false does not play', async () => {
    const onError = vi.fn(), onLoad = vi.fn();
    const { rerender } = render(view({ onError, onLoad, autoPlay: false }));
    const p = h.players[0]!;
    rerender(view({ onError, onLoad, autoPlay: false, contentMode: 'fill' }));
    expect(p.calls).toContain('mode:fill');
    expect(p.loads).toHaveLength(1);
    await act(async () => p.loads[0]!.resolve(info));
    expect(onLoad).toHaveBeenCalledOnce();
    expect(p.plays).toBe(0);
    const err = new GiftPlayerError('network', 'down');
    rerender(view({ onError, onLoad, autoPlay: false, contentMode: 'fill', src: '/c.svga' }));
    await act(async () => p.loads[1]!.reject(err));
    expect(onError).toHaveBeenCalledWith(err);
  });

  it('forwards className and style to the box', () => {
    const { container } = render(view({ className: 'gift', style: { width: 100 } }));
    const box = container.firstElementChild as HTMLElement;
    expect(box.className).toBe('gift');
    expect(box.style.width).toBe('100px');
  });
});

describe('useGiftQueue', () => {
  const Host = ({ onState }: { onState: (s: ReturnType<typeof useGiftQueue>) => void }) => {
    const r = useGiftQueue({ maxLength: 5 });
    onState(r);
    return createElement('div', { ref: r.containerRef });
  };

  it('StrictMode: one live player and queue, the discarded pair is destroyed; unmount destroys the rest', async () => {
    let last!: ReturnType<typeof useGiftQueue>;
    const { unmount } = render(createElement(StrictMode, null, createElement(Host, { onState: (s) => (last = s) })));
    await tick();
    expect(live()).toHaveLength(1);
    expect(h.queues.filter((q) => !q.destroyed)).toHaveLength(1);
    expect(last.queue).not.toBeNull();
    unmount();
    expect(live()).toHaveLength(0);
    expect(h.queues.every((q) => q.destroyed)).toBe(true);
  });

  it('stats follow the queue events', async () => {
    let last!: ReturnType<typeof useGiftQueue>;
    render(createElement(Host, { onState: (s) => (last = s) }));
    await tick();
    const q = h.queues[0]!;
    await act(async () => { q.length = 3; q.isPlaying = true; q.listeners.get('change')!.forEach((f) => f({ pending: 3, playing: true, paused: false })); });
    expect(last.stats).toMatchObject({ pending: 3, playing: true });
    await act(async () => { q.length = 2; q.stats.played = 1; q.listeners.get('item-end')!.forEach((f) => f({})); });
    expect(last.stats).toMatchObject({ pending: 2, played: 1 });
  });
});

describe('diffReplacements', () => {
  it('lists changed and removed keys; equal content is not a change', () => {
    const img = {};
    expect(diffReplacements({ a: { text: 'x' }, b: { image: img as never } }, { a: { text: 'x', style: { size: 5 } }, b: { image: img as never } })).toEqual({ changed: [['a', { text: 'x', style: { size: 5 } }]], cleared: [] });
    expect(diffReplacements({ a: { text: 'x' } }, undefined)).toEqual({ changed: [], cleared: ['a'] });
    expect(diffReplacements(undefined, { a: { hidden: true } })).toEqual({ changed: [['a', { hidden: true }]], cleared: [] });
  });
});
