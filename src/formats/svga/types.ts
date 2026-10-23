/**
 * Version-independent SVGA model. SVGA 2.x (protobuf) and 1.x (zip + JSON) both normalise to
 * `SvgaMovie`, so renderers never need to know the source version.
 *
 * Normalisation guarantees (all resolved at parse time):
 * - every sprite has exactly `movie.frames` frames;
 * - proto3 defaults applied: missing scalar = 0, missing transform = identity, missing layout = zeros;
 * - `KEEP` shapes are replaced by the previous frame's shapes, so no `keep` shape exists in the model;
 * - audio bytes are kept apart from image bytes.
 */

export interface SvgaMatrix {
  a: number;
  b: number;
  c: number;
  d: number;
  tx: number;
  ty: number;
}

export interface SvgaLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Colour components are 0..1 floats, exactly as stored in the file. */
export interface SvgaColor {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface SvgaShapeStyle {
  /** null = no fill. */
  fill: SvgaColor | null;
  /** null = no stroke. */
  stroke: SvgaColor | null;
  strokeWidth: number;
  lineCap: 'butt' | 'round' | 'square';
  lineJoin: 'miter' | 'round' | 'bevel';
  miterLimit: number;
  /** Raw dash parameters from the file (dash length, gap length, offset); 0 = unset. */
  lineDash: { dash: number; gap: number; offset: number };
}

interface ShapeBase {
  /** null when the shape carries no style message. */
  style: SvgaShapeStyle | null;
  transform: SvgaMatrix;
}

export type SvgaShape = ShapeBase &
  (
    | { type: 'shape'; /** SVG path data. */ d: string }
    | { type: 'rect'; x: number; y: number; width: number; height: number; cornerRadius: number }
    | { type: 'ellipse'; x: number; y: number; radiusX: number; radiusY: number }
  );

export interface SvgaFrame {
  /** 0 = sprite hidden in this frame. */
  alpha: number;
  layout: SvgaLayout;
  transform: SvgaMatrix;
  /** SVG path string used as a clip mask; '' = none. */
  clipPath: string;
  shapes: readonly SvgaShape[];
}

export interface SvgaSprite {
  /** Bitmap key; may end in `.matte` (mask layer) or `.vector` (vector-only layer). */
  imageKey: string;
  /**
   * For a sprite that is masked: the `imageKey` of its mask sprite. null if not masked.
   * Rendering mattes is the renderer's job; the parser only preserves the link.
   */
  matteKey: string | null;
  /** True when `imageKey` ends in `.matte`: this sprite is a mask for others. */
  isMatte: boolean;
  /** Exactly `movie.frames` entries. */
  frames: SvgaFrame[];
}

export interface SvgaBinary {
  data: Uint8Array;
  mime: string;
}

/** Timeline entry for an audio clip (playback is out of scope for now). */
export interface SvgaAudioTrack {
  audioKey: string;
  startFrame: number;
  endFrame: number;
  startTime: number;
  totalTime: number;
}

export interface SvgaMovie {
  /** Informational only; renderers must not branch on this. */
  container: 'protobuf' | 'zip-json' | 'zip-protobuf';
  /** Version string as declared in the file ('' if absent). */
  version: string;
  viewBox: { width: number; height: number };
  fps: number;
  frames: number;
  /** Raw encoded images (PNG/JPEG/WebP), keyed by image key. Never contains audio. */
  images: Map<string, SvgaBinary & { mime: 'image/png' | 'image/jpeg' | 'image/webp' }>;
  /** Raw encoded audio, keyed by audio key. */
  audios: Map<string, SvgaBinary>;
  audioTracks: SvgaAudioTrack[];
  sprites: SvgaSprite[];
  /** Non-fatal oddities found while parsing (dropped entries, padded frames, ...). */
  warnings: string[];
}
