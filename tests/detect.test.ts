import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflate } from 'pako';
import { describe, expect, it } from 'vitest';
import { detectFormat, detectSource, GiftPlayerError } from '../src';

const samplesDir = join(__dirname, '../samples');
const bytesOf = (...n: number[]) => new Uint8Array(n);
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0));

// Ground truth for real samples comes from the file extension *in the test only*;
// the detector itself never looks at names.
const extToExpected: Record<string, object> = {
  svga: { format: 'svga', version: '2.x' },
  gif: { format: 'gif' },
  pag: { format: 'pag' },
};

describe('real samples', () => {
  const files = readdirSync(samplesDir).filter((f) => /\.(svga|gif|webp|pag)$/i.test(f));

  it('has samples', () => expect(files.length).toBeGreaterThan(0));

  for (const f of files) {
    it(`detects ${f}`, () => {
      const ext = f.split('.').pop()!.toLowerCase();
      const info = detectFormat(new Uint8Array(readFileSync(join(samplesDir, f))));
      if (ext === 'webp') expect(info).toMatchObject({ format: 'webp' });
      else expect(info).toEqual(extToExpected[ext]);
    });
  }

  it('ignores the file name: a renamed SVGA is still SVGA', async () => {
    const svga = readdirSync(samplesDir).find((f) => f.endsWith('.svga'))!;
    const buf = readFileSync(join(samplesDir, svga));
    const blob = new File([new Uint8Array(buf)], 'totally-a-photo.png');
    expect(await detectSource(blob)).toEqual({ format: 'svga', version: '2.x' });
  });
});

// Synthetic headers: NOT real files. Real GIF/WebP/PAG samples are still missing from /samples.
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

  it('zip (SVGA 1.x)', () => {
    expect(detectFormat(bytesOf(0x50, 0x4b, 0x03, 0x04, 0, 0))).toEqual({ format: 'svga', version: '1.x' });
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
