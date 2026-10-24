export interface DiffResult {
  /** % of all pixels that differ by more than the tolerance in any premultiplied channel. */
  percent: number;
  /** Same count as a % of pixels where either image has any coverage (alpha > 0). */
  percentOfActive: number;
  mismatched: number;
  total: number;
  active: number;
}

/**
 * Compares two same-size canvases. Channels are compared premultiplied by alpha (so nearly
 * transparent pixels with different RGB do not count as differences) with a per-channel
 * tolerance (0..255) that absorbs anti-aliasing and rounding.
 */
export function pixelDiff(a: HTMLCanvasElement, b: HTMLCanvasElement, tolerance = 10): DiffResult {
  if (a.width !== b.width || a.height !== b.height) {
    throw new Error(`size mismatch ${a.width}x${a.height} vs ${b.width}x${b.height}`);
  }
  const da = a.getContext('2d')!.getImageData(0, 0, a.width, a.height).data;
  const db = b.getContext('2d')!.getImageData(0, 0, b.width, b.height).data;
  const total = a.width * a.height;
  let mismatched = 0;
  let active = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const aa = da[i + 3]!;
    const ab = db[i + 3]!;
    if (aa > 0 || ab > 0) active++;
    else continue;
    const fa = aa / 255;
    const fb = ab / 255;
    if (
      Math.abs(aa - ab) > tolerance ||
      Math.abs(da[i]! * fa - db[i]! * fb) > tolerance ||
      Math.abs(da[i + 1]! * fa - db[i + 1]! * fb) > tolerance ||
      Math.abs(da[i + 2]! * fa - db[i + 2]! * fb) > tolerance
    ) mismatched++;
  }
  return { percent: (mismatched / total) * 100, percentOfActive: active ? (mismatched / active) * 100 : 0, mismatched, total, active };
}

export interface DataDiff {
  mismatched: number;
  total: number;
  percent: number;
  /** Largest premultiplied channel difference seen (0-255). */
  maxDelta: number;
  /** First pixel (row-major) over the tolerance, for debugging. */
  first?: { index: number; a: number[]; b: number[] };
}

/** Same comparison as `pixelDiff` for raw RGBA buffers: premultiplied channels, per-channel tolerance. */
export function diffData(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance: number): DataDiff {
  if (a.length !== b.length) throw new Error(`buffer size mismatch ${a.length} vs ${b.length}`);
  const total = a.length / 4;
  let mismatched = 0;
  let maxDelta = 0;
  let first: DataDiff['first'];
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    const fa = a[i + 3]! / 255;
    const fb = b[i + 3]! / 255;
    const d = Math.max(
      Math.abs(a[i + 3]! - b[i + 3]!),
      Math.abs(a[i]! * fa - b[i]! * fb),
      Math.abs(a[i + 1]! * fa - b[i + 1]! * fb),
      Math.abs(a[i + 2]! * fa - b[i + 2]! * fb),
    );
    if (d > maxDelta) maxDelta = d;
    if (d > tolerance) {
      mismatched++;
      first ??= { index: p, a: [...a.subarray(i, i + 4)], b: [...b.subarray(i, i + 4)] };
    }
  }
  return { mismatched, total, percent: (mismatched / total) * 100, maxDelta: Math.round(maxDelta * 100) / 100, first };
}
