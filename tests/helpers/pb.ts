// Tiny protobuf *encoder* for building synthetic SVGA payloads in tests.
export type Bytes = number[];

export const cat = (...parts: (Bytes | Uint8Array)[]): Uint8Array => new Uint8Array(parts.flatMap((p) => [...p]));

/** Varint; negative numbers are sign-extended to 10 bytes like protobuf int32/int64. */
export function varint(v: number): Bytes {
  let n = BigInt(v);
  if (n < 0n) n += 1n << 64n;
  const out: Bytes = [];
  while (n > 0x7fn) {
    out.push(Number(n & 0x7fn) | 0x80);
    n >>= 7n;
  }
  out.push(Number(n));
  return out;
}

const key = (field: number, wire: number) => varint(field * 8 + wire);

export const vField = (field: number, v: number): Bytes => [...key(field, 0), ...varint(v)];

export const fField = (field: number, v: number): Bytes => {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setFloat32(0, v, true);
  return [...key(field, 5), ...b];
};

export const lField = (field: number, payload: Bytes | Uint8Array | string): Bytes => {
  const bytes = typeof payload === 'string' ? [...new TextEncoder().encode(payload)] : [...payload];
  return [...key(field, 2), ...varint(bytes.length), ...bytes];
};

const floats = (...vals: (number | undefined)[]): Bytes => vals.flatMap((v, i) => (v === undefined ? [] : fField(i + 1, v)));

export const params = (w: number, h: number, fps: number, frames: number): Bytes =>
  [...fField(1, w), ...fField(2, h), ...vField(3, fps), ...vField(4, frames)];

export const transform = (a: number, b: number, c: number, d: number, tx: number, ty: number) => floats(a, b, c, d, tx, ty);
export const layout = (x: number, y: number, w: number, h: number) => floats(x, y, w, h);

export const rectShape = (x: number, y: number, w: number, h: number, cornerRadius?: number): Bytes =>
  [...vField(1, 1), ...lField(3, floats(x, y, w, h, cornerRadius))];
export const ellipseShape = (x: number, y: number, rx: number, ry: number): Bytes =>
  [...vField(1, 2), ...lField(4, floats(x, y, rx, ry))];
export const pathShape = (d: string): Bytes => [...lField(2, lField(1, d))];
export const keepShape = (): Bytes => vField(1, 3);

export interface FrameOpts {
  alpha?: number;
  layout?: Bytes;
  transform?: Bytes;
  clipPath?: string;
  shapes?: Bytes[];
}
export const frame = (o: FrameOpts = {}): Bytes => [
  ...(o.alpha === undefined ? [] : fField(1, o.alpha)),
  ...(o.layout ? lField(2, o.layout) : []),
  ...(o.transform ? lField(3, o.transform) : []),
  ...(o.clipPath ? lField(4, o.clipPath) : []),
  ...(o.shapes ?? []).flatMap((s) => lField(5, s)),
];

export const sprite = (imageKey: string, frames: Bytes[], matteKey = ''): Bytes => [
  ...lField(1, imageKey),
  ...frames.flatMap((f) => lField(2, f)),
  ...(matteKey ? lField(3, matteKey) : []),
];

export const imageEntry = (k: string, v: Bytes | Uint8Array | string): Bytes => lField(3, [...lField(1, k), ...lField(2, v)]);

export const audioEntity = (key: string, startFrame: number, endFrame: number): Bytes => [
  ...lField(1, key),
  ...vField(2, startFrame),
  ...vField(3, endFrame),
];

export interface MovieOpts {
  version?: string;
  params?: Bytes | null;
  images?: Bytes[];
  sprites?: Bytes[];
  audios?: Bytes[];
  unknown?: Bytes;
}
/** Encodes a MovieEntity (not compressed). */
export const movie = (o: MovieOpts = {}): Uint8Array =>
  cat(
    lField(1, o.version ?? '2.1.0'),
    o.params === null ? [] : lField(2, o.params ?? params(100, 200, 20, 2)),
    (o.images ?? []).flat(),
    (o.sprites ?? []).flatMap((s) => lField(4, s)),
    (o.audios ?? []).flatMap((a) => lField(5, a)),
    o.unknown ?? [],
  );

export const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3];
export const JPEG = [0xff, 0xd8, 0xff, 0xe0, 1, 2, 3];
export const WEBP = [...'RIFF'].map((c) => c.charCodeAt(0)).concat([4, 0, 0, 0], [...'WEBP'].map((c) => c.charCodeAt(0)), [1, 2]);
export const MP3_ID3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0];
export const MP3_SYNC = [0xff, 0xfb, 0x90, 0x00, 1, 2];
export const OGG = [0x4f, 0x67, 0x67, 0x53, 0, 2, 0, 0];
