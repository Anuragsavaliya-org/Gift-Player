/**
 * Generates the synthetic GIF/WebP test files (run through `npm run gen:synthetic`; the output is committed
 * in samples/synthetic/). GIFs are encoded by tools/synthetic/gif-encoder.ts; animated WebPs are muxed by
 * tools/synthetic/webp-muxer.ts from still frames that Chrome's canvas encoder produces.
 */
import { encodeGif, type GifFrameSpec, type RGB } from '../tools/synthetic/gif-encoder';
import { buildSvgaSamples } from '../tools/synthetic/svga-samples';
import { muxAnimatedWebp, type WebpFrameSpec } from '../tools/synthetic/webp-muxer';

const files: Record<string, Uint8Array> = {};

// ---------------------------------------------------------------- GIF
const W = 40;
const H = 30;
const PAL: RGB[] = [
  [0, 0, 0], [230, 30, 30], [30, 200, 60], [40, 80, 240], [240, 220, 30], [220, 40, 200], [30, 210, 220], [255, 255, 255],
  [250, 140, 20], [120, 120, 120], [90, 20, 20], [20, 90, 20], [20, 20, 90], [200, 200, 120], [120, 200, 200], [200, 120, 200],
];
const SWAPPED: RGB[] = PAL.map(([r, g, b]) => [b, r, g] as RGB);

type Fill = number | ((x: number, y: number) => number);
function gframe(x: number, y: number, w: number, h: number, fill: Fill, o: Partial<GifFrameSpec> = {}): GifFrameSpec {
  const indices = new Uint8Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) indices[j * w + i] = typeof fill === 'number' ? fill : fill(i, j);
  return { x, y, width: w, height: h, indices, delayCs: 10, disposal: 1, ...o };
}
const stripes = (a: number, b: number, hole?: number) => (x: number, y: number) => (((x >> 1) + (y >> 1)) % 2 ? a : hole !== undefined && (x + y) % 5 === 0 ? hole : b);
const gradient = (x: number, y: number) => 1 + (((x >> 2) + (y >> 2)) % 6);
const gif = (name: string, frames: GifFrameSpec[], loop: number | null = 0, pal: RGB[] | null = PAL) => {
  files[name] = encodeGif({ width: W, height: H, globalPalette: pal, frames, loop });
};

gif('gif-disposal-1.gif', [
  gframe(0, 0, W, H, gradient, { delayCs: 20 }),
  gframe(5, 5, 12, 10, 3, { delayCs: 20 }),
  gframe(22, 12, 12, 10, 4, { delayCs: 20 }),
  gframe(10, 18, 20, 8, 6, { delayCs: 20 }),
]);
gif('gif-disposal-2.gif', [
  gframe(0, 0, W, H, gradient, { disposal: 2, delayCs: 20 }),
  gframe(5, 5, 14, 12, 3, { disposal: 2, delayCs: 20 }),
  gframe(20, 10, 14, 12, 4, { disposal: 2, delayCs: 20 }),
  gframe(0, 0, W, 10, 5, { disposal: 2, delayCs: 20 }),
]);
gif('gif-disposal-3.gif', [
  gframe(0, 0, W, H, gradient, { disposal: 1, delayCs: 20 }),
  gframe(5, 5, 14, 12, 3, { disposal: 3, delayCs: 20 }),
  gframe(22, 10, 12, 12, 4, { disposal: 1, delayCs: 20 }),
  gframe(8, 16, 24, 10, 6, { disposal: 3, delayCs: 20 }),
  gframe(2, 2, 10, 10, 5, { disposal: 1, delayCs: 20 }),
]);
gif('gif-transparency.gif', [
  gframe(0, 0, W, H, stripes(1, 0), { transparentIndex: 0, disposal: 1, delayCs: 20 }),
  gframe(0, 0, W, H, stripes(3, 0, 0), { transparentIndex: 0, disposal: 1, delayCs: 20 }),
  gframe(4, 4, 30, 20, stripes(4, 9), { transparentIndex: 9, disposal: 2, delayCs: 20 }),
  gframe(0, 0, W, H, stripes(2, 15), { transparentIndex: 15, disposal: 1, delayCs: 20 }),
]);
{
  const delays = [0, 1, 2, 5, 10, 20, 50];
  gif('gif-delays.gif', delays.map((d, i) => gframe(0, 0, W, H, i + 1, { delayCs: d })));
}
for (const [name, loop] of [['0', 0], ['1', 1], ['3', 3], ['none', null]] as const) {
  gif(`gif-loop-${name}.gif`, [1, 2, 3].map((c) => gframe(0, 0, W, H, c, { delayCs: 5 })), loop);
}
gif('gif-interlaced.gif', [
  gframe(0, 0, W, H, (x, y) => 1 + (y % 8), { interlace: true, palette: SWAPPED, delayCs: 20 }),
  gframe(6, 4, 25, 17, (x, y) => 1 + ((x + y) % 7), { interlace: true, delayCs: 20 }),
]);
gif('gif-mixed.gif', [
  gframe(0, 0, W, H, gradient, { palette: SWAPPED, disposal: 1, delayCs: 8 }),
  gframe(6, 6, 20, 14, stripes(7, 0), { transparentIndex: 0, disposal: 3, delayCs: 12 }),
  gframe(14, 10, 22, 16, 2, { palette: SWAPPED, disposal: 2, delayCs: 6 }),
  gframe(0, 0, W, H, stripes(3, 9, 0), { transparentIndex: 9, disposal: 1, delayCs: 15 }),
  gframe(4, 12, 30, 12, (x, y) => 1 + ((x * 3 + y) % 9), { interlace: true, disposal: 3, delayCs: 9 }),
  gframe(20, 2, 18, 12, stripes(5, 0), { transparentIndex: 0, disposal: 0, delayCs: 7 }),
  gframe(0, 20, W, 10, 6, { disposal: 2, delayCs: 11 }),
  gframe(10, 0, 10, 30, 4, { disposal: 1, delayCs: 10 }),
], 0);
// First frame with disposal 3 (nothing to restore to) and a frame that does not cover the canvas.
gif('gif-first-disposal3.gif', [
  gframe(10, 8, 20, 12, 3, { disposal: 3, delayCs: 20 }),
  gframe(0, 0, 14, 10, 1, { disposal: 1, delayCs: 20 }),
], 0);
gif('gif-single.gif', [gframe(0, 0, W, H, gradient)], null);

// ---------------------------------------------------------------- WebP
const WW = 48;
const WH = 36;
type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;

async function still(w: number, h: number, draw: Draw, lossless = false): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/webp', lossless ? 1 : 0.9));
  return new Uint8Array(await blob.arrayBuffer());
}
const opaque = (a: string, b: string): Draw => (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, w, h);
  gr.addColorStop(0, a);
  gr.addColorStop(1, b);
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
};
const translucent = (color: string, alpha: number): Draw => (g, w, h) => {
  g.globalAlpha = alpha;
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
  g.globalAlpha = 1;
  g.fillStyle = '#fff';
  g.fillRect(2, 2, w / 3, h / 3);
};
const solid = (color: string): Draw => (g, w, h) => {
  g.fillStyle = color;
  g.fillRect(0, 0, w, h);
};
interface WF { x?: number; y?: number; w?: number; h?: number; ms?: number; blend?: boolean; dispose?: boolean; draw: Draw; lossless?: boolean }
async function webp(name: string, frames: WF[], loop = 0, alpha = true): Promise<void> {
  const specs: WebpFrameSpec[] = [];
  for (const f of frames) {
    const w = f.w ?? WW;
    const h = f.h ?? WH;
    specs.push({ still: await still(w, h, f.draw, f.lossless), x: f.x ?? 0, y: f.y ?? 0, width: w, height: h, durationMs: f.ms ?? 100, blend: f.blend ?? true, disposeToBackground: f.dispose ?? false });
  }
  files[name] = muxAnimatedWebp({ width: WW, height: WH, loop, hasAlpha: alpha, frames: specs });
}

for (const blend of [true, false]) {
  await webp(`webp-alpha-${blend ? 'blend' : 'noblend'}.webp`, [
    { draw: opaque('#e22', '#24e'), ms: 100 },
    { x: 8, y: 6, w: 24, h: 18, draw: translucent('#0c0', 0.5), blend, ms: 100 },
    { x: 16, y: 12, w: 26, h: 20, draw: translucent('#fa0', 0.4), blend, ms: 100 },
  ]);
}
await webp('webp-dispose-bg.webp', [
  { draw: opaque('#2a2', '#222'), ms: 100 },
  { x: 4, y: 4, w: 20, h: 16, draw: solid('#e33'), dispose: true, ms: 100 },
  { x: 20, y: 14, w: 20, h: 16, draw: translucent('#33e', 0.6), dispose: true, ms: 100 },
  { x: 0, y: 0, w: 14, h: 12, draw: solid('#ee3'), ms: 100 },
]);
await webp('webp-mixed-codecs.webp', [
  { draw: opaque('#c0c', '#0cc'), lossless: true, ms: 80 },
  { x: 6, y: 4, w: 25, h: 15, draw: translucent('#e60', 0.7), blend: true, ms: 80 },
  { x: 12, y: 10, w: 21, h: 13, draw: translucent('#06e', 0.5), lossless: true, blend: false, ms: 80 },
  { x: 0, y: 0, w: WW, h: WH, draw: opaque('#fe0', '#e0f'), blend: true, dispose: true, ms: 80 },
  { x: 30, y: 20, w: 17, h: 15, draw: translucent('#0b4', 0.8), lossless: true, ms: 80 },
]);
await webp('webp-offsets.webp', [
  { draw: opaque('#335', '#aab'), lossless: true },
  { x: 2, y: 2, w: 21, h: 13, draw: solid('#f44'), lossless: true },
  { x: 10, y: 4, w: 17, h: 9, draw: translucent('#4f4', 0.5) },
  { x: 30, y: 20, w: 15, h: 13, draw: translucent('#44f', 0.7), lossless: true },
]);
{
  const ms = [0, 1, 10, 20, 50, 100];
  await webp('webp-delays.webp', ms.map((d, i) => ({ draw: solid(['#e22', '#2e2', '#22e', '#ee2', '#e2e', '#2ee'][i]!), lossless: true, ms: d })), 0, false);
}
for (const n of [0, 1, 3]) {
  await webp(`webp-loop-${n}.webp`, ['#e22', '#2e2', '#22e'].map((c) => ({ draw: solid(c), lossless: true, ms: 50 })), n, false);
}
await webp('webp-single.webp', [{ draw: opaque('#c60', '#06c'), ms: 200 }]);
files['webp-static-lossy.webp'] = await still(WW, WH, opaque('#d33', '#33d'));
files['webp-static-lossless.webp'] = await still(WW, WH, opaque('#3d3', '#d3d'), true);
files['webp-static-alpha.webp'] = await still(WW, WH, translucent('#f80', 0.5));

// ---------------------------------------------------------------- self-test files (embedded in src/formats/image/selftest.ts)
// GIF: 4x4. Frame 0 opaque red with disposal 2 ("restore to background"), frame 1 a 2x2 green patch. Browsers show frame 1
// as green in the corner and TRANSPARENT elsewhere; WebKit's ImageDecoder fills the disposed area with opaque black.
files['selftest-gif-dispose.gif'] = encodeGif({
  width: 4, height: 4, loop: null, globalPalette: [[0, 0, 0], [255, 0, 0], [0, 200, 0], [0, 0, 255]],
  frames: [
    { x: 0, y: 0, width: 4, height: 4, indices: new Uint8Array(16).fill(1), delayCs: 10, disposal: 2 },
    { x: 0, y: 0, width: 2, height: 2, indices: new Uint8Array(4).fill(2), delayCs: 10, disposal: 1 },
  ],
});
// 4x4: opaque red, then a lossless frame with 50 % alpha that REPLACES it (no blend). The composited second frame must
// be (0,255,0) at alpha ~128. WebKit's ImageDecoder returns it opaque, so the library uses this to avoid it.
{
  const red = await still(4, 4, solid('#f00'), true);
  const green = await still(4, 4, (g, w, h) => { g.globalAlpha = 0.5; g.fillStyle = '#0f0'; g.fillRect(0, 0, w, h); }, true);
  files['selftest-webp-alpha.webp'] = muxAnimatedWebp({
    width: 4, height: 4, loop: 0, hasAlpha: true,
    frames: [
      { still: red, x: 0, y: 0, width: 4, height: 4, durationMs: 100, blend: true, disposeToBackground: false },
      { still: green, x: 0, y: 0, width: 4, height: 4, durationMs: 100, blend: false, disposeToBackground: false },
    ],
  });
}

// ---------------------------------------------------------------- stand-ins for the real sample files (keys start with `@root/`: written to samples/, only where the file is missing)
async function pngOf(w: number, h: number, draw: Draw): Promise<Uint8Array> {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!, w, h);
  const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
for (const [name, bytes] of Object.entries(await buildSvgaSamples(pngOf))) files[`@root/${name}`] = bytes;
{
  // static.webp: a lossy 400 x 300 picture. animated.webp: 40 lossy frames, 320 x 240, 50 ms each, looping forever.
  const scene = (t: number): Draw => (g, w, h) => {
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#1b3a6b');
    sky.addColorStop(1, '#f2a65a');
    g.fillStyle = sky;
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#17212f';
    g.beginPath();
    g.moveTo(0, h);
    for (let x = 0; x <= w; x += 8) g.lineTo(x, h * 0.65 + Math.sin(x / 31 + t) * 18 + Math.sin(x / 11) * 6);
    g.lineTo(w, h);
    g.fill();
    g.fillStyle = '#ffe9a8';
    g.beginPath();
    g.arc(w * (0.2 + 0.6 * t / (Math.PI * 2)), h * 0.3, h * 0.08, 0, Math.PI * 2);
    g.fill();
  };
  files['@root/static.webp'] = await still(400, 300, scene(1));
  const AW = 320, AH = 240, specs: WebpFrameSpec[] = [];
  for (let i = 0; i < 40; i++) specs.push({ still: await still(AW, AH, scene((i / 40) * Math.PI * 2)), x: 0, y: 0, width: AW, height: AH, durationMs: 50, blend: false, disposeToBackground: false });
  files['@root/animated.webp'] = muxAnimatedWebp({ width: AW, height: AH, loop: 0, hasAlpha: false, frames: specs });
}

// ---------------------------------------------------------------- output
function b64(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
(window as unknown as { __result: unknown }).__result = { files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, b64(v)])) };
