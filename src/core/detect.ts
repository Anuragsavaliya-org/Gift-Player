import { inflate } from 'pako';
import { GiftPlayerError } from './errors';

export type GiftFormat = 'svga' | 'gif' | 'webp' | 'pag';

export type FormatInfo =
  | { format: 'svga'; version: '1.x' | '2.x' }
  | { format: 'gif' }
  | { format: 'webp'; animated: boolean }
  | { format: 'pag' };

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((v, i) => b[offset + i] === v);

const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

const RIFF = ascii('RIFF');
const WEBP = ascii('WEBP');
const GIF87 = ascii('GIF87a');
const GIF89 = ascii('GIF89a');
const PAG = ascii('PAG');
const ZIP = [0x50, 0x4b, 0x03, 0x04];

/**
 * Reads a protobuf varint (up to 10 bytes, e.g. negative int32 values);
 * returns [value, nextOffset] or null if truncated/overlong. Values above 2^53 lose precision.
 */
function readVarint(b: Uint8Array, pos: number): [number, number] | null {
  let result = 0;
  let shift = 0;
  while (pos < b.length && shift < 70) {
    const byte = b[pos++]!;
    result += (byte & 0x7f) * 2 ** shift;
    if (!(byte & 0x80)) return [result, pos];
    shift += 7;
  }
  return null;
}

/**
 * Walks protobuf wire format over `b`, calling `onField` per field.
 * Returns false if the bytes are not well-formed or the callback rejects a field.
 */
function walkFields(
  b: Uint8Array,
  onField: (field: number, wireType: number, start: number, end: number) => boolean,
): boolean {
  let pos = 0;
  while (pos < b.length) {
    const tag = readVarint(b, pos);
    if (!tag) return false;
    const [key, afterTag] = tag;
    const field = Math.floor(key / 8);
    const wireType = key & 7;
    if (field === 0) return false;
    let start = afterTag;
    let end: number;
    if (wireType === 0) {
      const v = readVarint(b, start);
      if (!v) return false;
      end = v[1];
    } else if (wireType === 1) end = start + 8;
    else if (wireType === 5) end = start + 4;
    else if (wireType === 2) {
      const len = readVarint(b, start);
      if (!len) return false;
      start = len[1];
      end = start + len[0];
    } else return false;
    if (end > b.length) return false;
    if (!onField(field, wireType, start, end)) return false;
    pos = end;
  }
  return true;
}

/**
 * Cheap structural check that `b` is an SVGA 2.x `MovieEntity` (svga.proto): well-formed wire
 * format, and field 2 `params` present with both fps (3) and frames (4) as varints. Unknown
 * fields are skipped, as protobuf decoders do. Full decoding is the parser's job (Phase 2);
 * this avoids pulling protobufjs into detection.
 */
function looksLikeMovieEntity(b: Uint8Array): boolean {
  let hasParams = false;
  const ok = walkFields(b, (field, wt, start, end) => {
    if (field !== 2) return true;
    if (wt !== 2) return false;
    let fps = false;
    let frames = false;
    const wellFormed = walkFields(b.subarray(start, end), (f, w) => {
      if (f === 3 && w === 0) fps = true;
      else if (f === 4 && w === 0) frames = true;
      return true;
    });
    if (wellFormed && fps && frames) hasParams = true;
    return wellFormed;
  });
  return ok && hasParams;
}

/** Inflates `b` and returns the buffer if it is an SVGA 2.x MovieEntity, else null. */
function inflateSvga2(b: Uint8Array): Uint8Array | null {
  try {
    const inflated = inflate(b);
    return inflated.length > 0 && looksLikeMovieEntity(inflated) ? inflated : null;
  } catch {
    return null;
  }
}

const u16 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8);
const u32 = (b: Uint8Array, o: number) => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0;

/**
 * True if the zip's central directory lists `movie.spec` or `movie.binary`.
 * Reads the central directory (not just the first local header): entry order is arbitrary.
 */
function zipHasSvgaMovie(b: Uint8Array): boolean {
  // End of central directory record: 22 bytes + up to 65535 bytes of comment, found by scanning back.
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 0xffff); i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return false;
  const count = u16(b, eocd + 10);
  let pos = u32(b, eocd + 16);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (pos + 46 > b.length || u32(b, pos) !== 0x02014b50) return false;
    const nameLen = u16(b, pos + 28);
    const extraLen = u16(b, pos + 30);
    const commentLen = u16(b, pos + 32);
    if (pos + 46 + nameLen > b.length) return false;
    const name = decoder.decode(b.subarray(pos + 46, pos + 46 + nameLen));
    if (name === 'movie.spec' || name === 'movie.binary') return true;
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return false;
}

/**
 * Detection result for in-package use. For SVGA 2.x it carries the inflated MovieEntity bytes so
 * the parser does not inflate twice. Not exported from the package entry.
 */
export interface Detected {
  info: FormatInfo;
  /** Only set for svga 2.x: the zlib-inflated protobuf payload. */
  inflated?: Uint8Array;
}

/** Like {@link detectFormat} but keeps the inflated SVGA 2.x buffer. */
export function detectInternal(bytes: Uint8Array): Detected {
  if (startsWith(bytes, ZIP)) {
    if (zipHasSvgaMovie(bytes)) return { info: { format: 'svga', version: '1.x' } };
    throw new GiftPlayerError(
      'unsupported-format',
      'ZIP archive does not contain movie.spec or movie.binary, so it is not an SVGA file.',
    );
  }
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return { info: { format: 'gif' } };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { info: { format: 'webp', animated: isAnimatedWebp(bytes) } };
  }
  if (startsWith(bytes, PAG)) return { info: { format: 'pag' } };
  const inflated = inflateSvga2(bytes);
  if (inflated) return { info: { format: 'svga', version: '2.x' }, inflated };
  throw new GiftPlayerError(
    'unsupported-format',
    `Unsupported or corrupt file (${bytes.length} bytes, header ${hexHead(bytes)}).`,
  );
}

/**
 * Detects the gift format from magic bytes (never from file extension).
 * @throws GiftPlayerError('unsupported-format') when nothing matches.
 */
export function detectFormat(bytes: Uint8Array): FormatInfo {
  return detectInternal(bytes).info;
}

/** Animated WebP = extended format (VP8X chunk) with the animation flag (bit 1) set. */
function isAnimatedWebp(b: Uint8Array): boolean {
  return startsWith(b, ascii('VP8X'), 12) && b.length > 20 && (b[20]! & 0x02) !== 0;
}

function hexHead(b: Uint8Array): string {
  return Array.from(b.subarray(0, 8), (v) => v.toString(16).padStart(2, '0')).join(' ') || '(empty)';
}
