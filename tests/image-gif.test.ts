import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GiftPlayerError } from '../src/core/errors';
import { GifCompositor, lzwDecode, parseGif } from '../src/formats/image/gif';
import { clampDelay, readGifMeta } from '../src/formats/image/meta';
import { encodeGif } from '../tools/synthetic/gif-encoder';

const dir = join(__dirname, '../samples/synthetic');
const load = (f: string) => new Uint8Array(readFileSync(join(dir, f)));
const W = 40;

/** Decodes frame `i` and returns [r,g,b,a] at (x, y). */
function pixelAt(file: string, i: number, x: number, y: number): number[] {
  const bytes = load(file);
  const c = new GifCompositor(bytes, parseGif(bytes));
  c.advanceTo(i);
  const o = (y * c.info.width + x) * 4;
  return [...c.buffer.subarray(o, o + 4)];
}
const palette = (file: string) => parseGif(load(file)).globalPalette!;
const color = (file: string, idx: number) => [...palette(file).subarray(idx * 3, idx * 3 + 3), 255];
const gradient = (x: number, y: number) => 1 + (((x >> 2) + (y >> 2)) % 6);

describe('GIF container', () => {
  it.each([
    ['gif-disposal-1.gif', 4, 0, null],
    ['gif-disposal-3.gif', 5, 0, null],
    ['gif-delays.gif', 7, 0, null],
    ['gif-loop-3.gif', 3, 3, null],
  ])('%s: %i frames, NETSCAPE loops %i', (file, frames, loops) => {
    const g = parseGif(load(file));
    expect(g.frames).toHaveLength(frames);
    expect(g.netscapeLoops).toBe(loops);
    expect([g.width, g.height]).toEqual([W, 30]);
  });

  it('loop count is normalised to total plays: 0 -> forever, N -> N+1, absent -> 1', () => {
    const plays = (f: string) => readGifMeta(load(f)).loopCount;
    expect(plays('gif-loop-0.gif')).toBe(0);
    expect(plays('gif-loop-1.gif')).toBe(2);
    expect(plays('gif-loop-3.gif')).toBe(4);
    expect(plays('gif-loop-none.gif')).toBe(1);
    expect(parseGif(load('gif-loop-none.gif')).netscapeLoops).toBeNull();
  });

  it('delays: 0 and 10 ms are shown as 100 ms, 20 ms stays 20 (browser rule)', () => {
    const raw = parseGif(load('gif-delays.gif')).frames.map((f) => f.delayCs * 10);
    expect(raw).toEqual([0, 10, 20, 50, 100, 200, 500]);
    expect(readGifMeta(load('gif-delays.gif')).durations).toEqual([100, 100, 20, 50, 100, 200, 500]);
    expect([0, 1, 10, 11, 20].map(clampDelay)).toEqual([100, 100, 100, 11, 20]);
  });

  it('disposal and interlace flags are read', () => {
    expect(parseGif(load('gif-disposal-2.gif')).frames.map((f) => f.disposal)).toEqual([2, 2, 2, 2]);
    expect(parseGif(load('gif-disposal-3.gif')).frames.map((f) => f.disposal)).toEqual([1, 3, 1, 3, 1]);
    expect(parseGif(load('gif-interlaced.gif')).frames.map((f) => f.interlaced)).toEqual([true, true]);
    expect(parseGif(load('gif-transparency.gif')).frames.map((f) => f.transparentIndex)).toEqual([0, 0, 9, 15]);
  });

  it('a real GIF parses (rotating-earth.gif)', () => {
    const g = parseGif(new Uint8Array(readFileSync(join(__dirname, '../samples/rotating-earth.gif'))));
    expect(g.frames.length).toBeGreaterThan(5);
  });

  it('rejects garbage and survives truncation without a raw RangeError', () => {
    expect(() => parseGif(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]))).toThrowError(GiftPlayerError);
    const full = load('gif-mixed.gif');
    for (const cut of [20, 60, 200, 400, 600, full.length - 1]) {
      try {
        const g = parseGif(full.subarray(0, cut));
        const c = new GifCompositor(full.subarray(0, cut), g);
        c.advanceTo(g.frames.length - 1); // must not throw
      } catch (e) {
        expect(e).toBeInstanceOf(GiftPlayerError);
      }
    }
  });
});

describe('LZW', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;

  it('round-trips random and low-entropy images, including > 4096 codes (table reset)', () => {
    for (let trial = 0; trial < 24; trial++) {
      const w = 5 + ((rnd() * 120) | 0);
      const h = 5 + ((rnd() * 120) | 0);
      const colors = 2 + ((rnd() * 254) | 0);
      const lowEntropy = trial % 3 === 0;
      const indices = new Uint8Array(w * h);
      for (let i = 0; i < indices.length; i++) indices[i] = lowEntropy ? (i >> 5) % colors : (rnd() * colors) | 0;
      const pal = Array.from({ length: colors }, (_, i) => [i, i, i] as [number, number, number]);
      const gif = encodeGif({ width: w, height: h, globalPalette: pal, loop: null, frames: [{ x: 0, y: 0, width: w, height: h, indices, delayCs: 1, disposal: 1 }] });
      const g = parseGif(gif);
      const c = new GifCompositor(gif, g);
      c.advanceTo(0);
      for (let i = 0; i < indices.length; i++) {
        if (c.buffer[i * 4] !== indices[i]) throw new Error(`trial ${trial}: pixel ${i} is ${c.buffer[i * 4]}, expected ${indices[i]}`);
      }
    }
  });

  it('garbage input yields a full-size buffer, never throws', () => {
    expect(lzwDecode(new Uint8Array([0xff, 0xff, 0xff]), 8, 100)).toHaveLength(100);
    expect(lzwDecode(new Uint8Array(), 8, 10)).toHaveLength(10);
    expect(lzwDecode(new Uint8Array([1, 2, 3]), 0, 10)).toHaveLength(10);
  });
});

describe('compositor: disposal methods, transparency, partial patches', () => {
  it('method 1 (leave): patches accumulate', () => {
    const f = 'gif-disposal-1.gif';
    expect(pixelAt(f, 3, 6, 6)).toEqual(color(f, 3)); // patch from frame 1 is still there
    expect(pixelAt(f, 3, 23, 13)).toEqual(color(f, 4)); // frame 2
    expect(pixelAt(f, 3, 11, 19)).toEqual(color(f, 6)); // frame 3
    expect(pixelAt(f, 3, 0, 0)).toEqual(color(f, gradient(0, 0))); // background frame
  });

  it('method 2 (restore to background): the frame is cleared to TRANSPARENT before the next one', () => {
    const f = 'gif-disposal-2.gif';
    expect(pixelAt(f, 0, 0, 0)).toEqual(color(f, gradient(0, 0)));
    expect(pixelAt(f, 1, 6, 6)).toEqual(color(f, 3));
    expect(pixelAt(f, 1, 0, 0)[3]).toBe(0); // frame 0 was disposed
    expect(pixelAt(f, 2, 6, 6)[3]).toBe(0); // frame 1's patch is gone
    expect(pixelAt(f, 2, 21, 11)).toEqual(color(f, 4));
    expect(pixelAt(f, 3, 0, 0)).toEqual(color(f, 5));
    expect(pixelAt(f, 3, 21, 11)[3]).toBe(0);
  });

  it('method 3 (restore to previous): the canvas returns to what it was before the frame', () => {
    const f = 'gif-disposal-3.gif';
    expect(pixelAt(f, 1, 6, 6)).toEqual(color(f, 3)); // shown
    expect(pixelAt(f, 2, 6, 6)).toEqual(color(f, gradient(6, 6))); // ...then restored
    expect(pixelAt(f, 2, 23, 11)).toEqual(color(f, 4));
    expect(pixelAt(f, 3, 9, 17)).toEqual(color(f, 6)); // frame 3 (method 3) visible
    expect(pixelAt(f, 4, 9, 17)).toEqual(color(f, gradient(9, 17))); // restored, frame 2's patch kept
    expect(pixelAt(f, 4, 23, 11)).toEqual(color(f, 4));
    expect(pixelAt(f, 4, 3, 3)).toEqual(color(f, 5));
  });

  it('method 3 on the very first frame restores to transparent; frames need not cover the canvas', () => {
    const f = 'gif-first-disposal3.gif';
    expect(pixelAt(f, 0, 12, 10)).toEqual(color(f, 3));
    expect(pixelAt(f, 0, 0, 0)[3]).toBe(0);
    expect(pixelAt(f, 1, 12, 10)[3]).toBe(0);
    expect(pixelAt(f, 1, 0, 0)).toEqual(color(f, 1));
  });

  it('transparent index leaves what is underneath untouched', () => {
    const f = 'gif-transparency.gif';
    const a = (i: number, x: number, y: number) => pixelAt(f, i, x, y)[3];
    // Each frame paints a colour where ((x>>1)+(y>>1)) is odd and uses its transparent index where it is even.
    expect(a(0, 0, 0)).toBe(0); // never painted: a fresh canvas is transparent, not black
    expect(pixelAt(f, 0, 2, 0)).toEqual(color(f, 1));
    expect(pixelAt(f, 1, 2, 0)).toEqual(color(f, 3)); // frame 1 paints over frame 0
    expect(a(1, 0, 0)).toBe(0); // transparent in frame 1 as well: still nothing
    // Frame 2 is a patch at (4,4) with index 9 transparent and disposal 2:
    expect(pixelAt(f, 2, 6, 8)).toEqual(color(f, 4)); // odd parity: its colour
    expect(a(2, 6, 6)).toBe(0); // even parity: transparent -> shows what was below (nothing there)
    // Frame 3 (index 15 transparent) comes after frame 2's rect was disposed to transparent:
    expect(a(3, 6, 6)).toBe(0); // even parity: transparent in frame 3, and frame 2's colour was disposed...
    expect(pixelAt(f, 3, 0, 2)).toEqual(color(f, 2)); // ...and frame 3's own colour is drawn at odd parity
  });

  it('a transparent pixel over an opaque one keeps the opaque one (mixed.gif)', () => {
    // gif-mixed frame 1 is a stripes(7, 0) patch with index 0 transparent, drawn over frame 0's opaque gradient.
    const f = 'gif-mixed.gif';
    const info = parseGif(load(f));
    const swapped = info.frames[0]!.palette!;
    const under = [...swapped.subarray(gradient(6, 6) * 3, gradient(6, 6) * 3 + 3), 255];
    expect(pixelAt(f, 1, 6, 6)).toEqual(under); // (6,6) is a transparent stripe pixel in frame 1
    expect(pixelAt(f, 1, 8, 6)).toEqual(color(f, 7)); // (8,6) is white
  });

  it('interlaced frames are de-interlaced with the local palette', () => {
    const f = 'gif-interlaced.gif';
    const g = parseGif(load(f));
    const local = g.frames[0]!.palette!;
    for (const y of [0, 1, 2, 3, 4, 8, 13, 29]) {
      const idx = 1 + (y % 8);
      expect(pixelAt(f, 0, 0, y)).toEqual([...local.subarray(idx * 3, idx * 3 + 3), 255]);
    }
  });

  it('random access gives the same pixels as playing in order (including rewinds and loops)', () => {
    for (const f of ['gif-mixed.gif', 'gif-disposal-3.gif', 'gif-disposal-2.gif']) {
      const bytes = load(f);
      const info = parseGif(bytes);
      const seq = new GifCompositor(bytes, info);
      const snapshots = info.frames.map((_, i) => {
        seq.advanceTo(i);
        return seq.buffer.slice();
      });
      const rnd = new GifCompositor(bytes, info);
      for (const i of [3, 1, 2, 0, info.frames.length - 1, 1, 1, 0]) {
        rnd.advanceTo(i);
        expect(rnd.buffer, `${f} frame ${i}`).toEqual(snapshots[i]);
      }
    }
  });

  it('a real GIF decodes frame after frame without throwing', () => {
    const bytes = new Uint8Array(readFileSync(join(__dirname, '../samples/rotating-earth.gif')));
    const info = parseGif(bytes);
    const c = new GifCompositor(bytes, info);
    for (let i = 0; i < Math.min(info.frames.length, 40); i++) c.advanceTo(i);
    expect(c.buffer.some((v) => v !== 0)).toBe(true);
  });

  it('reports dirty rectangles (only the changed region needs publishing)', () => {
    const bytes = load('gif-disposal-1.gif');
    const c = new GifCompositor(bytes, parseGif(bytes));
    c.advanceTo(0);
    expect(c.takeDirty()).toEqual({ x0: 0, y0: 0, x1: 40, y1: 30 });
    c.advanceTo(1);
    expect(c.takeDirty()).toEqual({ x0: 5, y0: 5, x1: 17, y1: 15 });
    expect(c.takeDirty()).toBeNull();
  });
});
