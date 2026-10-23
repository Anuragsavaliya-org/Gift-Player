import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { strFromU8, unzipSync, zipSync, zlibSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectInternal } from '../src/core/detect';
import { GiftPlayerError } from '../src/core/errors';
import { parseSvga } from '../src/formats/svga';
import type { SvgaMovie } from '../src/formats/svga';
import * as pb from './helpers/pb';

const samples = join(__dirname, '../samples');
const read = (f: string) => new Uint8Array(readFileSync(join(samples, f)));
const expected = JSON.parse(readFileSync(join(samples, 'expected.json'), 'utf8')) as Record<
  string,
  { fps: number; frames: number; spriteCount: number; imageCount: number; viewBox: { width: number; height: number } }
>;
const files = Object.keys(expected);
const parseZ = (m: Uint8Array) => parseSvga(zlibSync(m));

describe('real samples vs svgaplayerweb (expected.json)', () => {
  it('expected.json covers every SVGA sample', () => expect(files.length).toBe(8));

  for (const f of files) {
    it(`${f}`, () => {
      const e = expected[f]!;
      const m = parseSvga(read(f));
      expect(m.fps).toBe(e.fps);
      expect(m.frames).toBe(e.frames);
      expect(m.sprites.length).toBe(e.spriteCount);
      expect(m.viewBox).toEqual(e.viewBox);
      // The oracle counts audio blobs in its `images` map, so images + audios must add up to it.
      expect(m.images.size + m.audios.size).toBe(e.imageCount);
      // Rocket.svga's own data has matteKeys pointing at sprites that do not exist (see matte tests).
      expect(m.warnings.filter((w) => !w.startsWith('matteKey(s) with no matching'))).toEqual([]);
    });
  }

  it('Rocket.svga (1.x) also matches movie.spec read directly from the zip', () => {
    const spec = JSON.parse(strFromU8(unzipSync(read('Rocket.svga'))['movie.spec']!));
    const m = parseSvga(read('Rocket.svga'));
    expect(m.container).toBe('zip-json');
    expect([m.viewBox.width, m.viewBox.height, m.fps, m.frames, m.sprites.length]).toEqual([
      spec.movie.viewBox.width, spec.movie.viewBox.height, spec.movie.fps, spec.movie.frames, spec.sprites.length,
    ]);
  });
});

describe('invariants on every sample', () => {
  for (const f of files) {
    it(f, () => {
      const m = parseSvga(read(f));
      for (const s of m.sprites) {
        expect(s.frames.length).toBe(m.frames);
        const known = m.images.has(s.imageKey) || s.imageKey.endsWith('.matte') || s.imageKey.endsWith('.vector');
        expect(known, `imageKey ${s.imageKey}`).toBe(true);
        for (const fr of s.frames) {
          for (const sh of fr.shapes) expect(['shape', 'rect', 'ellipse']).toContain(sh.type);
          expect(Number.isFinite(fr.alpha)).toBe(true);
        }
      }
      for (const img of m.images.values()) expect(img.mime).toMatch(/^image\//);
      for (const a of m.audios.values()) expect(a.mime).toMatch(/^audio\//);
    });
  }

  it('audio sits apart from images (Fiery-Red-Dragon has an mp3 in its images map)', () => {
    const m = parseSvga(read('Fiery-Red-Dragon.svga'));
    expect(m.audios.size).toBe(1);
    expect([...m.audios.values()][0]!.mime).toBe('audio/mpeg');
    expect(m.audioTracks.length).toBeGreaterThan(0);
  });
});

describe('matte sprites', () => {
  for (const f of ['matteBitmap.svga', 'matteRect.svga']) {
    it(`${f}: every matteKey points at an existing matte sprite`, () => {
      const m = parseSvga(read(f));
      const mattes = new Set(m.sprites.filter((s) => s.isMatte).map((s) => s.imageKey));
      const masked = m.sprites.filter((s) => s.matteKey !== null);
      expect(mattes.size).toBeGreaterThan(0);
      expect(masked.length).toBeGreaterThan(0);
      for (const s of masked) expect(mattes.has(s.matteKey!), `${s.imageKey} -> ${s.matteKey}`).toBe(true);
    });
  }

  it('Rocket.svga (1.x): matte links preserved; 3 matteKeys dangle in the source file and are reported, not dropped', () => {
    const m = parseSvga(read('Rocket.svga'));
    const mattes = new Set(m.sprites.filter((s) => s.isMatte).map((s) => s.imageKey));
    expect(mattes.size).toBe(4);
    const dangling = m.sprites.filter((s) => s.matteKey && !mattes.has(s.matteKey)).map((s) => s.matteKey);
    expect(new Set(dangling)).toEqual(new Set(['matte_bTTCW1wT.matte', 'matte_pUPP05aB.matte', 'matte_3UJxqavb.matte']));
    expect(m.warnings.join()).toContain('matte_bTTCW1wT.matte');
    expect(m.sprites.filter((s) => s.matteKey && mattes.has(s.matteKey)).length).toBeGreaterThan(0);
  });

  it('matteBitmap: bitmap matte + three vector layers', () => {
    const m = parseSvga(read('matteBitmap.svga'));
    expect(m.sprites.map((s) => [s.imageKey, s.matteKey])).toEqual([
      ['dengziqi.matte', null],
      ['形状图层1.vector', 'dengziqi.matte'],
      ['形状图层2.vector', 'dengziqi.matte'],
      ['形状图层3.vector', 'dengziqi.matte'],
    ]);
    expect(m.images.size).toBe(1);
  });

  it('matteRect: vector matte (no bitmaps)', () => {
    const m = parseSvga(read('matteRect.svga'));
    expect(m.images.size).toBe(0);
    expect(m.sprites[0]!.isMatte).toBe(true);
    expect(m.sprites[0]!.frames.some((fr) => fr.shapes.length > 0)).toBe(true);
  });
});

describe('proto3 defaults and field decoding (synthetic)', () => {
  const one = (f: pb.Bytes, frames = 1) =>
    parseZ(pb.movie({ params: pb.params(10, 20, 30, frames), sprites: [pb.sprite('k', [f])] })).sprites[0]!.frames[0]!;

  it('empty frame: hidden, identity transform, zero layout, no shapes', () => {
    const fr = one([]);
    expect(fr).toMatchObject({ alpha: 0, clipPath: '' });
    expect(fr.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(fr.layout).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(fr.shapes).toEqual([]);
  });

  it('alpha 0 is kept as 0 even when other fields are set (sprite hidden that frame)', () => {
    const fr = one(pb.frame({ transform: pb.transform(2, 0, 0, 2, 5, 6), layout: pb.layout(1, 2, 3, 4) }));
    expect(fr.alpha).toBe(0);
    expect(fr.transform.tx).toBe(5);
  });

  it('floats are little-endian fixed32 and decode exactly', () => {
    const fr = one(
      pb.frame({ alpha: 0.5, layout: pb.layout(-2.25, 8, 1024, 0.125), transform: pb.transform(1.5, -0.5, 0.25, 3, 100.5, -7) }),
    );
    expect(fr.alpha).toBe(0.5);
    expect(fr.layout).toEqual({ x: -2.25, y: 8, width: 1024, height: 0.125 });
    expect(fr.transform).toEqual({ a: 1.5, b: -0.5, c: 0.25, d: 3, tx: 100.5, ty: -7 });
  });

  it('a present transform message with omitted scalars follows proto3: omitted = 0', () => {
    const fr = one(pb.frame({ alpha: 1, transform: pb.fField(5, 9) }));
    expect(fr.transform).toEqual({ a: 0, b: 0, c: 0, d: 0, tx: 9, ty: 0 });
  });

  it('clipPath and all shape kinds with styles', () => {
    const style = pb.lField(10, [
      ...pb.lField(1, [...pb.fField(1, 1), ...pb.fField(4, 1)]),
      ...pb.lField(2, pb.fField(3, 0.5)),
      ...pb.fField(3, 2),
      ...pb.vField(4, 1),
      ...pb.vField(5, 2),
      ...pb.fField(6, 4),
      ...pb.fField(7, 5),
      ...pb.fField(8, 6),
      ...pb.fField(9, 7),
    ]);
    const fr = one(
      pb.frame({
        alpha: 1,
        clipPath: 'M0 0 L1 1 Z',
        shapes: [
          [...pb.pathShape('M0 0 L5 5'), ...style, ...pb.lField(11, pb.transform(1, 0, 0, 1, 3, 4))],
          pb.rectShape(1, 2, 3, 4, 0.5),
          pb.ellipseShape(5, 6, 7, 8),
        ],
      }),
    );
    expect(fr.clipPath).toBe('M0 0 L1 1 Z');
    const [path, rect, ell] = fr.shapes;
    expect(path).toMatchObject({ type: 'shape', d: 'M0 0 L5 5' });
    expect(path!.style).toEqual({
      fill: { r: 1, g: 0, b: 0, a: 1 },
      stroke: { r: 0, g: 0, b: 0.5, a: 0 },
      strokeWidth: 2,
      lineCap: 'round',
      lineJoin: 'bevel',
      miterLimit: 4,
      lineDash: { dash: 5, gap: 6, offset: 7 },
    });
    expect(path!.transform).toMatchObject({ a: 1, tx: 3, ty: 4 });
    expect(rect).toMatchObject({ type: 'rect', x: 1, y: 2, width: 3, height: 4, cornerRadius: 0.5, style: null });
    expect(rect!.transform).toEqual({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 });
    expect(ell).toMatchObject({ type: 'ellipse', x: 5, y: 6, radiusX: 7, radiusY: 8 });
  });

  it('unknown fields are skipped everywhere', () => {
    const junk = [...pb.vField(99, 5), ...pb.fField(98, 1), ...pb.lField(97, 'zz')];
    const m = parseZ(
      pb.movie({
        params: [...pb.params(10, 20, 30, 1), ...junk],
        sprites: [pb.sprite('k', [[...pb.frame({ alpha: 1 }), ...junk]])],
        unknown: junk,
      }),
    );
    expect(m.sprites[0]!.frames[0]!.alpha).toBe(1);
  });

  it('10-byte varints (negative int32) decode as signed', () => {
    const m = parseZ(
      pb.movie({
        params: pb.params(10, 20, 30, 1),
        sprites: [pb.sprite('k', [pb.frame()])],
        audios: [pb.audioEntity('a', -5, 7)],
      }),
    );
    expect(m.audioTracks[0]).toMatchObject({ audioKey: 'a', startFrame: -5, endFrame: 7 });
    expect(pb.varint(-5)).toHaveLength(10);
  });

  it('negative frame count -> parse-failed, not a crash', () => {
    expect(() => parseZ(pb.movie({ params: pb.params(10, 20, 30, -1) }))).toThrowError(
      expect.objectContaining({ code: 'parse-failed' }),
    );
  });

  it('fps 0 defaults to 20 with a warning', () => {
    const m = parseZ(pb.movie({ params: pb.params(10, 20, 0, 1) }));
    expect(m.fps).toBe(20);
    expect(m.warnings.join()).toMatch(/fps/);
  });

  it.each([
    ['missing params', pb.movie({ params: null })],
    ['zero viewBox', pb.movie({ params: pb.params(0, 0, 30, 5) })],
    ['implausible frames', pb.movie({ params: pb.params(10, 20, 30, 2_000_000_000) })],
  ])('%s -> parse-failed', (_n, bytes) => {
    expect(() => parseZ(bytes)).toThrowError(expect.objectContaining({ code: 'parse-failed' }));
  });

  it('pads short sprites with hidden frames and truncates long ones, with warnings', () => {
    const m = parseZ(
      pb.movie({
        params: pb.params(10, 20, 30, 3),
        sprites: [pb.sprite('short.vector', [pb.frame({ alpha: 1 })]), pb.sprite('long.vector', Array.from({ length: 5 }, () => pb.frame({ alpha: 1 })))],
      }),
    );
    expect(m.sprites.map((s) => s.frames.length)).toEqual([3, 3]);
    expect(m.sprites[0]!.frames[2]!.alpha).toBe(0);
    expect(m.warnings).toHaveLength(2);
  });

  it('matteKey and isMatte are preserved', () => {
    const m = parseZ(
      pb.movie({ params: pb.params(10, 20, 30, 1), sprites: [pb.sprite('m.matte', [pb.frame()]), pb.sprite('x', [pb.frame()], 'm.matte')] }),
    );
    expect(m.sprites.map((s) => [s.isMatte, s.matteKey])).toEqual([[true, null], [false, 'm.matte']]);
  });
});

describe('KEEP shapes', () => {
  const rect = pb.rectShape(1, 2, 3, 4);
  const ell = pb.ellipseShape(1, 1, 2, 2);
  const m = parseZ(
    pb.movie({
      params: pb.params(10, 20, 30, 6),
      sprites: [
        pb.sprite('a', [
          pb.frame({ alpha: 1, shapes: [rect] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [ell] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [] }),
        ]),
        // KEEP state must not leak between sprites; a KEEP on the very first frame has nothing to copy.
        pb.sprite('b', [
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape(), rect] }),
          pb.frame({ alpha: 1, shapes: [rect, pb.keepShape()] }),
          pb.frame({ alpha: 1, shapes: [] }),
          pb.frame({ alpha: 1, shapes: [pb.keepShape()] }),
        ]),
      ],
    }),
  );
  const types = (i: number) => m.sprites[i]!.frames.map((f) => f.shapes.map((s) => s.type));

  it('copies the previous frame shapes', () => {
    expect(types(0)).toEqual([['rect'], ['rect'], ['ellipse'], ['ellipse'], ['ellipse'], []]);
    expect(m.sprites[0]!.frames[1]!.shapes[0]).toMatchObject({ type: 'rect', width: 3 });
  });

  it('handles first-frame KEEP, KEEP-first mixed lists and stray KEEPs; no state across sprites', () => {
    // frame0 KEEP (nothing before) -> []; frame1 KEEP -> []; frame2 [KEEP, rect] -> KEEP wins => prev [];
    // frame3 [rect, KEEP] -> stray KEEP dropped => [rect]; frame4 [] -> []; frame5 KEEP -> []
    expect(types(1)).toEqual([[], [], [], ['rect'], [], []]);
  });

  it('no keep shape survives anywhere', () => {
    for (const s of m.sprites) for (const f of s.frames) for (const sh of f.shapes) expect(sh.type).not.toBe('keep');
  });
});

describe('images map: audio vs images', () => {
  const m = parseZ(
    pb.movie({
      params: pb.params(10, 20, 30, 1),
      images: [
        pb.imageEntry('png', pb.PNG),
        pb.imageEntry('jpg', pb.JPEG),
        pb.imageEntry('webp', pb.WEBP),
        pb.imageEntry('mp3id3', pb.MP3_ID3),
        pb.imageEntry('mp3sync', pb.MP3_SYNC),
        pb.imageEntry('ogg', pb.OGG),
        pb.imageEntry('junk', [1, 2, 3, 4, 5, 6, 7, 8, 9]),
      ],
      sprites: [pb.sprite('png', [pb.frame()])],
    }),
  );
  it('classifies by magic bytes', () => {
    expect([...m.images].map(([k, v]) => [k, v.mime])).toEqual([
      ['png', 'image/png'],
      ['jpg', 'image/jpeg'],
      ['webp', 'image/webp'],
    ]);
    expect([...m.audios].map(([k, v]) => [k, v.mime])).toEqual([
      ['mp3id3', 'audio/mpeg'],
      ['mp3sync', 'audio/mpeg'],
      ['ogg', 'audio/ogg'],
    ]);
  });
  it('drops unrecognised blobs with a warning instead of exposing them as images', () => {
    expect(m.images.has('junk') || m.audios.has('junk')).toBe(false);
    expect(m.warnings.join()).toMatch(/junk/);
  });
});

describe('SVGA 1.x / 1.5 zips (synthetic)', () => {
  const spec = (over: object = {}) =>
    strToU8(
      JSON.stringify({
        ver: '1.1.0',
        movie: { viewBox: { width: 100, height: 50 }, fps: '25', frames: 2 },
        images: { hero: 'img_1', gone: 'img_9' },
        sprites: [
          {
            imageKey: 'hero',
            matteKey: '',
            frames: [
              { alpha: 1, layout: { x: 0, y: 0, width: 10, height: 10 }, transform: { a: 1, b: 0, c: 0, d: 1, tx: 3, ty: 4 } },
              {},
            ],
          },
          {
            imageKey: 'v.vector',
            frames: [
              {
                alpha: 1,
                shapes: [
                  { type: 'shape', args: { d: 'M0 0' }, styles: { fill: [1, 0, 0, 1], stroke: { r: 0, g: 1, b: 0, a: 1 }, strokeWidth: 2, lineCap: 'round', lineJoin: 1, lineDash: [4, 2, 1] }, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } },
                  { type: 1, rect: { x: 1, y: 2, width: 3, height: 4, cornerRadius: 5 } },
                  { type: 'ellipse', args: { x: 1, y: 2, radiusX: 3, radiusY: 4 } },
                ],
              },
              { shapes: [{ type: 'keep' }] },
            ],
          },
        ],
        audios: [],
        ...over,
      }),
    );
  const png = Uint8Array.from(pb.PNG);

  it('1.x: spec JSON + PNGs normalise to the same model', () => {
    const m = parseSvga(zipSync({ 'movie.spec': spec(), 'img_1.png': png }));
    expect(m.container).toBe('zip-json');
    expect([m.version, m.fps, m.frames, m.viewBox]).toEqual(['1.1.0', 25, 2, { width: 100, height: 50 }]);
    expect(m.images.get('hero')).toMatchObject({ mime: 'image/png' });
    expect(m.warnings.join()).toMatch(/gone/); // img_9.png missing
    expect(m.sprites[0]!.frames[0]).toMatchObject({ alpha: 1, transform: { tx: 3, ty: 4 }, layout: { width: 10 } });
    expect(m.sprites[0]!.frames[1]!.alpha).toBe(0); // `{}` frame = hidden
    const [shape, rect, ell] = m.sprites[1]!.frames[0]!.shapes;
    expect(shape).toMatchObject({ type: 'shape', d: 'M0 0' });
    expect(shape!.style).toMatchObject({ fill: { r: 1, g: 0, b: 0, a: 1 }, stroke: { g: 1 }, strokeWidth: 2, lineCap: 'round', lineJoin: 'round', lineDash: { dash: 4, gap: 2, offset: 1 } });
    expect(rect).toMatchObject({ type: 'rect', cornerRadius: 5 });
    expect(ell).toMatchObject({ type: 'ellipse', radiusY: 4 });
    expect(m.sprites[1]!.frames[1]!.shapes).toEqual(m.sprites[1]!.frames[0]!.shapes); // KEEP resolved
  });

  it('1.5: movie.binary (protobuf in zip, images are file names) uses the 2.x decoder', () => {
    const bin = pb.movie({
      params: pb.params(64, 32, 12, 1),
      images: [pb.imageEntry('hero', 'img_7')],
      sprites: [pb.sprite('hero', [pb.frame({ alpha: 1 })])],
    });
    const m = parseSvga(zipSync({ 'movie.binary': bin, 'movie.spec': spec(), 'img_7.png': png }));
    expect(m.container).toBe('zip-protobuf');
    expect([m.fps, m.frames, m.viewBox.width]).toEqual([12, 1, 64]);
    expect(m.images.get('hero')!.data).toEqual(png);
    expect(m.warnings).toEqual([]);
  });

  it('1.5: zlib-compressed movie.binary is accepted too', () => {
    const bin = zlibSync(pb.movie({ params: pb.params(64, 32, 12, 1), sprites: [pb.sprite('x.vector', [pb.frame()])] }));
    expect(parseSvga(zipSync({ 'movie.binary': bin })).viewBox.width).toBe(64);
  });

  it('corrupt movie.binary falls back to movie.spec with a warning', () => {
    const m = parseSvga(zipSync({ 'movie.binary': Uint8Array.from([0xff, 0xff, 0xff]), 'movie.spec': spec(), 'img_1.png': png }));
    expect(m.container).toBe('zip-json');
    expect(m.warnings.join()).toMatch(/movie\.binary/);
  });

  it.each([
    ['neither spec nor binary', zipSync({ 'a.txt': strToU8('x') })],
    ['invalid JSON', zipSync({ 'movie.spec': strToU8('{nope') })],
    ['spec is not an object', zipSync({ 'movie.spec': strToU8('[1]') })],
    ['corrupt movie.binary and no spec', zipSync({ 'movie.binary': Uint8Array.from([0xff, 0xff, 0xff]) })],
  ])('%s -> parse-failed', (_n, bytes) => {
    expect(() => parseSvga(bytes)).toThrowError(expect.objectContaining({ code: 'parse-failed' }));
  });
});

describe('corrupt input never escapes as a raw RangeError', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const expectParseFailed = (b: Uint8Array) => {
    try {
      parseSvga(b);
    } catch (e) {
      expect(e).toBeInstanceOf(GiftPlayerError);
      expect((e as GiftPlayerError).code).toBe('parse-failed');
      return;
    }
    throw new Error('expected parse-failed');
  };

  for (const f of files) {
    it(`${f}: truncated at several points`, () => {
      const b = read(f);
      for (const frac of [0.02, 0.1, 0.3, 0.5, 0.9, 0.999]) expectParseFailed(b.subarray(0, Math.floor(b.length * frac)));
    });
  }

  it('random bytes after a valid zlib header', () => {
    for (let i = 0; i < 50; i++) expectParseFailed(Uint8Array.from([0x78, 0x9c, ...Array.from({ length: 64 }, () => (rnd() * 256) | 0)]));
  });

  it('random bytes after a valid zip header', () => {
    for (let i = 0; i < 50; i++) expectParseFailed(Uint8Array.from([0x50, 0x4b, 3, 4, ...Array.from({ length: 64 }, () => (rnd() * 256) | 0)]));
  });

  it('not SVGA at all', () => {
    expectParseFailed(new TextEncoder().encode('GIF89a hello'));
    expectParseFailed(new Uint8Array());
  });

  it('valid zlib wrapping a truncated / bit-flipped protobuf: parses or throws parse-failed, nothing else', () => {
    const inflated = pb.movie({
      params: pb.params(10, 20, 30, 4),
      images: [pb.imageEntry('a', pb.PNG)],
      sprites: [pb.sprite('a', [pb.frame({ alpha: 1, shapes: [pb.rectShape(1, 2, 3, 4)] }), pb.frame(), pb.frame(), pb.frame()])],
    });
    for (let cut = 0; cut < inflated.length; cut++) {
      try {
        parseZ(inflated.subarray(0, cut));
      } catch (e) {
        expect(e).toBeInstanceOf(GiftPlayerError);
        expect((e as GiftPlayerError).code).toBe('parse-failed');
      }
    }
    for (let i = 0; i < 300; i++) {
      const copy = inflated.slice();
      copy[(rnd() * copy.length) | 0] = (rnd() * 256) | 0;
      try {
        parseZ(copy);
      } catch (e) {
        expect(e).toBeInstanceOf(GiftPlayerError);
        expect((e as GiftPlayerError).code).toBe('parse-failed');
      }
    }
  });

  it('a 10+ byte varint is rejected cleanly', () => {
    const bad = pb.cat(pb.lField(1, '2.0'), [0x10, ...Array(11).fill(0xff), 0x01]);
    expectParseFailed(zlibSync(bad));
  });
});

describe('reuse of the detection result', () => {
  it('parseSvga(bytes, detected) does not touch the compressed bytes again', () => {
    const bytes = read('angel.svga');
    const detected = detectInternal(bytes);
    const viaDetected = parseSvga(new Uint8Array(0), detected); // empty bytes prove no second inflate
    const direct = parseSvga(bytes);
    const summary = (m: SvgaMovie) => [m.fps, m.frames, m.sprites.length, m.images.size];
    expect(summary(viaDetected)).toEqual(summary(direct));
  });
});

describe('decompression limits (untrusted input)', () => {
  const MB = 1024 * 1024;
  const expectLimit = (fn: () => unknown) =>
    expect(fn).toThrowError(expect.objectContaining({ code: 'parse-failed', message: expect.stringMatching(/maxInflatedBytes/) }));

  it('zlib bomb is aborted at the cap (small cap)', () => {
    const bomb = zlibSync(new Uint8Array(8 * MB), { level: 9 });
    expect(bomb.length).toBeLessThan(20_000); // ~1000:1
    expectLimit(() => parseSvga(bomb, undefined, { maxInflatedBytes: MB }));
  });

  it('zlib bomb is aborted at the default 64 MB cap', () => {
    const bomb = zlibSync(new Uint8Array(70 * MB), { level: 1 });
    expectLimit(() => parseSvga(bomb));
  });

  it('detection also refuses to inflate a bomb', () => {
    const bomb = zlibSync(new Uint8Array(8 * MB), { level: 9 });
    expectLimit(() => detectInternal(bomb, { maxInflatedBytes: MB }));
  });

  it('data under the cap still parses', () => {
    const m = parseSvga(read('angel.svga'), undefined, { maxInflatedBytes: 64 * MB });
    expect(m.sprites.length).toBe(125);
    // angel inflates to well over 100 KB, so a 10 KB cap must reject it
    expectLimit(() => parseSvga(read('angel.svga'), undefined, { maxInflatedBytes: 10_000 }));
  });

  it('zip: a single entry declaring too much is rejected from the central directory, before inflating', () => {
    const zip = zipSync({ 'movie.spec': new Uint8Array(8 * MB) }, { level: 9 });
    expect(zip.length).toBeLessThan(20_000);
    expectLimit(() => parseSvga(zip, undefined, { maxInflatedBytes: MB }));
  });

  it('zip: many entries that add up past the cap are rejected', () => {
    const entries = Object.fromEntries([1, 2, 3].map((i) => [`img_${i}.png`, new Uint8Array(400 * 1024)]));
    expectLimit(() => parseSvga(zipSync({ 'movie.spec': strToU8('{}'), ...entries }), undefined, { maxInflatedBytes: MB }));
  });

  it('zip: a header that lies about the size cannot inflate past what it declared', () => {
    const zip = zipSync({ 'movie.spec': new Uint8Array(8 * MB) }, { level: 9 });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    for (let i = 0; i + 30 < zip.length; i++) {
      const sig = view.getUint32(i, true);
      if (sig === 0x04034b50) view.setUint32(i + 22, 1000, true); // local header: uncompressed size
      if (sig === 0x02014b50) view.setUint32(i + 24, 1000, true); // central directory: uncompressed size
    }
    expect(() => parseSvga(zip, undefined, { maxInflatedBytes: MB })).toThrowError(
      expect.objectContaining({ code: 'parse-failed' }),
    );
  });

  it('sprites x frames above 2M is rejected before allocating', () => {
    // 70 sprites x 30,000 frames = 2.1M entries (each frame is an object)
    const sprites = Array.from({ length: 70 }, (_, i) => pb.sprite(`s${i}.vector`, []));
    expect(() => parseZ(pb.movie({ params: pb.params(10, 20, 30, 30_000), sprites }))).toThrowError(
      expect.objectContaining({ code: 'parse-failed', message: expect.stringMatching(/sprites x/) }),
    );
    // just under the limit is fine
    const ok = Array.from({ length: 60 }, (_, i) => pb.sprite(`s${i}.vector`, []));
    expect(parseZ(pb.movie({ params: pb.params(10, 20, 30, 30_000), sprites: ok })).sprites.length).toBe(60);
  });
});
