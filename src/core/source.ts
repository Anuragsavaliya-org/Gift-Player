import { GiftPlayerError } from './errors';

/** Anything the SDK accepts as a gift file. */
export type GiftSource = string | ArrayBuffer | ArrayBufferView | Blob;

/** Resolves any accepted input to raw bytes. URLs are fetched; the file is read fully. */
export async function readSource(src: GiftSource, init?: RequestInit): Promise<Uint8Array> {
  if (typeof src === 'string') {
    let res: Response;
    try {
      res = await fetch(src, init);
    } catch (cause) {
      throw new GiftPlayerError('fetch-failed', `Failed to fetch ${src}`, { cause });
    }
    if (!res.ok) throw new GiftPlayerError('fetch-failed', `Failed to fetch ${src}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  }
  if (src instanceof ArrayBuffer) return new Uint8Array(src);
  if (ArrayBuffer.isView(src)) return new Uint8Array(src.buffer, src.byteOffset, src.byteLength);
  if (typeof Blob !== 'undefined' && src instanceof Blob) return new Uint8Array(await src.arrayBuffer());
  throw new GiftPlayerError('invalid-input', 'Source must be a URL string, ArrayBuffer, or Blob/File.');
}
