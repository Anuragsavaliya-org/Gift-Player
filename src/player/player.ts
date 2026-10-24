import { AssetCache } from '../cache/asset-cache';
import { Emitter } from '../core/emitter';
import { GiftPlayerError } from '../core/errors';
import { resolveLoops, type EditableKey, type FrameSource } from '../core/frame-source';
import type { ImageOptions, TextStyle } from '../core/replacement';
import type { GiftSource } from '../core/source';
import { Ticker } from '../core/ticker';
import type { ContentMode } from '../core/viewport';
import { AnimatedImageRenderer } from '../formats/image/renderer';
import type { PagEngineOptions } from '../formats/pag/engine';
import { PagRenderer } from '../formats/pag/renderer';
import { SvgaRenderer } from '../formats/svga/render/renderer';
import { acquireGift, registerResolver, type GiftLease, type LoadedGift, type SourceResolver } from './asset';

/** An image that can replace a layer: an `ImageBitmap` (never closed by the SDK), a `Blob`/`File`, or a URL. */
export type ReplacementImage = ImageBitmap | Blob | string;

/** One replacement, applied before the first frame when passed to `load()`. */
export type Replacement =
  | { text: string; style?: TextStyle }
  | { image: ReplacementImage; options?: ImageOptions }
  | { hidden: boolean };

/** Replacements by key (`getEditableKeys()` lists the keys). */
export type Replacements = Record<string, Replacement>;

/** Options for `new GiftPlayer(container, options)`. */
export interface GiftPlayerOptions {
  /** How the gift fits the container. Default 'aspectFit'. */
  contentMode?: ContentMode;
  /** Number of plays; 0 or Infinity = forever. Default: the file's own count, else once. `load()` can override per gift. */
  loops?: number;
  /** Pause while the page is hidden and continue from the same frame afterwards. Default true. */
  pauseWhenHidden?: boolean;
  /** Default `window.devicePixelRatio`. */
  devicePixelRatio?: number;
  /** Re-fit when the container is resized. Default true. */
  observeResize?: boolean;
  /** Share decoded gifts with other players through this cache. Default: the module-wide cache (64 MB). */
  cache?: AssetCache<LoadedGift>;
  /** How long a still GIF / WebP is shown, ms. Default 2000. */
  staticDurationMs?: number;
  /** PAG engine location (default: the pinned jsDelivr copy). */
  pagModuleUrl?: string;
  pagWasmUrl?: string;
  pagModule?: PagEngineOptions['pagModule'];
}

/** Options for `player.load(src, options)`. */
export interface LoadOptions {
  /** Applied before the first frame is drawn, so the original text never flashes. Unknown keys warn and are skipped. */
  replacements?: Replacements;
  /** Aborting rejects `load()` with code `aborted`. */
  signal?: AbortSignal;
  /** Number of plays for this gift (overrides the player option and the file). 0 = forever. */
  loops?: number;
}

/** What `load()` resolves to. */
export interface GiftInfo {
  format: 'svga' | 'gif' | 'webp' | 'pag';
  width: number;
  height: number;
  frameCount: number;
  /** Length of one play in milliseconds. */
  durationMs: number;
  /** Layers that `setText` / `setImage` / `setHidden` accept (empty for GIF and WebP). */
  editableKeys: EditableKey[];
}

/** Events and their payloads. `frame` costs a call per frame, so it is only produced while someone listens. */
export interface GiftPlayerEvents {
  /** A gift is loaded and its first frame is on the canvas. */
  loaded: GiftInfo;
  /** The first frame of a `play()` is on screen. */
  start: undefined;
  /** A play finished and another begins; `count` = plays completed so far. */
  loop: { count: number };
  /** The last play finished. */
  end: undefined;
  /** A load or render error (also thrown by the call that caused it). Aborts are not errors. */
  error: GiftPlayerError;
  /** The frame index changed (opt-in: only emitted while a listener exists). */
  frame: number;
}

/** What every renderer offers beyond `FrameSource`; GIF and WebP have no replaceable layers. */
interface Renderer extends FrameSource {
  readonly size?: { width: number; height: number };
  setText?(key: string, text: string, style?: TextStyle): void;
  setImage?(key: string, source: ReplacementImage, options?: ImageOptions): Promise<void>;
  setHidden?(key: string, hidden: boolean): void;
  clearReplacement?(key: string): void;
  setContentMode?(mode: ContentMode): void;
}

let defaultCache: AssetCache<LoadedGift> | null = null;
/** The module-wide cache, created on first use (never at import time, so importing the package is side-effect free). */
export function getDefaultCache(): AssetCache<LoadedGift> {
  return (defaultCache ??= new AssetCache<LoadedGift>());
}

const aborted = (why: string) => new GiftPlayerError('aborted', why);
const toError = (e: unknown): GiftPlayerError => (e instanceof GiftPlayerError ? e : new GiftPlayerError('decode-failed', e instanceof Error ? e.message : String(e), { cause: e }));
const warn = (msg: string) => console.warn(`[gift-player] ${msg}`);

interface Pending {
  promise: Promise<void>;
  resolve(): void;
  reject(e: unknown): void;
}

/**
 * Plays one gift at a time (SVGA, GIF, WebP or PAG) in a canvas it creates inside `container`. The container must have a size
 * (the canvas is `width:100%; height:100%`). One player can `load()` many gifts in a row and reuses its canvas.
 *
 * ```ts
 * const player = new GiftPlayer(el, { contentMode: 'aspectFit' });
 * await player.load('https://cdn.example/rocket.svga', { replacements: { name: { text: 'Rahul' } } });
 * await player.play(); // resolves when the last play ends
 * player.destroy();
 * ```
 */
export class GiftPlayer {
  private readonly events = new Emitter<GiftPlayerEvents>();
  private readonly canvas: HTMLCanvasElement;
  private readonly cache: AssetCache<LoadedGift>;
  private readonly pag: PagEngineOptions;
  private renderer: Renderer | null = null;
  private lease: GiftLease | null = null;
  private ticker: Ticker | null = null;
  private info: GiftInfo | null = null;
  private token = 0;
  private loadAbort: AbortController | null = null;
  private tail: Promise<void> = Promise.resolve();
  private pending: Pending | null = null;
  private userPaused = false;
  private autoPaused = false;
  private destroyed = false;
  private started = false;
  private lastFrame = -1;
  private loopsDone = 0;
  private swapMs = 0;
  private readonly onVisibility = () => this.visibilityChanged();

  /**
   * @param container Element that will contain the canvas. Give it a size (CSS).
   */
  constructor(
    private readonly container: HTMLElement,
    private readonly options: GiftPlayerOptions = {},
  ) {
    if (typeof document === 'undefined') throw new GiftPlayerError('invalid-input', 'GiftPlayer needs a DOM; construct it in the browser (importing the package on the server is fine).');
    this.cache = options.cache ?? getDefaultCache();
    this.pag = { pagModuleUrl: options.pagModuleUrl, pagWasmUrl: options.pagWasmUrl, pagModule: options.pagModule };
    this.canvas = document.createElement('canvas');
    this.canvas.style.cssText = 'display:block;width:100%;height:100%';
    container.appendChild(this.canvas);
    if (options.pauseWhenHidden !== false) document.addEventListener('visibilitychange', this.onVisibility);
  }

  // ---- loading -----------------------------------------------------------------------------------------------------

  /**
   * Loads a gift (URL, `scheme:ref` for a registered resolver, ArrayBuffer, or Blob/File) and shows its first frame; call `play()` to
   * animate. A second `load()` while one is in flight aborts the first (which rejects with `aborted` and never reaches the screen).
   * The previous gift stays on screen and keeps playing while the new one downloads; it is replaced at the moment the new one is ready.
   */
  async load(src: GiftSource, options: LoadOptions = {}): Promise<GiftInfo> {
    if (this.destroyed) throw aborted('The player is destroyed.');
    const token = ++this.token;
    this.loadAbort?.abort();
    const ctl = (this.loadAbort = new AbortController());
    const onUserAbort = () => ctl.abort();
    if (options.signal?.aborted) ctl.abort();
    options.signal?.addEventListener('abort', onUserAbort, { once: true });
    const stale = () => this.token !== token || ctl.signal.aborted || this.destroyed;
    const wait = this.tail;
    let done!: () => void;
    this.tail = new Promise<void>((r) => (done = r));
    let lease: GiftLease | null = null;
    try {
      if (stale()) throw aborted('The load was aborted.');
      lease = await acquireGift(this.cache, src, this.pag, ctl.signal);
      await wait; // another load may still be swapping the canvas content
      if (stale()) throw aborted('The load was aborted.');

      // From here on the old gift is replaced; everything is synchronous or guarded by `stale()`.
      const swapStart = performance.now();
      this.teardown(aborted('A new gift was loaded.'));
      const renderer = await this.createRenderer(lease.gift);
      if (stale()) {
        renderer.destroy();
        throw aborted('The load was aborted.');
      }
      this.renderer = renderer;
      this.lease = lease;
      lease = null;
      this.applyReplacements(renderer, options.replacements);
      await this.awaitReplacementImages(renderer, options.replacements);
      if (stale()) {
        this.teardown(aborted('The load was aborted.'));
        throw aborted('The load was aborted.');
      }
      const loops = resolveLoops(options.loops ?? this.options.loops, renderer);
      this.ticker = new Ticker({
        frames: renderer.frameCount,
        frameDuration: (i) => renderer.frameDuration(i),
        loops,
        onFrame: (f) => this.onFrame(f),
        onEnd: () => this.onEnd(),
      });
      this.userPaused = false;
      this.autoPaused = false;
      renderer.drawFrame(0);
      await renderer.ready(0);
      if (stale()) {
        this.teardown(aborted('The load was aborted.'));
        throw aborted('The load was aborted.');
      }
      renderer.drawFrame(0);
      this.swapMs = performance.now() - swapStart;
      const info = this.describe(this.lease!.gift, renderer);
      this.info = info;
      this.events.emit('loaded', info);
      return info;
    } catch (e) {
      lease?.release();
      const err = toError(e);
      if (err.code !== 'aborted') this.events.emit('error', err);
      throw err;
    } finally {
      options.signal?.removeEventListener('abort', onUserAbort);
      if (this.loadAbort === ctl) this.loadAbort = null;
      done();
    }
  }

  private async createRenderer(gift: LoadedGift): Promise<Renderer> {
    const view = { contentMode: this.options.contentMode, devicePixelRatio: this.options.devicePixelRatio, observeResize: this.options.observeResize };
    const onError = (e: unknown) => {
      if (!this.destroyed) this.events.emit('error', toError(e));
    };
    try {
      if (gift.svga) return new SvgaRenderer(this.canvas, gift.svga.movie, gift.svga.images, { ...view, sharedImages: true });
      if (gift.info.format === 'pag') return await PagRenderer.create(this.canvas, gift.bytes, { ...view, ...this.pag, onError });
      return await AnimatedImageRenderer.create(this.canvas, gift.bytes, { ...view, staticDurationMs: this.options.staticDurationMs, onError });
    } catch (e) {
      throw toError(e);
    }
  }

  private describe(gift: LoadedGift, r: Renderer): GiftInfo {
    let total = 0;
    for (let i = 0; i < r.frameCount; i++) total += r.frameDuration(i);
    const size = r.size ?? (gift.svga ? { ...gift.svga.movie.viewBox } : { width: this.canvas.width, height: this.canvas.height });
    return { format: gift.info.format, width: size.width, height: size.height, frameCount: r.frameCount, durationMs: Math.round(total * 1000) / 1000, editableKeys: r.getEditableKeys?.() ?? [] };
  }

  private applyReplacements(r: Renderer, repl: Replacements | undefined): void {
    if (!repl) return;
    for (const [key, v] of Object.entries(repl)) {
      if ('text' in v) this.callText(r, key, v.text, v.style);
      else if ('hidden' in v) r.setHidden?.(key, v.hidden);
    }
  }

  private async awaitReplacementImages(r: Renderer, repl: Replacements | undefined): Promise<void> {
    if (!repl) return;
    const jobs: Promise<void>[] = [];
    for (const [key, v] of Object.entries(repl)) if ('image' in v) jobs.push(this.callImage(r, key, v.image, v.options));
    // A broken replacement image must not take the whole gift down: report it and show the gift without it.
    const results = await Promise.allSettled(jobs);
    for (const res of results) if (res.status === 'rejected') this.events.emit('error', toError(res.reason));
  }

  // ---- playback ----------------------------------------------------------------------------------------------------

  /**
   * Plays the loaded gift from the start (or resumes a paused one). Resolves when the last play ends; rejects with `aborted` when the
   * gift is stopped, replaced by `load()`, or the player is destroyed, and with the error when playback fails.
   */
  play(): Promise<void> {
    if (!this.ticker || !this.renderer) return Promise.reject(new GiftPlayerError('invalid-input', 'Nothing is loaded: await load() first.'));
    if (this.pending) {
      this.resume();
      return this.pending.promise;
    }
    let resolve!: () => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<void>((res, rej) => ((resolve = res), (reject = rej)));
    this.pending = { promise, resolve, reject };
    this.started = false;
    this.lastFrame = -1;
    this.loopsDone = 0;
    this.userPaused = false;
    this.autoPaused = false;
    if (typeof document !== 'undefined' && document.hidden && this.options.pauseWhenHidden !== false) this.autoPaused = true;
    else this.ticker.play();
    return promise;
  }

  /** Pauses on the current frame. `play()` or `resume()` continues from it. */
  pause(): void {
    if (!this.ticker) return;
    this.userPaused = true;
    this.ticker.pause();
  }

  /** Continues after `pause()` from the same frame (no catching up). */
  resume(): void {
    if (!this.ticker || !this.pending) return;
    this.userPaused = false;
    if (typeof document !== 'undefined' && document.hidden && this.options.pauseWhenHidden !== false) {
      this.autoPaused = true;
      return;
    }
    this.ticker.play();
  }

  /** Stops and rewinds to the first frame, which stays on screen. A pending `play()` rejects with `aborted`. */
  stop(): void {
    if (!this.ticker || !this.renderer) return;
    this.ticker.stop();
    this.userPaused = false;
    this.autoPaused = false;
    this.renderer.drawFrame(0);
    this.settle(aborted('Playback was stopped.'));
  }

  /** Shows frame `frame` (clamped); keeps playing if it was playing. */
  seek(frame: number): void {
    if (!this.ticker) return;
    this.ticker.seek(frame);
  }

  /**
   * Milliseconds the canvas was blank during the last `load()`: from the moment the previous gift was removed until the new gift's
   * first frame was drawn. (Before that moment the previous gift stays on screen while the new one downloads.)
   */
  get lastSwapMs(): number {
    return this.swapMs;
  }

  /** True while frames are being advanced. */
  get playing(): boolean {
    return !!this.ticker?.playing;
  }

  /** What `load()` returned for the current gift, or null. */
  get current(): GiftInfo | null {
    return this.info;
  }

  /** Changes how the current and later gifts fit the container. */
  setContentMode(mode: ContentMode): void {
    (this.options as { contentMode?: ContentMode }).contentMode = mode;
    this.renderer?.setContentMode?.(mode);
  }

  private onFrame(f: number): void {
    const r = this.renderer;
    if (!r) return;
    const drawn = r.drawFrame(f);
    if (this.lastFrame >= 0 && f < this.lastFrame) {
      this.loopsDone++;
      this.events.emit('loop', { count: this.loopsDone });
    }
    this.lastFrame = f;
    if (!this.started) {
      this.started = true;
      if (drawn) this.events.emit('start', undefined);
      else void r.ready(f).then(() => !this.destroyed && this.renderer === r && this.events.emit('start', undefined));
    }
    if (this.events.has('frame')) this.events.emit('frame', f);
  }

  private onEnd(): void {
    this.events.emit('end', undefined);
    this.settle(null);
  }

  private settle(error: unknown): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    if (error) {
      p.promise.catch(() => {}); // the caller may not be awaiting; the rejection is theirs to handle
      p.reject(error);
    } else p.resolve();
  }

  private visibilityChanged(): void {
    if (this.destroyed || !this.ticker) return;
    if (document.hidden) {
      if (this.ticker.playing) {
        this.ticker.pause(); // frame and elapsed time are kept: resuming continues from this frame
        this.autoPaused = true;
      }
    } else if (this.autoPaused) {
      this.autoPaused = false;
      if (!this.userPaused && this.pending) this.ticker.play();
    }
  }

  // ---- replacement -------------------------------------------------------------------------------------------------

  /** Replaces the text of a layer (SVGA sprite key, or PAG text layer name / `#index`). Survives seeking and looping. */
  setText(key: string, text: string, style?: TextStyle): void {
    if (this.renderer) this.callText(this.renderer, key, text, style);
  }

  /** Replaces a layer's picture. Resolves once it is decoded and on screen. */
  setImage(key: string, source: ReplacementImage, options?: ImageOptions): Promise<void> {
    return this.renderer ? this.callImage(this.renderer, key, source, options) : Promise.resolve();
  }

  setHidden(key: string, hidden: boolean): void {
    this.renderer?.setHidden?.(key, hidden);
  }

  /** Puts the original text / picture / visibility of `key` back. */
  clearReplacement(key: string): void {
    this.renderer?.clearReplacement?.(key);
  }

  /** The layers `setText` / `setImage` / `setHidden` accept for the current gift. */
  getEditableKeys(): EditableKey[] {
    return this.renderer?.getEditableKeys?.() ?? [];
  }

  private callText(r: Renderer, key: string, text: string, style?: TextStyle): void {
    if (!r.setText) return warn('this format has no replaceable text (GIF and WebP are plain pictures).');
    r.setText(key, text, style);
  }

  private callImage(r: Renderer, key: string, source: ReplacementImage, options?: ImageOptions): Promise<void> {
    if (!r.setImage) {
      warn('this format has no replaceable images (GIF and WebP are plain pictures).');
      return Promise.resolve();
    }
    return r.setImage(key, source, options);
  }

  // ---- events and lifecycle ----------------------------------------------------------------------------------------

  /** Subscribes to an event; returns the unsubscribe function. */
  on<K extends keyof GiftPlayerEvents>(event: K, fn: (payload: GiftPlayerEvents[K]) => void): () => void {
    return this.events.on(event, fn);
  }

  off<K extends keyof GiftPlayerEvents>(event: K, fn: (payload: GiftPlayerEvents[K]) => void): void {
    this.events.off(event, fn);
  }

  /**
   * Takes a hold on a gift in the cache without showing it (the queue uses this to prepare the next gift). Release it when done.
   * @internal
   */
  hold(src: GiftSource, signal?: AbortSignal): Promise<{ release(): void }> {
    return acquireGift(this.cache, src, this.pag, signal);
  }

  /** Stops everything, aborts a load in flight, releases the gift and removes the canvas. Safe to call more than once. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.token++;
    this.loadAbort?.abort();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.teardown(aborted('The player was destroyed.'));
    this.events.clear();
    this.canvas.remove();
  }

  private teardown(reason: GiftPlayerError): void {
    this.ticker?.destroy();
    this.ticker = null;
    this.settle(reason);
    this.renderer?.destroy();
    this.renderer = null;
    this.lease?.release();
    this.lease = null;
    this.info = null;
  }

  // ---- module level ------------------------------------------------------------------------------------------------

  /**
   * Fetches, parses and decodes gifts into the shared cache so a later `load()` is instant. Never rejects: the result says what
   * happened per source. Gifts handed over as ArrayBuffer/Blob are not cached and are skipped.
   */
  static async preload(srcs: GiftSource | GiftSource[], options: PreloadOptions = {}): Promise<PreloadResult[]> {
    const cache = options.cache ?? getDefaultCache();
    const pag: PagEngineOptions = { pagModuleUrl: options.pagModuleUrl, pagWasmUrl: options.pagWasmUrl, pagModule: options.pagModule };
    const list = Array.isArray(srcs) ? srcs : [srcs];
    return Promise.all(
      list.map(async (src): Promise<PreloadResult> => {
        if (typeof src !== 'string') return { src, status: 'skipped' };
        try {
          (await acquireGift(cache, src, pag, options.signal)).release();
          return { src, status: 'cached' };
        } catch (e) {
          return { src, status: 'failed', error: toError(e) };
        }
      }),
    );
  }

  /**
   * Teaches `load()` a source scheme, e.g. `GiftPlayer.registerResolver('gift', async (id) => `https://cdn.example/${id}.svga`)` so
   * `player.load('gift:12345')` works. The resolver returns a URL, or the file itself (ArrayBuffer / Blob). Returns an unregister function.
   */
  static registerResolver(scheme: string, resolver: SourceResolver): () => void {
    return registerResolver(scheme, resolver);
  }

  /** The cache players use by default; `getCache().stats` shows bytes, hits and evictions. */
  static getCache(): AssetCache<LoadedGift> {
    return getDefaultCache();
  }

  /** Sets the budget of the default cache, in estimated decoded bytes (default 64 MB). */
  static setCacheBudget(maxBytes: number): void {
    getDefaultCache().setMaxBytes(maxBytes);
  }
}

/** Options for `GiftPlayer.preload()`. */
export interface PreloadOptions extends PagEngineOptions {
  /** Default: the module-wide cache. */
  cache?: AssetCache<LoadedGift>;
  signal?: AbortSignal;
}

/** Outcome of preloading one source: `cached`, `skipped` (not a cacheable source), or `failed` with the error. */
export type PreloadResult = { src: GiftSource; status: 'cached' | 'skipped' } | { src: GiftSource; status: 'failed'; error: GiftPlayerError };
