/**
 * Normalises an SVGA 1.x `movie.spec` JSON document into the same raw shape the protobuf decoder
 * produces. Missing numbers are 0, a missing `transform` is identity and a missing `layout` zeros
 * (the same proto3 rules as 2.x). Shapes accept both numeric and string types, `args` or
 * `shape`/`rect`/`ellipse` argument objects, colours as `[r,g,b,a]` or `{r,g,b,a}`, and
 * `lineDash` as `[dash, gap, offset]` or `lineDashI/II/III`.
 */
import { GiftPlayerError } from '../../core/errors';
import { identity, zeroLayout, type RawFrame, type RawMovie, type RawShape, type RawSprite } from './proto';
import type { SvgaAudioTrack, SvgaColor, SvgaLayout, SvgaMatrix, SvgaShapeStyle } from './types';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number.parseFloat(v) : 0;
  return Number.isFinite(n) ? n : 0;
};
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function matrix(v: unknown): SvgaMatrix {
  if (!isObj(v)) return identity();
  return { a: num(v.a), b: num(v.b), c: num(v.c), d: num(v.d), tx: num(v.tx), ty: num(v.ty) };
}

function layout(v: unknown): SvgaLayout {
  if (!isObj(v)) return zeroLayout();
  return { x: num(v.x), y: num(v.y), width: num(v.width), height: num(v.height) };
}

function color(v: unknown): SvgaColor | null {
  if (Array.isArray(v)) return { r: num(v[0]), g: num(v[1]), b: num(v[2]), a: num(v[3]) };
  if (isObj(v)) return { r: num(v.r), g: num(v.g), b: num(v.b), a: num(v.a) };
  return null;
}

const CAPS = ['butt', 'round', 'square'] as const;
const JOINS = ['miter', 'round', 'bevel'] as const;
const pick = <T extends string>(v: unknown, names: readonly T[], fallback: T): T =>
  typeof v === 'number' ? (names[v] ?? fallback) : names.find((n) => n === v) ?? fallback;

function style(v: unknown): SvgaShapeStyle | null {
  if (!isObj(v)) return null;
  let dash = 0;
  let gap = 0;
  let offset = 0;
  if (Array.isArray(v.lineDash)) [dash, gap, offset] = [num(v.lineDash[0]), num(v.lineDash[1]), num(v.lineDash[2])];
  else [dash, gap, offset] = [num(v.lineDashI), num(v.lineDashII), num(v.lineDashIII)];
  return {
    fill: color(v.fill),
    stroke: color(v.stroke),
    strokeWidth: num(v.strokeWidth),
    lineCap: pick(v.lineCap, CAPS, 'butt'),
    lineJoin: pick(v.lineJoin, JOINS, 'miter'),
    miterLimit: num(v.miterLimit),
    lineDash: { dash, gap, offset },
  };
}

const SHAPE_TYPES = ['shape', 'rect', 'ellipse', 'keep'] as const;

function shape(v: unknown): RawShape | null {
  if (!isObj(v)) return null;
  const type = pick(v.type, SHAPE_TYPES, 'shape');
  const transform = matrix(v.transform);
  if (type === 'keep') return { type: 'keep', style: null, transform };
  const args = (isObj(v.args) ? v.args : isObj(v[type]) ? v[type] : {}) as Json;
  const st = style(v.styles);
  if (type === 'rect') {
    return { type, x: num(args.x), y: num(args.y), width: num(args.width), height: num(args.height), cornerRadius: num(args.cornerRadius), style: st, transform };
  }
  if (type === 'ellipse') {
    return { type, x: num(args.x), y: num(args.y), radiusX: num(args.radiusX), radiusY: num(args.radiusY), style: st, transform };
  }
  return { type, d: str(args.d), style: st, transform };
}

function frame(v: unknown): RawFrame {
  const o = isObj(v) ? v : {};
  return {
    alpha: num(o.alpha),
    layout: layout(o.layout),
    transform: matrix(o.transform),
    clipPath: str(o.clipPath),
    shapes: Array.isArray(o.shapes) ? o.shapes.map(shape).filter((s): s is RawShape => s !== null) : [],
  };
}

function sprite(v: unknown): RawSprite {
  const o = isObj(v) ? v : {};
  return {
    imageKey: str(o.imageKey),
    matteKey: str(o.matteKey),
    frames: Array.isArray(o.frames) ? o.frames.map(frame) : [],
  };
}

export interface SpecResult {
  raw: RawMovie;
  /** `images` map of the spec: image key -> file name stem inside the zip (`<name>.png`). */
  imageNames: Map<string, string>;
}

export function fromSpecJson(spec: unknown): SpecResult {
  if (!isObj(spec)) throw new GiftPlayerError('parse-failed', 'movie.spec is not a JSON object.');
  const movie = isObj(spec.movie) ? spec.movie : {};
  const viewBox = isObj(movie.viewBox) ? movie.viewBox : {};
  const audios: SvgaAudioTrack[] = Array.isArray(spec.audios)
    ? spec.audios.filter(isObj).map((a) => ({
        audioKey: str(a.audioKey),
        startFrame: Math.trunc(num(a.startFrame)),
        endFrame: Math.trunc(num(a.endFrame)),
        startTime: Math.trunc(num(a.startTime)),
        totalTime: Math.trunc(num(a.totalTime)),
      }))
    : [];
  const imageNames = new Map<string, string>();
  if (isObj(spec.images)) for (const [k, v] of Object.entries(spec.images)) imageNames.set(k, str(v));
  return {
    raw: {
      version: str(spec.ver),
      viewBoxWidth: num(viewBox.width),
      viewBoxHeight: num(viewBox.height),
      fps: Math.trunc(num(movie.fps)),
      frames: Math.trunc(num(movie.frames)),
      images: new Map(),
      sprites: Array.isArray(spec.sprites) ? spec.sprites.map(sprite) : [],
      audios,
    },
    imageNames,
  };
}
