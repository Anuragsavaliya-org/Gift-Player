export interface Rgba {
  r: number;
  g: number;
  b: number;
  /** 0..1 */
  a: number;
}

let probe: CanvasRenderingContext2D | null | undefined;

/** Parses any CSS colour string ('#fff', 'rgb(...)', 'red', 'hsl(...)') to 0-255 channels via the browser itself. */
export function parseCssColor(css: string): Rgba {
  if (probe === undefined) {
    const c = typeof document !== 'undefined' ? document.createElement('canvas') : null;
    if (c) c.width = c.height = 1;
    probe = c?.getContext('2d', { willReadFrequently: true }) ?? null;
  }
  if (!probe) throw new Error('parseCssColor needs a DOM canvas');
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css; // an invalid colour leaves the previous value (#000)
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  const a = d[3]! / 255;
  // getImageData returns premultiplied-then-unpremultiplied bytes; for opaque colours this is exact.
  return { r: d[0]!, g: d[1]!, b: d[2]!, a };
}
