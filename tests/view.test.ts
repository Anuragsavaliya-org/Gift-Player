import { describe, expect, it } from 'vitest';
import { backingSize, computeView } from '../src/formats/svga/render/view';

describe('backingSize', () => {
  it('multiplies CSS size by the device pixel ratio and rounds', () => {
    expect(backingSize(375, 667, 2)).toEqual({ width: 750, height: 1334 });
    expect(backingSize(100.4, 50.5, 3)).toEqual({ width: 301, height: 152 });
  });
  it('never returns less than 1 px', () => {
    expect(backingSize(0, 0, 2)).toEqual({ width: 1, height: 1 });
  });
});

describe('computeView (viewBox 100x50)', () => {
  const view = (mode: 'fill' | 'aspectFit' | 'aspectFill', w: number, h: number) => computeView(mode, w, h, 100, 50);

  it('fill stretches each axis independently', () => {
    expect(view('fill', 400, 400)).toEqual({ sx: 4, sy: 8, ox: 0, oy: 0 });
  });
  it('aspectFit uses the smaller scale and centres (letterbox)', () => {
    expect(view('aspectFit', 400, 400)).toEqual({ sx: 4, sy: 4, ox: 0, oy: 100 });
    expect(view('aspectFit', 100, 200)).toEqual({ sx: 1, sy: 1, ox: 0, oy: 75 });
  });
  it('aspectFill uses the larger scale and centres (crop)', () => {
    expect(view('aspectFill', 400, 400)).toEqual({ sx: 8, sy: 8, ox: -200, oy: 0 });
  });
  it('same aspect ratio: all modes agree', () => {
    for (const m of ['fill', 'aspectFit', 'aspectFill'] as const) expect(view(m, 200, 100)).toEqual({ sx: 2, sy: 2, ox: 0, oy: 0 });
  });
  it('reuses the output object (no allocation per call)', () => {
    const out = { sx: 0, sy: 0, ox: 0, oy: 0 };
    expect(computeView('fill', 10, 10, 10, 10, out)).toBe(out);
  });
});
