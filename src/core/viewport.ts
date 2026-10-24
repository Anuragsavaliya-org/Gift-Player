import { backingSize, computeView, type ContentMode, type View } from '../formats/svga/render/view';

export type { ContentMode, View } from '../formats/svga/render/view';

export interface ViewportOptions {
  /** Default 'aspectFit'. */
  contentMode?: ContentMode;
  /** Default `window.devicePixelRatio || 1`. */
  devicePixelRatio?: number;
  /** Watch the canvas for CSS size changes and re-fit automatically. Default true. */
  observeResize?: boolean;
  /** Use this CSS size instead of reading `canvas.clientWidth/Height` (e.g. for detached canvases). */
  cssSize?: { width: number; height: number };
}

/**
 * Sizes a canvas' backing store (CSS size x devicePixelRatio) and maps a content rectangle of a given
 * intrinsic size (SVGA viewBox, GIF/WebP canvas) into it according to the content mode. Shared by every
 * renderer. The canvas must be sized by CSS (e.g. `width:100%; height:100%`).
 */
export class Viewport {
  /** Backing-store size in pixels. */
  width = 1;
  height = 1;
  /** content units -> backing pixels. */
  readonly view: View = { sx: 1, sy: 1, ox: 0, oy: 0 };
  private mode: ContentMode;
  private readonly dprOverride: number | undefined;
  private readonly cssOverride: { width: number; height: number } | undefined;
  private readonly observer: ResizeObserver | null = null;
  private initialised = false;
  private destroyed = false;

  /**
   * @param onChange Called after every resize/refit; `backingChanged` is true when the canvas backing
   *   store was resized (which also cleared the canvas). The renderer redraws its current frame there.
   */
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: { width: number; height: number },
    options: ViewportOptions,
    private readonly onChange: (backingChanged: boolean, width: number, height: number) => void,
  ) {
    this.mode = options.contentMode ?? 'aspectFit';
    this.dprOverride = options.devicePixelRatio;
    this.cssOverride = options.cssSize;
    this.resize();
    if (options.observeResize !== false && typeof ResizeObserver !== 'undefined' && !this.cssOverride) {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  get contentMode(): ContentMode {
    return this.mode;
  }

  setContentMode(mode: ContentMode): void {
    if (mode === this.mode || this.destroyed) return;
    this.mode = mode;
    this.refit(false);
  }

  /** Re-reads the CSS size and DPR, resizes the backing store, and notifies the renderer. */
  resize(): void {
    if (this.destroyed) return;
    const css = this.cssOverride ?? { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    // A canvas that is not laid out yet (0 size) falls back to the content's own size.
    const cw = css.width > 0 ? css.width : this.content.width;
    const ch = css.height > 0 ? css.height : this.content.height;
    const dpr = this.dprOverride ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const size = backingSize(cw, ch, dpr);
    const changed = !this.initialised || size.width !== this.width || size.height !== this.height;
    this.initialised = true;
    if (changed) {
      this.width = size.width;
      this.height = size.height;
      this.canvas.width = size.width; // also clears the canvas and resets its state
      this.canvas.height = size.height;
    }
    this.refit(changed);
  }

  private refit(backingChanged: boolean): void {
    computeView(this.mode, this.width, this.height, this.content.width, this.content.height, this.view);
    this.onChange(backingChanged, this.width, this.height);
  }

  /** Stops observing. */
  destroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
  }
}
