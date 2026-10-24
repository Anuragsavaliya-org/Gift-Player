/** Dev-only animated-WebP muxer: assembles still WebP files into an animation with chosen per-frame flags. */

export interface WebpFrameSpec {
  /** A complete still WebP file (as produced by a canvas encoder). Its ALPH and VP8/VP8L chunks are used. */
  still: Uint8Array;
  /** Even offsets only (stored as x/2). */
  x: number;
  y: number;
  width: number;
  height: number;
  durationMs: number;
  /** true = alpha-blend (ANMF blending method 0); false = do not blend. */
  blend: boolean;
  disposeToBackground: boolean;
}

export interface WebpSpec {
  width: number;
  height: number;
  /** ANIM loop count (0 = forever). */
  loop: number;
  hasAlpha: boolean;
  frames: WebpFrameSpec[];
}

const fourcc = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const le = (n: number, bytes: number) => Array.from({ length: bytes }, (_, i) => (n >>> (8 * i)) & 255);

function chunk(type: string, payload: ArrayLike<number>): number[] {
  const p = Array.from(payload);
  const out = [...[...type].map((c) => c.charCodeAt(0)), ...le(p.length, 4), ...p];
  if (p.length & 1) out.push(0);
  return out;
}

/** Pulls the ALPH and image (VP8 / VP8L) chunks out of a still WebP file. */
export function stillBitstream(still: Uint8Array): number[] {
  const out: number[] = [];
  let p = 12;
  while (p + 8 <= still.length) {
    const t = fourcc(still, p);
    const size = still[p + 4]! | (still[p + 5]! << 8) | (still[p + 6]! << 16) | (still[p + 7]! << 24);
    if (t === 'ALPH' || t === 'VP8 ' || t === 'VP8L') out.push(...chunk(t, still.subarray(p + 8, p + 8 + size)));
    p += 8 + size + (size & 1);
  }
  return out;
}

export function muxAnimatedWebp(spec: WebpSpec): Uint8Array {
  const body: number[] = [...[...'WEBP'].map((c) => c.charCodeAt(0))];
  body.push(...chunk('VP8X', [0x02 | (spec.hasAlpha ? 0x10 : 0), 0, 0, 0, ...le(spec.width - 1, 3), ...le(spec.height - 1, 3)]));
  body.push(...chunk('ANIM', [0, 0, 0, 0, ...le(spec.loop, 2)]));
  for (const f of spec.frames) {
    if (f.x % 2 || f.y % 2) throw new Error('ANMF offsets must be even');
    const flags = (f.blend ? 0 : 0x02) | (f.disposeToBackground ? 0x01 : 0);
    body.push(...chunk('ANMF', [...le(f.x / 2, 3), ...le(f.y / 2, 3), ...le(f.width - 1, 3), ...le(f.height - 1, 3), ...le(f.durationMs, 3), flags, ...stillBitstream(f.still)]));
  }
  return new Uint8Array([...[...'RIFF'].map((c) => c.charCodeAt(0)), ...le(body.length, 4), ...body]);
}
