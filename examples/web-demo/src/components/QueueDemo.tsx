import { useGiftQueue } from '@incodes/gift-player/react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { giftUrl, type Gift } from '../types';

interface RenderProps {
  /** Attach to the element (with a size) the queue should draw in. */
  overlayRef: RefObject<HTMLDivElement | null>;
  /** The "live stream" control panel. */
  panel: ReactNode;
  /** "×10" while a merged combo plays, else "". */
  badge: string;
  paused: boolean;
  togglePause: () => void;
  /** Queue a gift once (or `times` times) with the selected priority. */
  send: (g: Gift, times?: number) => void;
}

/**
 * Live-stream simulation. The coalesce switch recreates the queue: `useGiftQueue` reads its options once, when its element mounts,
 * so a different option means a different component instance (the inner `key`).
 */
export function QueueDemo(props: { gifts: Gift[]; selected: Gift | null; toast: (text: string) => void; children: (r: RenderProps) => ReactNode }) {
  const [coalesce, setCoalesce] = useState(true);
  return <QueueInner key={coalesce ? 'coalesce' : 'plain'} coalesce={coalesce} onCoalesce={setCoalesce} {...props} />;
}

function QueueInner({ coalesce, onCoalesce, gifts, selected, toast, children }: { coalesce: boolean; onCoalesce: (c: boolean) => void; gifts: Gift[]; selected: Gift | null; toast: (text: string) => void; children: (r: RenderProps) => ReactNode }) {
  // The hook creates a GiftPlayer in the element `containerRef` is attached to, and a GiftQueue on it; both are destroyed on unmount.
  const { queue, containerRef, stats } = useGiftQueue({ coalesce, maxLength: 60, preloadAhead: 2 });
  const [priority, setPriority] = useState(0); // 0 = normal, 5 = high
  const [badge, setBadge] = useState('');
  const [paused, setPaused] = useState(false);
  const byUrl = useRef(new Map<string, Gift>());
  byUrl.current = new Map(gifts.map((g) => [giftUrl(g), g]));

  useEffect(() => {
    if (!queue) return;
    const name = (src: unknown) => byUrl.current.get(String(src))?.name ?? String(src);
    const offs = [
      // item-start carries `count`: how many identical sends were merged into this one ("combo")
      queue.on('item-start', (i) => setBadge(i.count > 1 ? `×${i.count}` : '')),
      queue.on('item-end', () => setBadge('')),
      queue.on('item-error', (i) => toast(`${name(i.src)}: ${i.error.code}`)),
      queue.on('item-dropped', (i) => toast(`${name(i.src)} dropped (${i.reason})`)),
    ];
    return () => offs.forEach((off) => off());
  }, [queue, toast]);

  const send = (g: Gift, times = 1) => {
    // loops: 1 on purpose: a queue plays one gift at a time, so an endless gift would block everything behind it
    for (let i = 0; i < times; i++) queue?.add(giftUrl(g), { priority, loops: 1 });
  };
  const burst = () => {
    for (let i = 0; i < 20; i++) send(gifts[Math.floor(Math.random() * gifts.length)]!);
  };
  const togglePause = () => {
    if (!queue) return;
    if (paused) queue.resume();
    else queue.pause();
    setPaused(!paused);
  };

  const panel = (
    <section className="panel">
      <h2>Live stream</h2>
      <div className="row">
        <label>Priority{' '}
          <select value={priority} onChange={(e) => setPriority(Number(e.target.value))}>
            <option value={0}>normal</option>
            <option value={5}>high</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={coalesce} onChange={(e) => onCoalesce(e.target.checked)} /> merge identical sends (coalesce)
        </label>
      </div>
      <div className="row">
        <button onClick={burst} disabled={!queue}>Burst ×20</button>
        <button onClick={() => selected && send(selected, 10)} disabled={!queue || !selected} title="Sends the selected gift 10 times">
          Combo ×10 {selected ? `(${selected.name})` : ''}
        </button>
        <button onClick={() => queue?.clear()} disabled={!queue}>Clear waiting</button>
      </div>
      <p className="note">Each gift tile below also has a <b>Send</b> button that queues it once.</p>
      <ul className="stats">
        <li>Waiting <strong>{stats.pending}</strong></li>
        <li>Playing <strong>{stats.playing ? 'yes' : 'no'}</strong></li>
        <li>Played <strong>{stats.played}</strong></li>
        <li>Errors <strong>{stats.failed}</strong></li>
        <li>Dropped <strong>{stats.dropped}</strong></li>
      </ul>
    </section>
  );

  return <>{children({ overlayRef: containerRef, panel, badge, paused, togglePause, send })}</>;
}
