/**
 * WebP container parser (RIFF) for animated WebP: ANIM/ANMF structure, per-frame rect, delay, blend and
 * dispose flags, plus `wrapAnmfFrame`, which rebuilds one frame's bitstream (VP8 / VP8L, optional ALPH)
 * as a standalone WebP file that any browser can decode as a still image.
 */
import { GiftPlayerError } from '../../core/errors';

export interface WebpChunk {
  type: string;
  /** Offset of the chunk payload in the file and its size (without padding). */
  start: number;
  size: number;
}

export interface WebpFrameInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Raw delay in ms from the ANMF header. */
  durationMs: number;
  /** true = alpha-blend over the canvas (ANMF blending method 0); false = overwrite the rect. */
  blend: boolean;
  /** true = clear this frame's rect to transparent after it is shown. */
  disposeToBackground: boolean;
  chunks: WebpChunk[];
}

export interface WebpInfo {
  animated: boolean;
  /** Canvas size from VP8X; for a still image it is 0 (the decoder reports the size). */
  width: number;
  height: number;
  hasAlpha: boolean;
  /** ANIM loop count as stored (0 = forever), or null when there is no ANIM chunk. */
  animLoops: number | null;
  frames: WebpFrameInfo[];
}

const fail = (msg: string): never => {
  throw new GiftPlayerError('parse-failed', `WebP: ${msg}`);
};

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const u24 = (b: Uint8Array, o: number) => b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function readChunks(b: Uint8Array, start: number, end: number): WebpChunk[] {
  const out: WebpChunk[] = [];
  let p = start;
  while (p + 8 <= end) {
    const size = u32(b, p + 4);
    const payload = p + 8;
    if (payload + size > end) break; // truncated: ignore the partial chunk
    out.push({ type: fourcc(b, p), start: payload, size });
    p = payload + size + (size & 1); // payloads are padded to even length
  }
  return out;
}

export function parseWebp(b: Uint8Array): WebpInfo {
  if (b.length < 20 || fourcc(b, 0) !== 'RIFF' || fourcc(b, 8) !== 'WEBP') fail('missing RIFF/WEBP header');
  const end = Math.min(b.length, u32(b, 4) + 8);
  const top = readChunks(b, 12, end);
  const vp8x = top.find((c) => c.type === 'VP8X');
  const anim = top.find((c) => c.type === 'ANIM');
  const flags = vp8x ? b[vp8x.start]! : 0;
  const info: WebpInfo = {
    animated: !!(flags & 0x02),
    width: vp8x ? 1 + u24(b, vp8x.start + 4) : 0,
    height: vp8x ? 1 + u24(b, vp8x.start + 7) : 0,
    hasAlpha: !!(flags & 0x10),
    animLoops: anim ? b[anim.start + 4]! | (b[anim.start + 5]! << 8) : null,
    frames: [],
  };
  for (const c of top) {
    if (c.type !== 'ANMF') continue;
    if (c.size < 16) fail('ANMF chunk too small');
    const fl = b[c.start + 15]!;
    info.frames.push({
      x: u24(b, c.start) * 2,
      y: u24(b, c.start + 3) * 2,
      width: 1 + u24(b, c.start + 6),
      height: 1 + u24(b, c.start + 9),
      durationMs: u24(b, c.start + 12),
      blend: !(fl & 0x02),
      disposeToBackground: !!(fl & 0x01),
      chunks: readChunks(b, c.start + 16, c.start + c.size),
    });
  }
  if (info.animated && info.frames.length === 0) fail('animation flag set but no ANMF frames');
  return info;
}

/** Writes a RIFF chunk (header + payload + pad byte) into `out` at `pos`; returns the new position. */
function putChunk(out: Uint8Array, pos: number, type: string, payload: Uint8Array): number {
  for (let i = 0; i < 4; i++) out[pos + i] = type.charCodeAt(i);
  const n = payload.length;
  out[pos + 4] = n & 255;
  out[pos + 5] = (n >> 8) & 255;
  out[pos + 6] = (n >> 16) & 255;
  out[pos + 7] = (n >>> 24) & 255;
  out.set(payload, pos + 8);
  return pos + 8 + n + (n & 1);
}

/**
 * Builds a standalone WebP file for one ANMF frame:
 *  - VP8L (lossless, alpha inside)      -> RIFF[WEBP, VP8L]
 *  - VP8 without ALPH                   -> RIFF[WEBP, VP8 ]
 *  - VP8 + ALPH (lossy with alpha)      -> RIFF[WEBP, VP8X(alpha), ALPH, VP8 ]
 */
export function wrapAnmfFrame(b: Uint8Array, f: WebpFrameInfo): Uint8Array {
  const alph = f.chunks.find((c) => c.type === 'ALPH');
  const image = f.chunks.find((c) => c.type === 'VP8 ' || c.type === 'VP8L');
  if (!image) throw new GiftPlayerError('parse-failed', 'WebP: ANMF frame has no VP8/VP8L bitstream');
  const slice = (c: WebpChunk) => b.subarray(c.start, c.start + c.size);
  const parts: [string, Uint8Array][] = [];
  if (alph && image.type === 'VP8 ') {
    const vp8x = new Uint8Array(10);
    vp8x[0] = 0x10; // alpha flag
    const w = f.width - 1;
    const h = f.height - 1;
    vp8x.set([w & 255, (w >> 8) & 255, (w >> 16) & 255, h & 255, (h >> 8) & 255, (h >> 16) & 255], 4);
    parts.push(['VP8X', vp8x], ['ALPH', slice(alph)]);
  }
  parts.push([image.type, slice(image)]);
  let size = 4; // 'WEBP'
  for (const [, p] of parts) size += 8 + p.length + (p.length & 1);
  const out = new Uint8Array(8 + size);
  out.set([0x52, 0x49, 0x46, 0x46, size & 255, (size >> 8) & 255, (size >> 16) & 255, (size >>> 24) & 255, 0x57, 0x45, 0x42, 0x50]);
  let pos = 12;
  for (const [t, p] of parts) pos = putChunk(out, pos, t, p);
  return out;
}
