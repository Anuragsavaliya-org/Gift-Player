/**
 * GIF container parser, LZW decoder and compositor. The parser reads structure only (frame rects,
 * delays, disposal, loop count) without decoding pixels, so durations are known up front; pixels
 * are decoded one frame at a time on demand.
 */
import { GiftPlayerError } from '../../core/errors';

export interface GifFrameInfo {
  x: number;
  y: number;
  width: number;
  height: number;
  interlaced: boolean;
  /** Local colour table (RGB triples) or null to use the global one. */
  palette: Uint8Array | null;
  lzwMinCodeSize: number;
  /** Byte range of the image's data sub-blocks, starting at the first sub-block length byte. */
  dataStart: number;
  dataEnd: number;
  /** Raw delay in 1/100 s from the Graphic Control Extension (0 if none). */
  delayCs: number;
  /** 0/1 = leave, 2 = restore to background (transparent), 3 = restore to previous. */
  disposal: 0 | 1 | 2 | 3;
  /** -1 = no transparent colour. */
  transparentIndex: number;
}

export interface GifInfo {
  width: number;
  height: number;
  globalPalette: Uint8Array | null;
  frames: GifFrameInfo[];
  /** NETSCAPE2.0 loop count as stored (0 = forever), or null when the extension is absent. */
  netscapeLoops: number | null;
}

const fail = (msg: string): never => {
  throw new GiftPlayerError('parse-failed', `GIF: ${msg}`);
};

export function parseGif(b: Uint8Array): GifInfo {
  if (b.length < 13 || b[0] !== 0x47 || b[1] !== 0x49 || b[2] !== 0x46) fail('missing GIF header');
  const u16 = (o: number) => b[o]! | (b[o + 1]! << 8);
  const width = u16(6);
  const height = u16(8);
  if (!width || !height) fail(`invalid logical screen size ${width}x${height}`);
  const flags = b[10]!;
  let pos = 13;
  let globalPalette: Uint8Array | null = null;
  if (flags & 0x80) {
    const n = 3 * (1 << ((flags & 7) + 1));
    if (pos + n > b.length) fail('truncated global colour table');
    globalPalette = b.subarray(pos, pos + n);
    pos += n;
  }
  const frames: GifFrameInfo[] = [];
  let netscapeLoops: number | null = null;
  // Graphic Control Extension state applying to the next image descriptor.
  let delayCs = 0;
  let disposal: 0 | 1 | 2 | 3 = 0;
  let transparentIndex = -1;

  const skipSubBlocks = (p: number): number => {
    while (p < b.length) {
      const len = b[p]!;
      p += 1 + len;
      if (len === 0) return p;
    }
    return b.length + 1; // ran off the end: truncated
  };

  while (pos < b.length) {
    const tag = b[pos]!;
    if (tag === 0x3b) break; // trailer
    if (tag === 0x21) {
      const label = b[pos + 1];
      if (label === 0xf9 && b[pos + 2] === 4) {
        const packed = b[pos + 3]!;
        const d = (packed >> 2) & 7;
        disposal = d >= 1 && d <= 3 ? (d as 1 | 2 | 3) : 0; // 4-7 are undefined: treat as "leave"
        delayCs = u16(pos + 4);
        transparentIndex = packed & 1 ? b[pos + 6]! : -1;
      } else if (label === 0xff && b[pos + 2] === 11) {
        const id = String.fromCharCode(...b.subarray(pos + 3, pos + 14));
        if ((id === 'NETSCAPE2.0' || id === 'ANIMEXTS1.0') && b[pos + 14] === 3 && b[pos + 15] === 1) {
          netscapeLoops = u16(pos + 16);
        }
      }
      pos = skipSubBlocks(pos + 2);
      // A GCE block is [0x21,0xF9,4,<4 bytes>,0]; skipSubBlocks handled its terminator.
      continue;
    }
    if (tag === 0x2c) {
      if (pos + 10 > b.length) break;
      const x = u16(pos + 1);
      const y = u16(pos + 3);
      const w = u16(pos + 5);
      const h = u16(pos + 7);
      const fl = b[pos + 9]!;
      pos += 10;
      let palette: Uint8Array | null = null;
      if (fl & 0x80) {
        const n = 3 * (1 << ((fl & 7) + 1));
        if (pos + n > b.length) break;
        palette = b.subarray(pos, pos + n);
        pos += n;
      }
      if (pos >= b.length) break;
      const lzwMinCodeSize = b[pos]!;
      const dataStart = pos + 1;
      const end = skipSubBlocks(dataStart);
      if (end > b.length) {
        // Truncated image data: keep the frame (browsers show what decoded) but stop parsing.
        frames.push({ x, y, width: w, height: h, interlaced: !!(fl & 0x40), palette, lzwMinCodeSize, dataStart, dataEnd: b.length, delayCs, disposal, transparentIndex });
        break;
      }
      frames.push({ x, y, width: w, height: h, interlaced: !!(fl & 0x40), palette, lzwMinCodeSize, dataStart, dataEnd: end, delayCs, disposal, transparentIndex });
      pos = end;
      delayCs = 0;
      disposal = 0;
      transparentIndex = -1;
      continue;
    }
    break; // unknown block: stop
  }
  if (frames.length === 0) fail('no image data');
  return { width, height, globalPalette, frames, netscapeLoops };
}

/** Concatenates the data sub-blocks of a frame into one buffer. */
function gatherData(b: Uint8Array, f: GifFrameInfo): Uint8Array {
  const parts: Uint8Array[] = [];
  let total = 0;
  let p = f.dataStart;
  while (p < f.dataEnd) {
    const len = b[p]!;
    if (len === 0) break;
    const end = Math.min(p + 1 + len, f.dataEnd);
    parts.push(b.subarray(p + 1, end));
    total += end - p - 1;
    p = end;
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    out.set(part, o);
    o += part.length;
  }
  return out;
}

/** GIF variable-width LZW. Missing/corrupt data leaves the remaining pixels at index 0. */
export function lzwDecode(data: Uint8Array, minCodeSize: number, pixelCount: number): Uint8Array {
  const out = new Uint8Array(pixelCount);
  if (minCodeSize < 1 || minCodeSize > 11) return out;
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const prefix = new Uint16Array(4096);
  const suffix = new Uint8Array(4096);
  const stack = new Uint8Array(4097);
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let prev = -1;
  let first = 0;
  let bits = 0;
  let nbits = 0;
  let pos = 0;
  let o = 0;
  for (let i = 0; i < clear; i++) suffix[i] = i;
  while (o < pixelCount) {
    while (nbits < codeSize) {
      if (pos >= data.length) return out;
      bits |= data[pos++]! << nbits;
      nbits += 8;
    }
    let code = bits & ((1 << codeSize) - 1);
    bits >>>= codeSize;
    nbits -= codeSize;
    if (code === clear) {
      codeSize = minCodeSize + 1;
      next = eoi + 1;
      prev = -1;
      continue;
    }
    if (code === eoi) break;
    if (prev === -1) {
      if (code >= clear) return out; // corrupt: first code after a clear must be a literal
      out[o++] = code;
      prev = code;
      first = code;
      continue;
    }
    const inCode = code;
    let sp = 0;
    if (code >= next) {
      if (code > next) return out; // corrupt
      stack[sp++] = first;
      code = prev;
    }
    while (code >= clear) {
      stack[sp++] = suffix[code]!;
      code = prefix[code]!;
    }
    first = suffix[code]!;
    stack[sp++] = first;
    if (next < 4096) {
      prefix[next] = prev;
      suffix[next] = first;
      next++;
      if (next === 1 << codeSize && codeSize < 12) codeSize++;
    }
    prev = inCode;
    while (sp > 0 && o < pixelCount) out[o++] = stack[--sp]!;
  }
  return out;
}

const PASSES = [
  [0, 8],
  [4, 8],
  [2, 4],
  [1, 2],
] as const;

function deinterlace(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  let row = 0;
  for (const [start, step] of PASSES) {
    for (let y = start; y < h; y += step) {
      out.set(src.subarray(row * w, row * w + w), y * w);
      row++;
    }
  }
  return out;
}

/**
 * Applies GIF frames in order onto one RGBA buffer, honouring disposal methods 1, 2 and 3, transparency
 * and partial-frame patches. Only the buffer (and a snapshot of one rect for disposal 3) is kept, never a
 * stored image per frame. Browsers dispose "to background" as transparent, not as the logical screen's
 * background colour; so do we.
 */
export class GifCompositor {
  readonly buffer: Uint8ClampedArray<ArrayBuffer>;
  /** Index of the last frame applied (its disposal is NOT applied yet), or -1. */
  current = -1;
  /** Rect changed since the last `takeDirty()`; null when nothing changed. */
  private dirty: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private saved: { x: number; y: number; w: number; h: number; data: Uint8ClampedArray } | null = null;

  constructor(
    private readonly bytes: Uint8Array,
    readonly info: GifInfo,
  ) {
    this.buffer = new Uint8ClampedArray(info.width * info.height * 4);
  }

  /** Brings the buffer to the state in which frame `index` is displayed. */
  advanceTo(index: number): void {
    if (index < this.current) this.reset();
    while (this.current < index) this.applyNext();
  }

  reset(): void {
    this.buffer.fill(0);
    this.current = -1;
    this.saved = null;
    this.dirty = { x0: 0, y0: 0, x1: this.info.width, y1: this.info.height };
  }

  takeDirty() {
    const d = this.dirty;
    this.dirty = null;
    return d;
  }

  private mark(x0: number, y0: number, x1: number, y1: number): void {
    const d = this.dirty;
    this.dirty = d ? { x0: Math.min(d.x0, x0), y0: Math.min(d.y0, y0), x1: Math.max(d.x1, x1), y1: Math.max(d.y1, y1) } : { x0, y0, x1, y1 };
  }

  private clipRect(f: GifFrameInfo) {
    const { width: W, height: H } = this.info;
    const x0 = Math.max(0, f.x);
    const y0 = Math.max(0, f.y);
    return { x0, y0, x1: Math.min(W, f.x + f.width), y1: Math.min(H, f.y + f.height) };
  }

  private applyNext(): void {
    const { width: W } = this.info;
    const buf = this.buffer;
    // 1. dispose the previous frame
    if (this.current >= 0) {
      const p = this.info.frames[this.current]!;
      const r = this.clipRect(p);
      if (p.disposal === 2) {
        for (let y = r.y0; y < r.y1; y++) buf.fill(0, (y * W + r.x0) * 4, (y * W + r.x1) * 4);
        this.mark(r.x0, r.y0, r.x1, r.y1);
      } else if (p.disposal === 3 && this.saved) {
        const s = this.saved;
        for (let y = 0; y < s.h; y++) buf.set(s.data.subarray(y * s.w * 4, (y + 1) * s.w * 4), ((s.y + y) * W + s.x) * 4);
        this.mark(s.x, s.y, s.x + s.w, s.y + s.h);
      }
    }
    this.saved = null;
    // 2. draw this frame
    const index = this.current + 1;
    const f = this.info.frames[index]!;
    const r = this.clipRect(f);
    if (f.disposal === 3 && r.x1 > r.x0 && r.y1 > r.y0) {
      const w = r.x1 - r.x0;
      const h = r.y1 - r.y0;
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y++) data.set(buf.subarray(((r.y0 + y) * W + r.x0) * 4, ((r.y0 + y) * W + r.x0 + w) * 4), y * w * 4);
      this.saved = { x: r.x0, y: r.y0, w, h, data };
    }
    let idx = lzwDecode(gatherData(this.bytes, f), f.lzwMinCodeSize, f.width * f.height);
    if (f.interlaced) idx = deinterlace(idx, f.width, f.height);
    const pal = f.palette ?? this.info.globalPalette;
    if (pal) {
      const t = f.transparentIndex;
      const n = pal.length / 3;
      for (let y = r.y0; y < r.y1; y++) {
        let src = (y - f.y) * f.width + (r.x0 - f.x);
        let dst = (y * W + r.x0) * 4;
        for (let x = r.x0; x < r.x1; x++, src++, dst += 4) {
          const c = idx[src]!;
          if (c === t || c >= n) continue;
          buf[dst] = pal[c * 3]!;
          buf[dst + 1] = pal[c * 3 + 1]!;
          buf[dst + 2] = pal[c * 3 + 2]!;
          buf[dst + 3] = 255;
        }
      }
    }
    this.mark(r.x0, r.y0, r.x1, r.y1);
    this.current = index;
  }
}
