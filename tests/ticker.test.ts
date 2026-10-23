import { describe, expect, it } from 'vitest';
import { Ticker } from '../src/core/ticker';

/** Manual clock + rAF queue. */
function harness(opts: { fps: number; frames: number; loops?: number }) {
  let t = 0;
  let nextHandle = 1;
  const queue = new Map<number, (n: number) => void>();
  const stats = { raf: 0, caf: 0, ends: 0 };
  const seen: number[] = [];
  const ticker = new Ticker({
    ...opts,
    onFrame: (f) => seen.push(f),
    onEnd: () => stats.ends++,
    raf: (cb) => {
      stats.raf++;
      const h = nextHandle++;
      queue.set(h, cb);
      return h;
    },
    caf: (h) => {
      stats.caf++;
      queue.delete(h);
    },
    now: () => t,
  });
  /** Advance the clock by `ms` and run one animation frame, like a browser would. */
  const advance = (ms: number) => {
    t += ms;
    const cbs = [...queue.values()];
    queue.clear();
    cbs.forEach((cb) => cb(t));
  };
  return { ticker, advance, seen, stats, pending: () => queue.size };
}

describe('Ticker', () => {
  it('derives the frame from elapsed time x fps (not from the number of rAF calls)', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    expect(h.seen).toEqual([0]);
    h.advance(16); // 1.6 frames in: still frame 1? 0.16s*10 = 1.6 -> frame 1
    h.advance(16);
    h.advance(16); // 48ms -> 0.48 frames... fps 10 => 100ms per frame
    expect(h.seen).toEqual([0]); // 48ms < 100ms
    h.advance(60); // 108ms
    expect(h.seen).toEqual([0, 1]);
  });

  it('skips frames when behind instead of catching up', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    h.advance(1000); // one long stall = 10 frames
    expect(h.seen).toEqual([0, 10]);
    h.advance(350);
    expect(h.seen).toEqual([0, 10, 13]);
  });

  it('plays once by default, shows the last frame, then fires onEnd exactly once', () => {
    const h = harness({ fps: 10, frames: 5 }); // 500 ms
    h.ticker.play();
    h.advance(300);
    h.advance(300); // past the end
    expect(h.seen[h.seen.length - 1]).toBe(4);
    expect(h.stats.ends).toBe(1);
    expect(h.ticker.playing).toBe(false);
    expect(h.pending()).toBe(0);
    h.advance(1000);
    expect(h.stats.ends).toBe(1);
  });

  it('loops N times', () => {
    const h = harness({ fps: 10, frames: 5, loops: 3 }); // 1500 ms
    h.ticker.play();
    for (let i = 0; i < 14; i++) h.advance(100);
    expect(h.stats.ends).toBe(0);
    expect(h.seen.filter((f) => f === 0).length).toBe(3); // frame 0 reached at the start of each loop
    h.advance(200);
    expect(h.stats.ends).toBe(1);
  });

  it('loops: 0 means forever', () => {
    const h = harness({ fps: 10, frames: 5, loops: 0 });
    h.ticker.play();
    for (let i = 0; i < 100; i++) h.advance(100);
    expect(h.stats.ends).toBe(0);
    expect(h.ticker.playing).toBe(true);
  });

  it('pause keeps the position; play resumes from it', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    h.advance(300);
    h.ticker.pause();
    expect(h.pending()).toBe(0);
    const at = h.ticker.frame;
    expect(at).toBe(3);
    h.advance(5000); // time passes while paused; nothing is queued
    h.ticker.play();
    expect(h.ticker.frame).toBe(at);
    h.advance(200);
    expect(h.ticker.frame).toBe(at + 2);
  });

  it('stop rewinds to 0, cancels the loop, and does not fire onEnd', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    h.advance(500);
    h.ticker.stop();
    expect(h.ticker.frame).toBe(0);
    expect(h.ticker.playing).toBe(false);
    expect(h.pending()).toBe(0);
    expect(h.stats.ends).toBe(0);
  });

  it('seek jumps (clamped), emits, and playback continues from there', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    h.ticker.seek(50);
    expect(h.seen[h.seen.length - 1]).toBe(50);
    h.advance(300);
    expect(h.ticker.frame).toBe(53);
    h.ticker.seek(9999);
    expect(h.ticker.frame).toBe(99);
    h.ticker.seek(-5);
    expect(h.ticker.frame).toBe(0);
  });

  it('seek while paused emits the frame without starting the loop', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.seek(20);
    expect(h.seen).toEqual([20]);
    expect(h.ticker.playing).toBe(false);
    expect(h.stats.raf).toBe(0);
  });

  it('play after the end restarts from frame 0', () => {
    const h = harness({ fps: 10, frames: 5 });
    h.ticker.play();
    h.advance(1000);
    expect(h.stats.ends).toBe(1);
    h.seen.length = 0;
    h.ticker.play();
    expect(h.seen).toEqual([0]);
    h.advance(1000);
    expect(h.stats.ends).toBe(2);
  });

  it('destroy cancels the pending rAF and ignores further calls', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    expect(h.pending()).toBe(1);
    h.ticker.destroy();
    expect(h.pending()).toBe(0);
    h.ticker.play();
    h.ticker.seek(3);
    expect(h.pending()).toBe(0);
    expect(h.stats.caf).toBe(1);
  });

  it('onFrame fires only when the frame index changes', () => {
    const h = harness({ fps: 10, frames: 100 });
    h.ticker.play();
    for (let i = 0; i < 20; i++) h.advance(5); // 100 ms total in 5 ms steps
    expect(h.seen).toEqual([0, 1]);
  });
});
