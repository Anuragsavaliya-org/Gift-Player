import { detectFormat, type FormatInfo } from './detect';
import { readSource, type GiftSource } from './source';

/** Reads `src` (URL | ArrayBuffer | Blob/File) and detects its format from magic bytes. */
export async function detectSource(src: GiftSource): Promise<FormatInfo> {
  return detectFormat(await readSource(src));
}
