export type ContentMode = 'fill' | 'aspectFit' | 'aspectFill';

/** Maps viewBox units to backing-store pixels: x' = sx * x + ox, y' = sy * y + oy. */
export interface View {
  sx: number;
  sy: number;
  ox: number;
  oy: number;
}

/** Backing-store size for a CSS size at a given device pixel ratio (never below 1 px). */
export function backingSize(cssWidth: number, cssHeight: number, dpr: number): { width: number; height: number } {
  return {
    width: Math.max(1, Math.round(cssWidth * dpr)),
    height: Math.max(1, Math.round(cssHeight * dpr)),
  };
}

/**
 * Content-mode transform from the movie's viewBox into a backing store of the given size.
 * - fill: stretch to the box, ignoring aspect ratio
 * - aspectFit: uniform scale so everything is visible, centred (letterbox)
 * - aspectFill: uniform scale so the box is covered, centred (overflow is cropped by the canvas)
 */
export function computeView(
  mode: ContentMode,
  boxWidth: number,
  boxHeight: number,
  viewBoxWidth: number,
  viewBoxHeight: number,
  out: View = { sx: 1, sy: 1, ox: 0, oy: 0 },
): View {
  const kx = boxWidth / viewBoxWidth;
  const ky = boxHeight / viewBoxHeight;
  if (mode === 'fill') {
    out.sx = kx;
    out.sy = ky;
    out.ox = 0;
    out.oy = 0;
    return out;
  }
  const k = mode === 'aspectFit' ? Math.min(kx, ky) : Math.max(kx, ky);
  out.sx = k;
  out.sy = k;
  out.ox = (boxWidth - viewBoxWidth * k) / 2;
  out.oy = (boxHeight - viewBoxHeight * k) / 2;
  return out;
}
