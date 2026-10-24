import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { zlibSync as deflate } from 'fflate';
import { describe, expect, it } from 'vitest';
import { detectFormat, detectSource, GiftPlayerError } from '../src';
import { detectInternal } from '../src/core/detect';

const samplesDir = join(__dirname, '../samples');
const bytesOf = (...n: number[]) => new Uint8Array(n);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

// Explicit ground truth per real sample (the detector itself never looks at file names).
const svga2 = { format: 'svga', version: '2.x' } as const;
const expectedFormats: Record<string, object> = {
  'angel.svga': svga2,
  'Fiery-Red-Dragon.svga': svga2,
  'Glossy-Pink-Lips.svga': svga2,
  'kingset.svga': svga2,
  'matteBitmap.svga': svga2,
  'matteRect.svga': svga2,
  'Pink-Heart-Rocket.svga': svga2,
  'Rocket.svga': { format: 'svga', version: '1.x' },
  'rotating-earth.gif': { format: 'gif' },
  'animated.webp': { format: 'webp', animated: true },
  'static.webp': { format: 'webp', animated: false },
  'like.pag': { format: 'pag' },
  'replacement.pag': { format: 'pag' },
};

const read = (f: string) => new Uint8Array(readFileSync(join(samplesDir, f)));

describe('synthetic GIF/WebP files', () => {
  const dir = join(samplesDir, 'synthetic');
  for (const f of readdirSync(dir)) {
    it(`detects ${f}`, () => {
      const info = detectFormat(new Uint8Array(readFileSync(join(dir, f))));
      if (f.endsWith('.gif')) expect(info).toEqual({ format: 'gif' });
      else expect(info).toEqual({ format: 'webp', animated: !f.startsWith('webp-static') });
    });
  }
});

describe('real samples', () => {
  const files = readdirSync(samplesDir, { withFileTypes: true }).filter((d) => d.isFile() && !d.name.endsWith('.json')).map((d) => d.name);

  it('every sample has an expectation (add new samples to the table)', () => {
    expect(files.sort()).toEqual(Object.keys(expectedFormats).sort());
  });

  for (const [f, expected] of Object.entries(expectedFormats)) {
    it(`detects ${f}`, () => {
      expect(detectFormat(read(f))).toEqual(expected);
    });
  }

  it('ignores the file name: a renamed SVGA is still SVGA', async () => {
    const blob = new File([read('angel.svga')], 'totally-a-photo.png');
    expect(await detectSource(blob)).toEqual(svga2);
  });

  it('SVGA 2.x detection hands back the inflated buffer (no double inflate)', () => {
    const { info, inflated } = detectInternal(read('angel.svga'));
    expect(info).toEqual(svga2);
    expect(inflated).toBeInstanceOf(Uint8Array);
    expect(inflated!.length).toBeGreaterThan(read('angel.svga').length);
    expect(detectInternal(read('rotating-earth.gif')).inflated).toBeUndefined();
  });
});

// Minimal stored (uncompressed) zip builder; CRCs are zeroed, which detection does not check.
function makeZip(names: string[], comment = ''): Uint8Array {
  const enc = new TextEncoder();
  const parts: number[] = [];
  const central: number[] = [];
  const le = (v: number, n: number) => Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 0xff);
  for (const name of names) {
    const nameBytes = Array.from(enc.encode(name));
    const offset = parts.length;
    parts.push(...le(0x04034b50, 4), ...le(10, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(nameBytes.length, 2), ...le(0, 2), ...nameBytes);
    central.push(...le(0x02014b50, 4), ...le(20, 2), ...le(10, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(0, 4), ...le(nameBytes.length, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 2), ...le(0, 4), ...le(offset, 4), ...nameBytes);
  }
  const commentBytes = Array.from(enc.encode(comment));
  const eocd = [...le(0x06054b50, 4), ...le(0, 2), ...le(0, 2), ...le(names.length, 2), ...le(names.length, 2), ...le(central.length, 4), ...le(parts.length, 4), ...le(commentBytes.length, 2), ...commentBytes];
  return new Uint8Array([...parts, ...central, ...eocd]);
}

describe('zip / SVGA 1.x', () => {
  it('real Rocket.svga: movie.spec is not the first entry', () => {
    const b = read('Rocket.svga');
    const firstName = new TextDecoder().decode(b.subarray(30, 30 + (b[26]! | (b[27]! << 8))));
    expect(firstName).not.toBe('movie.spec');
    expect(detectFormat(b)).toEqual({ format: 'svga', version: '1.x' });
  });
  it('synthetic: movie.spec as second entry', () => {
    expect(detectFormat(makeZip(['0.png', 'movie.spec']))).toEqual({ format: 'svga', version: '1.x' });
  });
  it('synthetic: movie.binary (1.5)', () => {
    expect(detectFormat(makeZip(['a.png', 'movie.binary']))).toEqual({ format: 'svga', version: '1.x' });
  });
  it('synthetic: with a trailing zip comment', () => {
    expect(detectFormat(makeZip(['movie.spec'], 'hello'))).toEqual({ format: 'svga', version: '1.x' });
  });
  it('plain zip without movie.spec/movie.binary -> unsupported-format', () => {
    expect(() => detectFormat(makeZip(['readme.txt', 'photo.png']))).toThrowError(
      expect.objectContaining({ code: 'unsupported-format' }),
    );
  });
  it('zip with only a local header (no central directory) -> unsupported-format', () => {
    expect(() => detectFormat(makeZip(['movie.spec']).subarray(0, 40))).toThrowError(
      expect.objectContaining({ code: 'unsupported-format' }),
    );
  });
});

describe('SVGA 2.x protobuf tolerance', () => {
  const varint = (n: number) => {
    const out: number[] = [];
    while (n > 0x7f) { out.push((n & 0x7f) | 0x80); n = Math.floor(n / 128); }
    out.push(n);
    return out;
  };
  const params = [0x18, 15, 0x20, 30]; // fps=15, frames=30
  const movie = (...extra: number[]) => deflate(new Uint8Array([0x12, params.length, ...params, ...extra]));

  it('minimal MovieEntity', () => {
    expect(detectFormat(movie())).toEqual(svga2);
  });
  it('skips unknown top-level fields (varint, fixed32, length-delimited)', () => {
    const unknown = [0x38, 0x07, 0x45, 1, 2, 3, 4, 0x32, 2, 0xaa, 0xbb]; // fields 7, 8, 6
    expect(detectFormat(movie(...unknown))).toEqual(svga2);
  });
  it('skips unknown fields inside params, handles a 10-byte varint', () => {
    const tenByte = [0x28, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x01]; // field 5 = -1 (int64)
    const p = [0x18, 15, ...tenByte, 0x20, 30];
    const b = deflate(new Uint8Array([0x12, p.length, ...p]));
    expect(detectFormat(b)).toEqual(svga2);
    expect(varint(300)).toEqual([0xac, 0x02]);
  });
  it('rejects params without fps/frames', () => {
    expect(() => detectFormat(deflate(new Uint8Array([0x12, 2, 0x18, 15])))).toThrowError(
      expect.objectContaining({ code: 'unsupported-format' }),
    );
  });
  it('rejects malformed wire format', () => {
    expect(() => detectFormat(movie(0x32, 50, 1))).toThrowError( // length 50 runs past the end
      expect.objectContaining({ code: 'unsupported-format' }),
    );
  });
});

// Synthetic headers for edge cases real samples don't cover (real files are covered above).
describe('synthetic headers', () => {
  it('GIF87a / GIF89a', () => {
    expect(detectFormat(bytesOf(...ascii('GIF87a'), 1, 0))).toEqual({ format: 'gif' });
    expect(detectFormat(bytesOf(...ascii('GIF89a'), 1, 0))).toEqual({ format: 'gif' });
  });

  const webp = (chunk: string, flags: number) =>
    bytesOf(...ascii('RIFF'), 30, 0, 0, 0, ...ascii('WEBP'), ...ascii(chunk), 10, 0, 0, 0, flags, 0, 0, 0, 0, 0, 0, 0, 0, 0);

  it('animated WebP (VP8X + animation flag)', () => {
    expect(detectFormat(webp('VP8X', 0x12))).toEqual({ format: 'webp', animated: true });
  });
  it('static WebP', () => {
    expect(detectFormat(webp('VP8X', 0x10))).toEqual({ format: 'webp', animated: false });
    expect(detectFormat(webp('VP8 ', 0))).toEqual({ format: 'webp', animated: false });
  });

  it('PAG', () => {
    expect(detectFormat(bytesOf(...ascii('PAG'), 1, 2, 3, 4))).toEqual({ format: 'pag' });
  });

});

describe('garbage', () => {
  const expectUnsupported = (b: Uint8Array) => {
    try {
      detectFormat(b);
    } catch (e) {
      expect(e).toBeInstanceOf(GiftPlayerError);
      expect((e as GiftPlayerError).code).toBe('unsupported-format');
      return;
    }
    throw new Error('expected detectFormat to throw');
  };

  it('empty input', () => expectUnsupported(new Uint8Array()));
  it('random text', () => expectUnsupported(new TextEncoder().encode('hello world, not a gift')));
  it('PNG', () => expectUnsupported(bytesOf(0x89, ...ascii('PNG'), 13, 10, 26, 10)));
  it('random bytes', () => {
    const r = new Uint8Array(512);
    let s = 12345;
    for (let i = 0; i < r.length; i++) r[i] = (s = (s * 1103515245 + 12345) & 0x7fffffff) >> 16;
    expectUnsupported(r);
  });
  it('valid zlib that is not a MovieEntity', () => {
    expectUnsupported(deflate(new TextEncoder().encode('just some text, valid zlib')));
  });
  it('truncated real SVGA', () => {
    const svga = readdirSync(samplesDir).find((f) => f.endsWith('.svga'))!;
    expectUnsupported(new Uint8Array(readFileSync(join(samplesDir, svga))).subarray(0, 200));
  });
});

describe('inputs', () => {
  const gif = new Uint8Array([...ascii('GIF89a'), 1, 0, 1, 0]);
  it('ArrayBuffer', async () => {
    expect(await detectSource(gif.buffer.slice(0))).toEqual({ format: 'gif' });
  });
  it('typed-array view with offset', async () => {
    const padded = new Uint8Array([9, 9, ...gif]);
    expect(await detectSource(padded.subarray(2))).toEqual({ format: 'gif' });
  });
  it('Blob', async () => {
    expect(await detectSource(new Blob([gif]))).toEqual({ format: 'gif' });
  });
  it('URL via fetch', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response(gif)) as typeof fetch;
    try {
      expect(await detectSource('https://example.test/x')).toEqual({ format: 'gif' });
    } finally {
      globalThis.fetch = orig;
    }
  });
  it('URL 404 -> fetch-failed', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async () => new Response('no', { status: 404 })) as typeof fetch;
    try {
      await expect(detectSource('https://example.test/x')).rejects.toMatchObject({ code: 'fetch-failed' });
    } finally {
      globalThis.fetch = orig;
    }
  });
  it('invalid input type', async () => {
    await expect(detectSource(42 as never)).rejects.toMatchObject({ code: 'invalid-input' });
  });
});
