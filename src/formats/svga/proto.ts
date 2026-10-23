/**
 * Decoder for the SVGA 2.x `MovieEntity` protobuf. Field numbers follow `svga.proto`
 * (see the reference copy in this folder). Unknown fields and fields whose wire type does not
 * match the schema are skipped, as protobuf decoders do. Missing scalars decode as proto3
 * defaults (0 / ''), a missing `transform` as identity, a missing `layout` as zeros.
 *
 * Output is a "raw" movie in which shapes may still be `keep` (resolved in parse.ts).
 */
import type { SvgaAudioTrack, SvgaColor, SvgaLayout, SvgaMatrix, SvgaShape, SvgaShapeStyle } from './types';
import { WIRE_FIXED32, WIRE_LEN, WIRE_VARINT, WireReader } from './wire';

export type RawShape = SvgaShape | ({ type: 'keep' } & { style: null; transform: SvgaMatrix });

export interface RawFrame {
  alpha: number;
  layout: SvgaLayout;
  transform: SvgaMatrix;
  clipPath: string;
  shapes: RawShape[];
}

export interface RawSprite {
  imageKey: string;
  matteKey: string;
  frames: RawFrame[];
}

export interface RawMovie {
  version: string;
  viewBoxWidth: number;
  viewBoxHeight: number;
  fps: number;
  frames: number;
  /** Raw `images` map values: encoded image/audio bytes, or file names inside a 1.5 zip. */
  images: Map<string, Uint8Array>;
  sprites: RawSprite[];
  audios: SvgaAudioTrack[];
}

export const identity = (): SvgaMatrix => ({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
export const zeroLayout = (): SvgaLayout => ({ x: 0, y: 0, width: 0, height: 0 });

/** Reads fixed32 float fields 1..n into `out` by index (field number - 1). */
function readFloats(r: WireReader, count: number): number[] {
  const out = new Array<number>(count).fill(0);
  while (!r.done) {
    const [f, wt] = r.tag();
    if (f >= 1 && f <= count && wt === WIRE_FIXED32) out[f - 1] = r.float();
    else r.skip(wt);
  }
  return out;
}

function decodeTransform(r: WireReader): SvgaMatrix {
  const [a, b, c, d, tx, ty] = readFloats(r, 6) as [number, number, number, number, number, number];
  return { a, b, c, d, tx, ty };
}

function decodeLayout(r: WireReader): SvgaLayout {
  const [x, y, width, height] = readFloats(r, 4) as [number, number, number, number];
  return { x, y, width, height };
}

function decodeColor(r: WireReader): SvgaColor {
  const [cr, g, b, a] = readFloats(r, 4) as [number, number, number, number];
  return { r: cr, g, b, a };
}

const CAPS = ['butt', 'round', 'square'] as const;
const JOINS = ['miter', 'round', 'bevel'] as const;

function decodeStyle(r: WireReader): SvgaShapeStyle {
  const s: SvgaShapeStyle = {
    fill: null,
    stroke: null,
    strokeWidth: 0,
    lineCap: 'butt',
    lineJoin: 'miter',
    miterLimit: 0,
    lineDash: { dash: 0, gap: 0, offset: 0 },
  };
  while (!r.done) {
    const [f, wt] = r.tag();
    if (f === 1 && wt === WIRE_LEN) s.fill = decodeColor(r.message());
    else if (f === 2 && wt === WIRE_LEN) s.stroke = decodeColor(r.message());
    else if (f === 3 && wt === WIRE_FIXED32) s.strokeWidth = r.float();
    else if (f === 4 && wt === WIRE_VARINT) s.lineCap = CAPS[r.int32()] ?? 'butt';
    else if (f === 5 && wt === WIRE_VARINT) s.lineJoin = JOINS[r.int32()] ?? 'miter';
    else if (f === 6 && wt === WIRE_FIXED32) s.miterLimit = r.float();
    else if (f === 7 && wt === WIRE_FIXED32) s.lineDash.dash = r.float();
    else if (f === 8 && wt === WIRE_FIXED32) s.lineDash.gap = r.float();
    else if (f === 9 && wt === WIRE_FIXED32) s.lineDash.offset = r.float();
    else r.skip(wt);
  }
  return s;
}

function decodeShape(r: WireReader): RawShape {
  let type = 0;
  let d = '';
  let rect: number[] = [0, 0, 0, 0, 0];
  let ellipse: number[] = [0, 0, 0, 0];
  let style: SvgaShapeStyle | null = null;
  let transform = identity();
  while (!r.done) {
    const [f, wt] = r.tag();
    if (f === 1 && wt === WIRE_VARINT) type = r.int32();
    else if (f === 2 && wt === WIRE_LEN) {
      const sub = r.message();
      while (!sub.done) {
        const [sf, swt] = sub.tag();
        if (sf === 1 && swt === WIRE_LEN) d = sub.string();
        else sub.skip(swt);
      }
    } else if (f === 3 && wt === WIRE_LEN) rect = readFloats(r.message(), 5);
    else if (f === 4 && wt === WIRE_LEN) ellipse = readFloats(r.message(), 4);
    else if (f === 10 && wt === WIRE_LEN) style = decodeStyle(r.message());
    else if (f === 11 && wt === WIRE_LEN) transform = decodeTransform(r.message());
    else r.skip(wt);
  }
  switch (type) {
    case 1:
      return { type: 'rect', x: rect[0]!, y: rect[1]!, width: rect[2]!, height: rect[3]!, cornerRadius: rect[4]!, style, transform };
    case 2:
      return { type: 'ellipse', x: ellipse[0]!, y: ellipse[1]!, radiusX: ellipse[2]!, radiusY: ellipse[3]!, style, transform };
    case 3:
      return { type: 'keep', style: null, transform };
    default:
      // 0 = SHAPE; unknown enum values are treated as the proto3 default.
      return { type: 'shape', d, style, transform };
  }
}

/** Frame with nothing set: hidden, identity transform, zero layout, no shapes. */
export const isEmptyRawFrame = (f: RawFrame) => f.alpha === 0 && f.clipPath === '' && f.shapes.length === 0;

function decodeFrame(r: WireReader): RawFrame {
  const f: RawFrame = { alpha: 0, layout: zeroLayout(), transform: identity(), clipPath: '', shapes: [] };
  while (!r.done) {
    const [n, wt] = r.tag();
    if (n === 1 && wt === WIRE_FIXED32) f.alpha = r.float();
    else if (n === 2 && wt === WIRE_LEN) f.layout = decodeLayout(r.message());
    else if (n === 3 && wt === WIRE_LEN) f.transform = decodeTransform(r.message());
    else if (n === 4 && wt === WIRE_LEN) f.clipPath = r.string();
    else if (n === 5 && wt === WIRE_LEN) f.shapes.push(decodeShape(r.message()));
    else r.skip(wt);
  }
  return f;
}

function decodeSprite(r: WireReader): RawSprite {
  const s: RawSprite = { imageKey: '', matteKey: '', frames: [] };
  while (!r.done) {
    const [n, wt] = r.tag();
    if (n === 1 && wt === WIRE_LEN) s.imageKey = r.string();
    else if (n === 2 && wt === WIRE_LEN) s.frames.push(decodeFrame(r.message()));
    else if (n === 3 && wt === WIRE_LEN) s.matteKey = r.string();
    else r.skip(wt);
  }
  return s;
}

function decodeAudio(r: WireReader): SvgaAudioTrack {
  const a: SvgaAudioTrack = { audioKey: '', startFrame: 0, endFrame: 0, startTime: 0, totalTime: 0 };
  while (!r.done) {
    const [n, wt] = r.tag();
    if (n === 1 && wt === WIRE_LEN) a.audioKey = r.string();
    else if (n === 2 && wt === WIRE_VARINT) a.startFrame = r.int32();
    else if (n === 3 && wt === WIRE_VARINT) a.endFrame = r.int32();
    else if (n === 4 && wt === WIRE_VARINT) a.startTime = r.int32();
    else if (n === 5 && wt === WIRE_VARINT) a.totalTime = r.int32();
    else r.skip(wt);
  }
  return a;
}

/** `map<string, bytes>` entry: key = 1, value = 2. */
function decodeImageEntry(r: WireReader): [string, Uint8Array] {
  let key = '';
  let value: Uint8Array = new Uint8Array(0);
  while (!r.done) {
    const [n, wt] = r.tag();
    if (n === 1 && wt === WIRE_LEN) key = r.string();
    else if (n === 2 && wt === WIRE_LEN) value = r.bytes();
    else r.skip(wt);
  }
  return [key, value];
}

/** Decodes an (already inflated) `MovieEntity`. Throws `GiftPlayerError('parse-failed')`. */
export function decodeMovieEntity(buf: Uint8Array): RawMovie {
  const movie: RawMovie = {
    version: '',
    viewBoxWidth: 0,
    viewBoxHeight: 0,
    fps: 0,
    frames: 0,
    images: new Map(),
    sprites: [],
    audios: [],
  };
  const r = new WireReader(buf);
  while (!r.done) {
    const [n, wt] = r.tag();
    if (n === 1 && wt === WIRE_LEN) movie.version = r.string();
    else if (n === 2 && wt === WIRE_LEN) {
      const p = r.message();
      while (!p.done) {
        const [pn, pwt] = p.tag();
        if (pn === 1 && pwt === WIRE_FIXED32) movie.viewBoxWidth = p.float();
        else if (pn === 2 && pwt === WIRE_FIXED32) movie.viewBoxHeight = p.float();
        else if (pn === 3 && pwt === WIRE_VARINT) movie.fps = p.int32();
        else if (pn === 4 && pwt === WIRE_VARINT) movie.frames = p.int32();
        else p.skip(pwt);
      }
    } else if (n === 3 && wt === WIRE_LEN) {
      const [k, v] = decodeImageEntry(r.message());
      movie.images.set(k, v);
    } else if (n === 4 && wt === WIRE_LEN) movie.sprites.push(decodeSprite(r.message()));
    else if (n === 5 && wt === WIRE_LEN) movie.audios.push(decodeAudio(r.message()));
    else r.skip(wt);
  }
  return movie;
}
