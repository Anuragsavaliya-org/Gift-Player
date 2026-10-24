/**
 * @packageDocumentation
 * React bindings: `<GiftPlayerView>` and `useGiftQueue`. Requires React 18 or newer (peer dependency). Client-side only: in Next.js
 * import this from a Client Component (the entry carries `'use client'`).
 */
import { createElement, useEffect, useRef, useState, type CSSProperties, type ReactElement, type RefObject } from 'react';
import { GiftPlayer, GiftQueue, type GiftInfo, type GiftPlayerError, type GiftPlayerOptions, type GiftQueueOptions, type GiftSource, type Replacements } from '@gift-player/root';
import { diffReplacements } from './replacements';

export interface GiftPlayerViewProps {
  /** What to play: a URL, a registered `scheme:ref`, or a file. Changing it loads the new gift (the one in flight is aborted). */
  src: GiftSource;
  /** Text / image / visibility replacements by key. Changing them updates the gift in place, without a reload. */
  replacements?: Replacements;
  /** Number of plays (0 = forever). Changing it reloads. */
  loops?: number;
  /** How the gift fits the box. Changing it re-fits, without a reload. Default 'aspectFit'. */
  contentMode?: GiftPlayerOptions['contentMode'];
  /** Start playing as soon as the gift is loaded. Default true. */
  autoPlay?: boolean;
  /** Clear the canvas after the last play. Default true. */
  clearOnEnd?: boolean;
  /** Called when the gift is loaded and its first frame is on screen. */
  onLoad?: (info: GiftInfo) => void;
  /** Called when the last play ended. */
  onEnd?: () => void;
  /** Called with load and render errors (aborts are not errors). */
  onError?: (error: GiftPlayerError) => void;
  className?: string;
  /** The box needs a size (CSS): give it `width`/`height` here or through `className`. */
  style?: CSSProperties;
  /** Other player options (cache, PAG engine URLs, ...). Read once when the view mounts. */
  playerOptions?: Omit<GiftPlayerOptions, 'contentMode' | 'loops' | 'clearOnEnd'>;
}

/**
 * Plays one gift in a box. Unmounting destroys the player, changing `src` reloads (aborting the load in flight), and StrictMode's
 * mount → unmount → mount creates exactly one live player and plays once.
 */
export function GiftPlayerView(props: GiftPlayerViewProps): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const playerRef = useRef<GiftPlayer | null>(null);
  const latest = useRef(props);
  latest.current = props;
  // What the loaded gift currently shows, so a change of `replacements` only applies the difference.
  const applied = useRef<Replacements | undefined>(undefined);
  const ready = useRef(false);

  // The player lives as long as the view is mounted.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const { playerOptions, contentMode, clearOnEnd } = latest.current;
    const player = new GiftPlayer(el, { ...playerOptions, contentMode, clearOnEnd });
    player.on('error', (e) => latest.current.onError?.(e));
    playerRef.current = player;
    return () => {
      ready.current = false;
      playerRef.current = null;
      player.destroy();
    };
  }, []);

  // A new src / loops / clearOnEnd loads again; the previous load is aborted and its result discarded.
  const { src, loops, clearOnEnd } = props;
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    let cancelled = false;
    const ctl = new AbortController();
    ready.current = false;
    const given = latest.current.replacements;
    applied.current = given;
    player
      .load(src, { replacements: given, loops, clearOnEnd, signal: ctl.signal })
      .then((info) => {
        if (cancelled) return;
        ready.current = true;
        syncReplacements(player, applied, latest.current.replacements); // changed while it was loading
        latest.current.onLoad?.(info);
        if (latest.current.autoPlay === false) return;
        return player.play().then(() => {
          if (!cancelled) latest.current.onEnd?.();
        });
      })
      .catch((e: GiftPlayerError) => {
        if (cancelled || e?.code === 'aborted') return;
        latest.current.onError?.(e);
      });
    return () => {
      cancelled = true;
      ctl.abort();
    };
  }, [src, loops, clearOnEnd]);

  // `replacements` changed: apply the difference to the loaded gift.
  const { replacements } = props;
  useEffect(() => {
    const player = playerRef.current;
    if (player && ready.current) syncReplacements(player, applied, replacements);
  }, [replacements]);

  const { contentMode } = props;
  useEffect(() => {
    playerRef.current?.setContentMode(contentMode ?? 'aspectFit');
  }, [contentMode]);

  return createElement('div', { ref: box, className: props.className, style: { position: 'relative', ...props.style } });
}

function syncReplacements(player: GiftPlayer, applied: RefObject<Replacements | undefined>, next: Replacements | undefined): void {
  const d = diffReplacements(applied.current, next);
  for (const key of d.cleared) player.clearReplacement(key);
  for (const [key, r] of d.changed) {
    if ('text' in r) player.setText(key, r.text, r.style);
    else if ('image' in r) void player.setImage(key, r.image, r.options).catch(() => {});
    else player.setHidden(key, r.hidden);
  }
  applied.current = next;
}

/** Live numbers of a queue, re-rendered on every change. */
export interface GiftQueueState {
  /** Gifts waiting. */
  pending: number;
  playing: boolean;
  paused: boolean;
  played: number;
  failed: number;
  cancelled: number;
  dropped: number;
}

export interface UseGiftQueueResult {
  /** The queue, or null until the container has mounted. Call `queue?.add(...)` from event handlers. */
  queue: GiftQueue | null;
  /** Attach to the element (with a size) that should show the gifts. */
  containerRef: RefObject<HTMLDivElement | null>;
  stats: GiftQueueState;
}

const EMPTY: GiftQueueState = { pending: 0, playing: false, paused: false, played: 0, failed: 0, cancelled: 0, dropped: 0 };

/**
 * Creates a `GiftPlayer` in the element you attach `containerRef` to, and a `GiftQueue` on it. Both are destroyed on unmount (and
 * in StrictMode's first, discarded mount). Options are read once, when the element mounts.
 */
export function useGiftQueue(options: GiftPlayerOptions & GiftQueueOptions = {}): UseGiftQueueResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [queue, setQueue] = useState<GiftQueue | null>(null);
  const [stats, setStats] = useState<GiftQueueState>(EMPTY);
  const first = useRef(options);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const o = first.current;
    const player = new GiftPlayer(el, o);
    const q = new GiftQueue(player, o);
    const snapshot = (): GiftQueueState => ({ pending: q.length, playing: q.isPlaying, paused: false, played: q.stats.played, failed: q.stats.failed, cancelled: q.stats.cancelled, dropped: q.stats.dropped });
    const offs = [
      q.on('change', (c) => setStats({ ...snapshot(), pending: c.pending, playing: c.playing, paused: c.paused })),
      q.on('item-end', () => setStats((s) => ({ ...snapshot(), paused: s.paused }))),
    ];
    setQueue(q);
    return () => {
      offs.forEach((off) => off());
      q.destroy();
      player.destroy();
      setQueue(null);
      setStats(EMPTY);
    };
  }, []);

  return { queue, containerRef, stats };
}

