/**
 * Frame providers: the different ways to obtain composited frames of a GIF / WebP.
 *  - ImageDecoderProvider: WebCodecs `ImageDecoder` (browser does the decoding AND compositing)
 *  - GifProvider:          own LZW decode + disposal compositor (synchronous)
 *  - WebpAnmfProvider:     own ANMF parsing; each frame's bitstream re-wrapped as a still WebP, decoded with
 *                          `createImageBitmap`, composited with the ANMF offsets / blend / dispose flags
 *  - StillProvider:        a single bitmap
 * Memory is bounded: GIF keeps one RGBA buffer, WebP keeps one canvas plus a few look-ahead patches,
 * ImageDecoder keeps `lookAhead + 1` VideoFrames. Nothing decodes the whole file up front.
 */
import { GiftPlayerError } from '../../core/errors';
import { GifCompositor } from './gif';
import type { ImageMeta } from './meta';
import { wrapAnmfFrame, type WebpInfo } from './webp';

export type ImagePath = 'imagedecoder' | 'gif-fallback' | 'webp-anmf' | 'still';

export interface ProviderStats {
  /** Decoded frame objects (VideoFrame / ImageBitmap) created and closed so far, and the peak open at once. */
  created: number;
  closed: number;
  peakOpen: number;
  decoderOpened: number;
  decoderClosed: number;
}

export interface FrameProvider {
  readonly path: ImagePath;
  readonly width: number;
  readonly height: number;
  readonly stats: ProviderStats;
  /** Frame `i` composited, if available right now (valid until the next call); null if still decoding. */
  frame(i: number): CanvasImageSource | null;
  /** Resolves once `frame(i)` returns non-null. */
  ready(i: number): Promise<void>;
  destroy(): void;
}

export const newStats = (): ProviderStats => ({ created: 0, closed: 0, peakOpen: 0, decoderOpened: 0, decoderClosed: 0 });

function track(stats: ProviderStats, delta: 1 | -1): void {
  if (delta === 1) {
    stats.created++;
    stats.peakOpen = Math.max(stats.peakOpen, stats.created - stats.closed);
  } else stats.closed++;
}

function makeSurface(w: number, h: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

// ------------------------------------------------------------------------------------------------
export class StillProvider implements FrameProvider {
  readonly path = 'still' as const;
  readonly stats = newStats();
  private bitmap: ImageBitmap | null = null;

  private constructor(readonly width: number, readonly height: number, bitmap: ImageBitmap, private readonly onDestroy: () => void) {
    this.bitmap = bitmap;
    track(this.stats, 1);
  }

  static async create(bytes: Uint8Array, mime: string): Promise<StillProvider> {
    let bmp: ImageBitmap;
    try {
      bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: mime }));
    } catch (cause) {
      throw new GiftPlayerError('unsupported-format', `This browser cannot decode ${mime}.`, { cause });
    }
    return new StillProvider(bmp.width, bmp.height, bmp, () => undefined);
  }

  frame(): CanvasImageSource | null {
    return this.bitmap;
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): void {
    if (!this.bitmap) return;
    this.bitmap.close();
    track(this.stats, -1);
    this.bitmap = null;
    this.onDestroy();
  }
}

// ------------------------------------------------------------------------------------------------
export class GifProvider implements FrameProvider {
  readonly path = 'gif-fallback' as const;
  readonly stats = newStats();
  readonly width: number;
  readonly height: number;
  private readonly compositor: GifCompositor;
  private readonly surface: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: Ctx;
  private readonly imageData: ImageData;
  private destroyed = false;

  constructor(bytes: Uint8Array, meta: ImageMeta) {
    const gif = meta.gif!;
    this.width = gif.width;
    this.height = gif.height;
    this.compositor = new GifCompositor(bytes, gif);
    this.surface = makeSurface(gif.width, gif.height);
    this.ctx = this.surface.getContext('2d', { willReadFrequently: false }) as Ctx;
    // Shares memory with the compositor's buffer: putImageData of a dirty rect publishes the changes.
    this.imageData = new ImageData(this.compositor.buffer, gif.width, gif.height);
  }

  frame(i: number): CanvasImageSource | null {
    if (this.destroyed) return null;
    this.compositor.advanceTo(i);
    const d = this.compositor.takeDirty();
    if (d && d.x1 > d.x0 && d.y1 > d.y0) this.ctx.putImageData(this.imageData, 0, 0, d.x0, d.y0, d.x1 - d.x0, d.y1 - d.y0);
    return this.surface as CanvasImageSource;
  }
  ready(): Promise<void> {
    return Promise.resolve();
  }
  destroy(): void {
    this.destroyed = true;
    this.surface.width = 0; // release the backing store
    this.surface.height = 0;
  }
}

// ------------------------------------------------------------------------------------------------
export class WebpAnmfProvider implements FrameProvider {
  readonly path = 'webp-anmf' as const;
  readonly stats = newStats();
  readonly width: number;
  readonly height: number;
  private readonly info: WebpInfo;
  private readonly surface: HTMLCanvasElement | OffscreenCanvas;
  private readonly ctx: Ctx;
  /** Index of the frame currently composited on the surface, or -1. */
  private cur = -1;
  private busy = false;
  private readonly patches = new Map<number, ImageBitmap>();
  private readonly inflight = new Map<number, Promise<ImageBitmap>>();
  private chain: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(private readonly bytes: Uint8Array, meta: ImageMeta, private readonly lookAhead = 3) {
    this.info = meta.webp!;
    this.width = meta.width;
    this.height = meta.height;
    this.surface = makeSurface(this.width, this.height);
    this.ctx = this.surface.getContext('2d') as Ctx;
  }

  get frameCount(): number {
    return this.info.frames.length;
  }

  /** A frame that covers the whole canvas and overwrites it: the composite does not depend on earlier frames. */
  private isKeyframe(k: number): boolean {
    const f = this.info.frames[k]!;
    return f.x === 0 && f.y === 0 && f.width === this.width && f.height === this.height && !f.blend;
  }

  private keyframeAtOrBefore(i: number): number {
    for (let k = i; k > 0; k--) if (this.isKeyframe(k)) return k;
    return 0;
  }

  private patch(k: number): Promise<ImageBitmap> {
    const have = this.patches.get(k);
    if (have) return Promise.resolve(have);
    let p = this.inflight.get(k);
    if (!p) {
      const blob = new Blob([wrapAnmfFrame(this.bytes, this.info.frames[k]!) as BlobPart], { type: 'image/webp' });
      p = createImageBitmap(blob).then((bmp) => {
        this.inflight.delete(k);
        if (this.destroyed) {
          bmp.close();
          throw new GiftPlayerError('invalid-input', 'destroyed');
        }
        track(this.stats, 1);
        this.patches.set(k, bmp);
        return bmp;
      }, (cause) => {
        this.inflight.delete(k);
        throw new GiftPlayerError('parse-failed', `WebP frame ${k} could not be decoded by the browser.`, { cause });
      });
      this.inflight.set(k, p);
    }
    return p;
  }

  private release(k: number): void {
    const b = this.patches.get(k);
    if (!b) return;
    this.patches.delete(k);
    b.close();
    track(this.stats, -1);
  }

  /** Composites one already-decoded frame; the previous frame's dispose flag is applied first. */
  private apply(k: number, bmp: ImageBitmap): void {
    const f = this.info.frames[k]!;
    if (this.cur >= 0) {
      const p = this.info.frames[this.cur]!;
      if (p.disposeToBackground) this.ctx.clearRect(p.x, p.y, p.width, p.height);
    }
    if (!f.blend) this.ctx.clearRect(f.x, f.y, f.width, f.height); // "do not blend": overwrite the rect
    this.ctx.drawImage(bmp, f.x, f.y);
    this.cur = k;
  }

  /** Keeps `lookAhead` upcoming patches decoded (wrapping around for loops) and drops the rest. */
  private prefetch(from: number): void {
    const n = this.info.frames.length;
    const want = new Set<number>();
    for (let d = 1; d <= this.lookAhead && d < n + 1; d++) want.add((from + d) % n);
    for (const k of [...this.patches.keys()]) if (!want.has(k)) this.release(k);
    for (const k of want) if (!this.patches.has(k) && !this.inflight.has(k)) this.patch(k).catch(() => undefined);
  }

  frame(i: number): CanvasImageSource | null {
    if (this.destroyed) return null;
    if (i === this.cur && !this.busy) return this.surface as CanvasImageSource;
    if (this.busy) return null;
    // Fast path: the next frame (or a few) are already decoded.
    if (i > this.cur) {
      for (let k = this.cur + 1; k <= i; k++) if (!this.patches.has(k)) {
        this.ready(i).catch(() => undefined);
        return null;
      }
      for (let k = this.cur + 1; k <= i; k++) {
        this.apply(k, this.patches.get(k)!);
        this.release(k);
      }
      this.prefetch(i);
      return this.surface as CanvasImageSource;
    }
    this.ready(i).catch(() => undefined);
    return null;
  }

  ready(i: number): Promise<void> {
    if (this.destroyed) return Promise.resolve();
    if (i === this.cur && !this.busy) return Promise.resolve();
    // Serialised: composites mutate the surface, so only one advance runs at a time.
    const run = this.chain.then(() => this.advanceTo(i));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async advanceTo(i: number): Promise<void> {
    if (this.destroyed || i === this.cur) return;
    this.busy = true;
    try {
      if (i < this.cur) {
        // Rewind: restart from the nearest keyframe so earlier frames need not be replayed.
        const k0 = this.keyframeAtOrBefore(i);
        this.ctx.clearRect(0, 0, this.width, this.height);
        this.cur = k0 - 1;
        if (k0 === 0) this.cur = -1;
      }
      let k = this.cur + 1;
      if (this.cur < 0 && i > 0) k = this.keyframeAtOrBefore(i);
      for (; k <= i; k++) {
        const bmp = await this.patch(k);
        if (this.destroyed) return;
        if (k > 0 && this.cur !== k - 1) this.cur = -1; // started at a keyframe: nothing to dispose
        this.apply(k, bmp);
        this.release(k);
      }
      this.prefetch(i);
    } finally {
      this.busy = false;
    }
  }

  destroy(): void {
    this.destroyed = true;
    for (const k of [...this.patches.keys()]) this.release(k);
    for (const p of this.inflight.values()) p.then((b) => { b.close(); }, () => undefined);
    this.inflight.clear();
    this.surface.width = 0;
    this.surface.height = 0;
  }
}

// ------------------------------------------------------------------------------------------------
export class ImageDecoderProvider implements FrameProvider {
  readonly path = 'imagedecoder' as const;
  readonly stats = newStats();
  readonly width: number;
  readonly height: number;
  private decoder: ImageDecoder | null;
  private readonly frames = new Map<number, VideoFrame>();
  private readonly inflight = new Map<number, Promise<VideoFrame | null>>();
  private readonly count: number;
  private destroyed = false;

  private constructor(decoder: ImageDecoder, size: { width: number; height: number }, count: number, private readonly lookAhead: number, private readonly onError: (e: unknown) => void) {
    this.decoder = decoder;
    this.width = size.width;
    this.height = size.height;
    this.count = count;
    this.stats.decoderOpened++;
  }

  static isUsable(mime: string): Promise<boolean> {
    return typeof ImageDecoder === 'undefined' ? Promise.resolve(false) : ImageDecoder.isTypeSupported(mime).catch(() => false);
  }

  static async create(bytes: Uint8Array, mime: string, meta: ImageMeta, lookAhead: number, onError: (e: unknown) => void): Promise<ImageDecoderProvider> {
    const decoder = new ImageDecoder({ data: bytes, type: mime });
    try {
      await decoder.tracks.ready;
      const imageTrack = decoder.tracks.selectedTrack;
      if (!imageTrack) throw new Error('no image track');
      // Our container parse is authoritative for timing; the frame counts must agree for indices to line up.
      const count = Math.min(meta.frameCount, imageTrack.frameCount);
      if (imageTrack.frameCount !== meta.frameCount) console.warn(`[gift-player] ImageDecoder reports ${imageTrack.frameCount} frames, container parse found ${meta.frameCount}; using ${count}.`);
      let size = { width: meta.width, height: meta.height };
      let first: VideoFrame | null = null;
      if (!size.width || !size.height) {
        // A still WebP header has no canvas size: read it from the decoded frame (and keep that frame).
        first = (await decoder.decode({ frameIndex: 0 })).image;
        size = { width: first.displayWidth, height: first.displayHeight };
      }
      const provider = new ImageDecoderProvider(decoder, size, count, lookAhead, onError);
      if (first) {
        provider.frames.set(0, first);
        track(provider.stats, 1);
      }
      return provider;
    } catch (e) {
      decoder.close();
      throw e;
    }
  }

  private request(i: number): Promise<VideoFrame | null> {
    const have = this.frames.get(i);
    if (have) return Promise.resolve(have);
    let p = this.inflight.get(i);
    if (!p) {
      p = this.decoder!.decode({ frameIndex: i }).then(
        ({ image }) => {
          this.inflight.delete(i);
          if (this.destroyed) {
            image.close();
            return null;
          }
          track(this.stats, 1);
          this.frames.set(i, image);
          return image;
        },
        (e) => {
          this.inflight.delete(i);
          if (!this.destroyed) this.onError(e);
          return null;
        },
      );
      this.inflight.set(i, p);
    }
    return p;
  }

  /** Keep frame `i` and the next `lookAhead` frames (cyclic); close everything else. */
  private window(i: number): void {
    const keep = new Set<number>([i]);
    for (let d = 1; d <= this.lookAhead; d++) keep.add((i + d) % this.count);
    for (const [k, f] of [...this.frames]) {
      if (!keep.has(k)) {
        this.frames.delete(k);
        f.close();
        track(this.stats, -1);
      }
    }
    for (const k of keep) if (!this.frames.has(k) && !this.inflight.has(k)) void this.request(k);
  }

  frame(i: number): CanvasImageSource | null {
    if (this.destroyed) return null;
    const f = this.frames.get(i) ?? null;
    this.window(i);
    return f;
  }

  async ready(i: number): Promise<void> {
    if (this.destroyed) return;
    await this.request(i);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const f of this.frames.values()) {
      f.close();
      track(this.stats, -1);
    }
    this.frames.clear();
    // Decodes still in flight close their frame when they settle (see `request`).
    this.decoder?.close();
    this.decoder = null;
    this.stats.decoderClosed++;
  }
}
