import { GiftPlayerError } from '../../core/errors';
import type { FrameSource } from '../../core/frame-source';
import { detectFormat } from '../../core/detect';
import { Viewport, type ContentMode, type ViewportOptions } from '../../core/viewport';
import { readGifMeta, readWebpMeta, type ImageMeta } from './meta';
import { imageDecoderReliable } from './selftest';
import { GifProvider, ImageDecoderProvider, StillProvider, WebpAnmfProvider, type FrameProvider, type ImagePath, type ProviderStats } from './providers';

export interface ImageRendererOptions extends ViewportOptions {
  /**
   * 'auto' (default): WebCodecs ImageDecoder when the browser supports the type, else our own decoders.
   * 'imagedecoder' / 'fallback' force one path (used by the verification harness).
   */
  path?: 'auto' | 'imagedecoder' | 'fallback';
  /** How long a still image (or a one-frame animation) is shown before it ends. Default 2000 ms. */
  staticDurationMs?: number;
  /** Frames decoded ahead of the playhead on the asynchronous paths. Default 3. */
  lookAhead?: number;
  /** Called when a frame fails to decode asynchronously. Default: console.error. */
  onError?: (error: unknown) => void;
}

/**
 * Canvas renderer for GIF and WebP (animated or still) behind the same `FrameSource` contract as SVGA:
 * per-frame durations, the file's loop count, `drawFrame(i)`. Frames are decoded on demand with a small
 * look-ahead window, never all at once.
 */
export class AnimatedImageRenderer implements FrameSource {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly vp: Viewport;
  private current = -1;
  private wanted = -1;
  private destroyed = false;

  private constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly provider: FrameProvider,
    private readonly meta: ImageMeta,
    private readonly durations: number[],
    private readonly plays: number | null,
    readonly format: 'gif' | 'webp',
    private readonly onError: (e: unknown) => void,
    options: ViewportOptions,
    /** Why this decoding path was chosen (for diagnostics and the support table). */
    readonly pathReason: string,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new GiftPlayerError('invalid-input', 'Could not get a 2D context from the canvas.');
    this.ctx = ctx;
    this.vp = new Viewport(canvas, { width: provider.width, height: provider.height }, options, () => {
      if (this.current >= 0) this.drawFrame(this.current);
    });
  }

  /** Decodes the container header, picks a decoding path, and returns a renderer ready for `drawFrame`. */
  static async create(canvas: HTMLCanvasElement, bytes: Uint8Array, options: ImageRendererOptions = {}): Promise<AnimatedImageRenderer> {
    const info = detectFormat(bytes);
    if (info.format !== 'gif' && info.format !== 'webp') {
      throw new GiftPlayerError('unsupported-format', `AnimatedImageRenderer handles GIF and WebP, not ${info.format}.`);
    }
    const format = info.format;
    const mime = format === 'gif' ? 'image/gif' : 'image/webp';
    const meta = format === 'gif' ? readGifMeta(bytes) : readWebpMeta(bytes);
    const staticMs = options.staticDurationMs ?? 2000;
    const lookAhead = options.lookAhead ?? 3;
    const onError = options.onError ?? ((e) => console.error('[gift-player]', e));
    const wanted = options.path ?? 'auto';
    const single = meta.frameCount === 1;

    let provider: FrameProvider | null = null;
    let reason = wanted === 'fallback' ? 'forced fallback' : single ? 'single frame: plain bitmap' : 'ImageDecoder';
    if (wanted === 'imagedecoder' || (wanted === 'auto' && !single)) {
      if (wanted === 'auto' && !(await ImageDecoderProvider.isUsable(mime))) reason = `ImageDecoder does not support ${mime}`;
      else if (wanted === 'auto' && !(await imageDecoderReliable(mime))) reason = `ImageDecoder failed the ${format.toUpperCase()} self-test (known WebKit bug)`;
      else {
        try {
          provider = await ImageDecoderProvider.create(bytes, mime, meta, lookAhead, onError);
        } catch (e) {
          if (wanted === 'imagedecoder') throw new GiftPlayerError('unsupported-format', `ImageDecoder could not open this ${format}.`, { cause: e });
          reason = 'ImageDecoder failed to open the file';
          console.warn('[gift-player] ImageDecoder failed, using the built-in decoder:', e);
        }
      }
    }
    if (!provider) {
      if (single && wanted === 'auto') provider = await StillProvider.create(bytes, mime);
      else if (format === 'gif') provider = new GifProvider(bytes, meta);
      else if (meta.animated) provider = new WebpAnmfProvider(bytes, meta, lookAhead);
      else provider = await StillProvider.create(bytes, mime);
    }
    // A still image has no meaningful delay: show it for `staticDurationMs`, once.
    const durations = single ? [staticMs] : meta.durations;
    const plays = single ? 1 : meta.loopCount;
    return new AnimatedImageRenderer(canvas, provider, meta, durations, plays, format, onError, options, provider.path === 'imagedecoder' ? 'ImageDecoder' : reason);
  }

  /** Which decoding path is in use. */
  get path(): ImagePath {
    return this.provider.path;
  }

  get stats(): ProviderStats {
    return this.provider.stats;
  }

  /** Intrinsic size of the image. */
  get size(): { width: number; height: number } {
    return { width: this.provider.width, height: this.provider.height };
  }

  get frameCount(): number {
    return this.durations.length;
  }

  frameDuration(i: number): number {
    return this.durations[i] ?? this.durations[this.durations.length - 1]!;
  }

  get loopCount(): number | null {
    return this.plays;
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

  drawFrame(index: number): boolean {
    if (this.destroyed) return false;
    const i = Math.min(this.frameCount - 1, Math.max(0, index | 0));
    const frame = this.provider.frame(i);
    if (!frame) {
      // Still decoding: keep showing the previous frame and paint this one when it is ready (if still wanted).
      this.wanted = i;
      this.provider.ready(i).then(
        () => {
          if (!this.destroyed && this.wanted === i) this.drawFrame(i);
        },
        (e) => {
          if (!this.destroyed) this.onError(e);
        },
      );
      return false;
    }
    this.wanted = -1;
    this.current = i;
    const v = this.vp.view;
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.vp.width, this.vp.height);
    ctx.setTransform(v.sx, 0, 0, v.sy, v.ox, v.oy);
    ctx.drawImage(frame, 0, 0);
    return true;
  }

  ready(i: number): Promise<void> {
    return this.provider.ready(Math.min(this.frameCount - 1, Math.max(0, i | 0)));
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.vp.destroy();
    this.provider.destroy();
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
