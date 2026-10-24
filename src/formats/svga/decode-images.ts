import type { SvgaMovie } from './types';

/** A decoded, drawable image owned by whoever holds it: an `ImageBitmap`, or an `<img>` with a `close()` added. */
export type SvgaBitmap = CanvasImageSource & { readonly width: number; readonly height: number; close(): void };

export interface DecodedSvgaImages {
  bitmaps: Map<string, SvgaBitmap>;
  /** Keys whose bytes the browser could not decode (they are simply absent from `bitmaps`). */
  failed: string[];
}

export interface DecodeOptions {
  /**
   * 'img' (default): decoded `<img>` elements. 'bitmap': `createImageBitmap`, which also works without a DOM
   * (e.g. in a Worker) but is filtered worse when a sprite is drawn much smaller than its bitmap (below).
   */
  source?: 'bitmap' | 'img';
}

/**
 * Decodes an image into an `<img>` element that is ready to draw (`img.decode()` has resolved) and whose
 * `close()` drops its resource (`src = ''`).
 *
 * Why `<img>` and not `ImageBitmap` (Phase 4.1, measured on the real corpus): in Chromium a heavily shrunk
 * `<img>` is drawn with a mipmapped filter, while a shrunk `ImageBitmap` gets plain bilinear filtering, so small
 * particle sprites alias ("sparkle"). 14 of 16 real files were above 2 % vs the reference with ImageBitmap and
 * 0 of 16 with `<img>` (worst 0.24 %). WebKit filters both the same. Building our own mip chains instead could not
 * match Chromium's filtering (still 8 of 16 files above 2 %) and was worse in WebKit.
 */
export async function decodeImageElement(blob: Blob): Promise<SvgaBitmap> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  try {
    await img.decode();
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
  URL.revokeObjectURL(url); // the browser keeps the encoded data it needs; the URL is not required to re-decode
  // A detached <img>'s width/height are its natural size, but pin them so callers never see a layout-dependent value.
  Object.defineProperty(img, 'width', { value: img.naturalWidth });
  Object.defineProperty(img, 'height', { value: img.naturalHeight });
  return Object.assign(img, {
    close() {
      img.src = ''; // drops the resource now; the element itself is garbage-collected
    },
  }) as unknown as SvgaBitmap;
}

/**
 * Decodes every raw image of a parsed movie. Browser-only; the parser itself never calls it. Audio is never
 * passed here: `movie.images` only contains PNG/JPEG/WebP. The caller owns the images and must release them
 * with {@link releaseSvgaImages}.
 */
export async function decodeSvgaImages(movie: SvgaMovie, options: DecodeOptions = {}): Promise<DecodedSvgaImages> {
  const entries = [...movie.images];
  const asImg = options.source !== 'bitmap';
  const settled = await Promise.allSettled(
    entries.map(([, img]) =>
      asImg ? decodeImageElement(new Blob([img.data as BlobPart], { type: img.mime })) : (createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime })) as Promise<SvgaBitmap>),
    ),
  );
  const bitmaps = new Map<string, SvgaBitmap>();
  const failed: string[] = [];
  settled.forEach((res, i) => {
    const key = entries[i]![0];
    if (res.status === 'fulfilled') bitmaps.set(key, res.value);
    else failed.push(key);
  });
  return { bitmaps, failed };
}

export function releaseSvgaImages(bitmaps: Map<string, SvgaBitmap>): void {
  for (const b of bitmaps.values()) b.close();
  bitmaps.clear();
}
