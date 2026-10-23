/**
 * Load-time compilation of shapes into Path2D objects and ready-to-use canvas style values, so the
 * per-frame draw path only looks things up (no string building, no path parsing, no allocation).
 */
import type { SvgaColor, SvgaShape } from '../types';

export interface CompiledShape {
  path: Path2D;
  fill: string | null;
  stroke: string | null;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  /** 0 = leave the canvas default. */
  miterLimit: number;
  dash: number[];
  dashOffset: number;
}

export const NO_DASH: number[] = [];

const byte = (v: number) => Math.min(255, Math.max(0, Math.round(v * 255)));

/** Colour components are 0..1 floats in the file. */
export function rgba(c: SvgaColor): string {
  return `rgba(${byte(c.r)},${byte(c.g)},${byte(c.b)},${c.a})`;
}

function rectPath(x: number, y: number, w: number, h: number, cornerRadius: number): Path2D {
  const p = new Path2D();
  let r = cornerRadius;
  if (w < 2 * r) r = w / 2;
  if (h < 2 * r) r = h / 2;
  if (!(r > 0)) {
    p.rect(x, y, w, h);
    return p;
  }
  p.moveTo(x + r, y);
  p.arcTo(x + w, y, x + w, y + h, r);
  p.arcTo(x + w, y + h, x, y + h, r);
  p.arcTo(x, y + h, x, y, r);
  p.arcTo(x, y, x + w, y, r);
  p.closePath();
  return p;
}

function ellipsePath(x: number, y: number, rx: number, ry: number): Path2D {
  const p = new Path2D();
  p.ellipse(x, y, Math.abs(rx), Math.abs(ry), 0, 0, Math.PI * 2);
  return p;
}

/** Shares Path2D objects between identical geometry (frames repeat the same shapes). */
export class PathCache {
  private readonly paths = new Map<string, Path2D>();

  /** SVG path data. `new Path2D(d)` never throws; unparseable data yields an empty/partial path. */
  svg(d: string): Path2D {
    let p = this.paths.get(d);
    if (!p) this.paths.set(d, (p = new Path2D(d)));
    return p;
  }

  shape(s: SvgaShape): Path2D {
    switch (s.type) {
      case 'shape':
        return this.svg(s.d);
      case 'rect': {
        const key = `r${s.x},${s.y},${s.width},${s.height},${s.cornerRadius}`;
        let p = this.paths.get(key);
        if (!p) this.paths.set(key, (p = rectPath(s.x, s.y, s.width, s.height, s.cornerRadius)));
        return p;
      }
      case 'ellipse': {
        const key = `e${s.x},${s.y},${s.radiusX},${s.radiusY}`;
        let p = this.paths.get(key);
        if (!p) this.paths.set(key, (p = ellipsePath(s.x, s.y, s.radiusX, s.radiusY)));
        return p;
      }
    }
  }

  clear(): void {
    this.paths.clear();
  }
}

/** Returns null when the shape draws nothing (no style, or neither fill nor drawable stroke). */
export function compileShape(s: SvgaShape, paths: PathCache): CompiledShape | null {
  const st = s.style;
  if (!st) return null;
  const fill = st.fill ? rgba(st.fill) : null;
  // A zero-width stroke draws nothing (canvas would silently keep the previous width instead).
  const stroke = st.stroke && st.strokeWidth > 0 ? rgba(st.stroke) : null;
  if (!fill && !stroke) return null;
  const { dash, gap, offset } = st.lineDash;
  return {
    path: paths.shape(s),
    fill,
    stroke,
    lineWidth: st.strokeWidth,
    lineCap: st.lineCap,
    lineJoin: st.lineJoin,
    miterLimit: st.miterLimit > 0 ? st.miterLimit : 0,
    dash: dash > 0 || gap > 0 ? [dash, gap] : NO_DASH,
    dashOffset: offset,
  };
}
