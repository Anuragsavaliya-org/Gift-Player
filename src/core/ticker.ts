/**
 * requestAnimationFrame-driven frame clock. The frame is computed from elapsed time x fps, so it
 * SKIPS frames when the page falls behind instead of replaying them (animation duration stays
 * correct). `onFrame` only fires when the frame index actually changes.
 */
export interface TickerOptions {
  fps: number;
  frames: number;
  /** Number of plays; 0 or Infinity = loop forever. Default 1. */
  loops?: number;
  onFrame: (frame: number) => void;
  onEnd?: () => void;
  /** Injection points for tests. */
  raf?: (cb: (now: number) => void) => number;
  caf?: (handle: number) => void;
  now?: () => number;
}

export class Ticker {
  private readonly fps: number;
  private readonly frames: number;
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
  /** Absolute position in frames (may exceed `frames` while looping), advanced from the clock. */
  private position = 0;
  private startedAt = 0;
  private startPosition = 0;
  private emitted = -1;
  private readonly tick = (now: number) => this.step(now);

  constructor(options: TickerOptions) {
    this.fps = options.fps;
    this.frames = options.frames;
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
    return Math.floor(this.position / this.frames);
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
    this.position = this.loop * this.frames + f;
    if (this.position >= this.frames * this.loops) this.position = this.frames * this.loops - 1; // not past the end
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

  private frameAt(position: number): number {
    return Math.min(this.frames - 1, Math.floor(position % this.frames));
  }

  private step(now: number): void {
    this.handle = 0;
    if (!this.running) return;
    const elapsed = Math.max(0, now - this.startedAt);
    const pos = this.startPosition + (elapsed * this.fps) / 1000;
    const total = this.frames * this.loops;
    if (pos >= total) {
      this.position = total - 1;
      this.running = false;
      this.finished = true;
      this.emit(); // always show the last frame before ending
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
