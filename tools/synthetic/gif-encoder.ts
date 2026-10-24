/** Dev-only GIF89a encoder used to generate the synthetic test files. Not shipped. */

export type RGB = [number, number, number];

export interface GifFrameSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  /** width*height palette indices, row-major, in display order (the encoder interlaces if asked). */
  indices: Uint8Array;
  /** Local palette, or omit to use the global one. */
  palette?: RGB[];
  /** Delay in 1/100 s (the unit GIF stores). */
  delayCs: number;
  disposal: 0 | 1 | 2 | 3;
  transparentIndex?: number;
  interlace?: boolean;
}

export interface GifSpec {
  width: number;
  height: number;
  globalPalette: RGB[] | null;
  frames: GifFrameSpec[];
  /** NETSCAPE2.0 loop count (0 = forever); null = no extension at all. */
  loop: number | null;
}

const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];

function paletteBytes(p: RGB[]): { bytes: number[]; sizeBits: number } {
  let bits = 1;
  while (1 << bits < p.length) bits++;
  const bytes: number[] = [];
  for (let i = 0; i < 1 << bits; i++) bytes.push(...(p[i] ?? [0, 0, 0]));
  return { bytes, sizeBits: bits };
}

function lzwEncode(indices: Uint8Array, minCodeSize: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const out: number[] = [];
  let cur = 0;
  let nbits = 0;
  const emit = (code: number, size: number) => {
    cur |= code << nbits;
    nbits += size;
    while (nbits >= 8) {
      out.push(cur & 255);
      cur >>>= 8;
      nbits -= 8;
    }
  };
  let dict = new Map<number, number>();
  let next = eoi + 1;
  let size = minCodeSize + 1;
  emit(clear, size);
  let prefix = indices[0]!;
  for (let i = 1; i < indices.length; i++) {
    const c = indices[i]!;
    const key = (prefix << 8) | c;
    const hit = dict.get(key);
    if (hit !== undefined) {
      prefix = hit;
      continue;
    }
    emit(prefix, size);
    if (next < 4096) {
      dict.set(key, next++);
      if (next - 1 === 1 << size && size < 12) size++;
    } else {
      emit(clear, size);
      dict = new Map();
      next = eoi + 1;
      size = minCodeSize + 1;
    }
    prefix = c;
  }
  emit(prefix, size);
  emit(eoi, size);
  if (nbits > 0) out.push(cur & 255);
  return out;
}

function subBlocks(data: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 255) {
    const chunk = data.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0);
  return out;
}

function interlaceRows(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(src.length);
  let row = 0;
  for (const [start, step] of [[0, 8], [4, 8], [2, 4], [1, 2]] as const) {
    for (let y = start; y < h; y += step) out.set(src.subarray(y * w, y * w + w), row++ * w);
  }
  return out;
}

export function encodeGif(spec: GifSpec): Uint8Array {
  const out: number[] = [...'GIF89a'].map((c) => c.charCodeAt(0));
  const gp = spec.globalPalette ? paletteBytes(spec.globalPalette) : null;
  out.push(...u16(spec.width), ...u16(spec.height), gp ? 0x80 | (gp.sizeBits - 1) | ((gp.sizeBits - 1) << 4) : 0, 0, 0);
  if (gp) out.push(...gp.bytes);
  if (spec.loop !== null) out.push(0x21, 0xff, 11, ...[...'NETSCAPE2.0'].map((c) => c.charCodeAt(0)), 3, 1, ...u16(spec.loop), 0);
  for (const f of spec.frames) {
    const t = f.transparentIndex;
    out.push(0x21, 0xf9, 4, (f.disposal << 2) | (t !== undefined ? 1 : 0), ...u16(f.delayCs), t ?? 0, 0);
    const lp = f.palette ? paletteBytes(f.palette) : null;
    const palSize = (lp ?? gp)?.sizeBits ?? 1;
    out.push(0x2c, ...u16(f.x), ...u16(f.y), ...u16(f.width), ...u16(f.height), (lp ? 0x80 | (lp.sizeBits - 1) : 0) | (f.interlace ? 0x40 : 0));
    if (lp) out.push(...lp.bytes);
    const minCode = Math.max(2, palSize);
    const data = f.interlace ? interlaceRows(f.indices, f.width, f.height) : f.indices;
    out.push(minCode, ...subBlocks(lzwEncode(data, minCode)));
  }
  out.push(0x3b);
  return new Uint8Array(out);
}
