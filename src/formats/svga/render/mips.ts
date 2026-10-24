/**
 * Mip chains for minified sprites. Chrome filters a shrunk `<img>` with a mipmapped path but a shrunk
 * `ImageBitmap` with plain bilinear, which aliases ("sparkles") heavily shrunk particle sprites. We build the
 * missing levels ourselves: each level is half the size of the previous one, made by drawing the previous level
 * at exactly 0.5 scale (with bilinear filtering that is a 2x2 box average, identical in every browser), and the
 * renderer draws from the level closest to the on-screen scale. Level 0 is the original image and is never
 * owned by the chain.
 */
export interface Level {
  src: CanvasImageSource;
  width: number;
  height: number;
}

/** Tunables (prototype): bias added to log2(1/scale) before flooring: 0.5 = nearest level, 0 = never upscale a level. */
export const mipConfig = { bias: 0.5, floorDims: false, resize: false as false | 'low' | 'medium' | 'high' | 'pixelated' };
const MAX_DEPTH = 8;

type Surface = HTMLCanvasElement | OffscreenCanvas;

function surface(w: number, h: number): Surface {
  return typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
}

export class MipChain {
  readonly levels: Level[];
  private readonly owned: Surface[] = [];
  private readonly ownedBitmaps: ImageBitmap[] = [];

  constructor(base: CanvasImageSource & { width: number; height: number }) {
    // An <img>'s `width` is its rendered size; its natural size is what we draw from.
    const nat = base as unknown as { naturalWidth?: number; naturalHeight?: number };
    this.levels = [{ src: base, width: nat.naturalWidth || base.width, height: nat.naturalHeight || base.height }];
  }

  /** Number of levels below the original that exist. */
  get depth(): number {
    return this.levels.length - 1;
  }

  /** Builds levels up to `depth` (each from the previous one) and drops deeper ones. Never allocates in `pick`. */
  setDepth(depth: number): void {
    const target = Math.max(0, Math.min(depth, MAX_DEPTH));
    while (this.levels.length - 1 > target) this.dropLast();
    while (this.levels.length - 1 < target) {
      const prev = this.levels[this.levels.length - 1]!;
      if (prev.width <= 1 && prev.height <= 1) break;
      const w = Math.max(1, (prev.width + (mipConfig.floorDims ? 0 : 1)) >> 1);
      const h = Math.max(1, (prev.height + (mipConfig.floorDims ? 0 : 1)) >> 1);
      const s = surface(w, h);
      const ctx = s.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(prev.src, 0, 0, prev.width, prev.height, 0, 0, w, h);
      this.owned.push(s);
      this.levels.push({ src: s as CanvasImageSource, width: w, height: h });
    }
  }

  /**
   * Same as `setDepth` but each level comes from `createImageBitmap(previous, { resizeWidth, resizeHeight, resizeQuality })`,
   * i.e. the browser's own resampler. Asynchronous: levels appear as they finish.
   */
  async setDepthAsync(depth: number): Promise<void> {
    const target = Math.max(0, Math.min(depth, MAX_DEPTH));
    while (this.levels.length - 1 > target) this.dropLast();
    while (this.levels.length - 1 < target) {
      const prev = this.levels[this.levels.length - 1]!;
      if (prev.width <= 1 && prev.height <= 1) break;
      const w = Math.max(1, (prev.width + 1) >> 1);
      const h = Math.max(1, (prev.height + 1) >> 1);
      const bmp = await createImageBitmap(prev.src as ImageBitmap, { resizeWidth: w, resizeHeight: h, resizeQuality: (mipConfig.resize || 'high') as ResizeQuality });
      this.ownedBitmaps.push(bmp);
      this.levels.push({ src: bmp, width: w, height: h });
    }
  }

  private dropLast(): void {
    const b = this.ownedBitmaps.pop();
    if (b) b.close();
    else {
      const s = this.owned.pop();
      if (s) {
        s.width = 0;
        s.height = 0;
      }
    }
    this.levels.pop();
  }

  /** Frees every level this chain built (not the original). */
  destroy(): void {
    while (this.levels.length > 1) this.dropLast();
  }
}

/** Level index for an on-screen scale (backing pixels per image pixel, the smaller axis). No allocation. */
export function levelFor(scale: number, depth: number): number {
  if (depth === 0 || !(scale < 1)) return 0;
  const l = Math.floor(-Math.log2(scale) + mipConfig.bias);
  return l < 0 ? 0 : l > depth ? depth : l;
}

/** Depth a chain needs so that the smallest scale it is ever drawn at has a matching level. */
export function depthFor(minScale: number): number {
  return levelFor(minScale, MAX_DEPTH);
}
