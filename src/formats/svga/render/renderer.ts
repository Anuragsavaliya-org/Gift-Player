import { GiftPlayerError } from '../../../core/errors';
import type { SvgaFrame, SvgaMovie, SvgaShape, SvgaSprite } from '../types';
import { compileShape, NO_DASH, PathCache, type CompiledShape } from './compile';
import { backingSize, computeView, type ContentMode, type View } from './view';

export type { ContentMode } from './view';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface SvgaRendererOptions {
  /** Default 'aspectFit'. */
  contentMode?: ContentMode;
  /** Default `window.devicePixelRatio || 1`. */
  devicePixelRatio?: number;
  /** Watch the canvas for CSS size changes and re-fit automatically. Default true. */
  observeResize?: boolean;
  /** Use this CSS size instead of reading `canvas.clientWidth/Height` (e.g. for detached canvases). */
  cssSize?: { width: number; height: number };
}

export interface TextStyle {
  /** CSS font family. Default 'sans-serif'. */
  font?: string;
  /** Pixels in viewBox units. Default 14. */
  size?: number;
  /** CSS font weight, e.g. 'bold' or 700. */
  weight?: string | number;
  /** Default '#000'. */
  color?: string;
  /** Alignment inside the sprite's layout rect. Default 'center'. */
  align?: 'left' | 'center' | 'right';
  stroke?: { color: string; width: number };
}

export interface ImageOptions {
  /** How the image fills the layout rect. Default 'fill' (stretch), like the original bitmap. */
  fit?: 'fill' | 'cover' | 'contain';
}

interface ImageReplacement {
  bitmap: ImageBitmap;
  /** True when the renderer created the bitmap (from a URL/Blob) and must close it. */
  owned: boolean;
  fit: 'fill' | 'cover' | 'contain';
}

interface TextReplacement {
  text: string;
  font: string;
  color: string;
  align: 'left' | 'center' | 'right';
  strokeColor: string | null;
  strokeWidth: number;
}

/**
 * One step of the draw list, computed at load time. Either a single unmasked sprite, or a *run*: a
 * maximal sequence of consecutive masked sprites sharing one matteKey, which is composited together
 * and masked ONCE, like the official players do (Android `saveLayer` + isMatteBegin/End, iOS hostLayer
 * with a mask). Per-run gives (A over B) x m; per-sprite would give (A x m) over (B x m).
 */
interface DrawItem {
  rt: Runtime | null;
  run: Runtime[] | null;
  matte: Runtime | null;
}

interface Runtime {
  sprite: SvgaSprite;
  bitmap: ImageBitmap | null;
  image: ImageReplacement | null;
  text: TextReplacement | null;
  hidden: boolean;
}

const warn = (msg: string) => console.warn(`[gift-player] ${msg}`);

/**
 * Canvas2D renderer for a parsed SVGA movie. `drawFrame(i)` is the core: the same frame always
 * yields the same pixels (no time or randomness involved).
 *
 * Ownership: the renderer takes ownership of `bitmaps` (and of bitmaps it creates for replacements)
 * and closes them in `destroy()`. ImageBitmaps the caller passes to `setImage` are not closed.
 *
 * The canvas must be sized by CSS (e.g. `width:100%; height:100%`); the renderer sizes the backing
 * store from that CSS size times the device pixel ratio.
 */
export class SvgaRenderer {
  private readonly movie: SvgaMovie;
  private readonly ctx: Ctx2D;
  private readonly runtimes: Runtime[] = [];
  private readonly items: DrawItem[] = [];
  private readonly byKey = new Map<string, Runtime[]>();
  private readonly paths = new PathCache();
  private readonly compiled = new WeakMap<SvgaShape, CompiledShape | null>();
  private readonly replacementImages = new Map<string, ImageReplacement>();
  private readonly imageTokens = new Map<string, number>();
  private readonly dprOverride: number | undefined;
  private readonly cssOverride: { width: number; height: number } | undefined;
  private readonly observer: ResizeObserver | null = null;
  private offscreen: HTMLCanvasElement | OffscreenCanvas | null = null;
  private offCtx: Ctx2D | null = null;
  private bitmaps: Map<string, ImageBitmap>;
  private mode: ContentMode;
  private readonly view: View = { sx: 1, sy: 1, ox: 0, oy: 0 };
  private width = 1;
  private height = 1;
  private lastCssW = -1;
  private lastCssH = -1;
  private current = -1;
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    movie: SvgaMovie,
    bitmaps: Map<string, ImageBitmap>,
    options: SvgaRendererOptions = {},
  ) {
    this.movie = movie;
    this.bitmaps = bitmaps;
    this.mode = options.contentMode ?? 'aspectFit';
    this.dprOverride = options.devicePixelRatio;
    this.cssOverride = options.cssSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new GiftPlayerError('invalid-input', 'Could not get a 2D context from the canvas.');
    this.ctx = ctx;

    const matteByKey = new Map<string, Runtime>();
    for (const sprite of movie.sprites) {
      const rt: Runtime = {
        sprite,
        // Matte bitmaps are stored under the key without the ".matte" suffix.
        bitmap: bitmaps.get(sprite.imageKey) ?? (sprite.isMatte ? bitmaps.get(sprite.imageKey.slice(0, -'.matte'.length)) ?? null : null),
        image: null,
        text: null,
        hidden: false,
      };
      this.runtimes.push(rt);
      const list = this.byKey.get(sprite.imageKey);
      if (list) list.push(rt);
      else this.byKey.set(sprite.imageKey, [rt]);
      if (sprite.isMatte && !matteByKey.has(sprite.imageKey)) matteByKey.set(sprite.imageKey, rt);
      this.precompile(sprite);
    }
    // Matte sprites are skipped and do not break a run. An unmasked sprite, or a matteKey that matches no
    // matte sprite (dangling), ends the current run and is drawn directly.
    let needsOffscreen = false;
    let run: Runtime[] | null = null;
    let runKey = '';
    for (const rt of this.runtimes) {
      if (rt.sprite.isMatte) continue;
      const key = rt.sprite.matteKey;
      const matte = key ? matteByKey.get(key) : undefined;
      if (key && matte) {
        if (run && runKey === key) run.push(rt);
        else {
          run = [rt];
          runKey = key;
          this.items.push({ rt: null, run, matte });
          needsOffscreen = true;
        }
      } else {
        run = null;
        runKey = '';
        this.items.push({ rt, run: null, matte: null });
      }
    }
    if (needsOffscreen) {
      this.offscreen = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : document.createElement('canvas');
      this.offCtx = this.offscreen.getContext('2d') as Ctx2D | null;
    }

    this.resize();
    if (options.observeResize !== false && typeof ResizeObserver !== 'undefined' && !this.cssOverride) {
      this.observer = new ResizeObserver(() => this.resize());
      this.observer.observe(canvas);
    }
  }

  /** Index of the last drawn frame, or -1. */
  get frame(): number {
    return this.current;
  }

  get contentMode(): ContentMode {
    return this.mode;
  }

  setContentMode(mode: ContentMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.refit();
  }

  /** Re-reads the CSS size and DPR, resizes the backing store, and redraws the current frame. */
  resize(): void {
    if (this.destroyed) return;
    const css = this.cssOverride ?? { width: this.canvas.clientWidth, height: this.canvas.clientHeight };
    // A canvas that is not laid out yet (0 size) falls back to the movie's own size.
    const cw = css.width > 0 ? css.width : this.movie.viewBox.width;
    const ch = css.height > 0 ? css.height : this.movie.viewBox.height;
    const dpr = this.dprOverride ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    const size = backingSize(cw, ch, dpr);
    const changed = size.width !== this.width || size.height !== this.height || this.lastCssW < 0;
    this.lastCssW = cw;
    this.lastCssH = ch;
    if (changed) {
      this.width = size.width;
      this.height = size.height;
      this.canvas.width = size.width; // also clears the canvas and resets its state
      this.canvas.height = size.height;
      if (this.offscreen) {
        this.offscreen.width = size.width;
        this.offscreen.height = size.height;
      }
    }
    this.refit();
  }

  private refit(): void {
    computeView(this.mode, this.width, this.height, this.movie.viewBox.width, this.movie.viewBox.height, this.view);
    if (this.current >= 0) this.drawFrame(this.current);
  }

  /** Draws frame `index` (clamped to the movie's range). */
  drawFrame(index: number): void {
    if (this.destroyed) return;
    const frames = this.movie.frames;
    let i = index | 0;
    if (i < 0) i = 0;
    else if (i >= frames) i = frames - 1;
    this.current = i;

    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.width, this.height);

    const items = this.items;
    for (let n = 0; n < items.length; n++) {
      const item = items[n]!;
      const run = item.run;
      if (run === null) {
        const rt = item.rt!;
        if (rt.hidden) continue;
        const frame = rt.sprite.frames[i]!;
        if (frame.alpha > 0) this.drawSprite(ctx, rt, frame);
        continue;
      }
      const matte = item.matte!;
      const matteFrame = matte.sprite.frames[i]!;
      // A hidden matte layer masks the whole run out (as in the official players).
      if (!(matteFrame.alpha > 0)) continue;
      const off = this.offCtx!;
      off.setTransform(1, 0, 0, 1, 0, 0);
      off.globalAlpha = 1;
      off.globalCompositeOperation = 'source-over';
      off.clearRect(0, 0, this.width, this.height);
      let any = false;
      for (let k = 0; k < run.length; k++) {
        const rt = run[k]!;
        if (rt.hidden) continue;
        const frame = rt.sprite.frames[i]!;
        if (!(frame.alpha > 0)) continue;
        this.drawSprite(off, rt, frame);
        any = true;
      }
      if (!any) continue;
      off.globalCompositeOperation = 'destination-in';
      this.drawSprite(off, matte, matteFrame);
      off.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.offscreen as CanvasImageSource, 0, 0);
    }
  }

  private drawSprite(ctx: Ctx2D, rt: Runtime, frame: SvgaFrame): void {
    const v = this.view;
    const t = frame.transform;
    ctx.save();
    ctx.globalAlpha = frame.alpha;
    ctx.setTransform(v.sx * t.a, v.sy * t.b, v.sx * t.c, v.sy * t.d, v.sx * t.tx + v.ox, v.sy * t.ty + v.oy);
    if (frame.clipPath !== '') ctx.clip(this.paths.svg(frame.clipPath));

    const l = frame.layout;
    const img = rt.image;
    if (img !== null) drawReplacement(ctx, img, l.x, l.y, l.width, l.height);
    else if (rt.bitmap !== null) {
      if (l.width > 0 && l.height > 0) ctx.drawImage(rt.bitmap, l.x, l.y, l.width, l.height);
      else ctx.drawImage(rt.bitmap, l.x, l.y);
    }

    const shapes = frame.shapes;
    for (let s = 0; s < shapes.length; s++) {
      const shape = shapes[s]!;
      const c = this.compiled.get(shape);
      if (!c) continue;
      const st = shape.transform;
      ctx.save();
      ctx.transform(st.a, st.b, st.c, st.d, st.tx, st.ty);
      if (c.fill !== null) {
        ctx.fillStyle = c.fill;
        ctx.fill(c.path);
      }
      if (c.stroke !== null) {
        ctx.strokeStyle = c.stroke;
        ctx.lineWidth = c.lineWidth;
        ctx.lineCap = c.lineCap;
        ctx.lineJoin = c.lineJoin;
        if (c.miterLimit > 0) ctx.miterLimit = c.miterLimit;
        ctx.setLineDash(c.dash);
        ctx.lineDashOffset = c.dashOffset;
        ctx.stroke(c.path);
      }
      ctx.restore();
    }

    const text = rt.text;
    if (text !== null) drawText(ctx, text, l.x, l.y, l.width, l.height);
    ctx.restore();
  }

  // ---- dynamic replacement -------------------------------------------------------------------

  /**
   * Replaces the bitmap of every sprite whose imageKey is `key`. The image is drawn into the
   * sprite's layout rect; the sprite's clip and matte still apply. Survives seek and looping.
   * Unknown keys log a warning and do nothing.
   */
  async setImage(key: string, source: ImageBitmap | Blob | string, options: ImageOptions = {}): Promise<void> {
    if (!this.knows(key)) return;
    const token = (this.imageTokens.get(key) ?? 0) + 1;
    this.imageTokens.set(key, token);
    let bitmap: ImageBitmap;
    let owned = true;
    if (typeof ImageBitmap !== 'undefined' && source instanceof ImageBitmap) {
      bitmap = source;
      owned = false;
    } else if (typeof source === 'string') {
      let res: Response;
      try {
        res = await fetch(source);
      } catch (cause) {
        throw new GiftPlayerError('fetch-failed', `Failed to fetch image ${source}`, { cause });
      }
      if (!res.ok) throw new GiftPlayerError('fetch-failed', `Failed to fetch image ${source}: HTTP ${res.status}`);
      bitmap = await createImageBitmap(await res.blob());
    } else {
      bitmap = await createImageBitmap(source);
    }
    // A newer setImage/clear for the same key (or destroy) won the race while we were decoding.
    if (this.destroyed || this.imageTokens.get(key) !== token) {
      if (owned) bitmap.close();
      return;
    }
    this.releaseReplacement(key);
    const repl: ImageReplacement = { bitmap, owned, fit: options.fit ?? 'fill' };
    this.replacementImages.set(key, repl);
    for (const rt of this.byKey.get(key)!) rt.image = repl;
    this.redraw();
  }

  /**
   * Draws `text` centred (by default) in the layout rect of every sprite whose imageKey is `key`,
   * on top of its bitmap. Text wider than the layout rect is squeezed to fit.
   */
  setText(key: string, text: string, style: TextStyle = {}): void {
    if (!this.knows(key)) return;
    const size = style.size ?? 14;
    const weight = style.weight === undefined ? '' : `${style.weight} `;
    const repl: TextReplacement = {
      text,
      font: `${weight}${size}px ${style.font ?? 'sans-serif'}`,
      color: style.color ?? '#000',
      align: style.align ?? 'center',
      strokeColor: style.stroke?.color ?? null,
      strokeWidth: style.stroke?.width ?? 0,
    };
    for (const rt of this.byKey.get(key)!) rt.text = repl;
    this.redraw();
  }

  /** Hides (or shows again) every sprite whose imageKey is `key`. */
  setHidden(key: string, hidden: boolean): void {
    if (!this.knows(key)) return;
    for (const rt of this.byKey.get(key)!) rt.hidden = hidden;
    this.redraw();
  }

  /** Removes any image/text replacement and un-hides the sprites for `key`. */
  clearReplacement(key: string): void {
    if (!this.knows(key)) return;
    this.imageTokens.set(key, (this.imageTokens.get(key) ?? 0) + 1); // cancel an in-flight setImage
    this.releaseReplacement(key);
    for (const rt of this.byKey.get(key)!) {
      rt.image = null;
      rt.text = null;
      rt.hidden = false;
    }
    this.redraw();
  }

  private knows(key: string): boolean {
    if (this.byKey.has(key)) return true;
    warn(`unknown key "${key}": no sprite uses it, ignoring.`);
    return false;
  }

  private releaseReplacement(key: string): void {
    const old = this.replacementImages.get(key);
    if (!old) return;
    this.replacementImages.delete(key);
    for (const rt of this.byKey.get(key) ?? []) if (rt.image === old) rt.image = null;
    if (old.owned) old.bitmap.close();
  }

  private redraw(): void {
    if (this.current >= 0) this.drawFrame(this.current);
  }

  // ---- lifecycle -------------------------------------------------------------------------------

  /** Stops observing, closes every bitmap it owns, and drops all caches. Safe to call twice. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer?.disconnect();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.width, this.height);
    for (const key of [...this.replacementImages.keys()]) this.releaseReplacement(key);
    for (const b of this.bitmaps.values()) b.close();
    this.bitmaps.clear();
    for (const rt of this.runtimes) {
      rt.bitmap = null;
      rt.image = null;
    }
    this.runtimes.length = 0;
    this.items.length = 0;
    this.byKey.clear();
    this.paths.clear();
    if (this.offscreen) {
      this.offscreen.width = 0; // release the backing store
      this.offscreen.height = 0;
    }
    this.offscreen = null;
    this.offCtx = null;
  }

  private precompile(sprite: SvgaSprite): void {
    for (const frame of sprite.frames) {
      if (frame.clipPath !== '') this.paths.svg(frame.clipPath);
      for (const shape of frame.shapes) {
        if (!this.compiled.has(shape)) this.compiled.set(shape, compileShape(shape, this.paths));
      }
    }
  }
}

function drawReplacement(ctx: Ctx2D, r: ImageReplacement, x: number, y: number, w: number, h: number): void {
  const bmp = r.bitmap;
  if (!(w > 0 && h > 0)) {
    ctx.drawImage(bmp, x, y);
    return;
  }
  if (r.fit === 'fill') {
    ctx.drawImage(bmp, x, y, w, h);
    return;
  }
  const scale = r.fit === 'cover' ? Math.max(w / bmp.width, h / bmp.height) : Math.min(w / bmp.width, h / bmp.height);
  if (r.fit === 'cover') {
    const sw = w / scale;
    const sh = h / scale;
    ctx.drawImage(bmp, (bmp.width - sw) / 2, (bmp.height - sh) / 2, sw, sh, x, y, w, h);
  } else {
    const dw = bmp.width * scale;
    const dh = bmp.height * scale;
    ctx.drawImage(bmp, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }
}

function drawText(ctx: Ctx2D, t: TextReplacement, x: number, y: number, w: number, h: number): void {
  ctx.font = t.font;
  ctx.textAlign = t.align;
  ctx.textBaseline = 'middle';
  const tx = t.align === 'left' ? x : t.align === 'right' ? x + w : x + w / 2;
  const ty = y + h / 2;
  if (t.strokeColor !== null && t.strokeWidth > 0) {
    ctx.strokeStyle = t.strokeColor;
    ctx.lineWidth = t.strokeWidth;
    ctx.lineJoin = 'round';
    ctx.setLineDash(NO_DASH);
    if (w > 0) ctx.strokeText(t.text, tx, ty, w);
    else ctx.strokeText(t.text, tx, ty);
  }
  ctx.fillStyle = t.color;
  if (w > 0) ctx.fillText(t.text, tx, ty, w);
  else ctx.fillText(t.text, tx, ty);
}
