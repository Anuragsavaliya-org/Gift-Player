import { describe, expect, it } from 'vitest';
import { Ticker } from '../src/core/ticker';

/** Manual clock + rAF queue. */
function harness(opts: { fps?: number; frames: number; loops?: number; frameDuration?: (i: number) => number }) {
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

describe('Ticker with per-frame durations (GIF/WebP delays)', () => {
  const D = [100, 50, 200, 10]; // starts: 0, 100, 150, 350; one play = 360 ms
  const make = (loops?: number) => harness({ frames: 4, frameDuration: (i) => D[i]!, loops });

  it('reports the total duration (sum of the delays)', () => {
    expect(make().ticker.duration).toBe(360);
  });

  it('shows each frame for exactly its own delay', () => {
    const h = make(0);
    h.ticker.play();
    const at = (t: number) => { h.advance(t - now); now = t; return h.ticker.frame; };
    let now = 0;
    expect(at(99)).toBe(0);
    expect(at(100)).toBe(1); // exactly on the boundary: new frame
    expect(at(149)).toBe(1);
    expect(at(150)).toBe(2);
    expect(at(349)).toBe(2);
    expect(at(350)).toBe(3);
    expect(at(359)).toBe(3);
    expect(at(360)).toBe(0); // wraps (loops forever)
  });

  it('skips frames when behind, landing on the frame that belongs to the elapsed time', () => {
    const h = make(0);
    h.ticker.play();
    h.advance(300); // 300 ms is inside frame 2; frame 1 is skipped, not replayed
    expect(h.seen).toEqual([0, 2]);
    h.advance(55); // 355 ms -> frame 3 (10 ms long)
    h.advance(10); // 365 ms -> next loop, frame 0
    expect(h.seen).toEqual([0, 2, 3, 0]);
  });

  it('a very short frame can be skipped entirely', () => {
    const h = make(0);
    h.ticker.play();
    h.advance(340);
    h.advance(30); // 340 -> 370: crosses frame 3 (350..360) completely
    expect(h.seen).toEqual([0, 2, 0]);
  });

  it('total play time is the sum of delays x loops; the last frame is shown, then onEnd once', () => {
    const h = make(2); // 720 ms
    h.ticker.play();
    h.advance(719);
    expect(h.stats.ends).toBe(0);
    h.advance(2);
    expect(h.stats.ends).toBe(1);
    expect(h.seen[h.seen.length - 1]).toBe(3);
    expect(h.ticker.playing).toBe(false);
  });

  it('seek lands on the start of the frame and playback continues with that frame\'s delay', () => {
    const h = make(0);
    h.ticker.seek(2);
    expect(h.seen).toEqual([2]);
    h.ticker.play();
    h.advance(199);
    expect(h.ticker.frame).toBe(2); // 200 ms frame not over yet
    h.advance(2);
    expect(h.ticker.frame).toBe(3);
  });

  it('pause/resume keeps the position inside a long frame', () => {
    const h = make(0);
    h.ticker.play();
    h.advance(180); // inside frame 2 (150..350)
    h.ticker.pause();
    h.advance(10_000);
    h.ticker.play();
    h.advance(160);
    expect(h.ticker.frame).toBe(2); // 340 ms
    h.advance(15);
    expect(h.ticker.frame).toBe(3); // 355 ms: inside the 10 ms frame 3 (350..360)
  });

  it('non-integer uniform fps has no boundary drift (15 fps = 66.667 ms)', () => {
    const h = harness({ fps: 15, frames: 15, loops: 0 });
    h.ticker.play();
    let t = 0;
    for (let k = 1; k < 45; k++) {
      const target = (k * 1000) / 15;
      h.advance(target - t);
      t = target;
      expect(h.ticker.frame, `t=${target}`).toBe(k % 15);
    }
  });

  it('loop counter follows the variable cycle', () => {
    const h = make(0);
    h.ticker.play();
    h.advance(1100); // 3 x 360 = 1080 -> loop index 3
    expect(h.ticker.loop).toBe(3);
  });
});
