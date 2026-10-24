/**
 * Browser verification for GIF / animated WebP. `?task=` is one of:
 *   support   what this browser can do and which path 'auto' picks
 *   correct   every frame of every file through each path vs. the browser's own ImageDecoder (the oracle)
 *   timing    on-screen frame times vs. the file's delays (Ticker + renderer)
 *   loops     play counts for loop counts 0 / 1 / 3 / absent, and the option-over-file precedence
 *   leaks     50 create/play/destroy cycles per format and path, with resource counters
 * Result is published on window.__result (see scripts/verify-images.mjs).
 */
import { resolveLoops } from '../src/core/frame-source';
import { Ticker } from '../src/core/ticker';
import { AnimatedImageRenderer, type ImagePath } from '../src/formats/image';
import { imageDecoderReliable } from '../src/formats/image/selftest';
import { readGifMeta, readWebpMeta } from '../src/formats/image/meta';
import { diffData } from './lib/diff';

const q = new URLSearchParams(location.search);
const task = q.get('task') ?? 'support';
const files = (q.get('files') ?? '').split(',').filter(Boolean);
const paths = (q.get('paths') ?? 'imagedecoder,fallback').split(',') as ('auto' | 'imagedecoder' | 'fallback')[];
/** 'local': the browser's own ImageDecoder is the reference. 'golden': frames dumped from Chromium's ImageDecoder. */
const oracleMode = q.get('oracle') ?? 'local';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const mimeOf = (f: string) => (f.endsWith('.gif') ? 'image/gif' : 'image/webp');
const bytesOf = async (f: string) => new Uint8Array(await (await fetch(`/samples/${f}`)).arrayBuffer());

function mount(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.style.cssText = `width:${w}px;height:${h}px`;
  document.body.append(c);
  return c;
}

/** Intrinsic size of any GIF/WebP, including still WebP (whose header has no canvas size). */
async function sizeOf(bytes: Uint8Array, file: string): Promise<{ w: number; h: number }> {
  if (file.endsWith('.gif')) {
    const m = readGifMeta(bytes);
    return { w: m.width, h: m.height };
  }
  const m = readWebpMeta(bytes);
  if (m.width) return { w: m.width, h: m.height };
  const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }));
  const s = { w: bmp.width, h: bmp.height };
  bmp.close();
  return s;
}

/** The browser's own decoder as the reference: composited frames straight from ImageDecoder. */
async function openOracle(bytes: Uint8Array, mime: string, w: number, h: number) {
  if (typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(mime))) return null;
  const dec = new ImageDecoder({ data: bytes, type: mime });
  await dec.tracks.ready;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return {
    count: dec.tracks.selectedTrack!.frameCount,
    async frame(i: number): Promise<Uint8ClampedArray> {
      const { image } = await dec.decode({ frameIndex: i });
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(image, 0, 0);
      image.close();
      return ctx.getImageData(0, 0, w, h).data;
    },
    close: () => dec.close(),
  };
}

const toB64 = (b: Uint8ClampedArray) => {
  let s = '';
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s: string) => Uint8ClampedArray.from(atob(s), (c) => c.charCodeAt(0));
const goldenUrl = (file: string) => `/samples/.golden/${file.replace(/\//g, '__')}.json`;

/** Frames dumped from the reference browser (Chromium ImageDecoder): lets every other browser be checked against it. */
async function openGolden(file: string) {
  const res = await fetch(goldenUrl(file));
  if (!res.ok) return null;
  const g = (await res.json()) as { w: number; h: number; count: number; indices: number[]; frames: string[] };
  const at = new Map(g.indices.map((frameIndex, k) => [frameIndex, k]));
  return { count: g.count, indices: g.indices, frame: async (i: number) => fromB64(g.frames[at.get(i)!]!), close: () => undefined };
}

/** Dumps up to `max` evenly spaced frames per file (all frames when `max` is 0 or the file is shorter). */
async function runDumpGolden() {
  const max = Number(q.get('max') ?? 0);
  const out: Record<string, { w: number; h: number; count: number; indices: number[]; frames: string[] }> = {};
  for (const f of files) {
    const bytes = await bytesOf(f);
    const { w, h } = await sizeOf(bytes, f);
    const o = await openOracle(bytes, mimeOf(f), w, h);
    if (!o) continue;
    const n = o.count;
    const indices = max > 0 && n > max ? [...new Set(Array.from({ length: max }, (_, j) => Math.round((j * (n - 1)) / (max - 1))))] : Array.from({ length: n }, (_, i) => i);
    const frames: string[] = [];
    for (const i of indices) frames.push(toB64(await o.frame(i)));
    o.close();
    out[f] = { w, h, count: n, indices, frames };
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runSupport() {
  const probe = async (file: string) => {
    const bytes = await bytesOf(file);
    const { w, h } = await sizeOf(bytes, file);
    const c = mount(w, h);
    try {
      const r = await AnimatedImageRenderer.create(c, bytes, { devicePixelRatio: 1, observeResize: false });
      const path = r.path;
      r.destroy();
      return path;
    } catch (e) {
      return `error: ${(e as Error).message}`;
    } finally {
      c.remove();
    }
  };
  const reasonOf = async (file: string) => {
    const bytes = await bytesOf(file);
    const { w, h } = await sizeOf(bytes, file);
    const c = mount(w, h);
    try {
      const r = await AnimatedImageRenderer.create(c, bytes, { devicePixelRatio: 1, observeResize: false });
      const why = r.pathReason;
      r.destroy();
      return why;
    } finally {
      c.remove();
    }
  };
  const tiny = new Uint8Array(await (await fetch('/samples/synthetic/webp-static-lossless.webp')).arrayBuffer());
  let webpBitmap = false;
  try {
    (await createImageBitmap(new Blob([tiny as BlobPart], { type: 'image/webp' }))).close();
    webpBitmap = true;
  } catch { /* unsupported */ }
  return {
    userAgent: navigator.userAgent,
    imageDecoder: typeof ImageDecoder !== 'undefined',
    imageDecoderGif: typeof ImageDecoder !== 'undefined' ? await ImageDecoder.isTypeSupported('image/gif') : false,
    imageDecoderWebp: typeof ImageDecoder !== 'undefined' ? await ImageDecoder.isTypeSupported('image/webp') : false,
    createImageBitmapWebp: webpBitmap,
    offscreenCanvas: typeof OffscreenCanvas !== 'undefined',
    imageDecoderWebpAlphaReliable: await imageDecoderReliable('image/webp'),
    imageDecoderGifDisposalReliable: await imageDecoderReliable('image/gif'),
    autoPathGif: await probe('synthetic/gif-disposal-1.gif'),
    autoPathAnimatedWebp: await probe('synthetic/webp-alpha-blend.webp'),
    autoPathGifReason: await reasonOf('synthetic/gif-disposal-1.gif'),
    autoPathAnimatedWebpReason: await reasonOf('synthetic/webp-alpha-blend.webp'),
    autoPathStillWebp: await probe('synthetic/webp-static-lossy.webp'),
    autoPathSingleFrameGif: await probe('synthetic/gif-single.gif'),
  };
}

// ------------------------------------------------------------------------------------------------
interface FrameResult { order: string; frame: number; percent: number; maxDelta: number; at?: string }

async function correctFile(file: string, path: 'auto' | 'imagedecoder' | 'fallback') {
  const bytes = await bytesOf(file);
  const mime = mimeOf(file);
  const { w, h } = await sizeOf(bytes, file);
  const tol = file.endsWith('.gif') ? 0 : 3; // GIF decoding is exact; WebP allows rounding in the colour pipeline
  const oracle = oracleMode === 'golden' ? await openGolden(file) : await openOracle(bytes, mime, w, h);
  if (!oracle) return { file, path, skipped: oracleMode === 'golden' ? 'no golden data for this file' : 'no ImageDecoder oracle in this browser' };
  const c = mount(w, h);
  try {
    const t0 = performance.now();
    const r = await AnimatedImageRenderer.create(c, bytes, { path, devicePixelRatio: 1, observeResize: false });
    const n = r.frameCount;
    const subset = (oracle as { indices?: number[] }).indices;
    const grab = async (i: number) => {
      for (let k = 0; k < 50 && !r.drawFrame(i); k++) await r.ready(i);
      return c.getContext('2d')!.getImageData(0, 0, w, h).data;
    };
    const cap = 70;
    // With a golden subset only those frames can be checked: in order, then backwards (forces rewinds), then every other one.
    const seqA = subset && subset.length < n ? [...subset] : Array.from({ length: Math.min(n, cap) }, (_, i) => i);
    if (!subset && n > cap) for (let i = cap; i < n; i += Math.ceil((n - cap) / 8)) seqA.push(i);
    const seqB = subset && subset.length < n ? [...subset].reverse() : [...new Set([n - 1, 0, n >> 1, 1, n - 2, 2, Math.floor(n / 3), Math.floor((2 * n) / 3), 0, n - 1].filter((i) => i >= 0 && i < n))];
    const seqC = subset && subset.length < n ? subset.filter((_, k) => k % 2 === 0) : Array.from({ length: Math.ceil(n / 3) }, (_, i) => i * 3).filter((i) => i < n);
    const bad: FrameResult[] = [];
    let checked = 0;
    let maxPercent = 0;
    let maxDelta = 0;
    for (const [order, seq] of [['sequential', seqA], ['seeks', seqB], ['stride-3', seqC]] as const) {
      for (const i of seq) {
        const mine = await grab(i);
        const ref = await oracle.frame(i);
        const d = diffData(mine, ref, tol);
        checked++;
        maxPercent = Math.max(maxPercent, d.percent);
        maxDelta = Math.max(maxDelta, d.maxDelta);
        if (d.mismatched > 0) bad.push({ order, frame: i, percent: round(d.percent, 3), maxDelta: d.maxDelta, at: d.first ? `(${d.first.index % w},${Math.floor(d.first.index / w)}) ours=${d.first.a} ref=${d.first.b}` : undefined });
      }
    }
    const usedPath: ImagePath = r.path;
    const pathStats = { ...r.stats };
    r.destroy();
    return {
      file, path, usedPath, size: `${w}x${h}`, frames: n, checked, tolerance: tol,
      reason: r.pathReason, oracle: oracleMode,
      mismatchedFrames: bad.length, maxPercent: round(maxPercent, 3), maxDelta, first: bad.slice(0, 4), peakOpen: pathStats.peakOpen,
      ms: Math.round(performance.now() - t0), ok: bad.length === 0,
    };
  } catch (e) {
    return { file, path, error: String((e as Error).stack ?? e).slice(0, 400), ok: false };
  } finally {
    oracle.close();
    c.remove();
  }
}

async function runCorrect() {
  const out: unknown[] = [];
  for (const f of files) for (const p of paths) out.push(await correctFile(f, p));
  return out;
}

// ------------------------------------------------------------------------------------------------
async function playOnce(r: AnimatedImageRenderer, loops: number, maxMs: number) {
  const events: { f: number; t: number; late: boolean }[] = [];
  let endedAt = -1;
  let t0 = 0;
  await new Promise<void>((resolve) => {
    const ticker = new Ticker({
      frames: r.frameCount,
      frameDuration: (i) => r.frameDuration(i),
      loops,
      onFrame: (f) => events.push({ f, t: performance.now() - t0, late: !r.drawFrame(f) }),
      onEnd: () => { endedAt = performance.now() - t0; resolve(); },
    });
    t0 = performance.now();
    ticker.play();
    setTimeout(() => { ticker.destroy(); resolve(); }, maxMs);
  });
  return { events, endedAt };
}

async function runTiming() {
  const out: unknown[] = [];
  for (const f of files) {
    for (const p of paths) {
      if (p === 'auto') continue;
      const bytes = await bytesOf(f);
      const { w, h } = await sizeOf(bytes, f);
      const c = mount(w, h);
      try {
        const r = await AnimatedImageRenderer.create(c, bytes, { path: p, devicePixelRatio: 1, observeResize: false });
        // Warm up so the test measures scheduling, not first-use decode cost.
        for (let i = 0; i < Math.min(r.frameCount, 12); i++) for (let k = 0; k < 20 && !r.drawFrame(i); k++) await r.ready(i);
        const n = r.frameCount;
        const starts = [0];
        for (let i = 0; i < n; i++) starts.push(starts[i]! + r.frameDuration(i));
        const full = starts[n]!;
        const loops = full <= 3000 ? 2 : 1;
        const { events, endedAt } = await playOnce(r, loops, full * loops + 1500);
        // Frame f of play k should appear at k * full + starts[f] (a rAF callback can only run at the next ~16.7 ms tick).
        let play = 0;
        let prev = -1;
        let late = 0;
        const errs: number[] = [];
        for (const e of events) {
          if (e.f < prev) play++;
          prev = e.f;
          if (e.late) late++;
          errs.push(e.t - (play * full + starts[e.f]!));
        }
        const abs = errs.map(Math.abs);
        out.push({
          file: f, path: p, usedPath: r.path, frames: n, emitted: events.length, lateDraws: late,
          meanErrMs: round(errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length), 1), maxAbsErrMs: round(Math.max(0, ...abs), 1),
          expectedTotalMs: round(full * loops, 0), measuredTotalMs: endedAt < 0 ? null : round(endedAt, 0),
          ok: abs.length > 0 && Math.max(...abs) <= 60 && endedAt >= 0 && Math.abs(endedAt - full * loops) <= 60,
        });
        r.destroy();
      } catch (e) {
        out.push({ file: f, path: p, error: String((e as Error).stack ?? e).slice(0, 300), ok: false });
      } finally {
        c.remove();
      }
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runLoops() {
  const out: unknown[] = [];
  const cases: [string, number | undefined, number][] = [
    // file, explicit option, expected total plays (0 = forever)
    ['synthetic/gif-loop-0.gif', undefined, 0], ['synthetic/gif-loop-1.gif', undefined, 2], ['synthetic/gif-loop-3.gif', undefined, 4], ['synthetic/gif-loop-none.gif', undefined, 1],
    ['synthetic/webp-loop-0.webp', undefined, 0], ['synthetic/webp-loop-1.webp', undefined, 1], ['synthetic/webp-loop-3.webp', undefined, 3],
    ['synthetic/gif-loop-3.gif', 2, 2], ['synthetic/webp-loop-0.webp', 3, 3], ['synthetic/gif-loop-none.gif', 0, 0],
  ];
  for (const [file, option, expected] of cases) {
    const bytes = await bytesOf(file);
    const { w, h } = await sizeOf(bytes, file);
    const c = mount(w, h);
    try {
      const r = await AnimatedImageRenderer.create(c, bytes, { devicePixelRatio: 1, observeResize: false });
      for (let i = 0; i < r.frameCount; i++) for (let k = 0; k < 20 && !r.drawFrame(i); k++) await r.ready(i); // warm
      const loops = resolveLoops(option, r);
      const forever = expected === 0;
      const cycle = Array.from({ length: r.frameCount }, (_, i) => r.frameDuration(i)).reduce((a, b) => a + b, 0);
      const { events, endedAt } = await playOnce(r, loops, forever ? cycle * 3.5 : cycle * expected + 800);
      const plays = events.filter((e) => e.f === 0).length;
      out.push({
        file, option: option ?? null, fileLoopCount: r.loopCount, resolvedLoops: loops, expectedPlays: forever ? 'forever' : expected,
        observedPlays: plays, endedAfterMs: endedAt < 0 ? null : round(endedAt, 0), expectedMs: forever ? null : round(cycle * expected, 0),
        ok: forever ? endedAt < 0 && plays >= 3 : plays === expected && endedAt >= 0 && Math.abs(endedAt - cycle * expected) <= 60,
      });
      r.destroy();
    } catch (e) {
      out.push({ file, error: String((e as Error).stack ?? e).slice(0, 300), ok: false });
    } finally {
      c.remove();
    }
  }
  // Stills (static WebP, one-frame GIF / WebP): shown for `staticDurationMs`, once, then `end`.
  for (const file of ['static.webp', 'synthetic/gif-single.gif', 'synthetic/webp-single.webp', 'synthetic/webp-static-alpha.webp']) {
    const bytes = await bytesOf(file);
    const { w, h } = await sizeOf(bytes, file);
    const c = mount(w, h);
    try {
      const r = await AnimatedImageRenderer.create(c, bytes, { devicePixelRatio: 1, observeResize: false, staticDurationMs: 300 });
      for (let k = 0; k < 20 && !r.drawFrame(0); k++) await r.ready(0);
      const { events, endedAt } = await playOnce(r, resolveLoops(undefined, r), 1500);
      const px = c.getContext('2d')!.getImageData(w >> 1, h >> 1, 1, 1).data;
      out.push({
        file, still: true, frames: r.frameCount, frameDurationMs: r.frameDuration(0), fileLoopCount: r.loopCount, observedPlays: events.length, endedAfterMs: endedAt < 0 ? null : round(endedAt, 0), expectedMs: 300, option: null, resolvedLoops: 1, expectedPlays: 1,
        drawn: px[3]! > 0,
        ok: r.frameCount === 1 && r.frameDuration(0) === 300 && events.length === 1 && endedAt >= 0 && Math.abs(endedAt - 300) <= 60 && px[3]! > 0,
      });
      r.destroy();
    } catch (e) {
      out.push({ file, still: true, error: String((e as Error).stack ?? e).slice(0, 300), ok: false });
    } finally {
      c.remove();
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runLeaks() {
  const cycles = Number(q.get('cycles') ?? 50);
  const c = { videoFramesCreated: 0, videoFramesClosed: 0, bitmapsCreated: 0, bitmapsClosed: 0, decodersOpened: 0, decodersClosed: 0, rafRequested: 0, rafFired: 0, rafCancelled: 0, roCreated: 0, roDisconnected: 0 };
  const closedFrames = new WeakSet<object>();
  const closedBitmaps = new WeakSet<object>();
  const outstanding = new Set<number>();
  if (typeof VideoFrame !== 'undefined') {
    const orig = VideoFrame.prototype.close;
    VideoFrame.prototype.close = function (this: VideoFrame) { if (!closedFrames.has(this)) { closedFrames.add(this); c.videoFramesClosed++; } orig.call(this); };
  }
  if (typeof ImageDecoder !== 'undefined') {
    const OrigDecoder = ImageDecoder;
    const origDecode = OrigDecoder.prototype.decode;
    OrigDecoder.prototype.decode = async function (this: ImageDecoder, ...a: Parameters<ImageDecoder['decode']>) { const r = await origDecode.apply(this, a); c.videoFramesCreated++; return r; };
    const origClose = OrigDecoder.prototype.close;
    OrigDecoder.prototype.close = function (this: ImageDecoder) { c.decodersClosed++; origClose.call(this); };
    (window as unknown as { ImageDecoder: unknown }).ImageDecoder = class extends OrigDecoder { constructor(init: ImageDecoderInit) { super(init); c.decodersOpened++; } };
  }
  const origCib = window.createImageBitmap.bind(window);
  window.createImageBitmap = (async (...a: Parameters<typeof createImageBitmap>) => { const b = await origCib(...a); c.bitmapsCreated++; return b; }) as typeof createImageBitmap;
  const origBClose = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function (this: ImageBitmap) { if (!closedBitmaps.has(this)) { closedBitmaps.add(this); c.bitmapsClosed++; } origBClose.call(this); };
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { c.rafRequested++; const h = origRaf((t) => { outstanding.delete(h); c.rafFired++; cb(t); }); outstanding.add(h); return h; };
  window.cancelAnimationFrame = (h) => { if (outstanding.delete(h)) c.rafCancelled++; origCaf(h); };
  const OrigRO = window.ResizeObserver;
  const liveRO = new Set<unknown>();
  window.ResizeObserver = class extends OrigRO { constructor(cb: ResizeObserverCallback) { super(cb); c.roCreated++; liveRO.add(this); } override disconnect() { c.roDisconnected++; liveRO.delete(this); super.disconnect(); } } as typeof ResizeObserver;

  const out: unknown[] = [];
  for (const f of files) {
    for (const p of paths) {
      if (p === 'auto') continue;
      const bytes = await bytesOf(f);
      const { w, h } = await sizeOf(bytes, f);
      const before = { ...c };
      let peakOpen = 0;
      let framesDrawn = 0;
      let lastPath = '';
      try {
        for (let i = 0; i < cycles; i++) {
          const cv = mount(w, h);
          const r = await AnimatedImageRenderer.create(cv, bytes, { path: p, observeResize: true });
          lastPath = r.path;
          const ticker = new Ticker({ frames: r.frameCount, frameDuration: (k) => Math.min(20, r.frameDuration(k)), loops: 0, onFrame: (k) => { framesDrawn++; r.drawFrame(k); } });
          ticker.play();
          for (let k = 0; k < 6; k++) await nextFrame();
          for (const j of [r.frameCount - 1, 0, r.frameCount >> 1, 1]) r.drawFrame(j); // seeks stress the window/pruning
          await sleep(5);
          peakOpen = Math.max(peakOpen, r.stats.peakOpen);
          ticker.destroy();
          r.destroy();
          cv.remove();
        }
      } catch (e) {
        out.push({ file: f, path: p, error: String((e as Error).stack ?? e).slice(0, 300), ok: false });
        continue;
      }
      await sleep(100); // let in-flight decodes settle (they close their frames when they land)
      const d = (k: keyof typeof c) => c[k] - before[k];
      const open = { videoFrames: d('videoFramesCreated') - d('videoFramesClosed'), bitmaps: d('bitmapsCreated') - d('bitmapsClosed'), decoders: d('decodersOpened') - d('decodersClosed') };
      out.push({
        file: f, path: p, usedPath: lastPath, cycles, framesDrawn,
        created: { videoFrames: d('videoFramesCreated'), bitmaps: d('bitmapsCreated'), decoders: d('decodersOpened') },
        closed: { videoFrames: d('videoFramesClosed'), bitmaps: d('bitmapsClosed'), decoders: d('decodersClosed') },
        stillOpen: open, peakOpenPerRenderer: peakOpen, rafOutstanding: outstanding.size, resizeObserversLive: liveRO.size,
        ok: open.videoFrames === 0 && open.bitmaps === 0 && open.decoders === 0 && outstanding.size === 0 && liveRO.size === 0,
      });
    }
  }
  return out;
}

(async () => {
  try {
    const result = task === 'support' ? await runSupport() : task === 'dumpgolden' ? await runDumpGolden() : task === 'correct' ? await runCorrect() : task === 'timing' ? await runTiming() : task === 'loops' ? await runLoops() : await runLeaks();
    (window as unknown as { __result: unknown }).__result = result;
    const out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(result, null, 1).slice(0, 4000);
  } catch (e) {
    (window as unknown as { __result: unknown }).__result = { error: String((e as Error).stack ?? e) };
  }
})();
