import type { SvgaMovie } from './types';

export interface DecodedSvgaImages {
  bitmaps: Map<string, ImageBitmap>;
  /** Keys whose bytes the browser could not decode (they are simply absent from `bitmaps`). */
  failed: string[];
}

/**
 * Decodes every raw image of a parsed movie into an `ImageBitmap`. Browser-only (needs
 * `createImageBitmap`); the parser itself never calls it. Audio is never passed here:
 * `movie.images` only contains PNG/JPEG/WebP.
 * The caller owns the bitmaps and must release them with {@link releaseSvgaImages}.
 */
export async function decodeSvgaImages(movie: SvgaMovie): Promise<DecodedSvgaImages> {
  const entries = [...movie.images];
  const settled = await Promise.allSettled(
    entries.map(([, img]) => createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime }))),
  );
  const bitmaps = new Map<string, ImageBitmap>();
  const failed: string[] = [];
  settled.forEach((res, i) => {
    const key = entries[i]![0];
    if (res.status === 'fulfilled') bitmaps.set(key, res.value);
    else failed.push(key);
  });
  return { bitmaps, failed };
}

export function releaseSvgaImages(bitmaps: Map<string, ImageBitmap>): void {
  for (const b of bitmaps.values()) b.close();
  bitmaps.clear();
}
