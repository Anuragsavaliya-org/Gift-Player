import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GiftPlayerError } from '../src/core/errors';
import { readWebpMeta } from '../src/formats/image/meta';
import { parseWebp, wrapAnmfFrame } from '../src/formats/image/webp';

const load = (f: string) => new Uint8Array(readFileSync(join(__dirname, '../samples/synthetic', f)));
const type = (b: Uint8Array, o: number) => String.fromCharCode(b[o]!, b[o + 1]!, b[o + 2]!, b[o + 3]!);
const u32 = (b: Uint8Array, o: number) => (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;

function topChunks(b: Uint8Array): string[] {
  const out: string[] = [];
  let p = 12;
  while (p + 8 <= b.length) {
    const size = u32(b, p + 4);
    out.push(type(b, p));
    p += 8 + size + (size & 1);
  }
  return out;
}

describe('WebP container', () => {
  it('animated file: canvas, frames, offsets, delays, blend and dispose flags', () => {
    const w = parseWebp(load('webp-dispose-bg.webp'));
    expect(w.animated).toBe(true);
    expect([w.width, w.height]).toEqual([48, 36]);
    expect(w.frames.map((f) => [f.x, f.y, f.width, f.height])).toEqual([[0, 0, 48, 36], [4, 4, 20, 16], [20, 14, 20, 16], [0, 0, 14, 12]]);
    expect(w.frames.map((f) => f.disposeToBackground)).toEqual([false, true, true, false]);
    expect(w.frames.every((f) => f.blend)).toBe(true);
    expect(parseWebp(load('webp-alpha-noblend.webp')).frames.map((f) => f.blend)).toEqual([true, false, false]);
    expect(parseWebp(load('webp-alpha-blend.webp')).frames.map((f) => f.blend)).toEqual([true, true, true]);
  });

  it('odd frame sizes and even offsets (ANMF stores x/2, y/2, w-1, h-1)', () => {
    expect(parseWebp(load('webp-offsets.webp')).frames.map((f) => [f.x, f.y, f.width, f.height])).toEqual([[0, 0, 48, 36], [2, 2, 21, 13], [10, 4, 17, 9], [30, 20, 15, 13]]);
  });

  it('delays: 0, 1 and 10 ms are shown as 100 ms; 20 / 50 / 100 stay', () => {
    expect(parseWebp(load('webp-delays.webp')).frames.map((f) => f.durationMs)).toEqual([0, 1, 10, 20, 50, 100]);
    expect(readWebpMeta(load('webp-delays.webp')).durations).toEqual([100, 100, 100, 20, 50, 100]);
  });

  it('loop count is the TOTAL number of plays: 0 -> forever, N -> N', () => {
    expect(readWebpMeta(load('webp-loop-0.webp')).loopCount).toBe(0);
    expect(readWebpMeta(load('webp-loop-1.webp')).loopCount).toBe(1);
    expect(readWebpMeta(load('webp-loop-3.webp')).loopCount).toBe(3);
  });

  it('still images are not animated', () => {
    for (const f of ['webp-static-lossy.webp', 'webp-static-lossless.webp', 'webp-static-alpha.webp']) {
      const m = readWebpMeta(load(f));
      expect(m.animated, f).toBe(false);
      expect(m.frameCount).toBe(1);
      expect(m.loopCount).toBeNull();
    }
    expect(readWebpMeta(new Uint8Array(readFileSync(join(__dirname, '../samples/static.webp')))).animated).toBe(false);
  });

  it('real animated.webp parses', () => {
    const m = readWebpMeta(new Uint8Array(readFileSync(join(__dirname, '../samples/animated.webp'))));
    expect(m.animated).toBe(true);
    expect(m.frameCount).toBeGreaterThan(1);
    expect(m.durations.every((d) => d > 10)).toBe(true);
  });

  it('wrapAnmfFrame: VP8L frames become a bare lossless WebP', () => {
    const b = load('webp-mixed-codecs.webp');
    const w = parseWebp(b);
    const lossless = w.frames.findIndex((f) => f.chunks.some((c) => c.type === 'VP8L'));
    expect(lossless).toBeGreaterThanOrEqual(0);
    const out = wrapAnmfFrame(b, w.frames[lossless]!);
    expect(type(out, 0)).toBe('RIFF');
    expect(type(out, 8)).toBe('WEBP');
    expect(u32(out, 4)).toBe(out.length - 8);
    expect(topChunks(out)).toEqual(['VP8L']);
  });

  it('wrapAnmfFrame: lossy frames with alpha get VP8X + ALPH + VP8, with the frame size', () => {
    const b = load('webp-alpha-blend.webp');
    const w = parseWebp(b);
    const f = w.frames[1]!;
    const out = wrapAnmfFrame(b, f);
    expect(topChunks(out)).toEqual(['VP8X', 'ALPH', 'VP8 ']);
    expect(u32(out, 4)).toBe(out.length - 8);
    expect(out[20]! & 0x10).toBe(0x10); // alpha flag in VP8X
    expect(1 + (out[24]! | (out[25]! << 8) | (out[26]! << 16))).toBe(f.width);
    expect(1 + (out[27]! | (out[28]! << 8) | (out[29]! << 16))).toBe(f.height);
    expect(out.length % 2).toBe(0);
  });

  it('rejects garbage and truncated files cleanly', () => {
    expect(() => parseWebp(new Uint8Array(30))).toThrowError(GiftPlayerError);
    const full = load('webp-mixed-codecs.webp');
    for (const cut of [10, 20, 40, 100, 300, full.length - 3]) {
      try {
        const w = parseWebp(full.subarray(0, cut));
        for (const f of w.frames) wrapAnmfFrame(full.subarray(0, cut), f);
      } catch (e) {
        expect(e).toBeInstanceOf(GiftPlayerError);
      }
    }
  });
});
