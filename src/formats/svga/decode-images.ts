import type { SvgaMovie } from './types';

/** A decoded, drawable image owned by whoever holds it: an `ImageBitmap`, or an `<img>` with a `close()` added. */
export type SvgaBitmap = CanvasImageSource & { readonly width: number; readonly height: number; close(): void };

export interface DecodedSvgaImages {
  bitmaps: Map<string, SvgaBitmap>;
  /** Keys whose bytes the browser could not decode (they are simply absent from `bitmaps`). */
  failed: string[];
}

export interface DecodeOptions {
  /** 'bitmap' (default): `createImageBitmap`. 'img': decoded `<img>` elements. */
  source?: 'bitmap' | 'img';
}

async function decodeImgElement(data: Uint8Array, mime: string): Promise<SvgaBitmap> {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
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
  return Object.assign(img, {
    close() {
      img.src = ''; // drop the resource; the element itself is released by GC
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
  const asImg = options.source === 'img';
  const settled = await Promise.allSettled(
    entries.map(([, img]) =>
      asImg ? decodeImgElement(img.data, img.mime) : (createImageBitmap(new Blob([img.data as BlobPart], { type: img.mime })) as Promise<SvgaBitmap>),
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
