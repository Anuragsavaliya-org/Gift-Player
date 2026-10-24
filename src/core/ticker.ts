/**
 * requestAnimationFrame-driven frame clock. Frames have individual durations (GIF/WebP delays) or one
 * uniform duration (SVGA fps); the frame on screen is derived from elapsed time via cumulative start
 * times (prefix sums), so it SKIPS frames when the page falls behind instead of replaying them (the
 * animation's total duration stays correct). `onFrame` only fires when the frame index changes.
 */
export interface TickerOptions {
  frames: number;
  /** Duration of frame `i` in ms (must be > 0). Takes precedence over `fps`. */
  frameDuration?: (i: number) => number;
  /** Uniform frame rate, used when `frameDuration` is not given. */
  fps?: number;
  /** Number of plays; 0 or Infinity = loop forever. Default 1. */
  loops?: number;
  onFrame: (frame: number) => void;
  onEnd?: () => void;
  /** Injection points for tests. */
  raf?: (cb: (now: number) => void) => number;
  caf?: (handle: number) => void;
  now?: () => number;
}

/** Floating-point slack so a time exactly on a frame boundary lands in the new frame. */
const EPS = 1e-6;

export class Ticker {
  private readonly frames: number;
  /** starts[i] = ms at which frame i begins; starts[frames] = length of one play. */
  private readonly starts: Float64Array;
  private readonly cycle: number;
  private readonly loops: number;
  private readonly onFrame: (frame: number) => void;
  private readonly onEnd: (() => void) | undefined;
  private readonly raf: (cb: (now: number) => void) => number;
  private readonly caf: (handle: number) => void;
  private readonly now: () => number;
  private handle = 0;
  private running = false;
  private destroyed = false;
  private finished = false;
  /** Absolute position in ms (may exceed one cycle while looping), advanced from the clock. */
  private position = 0;
  private startedAt = 0;
  private startPosition = 0;
  private emitted = -1;
  private readonly tick = (now: number) => this.step(now);

  constructor(options: TickerOptions) {
    this.frames = options.frames;
    this.starts = new Float64Array(this.frames + 1);
    if (options.frameDuration) {
      for (let i = 0; i < this.frames; i++) this.starts[i + 1] = this.starts[i]! + Math.max(options.frameDuration(i), EPS * 10);
    } else {
      // Multiplication, not repeated addition, so uniform boundaries have no accumulated error.
      const per = 1000 / (options.fps ?? 30);
      for (let i = 0; i <= this.frames; i++) this.starts[i] = i * per;
    }
    this.cycle = this.starts[this.frames]!;
    this.loops = options.loops === undefined ? 1 : options.loops <= 0 ? Infinity : options.loops;
    this.onFrame = options.onFrame;
    this.onEnd = options.onEnd;
    this.raf = options.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = options.caf ?? ((h) => cancelAnimationFrame(h));
    this.now = options.now ?? (() => performance.now());
  }

  get playing(): boolean {
    return this.running;
  }

  /** Current frame index (0 .. frames-1). */
  get frame(): number {
    return this.frameAt(this.position);
  }

  /** Number of completed loops so far. */
  get loop(): number {
    return Math.floor((this.position + EPS) / this.cycle);
  }

  /** Length of one play in ms. */
  get duration(): number {
    return this.cycle;
  }

  /** Starts, resumes, or (after the end) restarts from frame 0. */
  play(): void {
    if (this.destroyed || this.running) return;
    if (this.finished) {
      this.finished = false;
      this.position = 0;
      this.emitted = -1;
    }
    this.running = true;
    this.startedAt = this.now();
    this.startPosition = this.position;
    this.emit();
    this.schedule();
  }

  pause(): void {
    if (!this.running) return;
    this.running = false;
    this.cancel();
  }

  /** Pauses and rewinds to frame 0 (does not emit `onEnd`). */
  stop(): void {
    this.running = false;
    this.cancel();
    this.position = 0;
    this.finished = false;
    this.emitted = -1;
  }

  /** Jumps to a frame within the current loop (clamped) and emits it; keeps playing if playing. */
  seek(frame: number): void {
    if (this.destroyed) return;
    const f = Math.min(this.frames - 1, Math.max(0, Math.floor(frame)));
    this.finished = false;
    const loop = Math.min(this.loop, Number.isFinite(this.loops) ? this.loops - 1 : this.loop);
    this.position = loop * this.cycle + this.starts[f]!;
    this.startedAt = this.now();
    this.startPosition = this.position;
    this.emitted = -1;
    this.emit();
  }

  destroy(): void {
    this.destroyed = true;
    this.running = false;
    this.cancel();
  }

  /** Index of the frame that is showing at absolute position `position` (ms). */
  private frameAt(position: number): number {
    const t = (position + EPS) % this.cycle;
    // Last index whose start <= t (binary search over the prefix sums).
    let lo = 0;
    let hi = this.frames - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid]! <= t) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  private step(now: number): void {
    this.handle = 0;
    if (!this.running) return;
    const pos = this.startPosition + Math.max(0, now - this.startedAt);
    const total = this.cycle * this.loops;
    if (pos >= total) {
      // Show the last frame of the last play, then end.
      this.position = total - this.cycle + this.starts[this.frames - 1]!;
      this.running = false;
      this.finished = true;
      this.emit();
      this.onEnd?.();
      return;
    }
    this.position = pos;
    this.emit();
    this.schedule();
  }

  private emit(): void {
    const f = this.frameAt(this.position);
    if (f === this.emitted) return;
    this.emitted = f;
    this.onFrame(f);
  }

  private schedule(): void {
    this.handle = this.raf(this.tick);
  }

  private cancel(): void {
    if (this.handle) this.caf(this.handle);
    this.handle = 0;
  }
}
