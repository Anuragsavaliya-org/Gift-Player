import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveLoops } from '../src/core/frame-source';
import { clampDelay, readGifMeta, readWebpMeta } from '../src/formats/image/meta';
import { parseGif } from '../src/formats/image/gif';
import { parseWebp } from '../src/formats/image/webp';

const dir = join(__dirname, '../samples/synthetic');
const load = (f: string) => new Uint8Array(readFileSync(join(dir, f)));
const source = (loopCount: number | null) => ({ loopCount });

describe('loop count precedence: player option > file > play once', () => {
  it('an explicit option always wins', () => {
    expect(resolveLoops(2, source(5))).toBe(2);
    expect(resolveLoops(1, source(0))).toBe(1); // file says forever, option says once
    expect(resolveLoops(3, source(null))).toBe(3);
  });
  it('0 and Infinity mean forever (normalised to 0)', () => {
    expect(resolveLoops(0, source(3))).toBe(0);
    expect(resolveLoops(Infinity, source(3))).toBe(0);
    expect(resolveLoops(undefined, source(0))).toBe(0);
  });
  it('without an option the file decides, and with neither it plays once', () => {
    expect(resolveLoops(undefined, source(4))).toBe(4);
    expect(resolveLoops(undefined, source(null))).toBe(1);
  });
});

describe('delay clamping (<= 10 ms is shown as 100 ms)', () => {
  it('matches the browser rule on both sides of the boundary', () => {
    expect([0, 1, 9, 10].map(clampDelay)).toEqual([100, 100, 100, 100]);
    expect([11, 20, 50, 100, 5000].map(clampDelay)).toEqual([11, 20, 50, 100, 5000]);
  });
});

describe('total plays from the file (browsers: GIF N -> N+1 plays, WebP N -> N plays)', () => {
  it.each([
    ['gif-loop-0.gif', 0], ['gif-loop-1.gif', 2], ['gif-loop-3.gif', 4], ['gif-loop-none.gif', 1],
    ['webp-loop-0.webp', 0], ['webp-loop-1.webp', 1], ['webp-loop-3.webp', 3],
  ])('%s -> %i', (file, plays) => {
    expect((file.endsWith('.gif') ? readGifMeta(load(file)) : readWebpMeta(load(file))).loopCount).toBe(plays);
  });

  it('the real GIF declares 65535 repeats (effectively forever, but not 0)', () => {
    const m = readGifMeta(new Uint8Array(readFileSync(join(__dirname, '../samples/rotating-earth.gif'))));
    expect(m.loopCount).toBe(65536);
  });
});

describe('self-test files used by `auto` mode', () => {
  it('selftest-gif-dispose.gif: frame 0 disposal 2 then a 2x2 patch', () => {
    const g = parseGif(load('selftest-gif-dispose.gif'));
    expect(g.frames.map((f) => [f.width, f.height, f.disposal])).toEqual([[4, 4, 2], [2, 2, 1]]);
  });
  it('selftest-webp-alpha.webp: 4x4, second frame replaces (no blend) with a lossless alpha frame', () => {
    const w = parseWebp(load('selftest-webp-alpha.webp'));
    expect([w.width, w.height, w.frames.length]).toEqual([4, 4, 2]);
    expect(w.frames.map((f) => f.blend)).toEqual([true, false]);
    expect(w.frames[1]!.chunks.map((c) => c.type)).toEqual(['VP8L']);
  });
  it('the base64 copies embedded in selftest.ts are byte-identical to the files', () => {
    const src = readFileSync(join(__dirname, '../src/formats/image/selftest.ts'), 'utf8');
    for (const f of ['selftest-gif-dispose.gif', 'selftest-webp-alpha.webp']) {
      expect(src).toContain(Buffer.from(load(f)).toString('base64'));
    }
  });
});
