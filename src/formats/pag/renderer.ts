import { parseCssColor } from '../../core/color';
import { GiftPlayerError } from '../../core/errors';
import type { EditableKey, FrameSource } from '../../core/frame-source';
import type { ImageOptions, TextStyle } from '../../core/replacement';
import { Viewport, type ContentMode, type ViewportOptions } from '../../core/viewport';
import { loadPagEngine, type PagEngine, type PagEngineOptions } from './engine';
import {
  LAYER_IMAGE,
  LAYER_TEXT,
  SCALE_LETTERBOX,
  SCALE_STRETCH,
  SCALE_ZOOM,
  type PagFileLike,
  type PagImageLike,
  type PagLayerLike,
  type PagModuleLike,
  type PagTextDocument,
  type PagTextLayerLike,
  type PagVec,
  type PagViewLike,
} from './types';

/** Options for `PagRenderer.create`. */
export interface PagRendererOptions extends ViewportOptions, PagEngineOptions {
  /** Called when a frame fails to render asynchronously. Default: console.error. */
  onError?: (error: unknown) => void;
}

interface Owned {
  pag: PagImageLike;
  bitmap: ImageBitmap;
  owned: boolean;
}

const warn = (msg: string) => console.warn(`[gift-player] ${msg}`);

/**
 * Scripts that need shaping (Indic, Arabic, Hebrew, Thai, Khmer, Myanmar, ...) or right-to-left ordering. libpag draws text
 * glyph by glyph without a shaper, so these render wrongly in PAG text layers (SVGA, which uses the browser's own text
 * drawing, is fine).
 */
const COMPLEX_SCRIPT = /[\u0590-\u08FF\u0900-\u0DFF\u0E00-\u0EFF\u0F00-\u0FFF\u1000-\u109F\u1780-\u17FF\uFB1D-\uFDFF\uFE70-\uFEFF]/;
const SCALE: Record<ContentMode, number> = { aspectFit: SCALE_LETTERBOX, fill: SCALE_STRETCH, aspectFill: SCALE_ZOOM };
const FIT_SCALE = { fill: SCALE_STRETCH, contain: SCALE_LETTERBOX, cover: SCALE_ZOOM } as const;
const JUSTIFY = { left: 0, center: 1, right: 2 } as const;

function vecToArray<T>(vec: PagVec<T>): T[] {
  const out: T[] = [];
  for (let i = 0; i < vec.size(); i++) out.push(vec.get(i));
  return out;
}

/**
 * PAG (libpag) behind the same `FrameSource` contract as every other format. libpag renders with WebGL; we run it in its
 * Canvas2D mode, in which every view shares ONE WebGL context and the finished frame is copied into our 2D canvas, so any
 * number of gifts can come and go with a constant number of contexts. Our own `Ticker` drives it frame by frame
 * (`setProgress` + `flush`), so loops, events and seeking behave exactly as for SVGA / GIF / WebP.
 *
 * Frames are rendered asynchronously: `drawFrame(i)` returns false and the frame appears when libpag has flushed it;
 * if the clock moves on faster than libpag can render, intermediate frames are skipped (never queued).
 */
export class PagRenderer implements FrameSource {
  private view!: PagViewLike;
  private readonly vp: Viewport;
  private readonly fps: number;
  private readonly durationUs: number;
  private readonly count: number;
  private readonly keys: EditableKey[] = [];
  private readonly textIndexByKey = new Map<string, number>();
  private readonly imageIndexByKey = new Map<string, number>();
  private readonly originalText = new Map<number, Partial<PagTextDocument>>();
  private readonly images = new Map<number, Owned>();
  private readonly imageTokens = new Map<string, number>();
  private readonly waiters: { frame: number; resolve: () => void }[] = [];
  private wanted = 0;
  /** Frame currently on the canvas, or -1 (nothing, or it must be redrawn). */
  private current = -1;
  private pumping = false;
  private pumpDone: Promise<void> = Promise.resolve();
  private destroyed = false;
  private warnedComplexScript = false;
  private readonly released: Promise<void>;
  private releaseResolve!: () => void;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly engine: PagEngine,
    private readonly file: PagFileLike,
    private readonly onError: (e: unknown) => void,
    options: ViewportOptions,
  ) {
    this.fps = file.frameRate();
    this.durationUs = file.duration();
    this.count = Math.max(1, Math.round((this.durationUs * this.fps) / 1e6));
    this.released = new Promise((r) => (this.releaseResolve = r));
    // The canvas must have its final backing size before libpag creates its surface from it.
    this.vp = new Viewport(canvas, { width: file.width(), height: file.height() }, options, (backingChanged) => {
      if (!this.view || this.destroyed) return;
      if (backingChanged) this.view.updateSize();
      this.view.setScaleMode(SCALE[this.vp.contentMode]);
      this.requestRedraw();
    });
  }

  /** Loads the PAG engine (first use only), parses `bytes`, and returns a renderer ready for `drawFrame`. */
  static async create(canvas: HTMLCanvasElement, bytes: Uint8Array, options: PagRendererOptions = {}): Promise<PagRenderer> {
    const engine = await loadPagEngine(options);
    const { PAG } = engine;
    let file: PagFileLike;
    try {
      file = await PAG.PAGFile.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    } catch (cause) {
      throw new GiftPlayerError('parse-failed', 'The PAG engine could not parse this file (corrupt, or newer than the engine supports).', { cause });
    }
    const onError = options.onError ?? ((e) => console.error('[gift-player]', e));
    const r = new PagRenderer(canvas, engine, file, onError, options);
    try {
      const view = await PAG.PAGView.init(file, canvas, { useCanvas2D: true, useScale: false, firstFrame: false });
      if (!view) throw new Error('PAGView.init returned nothing');
      r.view = view;
    } catch (cause) {
      r.vp.destroy();
      file.destroy();
      throw new GiftPlayerError('unsupported-format', 'Could not create a PAG view (WebGL unavailable or out of memory).', { cause });
    }
    r.view.setScaleMode(SCALE[r.vp.contentMode]);
    r.buildEditable();
    return r;
  }

  // ---- FrameSource ------------------------------------------------------------------------------------------------

  get frameCount(): number {
    return this.count;
  }

  frameDuration(): number {
    return 1000 / this.fps;
  }

  /** PAG files carry no loop count. */
  get loopCount(): number | null {
    return null;
  }

  /** Intrinsic size of the composition. */
  get size(): { width: number; height: number } {
    return { width: this.file.width(), height: this.file.height() };
  }

  /** Milliseconds the engine took to load on this page (0 if another renderer had already loaded it). */
  get engineLoadMs(): number {
    return this.engine.loadMs;
  }

  get contentMode(): ContentMode {
    return this.vp.contentMode;
  }

  setContentMode(mode: ContentMode): void {
    this.vp.setContentMode(mode);
  }

  resize(): void {
    this.vp.resize();
  }

  /** progress (0..1) that libpag maps to the start of frame `i`. */
  private progressOf(i: number): number {
    return Math.min(1, ((i * 1e6) / this.fps + 1) / this.durationUs); // +1 microsecond: stay inside the frame
  }

  drawFrame(index: number): boolean {
    if (this.destroyed) return false;
    const i = Math.min(this.count - 1, Math.max(0, Math.floor(index)));
    this.wanted = i;
    if (this.current === i && !this.pumping) return true;
    void this.pump();
    return false;
  }

  /** Blanks the canvas (after any frame being rendered has landed); the next `drawFrame` paints again. */
  clear(): void {
    if (this.destroyed) return;
    this.wanted = -1;
    this.current = -1;
    this.settle();
    const blank = () => {
      if (this.destroyed || this.wanted >= 0) return;
      const ctx = this.canvas.getContext('2d');
      ctx?.setTransform(1, 0, 0, 1, 0, 0);
      ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    };
    blank();
    this.pumpDone.then(blank, blank); // a flush that was already running copies its frame in when it finishes
  }

  ready(index: number): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    const i = Math.min(this.count - 1, Math.max(0, Math.floor(index)));
    if (this.current === i && !this.pumping && this.wanted === i) return Promise.resolve();
    this.drawFrame(i);
    return new Promise((resolve) => this.waiters.push({ frame: i, resolve }));
  }

  /** Marks the canvas stale (after a size change or a replacement) and renders the wanted frame again. */
  private requestRedraw(): void {
    this.current = -1;
    if (!this.destroyed) void this.pump();
  }

  private pump(): Promise<void> {
    if (this.pumping) return this.pumpDone;
    this.pumping = true;
    this.pumpDone = (async () => {
      try {
        while (!this.destroyed && this.wanted >= 0 && this.current !== this.wanted) {
          const i = this.wanted;
          this.view.setProgress(this.progressOf(i));
          await this.view.flush();
          if (this.destroyed || this.wanted < 0) break; // cleared while rendering
          this.current = i;
          this.settle();
        }
      } catch (e) {
        if (!this.destroyed) this.onError(e);
      } finally {
        this.pumping = false;
        this.settle(true);
      }
    })();
    return this.pumpDone;
  }

  /** Resolves `ready()` waiters whose frame is on screen, or was skipped because a later frame was requested. */
  private settle(all = false): void {
    for (let k = this.waiters.length - 1; k >= 0; k--) {
      const w = this.waiters[k]!;
      if (all || this.current === w.frame || this.wanted !== w.frame) {
        this.waiters.splice(k, 1);
        w.resolve();
      }
    }
  }

  // ---- dynamic replacement ----------------------------------------------------------------------------------------

  private layerName(idx: number, type: number): string {
    const vec = this.file.getLayersByEditableIndex(idx, type);
    try {
      return vec.size() > 0 ? vec.get(0).layerName() : '';
    } finally {
      vec.delete?.();
    }
  }

  private buildEditable(): void {
    for (const [type, kind, map] of [
      [LAYER_TEXT, 'text', this.textIndexByKey],
      [LAYER_IMAGE, 'image', this.imageIndexByKey],
    ] as const) {
      const entries = this.file.getEditableIndices(type).map((index) => ({ index, name: this.layerName(index, type) }));
      for (const e of entries) {
        const unique = e.name !== '' && entries.filter((x) => x.name === e.name).length === 1;
        const key = unique ? e.name : `#${e.index}`;
        this.keys.push({ key, type: kind, index: e.index, name: e.name });
        map.set(key, e.index);
        map.set(`#${e.index}`, e.index);
        if (e.name !== '' && !map.has(e.name)) map.set(e.name, e.index); // ambiguous names still resolve (first wins)
      }
    }
  }

  /** The layers `setText` / `setImage` / `setHidden` can address: editable text and image layers (by name or `#index`). */
  getEditableKeys(): EditableKey[] {
    return this.keys.map((k) => ({ ...k }));
  }

  private layersNamed(key: string): PagLayerLike[] {
    const vec = this.file.getLayersByName(key);
    try {
      return vecToArray(vec);
    } finally {
      vec.delete?.();
    }
  }

  /**
   * Replaces the text of an editable text layer (by layer name or `#index`). If the key is not an editable layer but names an
   * ordinary text layer, that layer's text is set directly. Unknown keys log a warning and do nothing.
   */
  setText(key: string, text: string, style: TextStyle = {}): void {
    if (this.destroyed) return;
    if (!this.warnedComplexScript && COMPLEX_SCRIPT.test(text)) {
      this.warnedComplexScript = true; // once per player
      warn('PAG text layers cannot shape complex scripts: Devanagari, Gujarati and other Indic scripts, Arabic, Hebrew, Thai, ... are drawn glyph by glyph (wrong or missing marks, no joining, no right-to-left order). Latin, CJK and emoji are fine. Use an SVGA gift for personalised names in these scripts.');
    }
    const idx = this.textIndexByKey.get(key);
    if (idx !== undefined) {
      const doc = this.file.getTextData(idx);
      try {
        if (!this.originalText.has(idx)) {
          this.originalText.set(idx, { text: doc.text, fontSize: doc.fontSize, fontFamily: doc.fontFamily, fontStyle: doc.fontStyle, fillColor: { ...doc.fillColor }, strokeColor: { ...doc.strokeColor }, strokeWidth: doc.strokeWidth, applyStroke: doc.applyStroke, applyFill: doc.applyFill, justification: doc.justification, fauxBold: doc.fauxBold });
        }
        doc.text = text;
        if (style.size !== undefined) doc.fontSize = style.size;
        if (style.font !== undefined) doc.fontFamily = style.font;
        if (style.weight !== undefined) {
          const bold = style.weight === 'bold' || Number(style.weight) >= 600;
          doc.fauxBold = bold;
          doc.fontStyle = bold ? 'Bold' : 'Regular';
        }
        if (style.color !== undefined) {
          const c = parseCssColor(style.color);
          doc.fillColor = { red: c.r, green: c.g, blue: c.b };
          doc.applyFill = true;
        }
        if (style.align !== undefined) doc.justification = JUSTIFY[style.align];
        if (style.stroke) {
          const c = parseCssColor(style.stroke.color);
          doc.strokeColor = { red: c.r, green: c.g, blue: c.b };
          doc.strokeWidth = style.stroke.width;
          doc.applyStroke = style.stroke.width > 0;
        }
        this.file.replaceText(idx, doc);
      } finally {
        doc.delete?.();
      }
      this.requestRedraw();
      return;
    }
    const layers = this.layersNamed(key).filter((l) => l.layerType() === LAYER_TEXT);
    if (layers.length === 0) {
      warn(`unknown text key "${key}": not an editable text layer (editable: ${this.keys.filter((k) => k.type === 'text').map((k) => k.key).join(', ') || 'none'}).`);
      return;
    }
    for (const layer of layers) {
      const t = (layer.asTypeLayer?.() ?? layer) as PagLayerLike & Partial<PagTextLayerLike>;
      t.setText?.(text);
      if (style.size !== undefined) t.setFontSize?.(style.size);
      if (style.color !== undefined) {
        const c = parseCssColor(style.color);
        t.setFillColor?.({ red: c.r, green: c.g, blue: c.b });
      }
    }
    this.requestRedraw();
  }

  /**
   * Replaces the picture of an editable image layer (by layer name or `#index`). Blob and URL sources are decoded to an
   * ImageBitmap that the renderer owns; a caller-supplied ImageBitmap is used as is and never closed by us.
   */
  async setImage(key: string, source: ImageBitmap | Blob | string, options: ImageOptions = {}): Promise<void> {
    if (this.destroyed) return;
    const idx = this.imageIndexByKey.get(key);
    if (idx === undefined) {
      warn(`unknown image key "${key}": not an editable image layer (editable: ${this.keys.filter((k) => k.type === 'image').map((k) => k.key).join(', ') || 'none'}).`);
      return;
    }
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
        throw new GiftPlayerError('network', `Failed to fetch image ${source}`, { cause });
      }
      if (!res.ok) throw new GiftPlayerError('network', `Failed to fetch image ${source}: HTTP ${res.status}`);
      bitmap = await createImageBitmap(await res.blob());
    } else {
      bitmap = await createImageBitmap(source as Blob);
    }
    if (this.destroyed || this.imageTokens.get(key) !== token) {
      if (owned) bitmap.close();
      return;
    }
    const pag = this.engine.PAG.PAGImage.fromSource(bitmap);
    pag.setScaleMode(FIT_SCALE[options.fit ?? 'fill']);
    this.file.replaceImage(idx, pag);
    const previous = this.images.get(idx);
    this.images.set(idx, { pag, bitmap, owned });
    if (previous) {
      previous.pag.destroy();
      if (previous.owned) previous.bitmap.close();
    }
    this.requestRedraw();
  }

  /** Hides (or shows) the layer(s) with this name, or the editable layer `#index`. */
  setHidden(key: string, hidden: boolean): void {
    if (this.destroyed) return;
    let layers = this.layersNamed(key);
    if (layers.length === 0) {
      const idx = this.textIndexByKey.get(key) ?? this.imageIndexByKey.get(key);
      if (idx !== undefined) {
        const type = this.textIndexByKey.has(key) ? LAYER_TEXT : LAYER_IMAGE;
        const vec = this.file.getLayersByEditableIndex(idx, type);
        layers = vecToArray(vec);
        vec.delete?.();
      }
    }
    if (layers.length === 0) {
      warn(`unknown key "${key}": no layer has this name.`);
      return;
    }
    for (const l of layers) l.setVisible(!hidden);
    this.requestRedraw();
  }

  /** Restores an edited text layer and shows hidden layers. A replaced image cannot be restored (PAG has no API for it): set another image instead. */
  clearReplacement(key: string): void {
    if (this.destroyed) return;
    const idx = this.textIndexByKey.get(key);
    if (idx !== undefined && this.originalText.has(idx)) {
      const doc = this.file.getTextData(idx);
      try {
        Object.assign(doc, this.originalText.get(idx));
        this.file.replaceText(idx, doc);
      } finally {
        doc.delete?.();
      }
      this.originalText.delete(idx);
    }
    if (this.imageIndexByKey.has(key) && this.images.has(this.imageIndexByKey.get(key)!)) warn(`cannot restore the original image of "${key}" (PAG has no API for it); set another image instead.`);
    for (const l of this.layersNamed(key)) l.setVisible(true);
    this.requestRedraw();
  }

  /** Unsupported escape hatch for tests and advanced use: the raw engine objects. */
  get internals(): { PAG: PagModuleLike; file: PagFileLike; view: PagViewLike } {
    return { PAG: this.engine.PAG, file: this.file, view: this.view };
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  /** Resolves once everything has been released (the engine may still be mid-flush when `destroy()` is called). */
  get disposed(): Promise<void> {
    return this.released;
  }

  /**
   * Releases the PAGView (and with it this view's reference to the shared WebGL canvas), the PAGFile and every replacement
   * image, and clears the canvas. The shared WebGL context itself stays alive for the page (see engine.ts).
   */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vp.destroy();
    this.settle(true);
    const finish = () => {
      try {
        this.view?.destroy();
        for (const img of this.images.values()) {
          img.pag.destroy();
          if (img.owned) img.bitmap.close();
        }
        this.images.clear();
        this.file.destroy();
        const ctx = this.canvas.getContext('2d');
        ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
      } catch (e) {
        this.onError(e);
      } finally {
        this.releaseResolve();
      }
    };
    // libpag must not be torn down in the middle of a flush.
    this.pumpDone.then(finish, finish);
  }
}
