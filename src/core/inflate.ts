import { Unzlib } from 'fflate';
import { GiftPlayerError } from './errors';

/** Default ceiling for decompressed data (files come from untrusted sources). */
export const DEFAULT_MAX_INFLATED_BYTES = 64 * 1024 * 1024;

const mb = (n: number) => `${(n / (1024 * 1024)).toFixed(n < 1024 * 1024 ? 2 : 0)} MB`;

export class InflateLimitError extends GiftPlayerError {
  constructor(limit: number, what = 'Decompressed data') {
    super(
      'parse-failed',
      `${what} exceeds the limit of ${mb(limit)} (maxInflatedBytes); the file is corrupt or a decompression bomb.`,
    );
    this.name = 'InflateLimitError';
  }
}

/** Input is fed in slices this big so output overshoot past the cap stays small (deflate expands <= ~1032x). */
const INPUT_SLICE = 16 * 1024;

/**
 * zlib inflate that aborts as soon as the output passes `maxBytes`, instead of allocating it all first.
 * @throws InflateLimitError over the cap; any fflate error for corrupt/truncated input.
 */
export function inflateCapped(bytes: Uint8Array, maxBytes = DEFAULT_MAX_INFLATED_BYTES): Uint8Array {
  const chunks: Uint8Array[] = [];
  let total = 0;
  const stream = new Unzlib((chunk) => {
    total += chunk.length;
    if (total > maxBytes) throw new InflateLimitError(maxBytes);
    chunks.push(chunk);
  });
  if (bytes.length === 0) stream.push(bytes, true);
  for (let i = 0; i < bytes.length; i += INPUT_SLICE) {
    const end = Math.min(i + INPUT_SLICE, bytes.length);
    stream.push(bytes.subarray(i, end), end === bytes.length);
  }
  if (chunks.length === 1) return chunks[0]!;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
