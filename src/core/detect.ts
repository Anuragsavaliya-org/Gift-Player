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

/** Reads a protobuf varint; returns [value, nextOffset] or null if truncated/overlong. */
function readVarint(b: Uint8Array, pos: number): [number, number] | null {
  let result = 0;
  let shift = 0;
  while (pos < b.length && shift < 35) {
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
 * Cheap structural check that `b` is an SVGA 2.x `MovieEntity` (svga.proto):
 * field 1 is `version` (string), field 2 `params` must exist and contain only viewBoxWidth/Height (float),
 * fps/frames (int32); every other top-level field must be a known one with the right wire type.
 * Full decoding is the parser's job (Phase 2); this avoids pulling protobufjs into detection.
 */
function looksLikeMovieEntity(b: Uint8Array): boolean {
  let hasParams = false;
  const ok = walkFields(b, (field, wt, start, end) => {
    switch (field) {
      case 1:
        return wt === 2; // version string
      case 2: {
        if (wt !== 2) return false;
        hasParams = true;
        return walkFields(b.subarray(start, end), (f, w) =>
          f === 1 || f === 2 ? w === 5 : f === 3 || f === 4 ? w === 0 : false,
        );
      }
      case 3: // images map entries
      case 4: // sprites
      case 5: // audios
        return wt === 2;
      default:
        return false;
    }
  });
  return ok && hasParams;
}

function isSvga2(b: Uint8Array): boolean {
  try {
    const inflated = inflate(b);
    return inflated.length > 0 && looksLikeMovieEntity(inflated);
  } catch {
    return false;
  }
}

/**
 * Detects the gift format from magic bytes (never from file extension).
 * @throws GiftPlayerError('unsupported-format') when nothing matches.
 */
export function detectFormat(bytes: Uint8Array): FormatInfo {
  if (startsWith(bytes, ZIP)) return { format: 'svga', version: '1.x' };
  if (startsWith(bytes, GIF87) || startsWith(bytes, GIF89)) return { format: 'gif' };
  if (startsWith(bytes, RIFF) && startsWith(bytes, WEBP, 8)) {
    return { format: 'webp', animated: isAnimatedWebp(bytes) };
  }
  if (startsWith(bytes, PAG)) return { format: 'pag' };
  if (isSvga2(bytes)) return { format: 'svga', version: '2.x' };
  throw new GiftPlayerError(
    'unsupported-format',
    `Unsupported or corrupt file (${bytes.length} bytes, header ${hexHead(bytes)}).`,
  );
}

/** Animated WebP = extended format (VP8X chunk) with the animation flag (bit 1) set. */
function isAnimatedWebp(b: Uint8Array): boolean {
  return startsWith(b, ascii('VP8X'), 12) && b.length > 20 && (b[20]! & 0x02) !== 0;
}

function hexHead(b: Uint8Array): string {
  return Array.from(b.subarray(0, 8), (v) => v.toString(16).padStart(2, '0')).join(' ') || '(empty)';
}
