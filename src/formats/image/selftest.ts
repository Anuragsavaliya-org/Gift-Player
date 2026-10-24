/**
 * Runtime checks that the browser's WebCodecs `ImageDecoder` composites animated GIF / WebP the way every
 * browser's <img> does. `auto` mode decodes a tiny animation once and compares; a failing decoder is skipped in
 * favour of our own (bit-exact) decoders. We test behaviour instead of sniffing user agents.
 *
 * Found with Playwright WebKit 27.2 (see PROGRESS.md, Phase 4):
 *  - GIF:  "restore to background" areas come out OPAQUE BLACK instead of transparent.
 *  - WebP: frames with partial transparency come out opaque with wrong colours, and the error grows each time
 *          the same frame is decoded again (so loop 2 would not look like loop 1).
 * Chromium passes both.
 */
// samples/synthetic/selftest-gif-dispose.gif: 4x4, frame 0 opaque red with disposal 2, frame 1 a 2x2 green patch.
// Expected frame 1: (0,0) green opaque, (3,3) TRANSPARENT.
const SELFTEST_GIF = 'R0lGODlhBAAEAJEAAAAAAP8AAADIAAAA/yH5BAgKAAAALAAAAAAEAAQAAAIEjI8ZBQAh+QQECgAAACwAAAAAAgACAAACApRVADs=';
// samples/synthetic/selftest-webp-alpha.webp: 4x4, frame 0 opaque red, frame 1 a lossless 50 %-alpha green that
// replaces it ("do not blend"). Expected frame 1: about (0, 255, 0, 128), identical on every decode.
const SELFTEST_WEBP =
  'UklGRoQAAABXRUJQVlA4WAoAAAASAAAAAwAAAwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAABWUDhMDwAAAC8DwAAABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAMAAAMAAGQAAAJWUDhMDwAAAC8DwAAQB9D/iAIGIqL/AQA=';

const cache = new Map<string, Promise<boolean>>();

/** true if `ImageDecoder` can be trusted for `mime` (GIF and WebP are tested; other types pass). */
export function imageDecoderReliable(mime: string): Promise<boolean> {
  if (mime !== 'image/webp' && mime !== 'image/gif') return Promise.resolve(true);
  let p = cache.get(mime);
  if (!p) cache.set(mime, (p = run(mime)));
  return p;
}

async function run(mime: string): Promise<boolean> {
  try {
    const bytes = Uint8Array.from(atob(mime === 'image/gif' ? SELFTEST_GIF : SELFTEST_WEBP), (c) => c.charCodeAt(0));
    const dec = new ImageDecoder({ data: bytes, type: mime });
    try {
      await dec.tracks.ready;
      const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(4, 4) : Object.assign(document.createElement('canvas'), { width: 4, height: 4 });
      const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      const read = async (x: number, y: number) => {
        const { image } = await dec.decode({ frameIndex: 1 });
        ctx.clearRect(0, 0, 4, 4);
        ctx.drawImage(image, 0, 0);
        image.close();
        return ctx.getImageData(x, y, 1, 1).data;
      };
      if (mime === 'image/gif') {
        const patch = await read(0, 0);
        const disposed = await read(3, 3);
        return patch[1]! > 150 && patch[3]! > 250 && disposed[3]! < 8;
      }
      const alphas: number[] = [];
      for (let k = 0; k < 2; k++) {
        const p = await read(1, 1);
        if (Math.abs(p[3]! - 128) > 6 || p[0]! > 12 || p[2]! > 12 || p[1]! < 240) return false;
        alphas.push(p[3]!);
      }
      return alphas[0] === alphas[1]; // decoding the same frame again must not change it
    } finally {
      dec.close();
    }
  } catch {
    return false;
  }
}
