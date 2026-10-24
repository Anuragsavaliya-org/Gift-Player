/**
 * Automated verification, driven by scripts/headless.mjs. `?task=` selects one of:
 *   diff     renders every Nth frame with our renderer and svgaplayerweb and diffs the pixels
 *   perf     drawFrame timing
 *   leaks    create/play/destroy N times with resource counters
 *   replace  dynamic replacement, mattes, content modes, resize (pass/fail assertions)
 * The outcome is published as JSON on window.__result.
 */
import { Ticker } from '../src/core/ticker';
import { decodeSvgaImages, parseSvga } from '../src/formats/svga';
import { SvgaRenderer, type ContentMode } from '../src/formats/svga/render/renderer';
import type { SvgaFrame, SvgaMovie, SvgaSprite } from '../src/formats/svga/types';
import { pixelDiff } from './lib/diff';
import { createOracle, type OracleMode } from './lib/oracle';
import { sampleBytes, sampleUrl } from './lib/samples';

const q = new URLSearchParams(location.search);
const task = q.get('task') ?? 'diff';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (n: number, d = 3) => Math.round(n * 10 ** d) / 10 ** d;

const MODES: Record<string, [ContentMode, OracleMode]> = {
  fill: ['fill', 'Fill'],
  aspectFit: ['aspectFit', 'AspectFit'],
  aspectFill: ['aspectFill', 'AspectFill'],
};

function box(width: number, height: number): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'box';
  d.style.width = `${width}px`;
  d.style.height = `${height}px`;
  document.body.append(d);
  return d;
}

async function load(name: string) {
  const bytes = await sampleBytes(name);
  const movie = parseSvga(bytes);
  const { bitmaps, failed } = await decodeSvgaImages(movie);
  if (failed.length) throw new Error(`image decode failed: ${failed.join(',')}`);
  return { movie, bitmaps, url: await sampleUrl(name) };
}

// ------------------------------------------------------------------------------------------------
async function runDiff(p: URLSearchParams = q) {
  const name = p.get('sample')!;
  const step = Number(p.get('step') ?? 5);
  const tol = Number(p.get('tol') ?? 10);
  const [mode, oracleMode] = MODES[p.get('mode') ?? 'aspectFit']!;
  const { movie, bitmaps, url } = await load(name);
  if (p.get('mimicOracleAlpha') === '1') {
    // Diagnostic only: svgaplayerweb skips any sprite with frame alpha < 0.05; reproduce that on our side.
    for (const sp of movie.sprites) sp.frames = sp.frames.map((fr) => (fr.alpha > 0 && fr.alpha < 0.05 ? { ...fr, alpha: 0 } : fr));
  }
  const w = Number(p.get('w') ?? movie.viewBox.width);
  const h = Number(p.get('h') ?? movie.viewBox.height);

  const oracleBox = box(w, h);
  const oracle = await createOracle(oracleBox, url, oracleMode, { isolateRuns: p.get('oracleIsolate') === '1' });
  const mine = document.createElement('canvas');
  mine.style.cssText = `width:${w}px;height:${h}px`;
  box(w, h).append(mine);
  if (p.get('srcimg') === '1') {
    // Diagnostic: hand the renderer <img> elements (what svgaplayerweb draws) instead of ImageBitmaps.
    for (const [k, v] of movie.images) {
      const im = new Image();
      im.src = URL.createObjectURL(new Blob([v.data as BlobPart], { type: v.mime }));
      await im.decode();
      (bitmaps as unknown as Map<string, unknown>).set(k, Object.assign(im, { close() { /* not an ImageBitmap */ } }));
    }
  }
  const r = new SvgaRenderer(mine, movie, bitmaps, { contentMode: mode, devicePixelRatio: 1, imageSmoothing: (p.get('smooth') as ImageSmoothingQuality | null) ?? 'low' });

  const frames: number[] = [];
  const from = Number(p.get('from') ?? 0);
  const to = Number(p.get('to') ?? movie.frames - 1);
  for (let f = from; f <= to; f += step) frames.push(f);
  if (p.get('to') === null && frames[frames.length - 1] !== movie.frames - 1) frames.push(movie.frames - 1);

  const rows: { frame: number; percent: number; percentOfActive: number; active: number }[] = [];
  for (const f of frames) {
    const o = oracle.draw(f);
    r.drawFrame(f);
    if (o.width !== mine.width || o.height !== mine.height) throw new Error(`canvas size ${o.width}x${o.height} vs ${mine.width}x${mine.height}`);
    const d = pixelDiff(mine, o, tol);
    rows.push({ frame: f, percent: d.percent, percentOfActive: d.percentOfActive, active: d.active });
  }
  const mean = rows.reduce((s, x) => s + x.percent, 0) / rows.length;
  const meanActive = rows.reduce((s, x) => s + x.percentOfActive, 0) / rows.length;
  const worst = rows.reduce((a, b) => (b.percent > a.percent ? b : a));
  const worstActive = rows.reduce((a, b) => (b.percentOfActive > a.percentOfActive ? b : a));
  const result = {
    sample: name, size: `${w}x${h}`, mode: p.get('mode') ?? 'aspectFit', tolerance: tol, compared: rows.length, maxActivePixels: Math.max(...rows.map((x) => x.active)), minActivePixels: Math.min(...rows.map((x) => x.active)),
    meanPercent: round(mean), maxPercent: round(worst.percent), worstFrame: worst.frame,
    meanPercentOfActive: round(meanActive), maxPercentOfActive: round(worstActive.percentOfActive), worstActiveFrame: worstActive.frame,
    framesOver2Percent: rows.filter((x) => x.percent > 2).map((x) => [x.frame, round(x.percent)]),
    top5: [...rows].sort((a, b) => b.percent - a.percent).slice(0, 5).map((x) => [x.frame, round(x.percent), round(x.percentOfActive)]),
    warnings: movie.warnings,
  };
  r.destroy();
  oracle.destroy();
  return result;
}

// ------------------------------------------------------------------------------------------------
/** Words that suggest a designer left a slot for dynamic content (avatar, nickname, ...). */
const REPLACEABLE = /(avatar|head(?!er)|portrait|photo|profile|nick|name|user|sender|receiver|text|title|label|slot|replace|dynamic|custom|touxiang|wenzi|name\d*$)/i;

function census(movie: SvgaMovie, fileBytes: number) {
  const shapes = new Set<object>();
  let rotatedFrames = 0, skewedFrames = 0, clipFrames = 0;
  const rotatedSprites = new Set<number>(), skewedSprites = new Set<number>();
  movie.sprites.forEach((sp, i) => {
    for (const fr of sp.frames) {
      if (!(fr.alpha > 0)) continue;
      const t = fr.transform;
      if (t.a === 0 || t.d === 0) { rotatedFrames++; rotatedSprites.add(i); }
      if (t.b !== 0 || t.c !== 0) { skewedFrames++; skewedSprites.add(i); }
      if (fr.clipPath) clipFrames++;
      for (const sh of fr.shapes) shapes.add(sh);
    }
  });
  let strokes = 0, dashes = 0, arcs = 0, rounded = 0, fills = 0;
  const types = { shape: 0, rect: 0, ellipse: 0 };
  for (const sh of shapes as Set<import('../src/formats/svga/types').SvgaShape>) {
    types[sh.type]++;
    if (sh.style?.fill) fills++;
    if (sh.style?.stroke && sh.style.strokeWidth > 0) strokes++;
    if (sh.style && (sh.style.lineDash.dash > 0 || sh.style.lineDash.gap > 0)) dashes++;
    if (sh.type === 'shape' && /[Aa]/.test(sh.d)) arcs++;
    if (sh.type === 'rect' && sh.cornerRadius > 0) rounded++;
  }
  const keys = [...new Set(movie.sprites.filter((s) => !s.isMatte).map((s) => s.imageKey))];
  const dangling = movie.warnings.filter((w) => w.startsWith('matteKey(s) with no matching'));
  return {
    fileBytes, container: movie.container, version: movie.version, viewBox: `${movie.viewBox.width}x${movie.viewBox.height}`, fps: movie.fps, frames: movie.frames,
    sprites: movie.sprites.length, images: movie.images.size, audios: movie.audios.size, audioTracks: movie.audioTracks.length,
    rotated: { sprites: rotatedSprites.size, frames: rotatedFrames }, skewedOrRotated: { sprites: skewedSprites.size, frames: skewedFrames },
    clipPathFrames: clipFrames,
    shapes: { unique: shapes.size, ...types, fills, strokes, dashes, arcPaths: arcs, roundedRects: rounded },
    mattes: { matteSprites: movie.sprites.filter((s) => s.isMatte).length, maskedSprites: movie.sprites.filter((s) => s.matteKey).length, danglingMatteKeys: dangling.length > 0 },
    replaceableLookingKeys: keys.filter((k) => REPLACEABLE.test(k)),
    warnings: movie.warnings,
  };
}

async function runCorpus() {
  const file = q.get('file')!;
  const out: Record<string, unknown> = { file };
  let movie: SvgaMovie;
  try {
    const bytes = await sampleBytes(file);
    movie = parseSvga(bytes);
    out.parse = { ok: true, warnings: movie.warnings };
    out.census = census(movie, bytes.length);
  } catch (e) {
    out.parse = { ok: false, code: (e as { code?: string }).code ?? 'error', message: (e as Error).message };
    return out;
  }
  try {
    out.diff = await runDiff(new URLSearchParams({ sample: file, step: q.get('step') ?? '10' }));
  } catch (e) {
    out.diffError = String((e as Error).message ?? e).slice(0, 400);
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
/** Diagnostic: shows ours | oracle | mismatch mask for one frame and reports where the mismatches are. */
async function runDiffView() {
  const name = q.get('sample')!;
  const frameNo = Number(q.get('frame') ?? 0);
  const tol = Number(q.get('tol') ?? 10);
  const { movie, bitmaps, url } = await load(name);
  const w = movie.viewBox.width;
  const h = movie.viewBox.height;
  const oracle = await createOracle(box(w, h), url);
  const mine = document.createElement('canvas');
  mine.style.cssText = `width:${w}px;height:${h}px`;
  box(w, h).append(mine);
  const r = new SvgaRenderer(mine, movie, bitmaps, { devicePixelRatio: 1 });
  for (const k of (q.get('hide') ?? '').split(',').filter(Boolean)) r.setHidden(k, true);
  r.drawFrame(frameNo);
  const o = oracle.draw(frameNo);
  const a = mine.getContext('2d')!.getImageData(0, 0, w, h).data;
  const b = o.getContext('2d')!.getImageData(0, 0, w, h).data;
  const mask = document.createElement('canvas'); mask.width = w; mask.height = h;
  const mx = mask.getContext('2d')!; const md = mx.createImageData(w, h);
  let n = 0, minX = w, minY = h, maxX = 0, maxY = 0, maxDelta = 0, sumDelta = 0;
  const bucket = new Map<string, number>();
  const samples: string[] = [];
  for (let p = 0; p < w * h; p++) {
    const i = p * 4; const fa = a[i + 3]! / 255; const fb = b[i + 3]! / 255;
    const d = Math.max(Math.abs(a[i + 3]! - b[i + 3]!), Math.abs(a[i]! * fa - b[i]! * fb), Math.abs(a[i + 1]! * fa - b[i + 1]! * fb), Math.abs(a[i + 2]! * fa - b[i + 2]! * fb));
    if (d > tol) {
      n++; const x = p % w; const y = Math.floor(p / w);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      maxDelta = Math.max(maxDelta, d); sumDelta += d;
      const key = `${Math.floor(x / 100) * 100},${Math.floor(y / 100) * 100}`; bucket.set(key, (bucket.get(key) ?? 0) + 1);
      md.data[i] = 255; md.data[i + 3] = 255;
      if (samples.length < 8 && p % 7 === 0) samples.push(`(${x},${y}) ours=${[a[i], a[i + 1], a[i + 2], a[i + 3]]} oracle=${[b[i], b[i + 1], b[i + 2], b[i + 3]]}`);
    }
  }
  mx.putImageData(md, 0, 0);
  document.body.replaceChildren();
  const row = document.createElement('div'); row.style.cssText = 'display:flex;gap:6px;background:#888';
  for (const c of [mine, o, mask]) { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d')!.drawImage(c, 0, 0); cv.style.cssText = `width:${w * 0.5}px;height:${h * 0.5}px;background:#444`; row.append(cv); }
  document.body.append(row);
  // first/last column with alpha > 128 on the given row, for both renderers
  const rowY = Number(q.get('row') ?? Math.floor(h / 2));
  const edge = (d: Uint8ClampedArray) => { let l = -1, rr = -1; for (let x = 0; x < w; x++) if (d[(rowY * w + x) * 4 + 3]! > 128) { if (l < 0) l = x; rr = x; } return [l, rr]; };
  (window as unknown as { __edges: unknown }).__edges = { row: rowY, ours: edge(a), oracle: edge(b) };
  const zoom = q.get('zoom'); // x,y,size,scale: magnified crops of ours | oracle | mask
  if (zoom) {
    const [zx, zy, zs, zk] = zoom.split(',').map(Number) as [number, number, number, number];
    const zrow = document.createElement('div'); zrow.style.cssText = 'display:flex;gap:6px;background:#888;margin-top:6px';
    for (const c of [mine, o, mask]) { const cv = document.createElement('canvas'); cv.width = zs * zk; cv.height = zs * zk; const x = cv.getContext('2d')!; x.imageSmoothingEnabled = false; x.fillStyle = '#444'; x.fillRect(0, 0, cv.width, cv.height); x.drawImage(c, zx, zy, zs, zs, 0, 0, zs * zk, zs * zk); zrow.append(cv); }
    document.body.append(zrow);
  }
  const visible = movie.sprites.map((sp, i) => ({ i, key: sp.imageKey, matte: sp.matteKey, f: sp.frames[frameNo]! })).filter((x) => x.f.alpha > 0).map((x) => `${x.i}:${x.key}${x.matte ? '@' + x.matte : ''} a=${x.f.alpha.toFixed(2)} t=[${[x.f.transform.a, x.f.transform.d, x.f.transform.tx, x.f.transform.ty].map((v) => +v.toFixed(2))}] l=${x.f.layout.width}x${x.f.layout.height}`);
  return { sample: name, frame: frameNo, edges: (window as unknown as { __edges: unknown }).__edges, visible: q.get('quiet') ? undefined : visible, mismatched: n, samples, bbox: [minX, minY, maxX, maxY], maxDelta, meanDelta: n ? Math.round(sumDelta / n) : 0, topBuckets: [...bucket].sort((x, y) => y[1] - x[1]).slice(0, 8) };
}

// ------------------------------------------------------------------------------------------------
function stats(ms: number[]) {
  const s = [...ms].sort((a, b) => a - b);
  return { n: s.length, avg: round(ms.reduce((a, b) => a + b, 0) / ms.length), p50: round(s[Math.floor(s.length * 0.5)]!), p95: round(s[Math.floor(s.length * 0.95)]!), max: round(s[s.length - 1]!) };
}

async function runPerf() {
  const name = q.get('sample') ?? 'Pink-Heart-Rocket.svga';
  const passes = Number(q.get('passes') ?? 5);
  const out: Record<string, unknown> = { sample: name };
  for (const dpr of [1, 2]) {
    const { movie, bitmaps, url } = await load(name);
    const w = movie.viewBox.width / (dpr === 2 ? 2 : 1); // dpr 2 = a phone-like backing store of the full viewBox size
    const h = movie.viewBox.height / (dpr === 2 ? 2 : 1);
    const mine = document.createElement('canvas');
    mine.style.cssText = `width:${w}px;height:${h}px`;
    box(w, h).append(mine);
    if (q.get('srcimg') === '1') {
      for (const [k, v] of movie.images) {
        const im = new Image();
        im.src = URL.createObjectURL(new Blob([v.data as BlobPart], { type: v.mime }));
        await im.decode();
        (bitmaps as unknown as Map<string, unknown>).set(k, Object.assign(im, { close() { /* not an ImageBitmap */ } }));
      }
    }
    const r = new SvgaRenderer(mine, movie, bitmaps, { devicePixelRatio: dpr, imageSmoothing: (q.get('smooth') as ImageSmoothingQuality | null) ?? 'low' });
    const ctx = mine.getContext('2d')!;
    const flush = () => ctx.getImageData(0, 0, 1, 1); // readback forces the deferred raster to finish
    for (let f = 0; f < movie.frames; f++) { r.drawFrame(f); flush(); } // warm-up
    // Allocation check: JS heap growth (no GC in between) across many frames. A per-frame allocation of even
    // a few hundred bytes would add up to many MB over this many draws.
    const gc = (window as unknown as { gc?: () => void }).gc;
    const heapNow = () => (performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize;
    gc?.(); gc?.();
    const heap0 = heapNow();
    for (let p = 0; p < 10; p++) for (let f = 0; f < movie.frames; f++) r.drawFrame(f);
    const heapGrowthKB = Math.round((heapNow() - heap0) / 1024);
    flush();
    const call: number[] = [];
    const full: number[] = [];
    for (let p = 0; p < passes; p++) {
      for (let f = 0; f < movie.frames; f++) {
        const t0 = performance.now();
        r.drawFrame(f);
        const t1 = performance.now();
        flush();
        const t2 = performance.now();
        call.push(t1 - t0);
        full.push(t2 - t0);
      }
    }
    out[`dpr${dpr}`] = { backing: `${mine.width}x${mine.height}`, heapGrowthKB_for_2400_drawFrames: heapGrowthKB, drawFrameCall: stats(call), drawFramePlusRaster: stats(full) };
    r.destroy();

    if (dpr === 1) {
      const oracleBox = box(movie.viewBox.width, movie.viewBox.height);
      const oracle = await createOracle(oracleBox, url);
      const oc = oracle.canvas.getContext('2d')!;
      const ot: number[] = [];
      for (let p = 0; p < passes; p++) {
        for (let f = 0; f < movie.frames; f++) {
          const t0 = performance.now();
          oracle.draw(f);
          oc.getImageData(0, 0, 1, 1);
          ot.push(performance.now() - t0);
        }
      }
      out.oracleDpr1 = stats(ot);
      oracle.destroy();
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runLeaks() {
  const cycles = Number(q.get('cycles') ?? 50);
  const name = q.get('sample') ?? 'Pink-Heart-Rocket.svga';
  const gc = (window as unknown as { gc?: () => void }).gc;

  // Counters (installed before anything is created).
  const c = { bitmapsCreated: 0, bitmapsClosed: 0, rafRequested: 0, rafCancelled: 0, rafFired: 0, roCreated: 0, roObserve: 0, roDisconnect: 0, listenersAdded: 0, listenersRemoved: 0 };
  const closedSet = new WeakSet<ImageBitmap>();
  const rafOutstanding = new Set<number>();
  const origCreate = window.createImageBitmap.bind(window);
  window.createImageBitmap = (async (...a: Parameters<typeof createImageBitmap>) => {
    const b = await origCreate(...a);
    c.bitmapsCreated++;
    return b;
  }) as typeof createImageBitmap;
  const origClose = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function (this: ImageBitmap) {
    if (!closedSet.has(this)) { closedSet.add(this); c.bitmapsClosed++; }
    origClose.call(this);
  };
  const origRaf = window.requestAnimationFrame.bind(window);
  const origCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => {
    c.rafRequested++;
    const h = origRaf((t) => { rafOutstanding.delete(h); c.rafFired++; cb(t); });
    rafOutstanding.add(h);
    return h;
  };
  window.cancelAnimationFrame = (h) => { if (rafOutstanding.delete(h)) c.rafCancelled++; origCaf(h); };
  const OrigRO = window.ResizeObserver;
  const live = new Set<unknown>();
  window.ResizeObserver = class extends OrigRO {
    constructor(cb: ResizeObserverCallback) { super(cb); c.roCreated++; live.add(this); }
    override observe(t: Element, o?: ResizeObserverOptions) { c.roObserve++; super.observe(t, o); }
    override disconnect() { c.roDisconnect++; live.delete(this); super.disconnect(); }
  } as typeof ResizeObserver;
  const origAdd = EventTarget.prototype.addEventListener;
  const origRem = EventTarget.prototype.removeEventListener;
  EventTarget.prototype.addEventListener = function (...a: Parameters<typeof origAdd>) { c.listenersAdded++; return origAdd.apply(this, a); };
  EventTarget.prototype.removeEventListener = function (...a: Parameters<typeof origRem>) { c.listenersRemoved++; return origRem.apply(this, a); };

  const bytes = await sampleBytes(name);
  const heap = () => { gc?.(); gc?.(); return (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0; };
  const redPng = await (async () => { const cv = document.createElement('canvas'); cv.width = cv.height = 16; const x = cv.getContext('2d')!; x.fillStyle = '#f00'; x.fillRect(0, 0, 16, 16); return new Promise<Blob>((r) => cv.toBlob((b) => r(b!))); })();
  const nodesBefore = document.getElementsByTagName('*').length;
  const baselineListeners = { added: c.listenersAdded, removed: c.listenersRemoved };
  const heapBefore = heap();
  let drawn = 0;
  for (let i = 0; i < cycles; i++) {
    const movie = parseSvga(bytes);
    const { bitmaps } = await decodeSvgaImages(movie);
    const canvas = document.createElement('canvas');
    canvas.style.cssText = 'width:300px;height:533px';
    document.body.append(canvas);
    const r = new SvgaRenderer(canvas, movie, bitmaps, { devicePixelRatio: 2 });
    const key = movie.sprites.find((s) => !s.isMatte && bitmaps.has(s.imageKey))!.imageKey;
    await r.setImage(key, redPng); // renderer-owned bitmap from a Blob
    await r.setImage(key, redPng); // replaced once: the first one must be closed
    r.setText(key, 'leak test', { color: '#fff' });
    const ticker = new Ticker({ fps: movie.fps, frames: movie.frames, loops: 0, onFrame: (f) => { drawn++; r.drawFrame(f); } });
    ticker.play();
    await nextFrame();
    await nextFrame();
    ticker.destroy();
    r.destroy();
    canvas.remove();
  }
  await sleep(50);
  const heapAfter = heap();
  const result = {
    sample: name, cycles, framesDrawn: drawn, counters: c,
    bitmapsStillOpen: c.bitmapsCreated - c.bitmapsClosed,
    rafOutstanding: rafOutstanding.size,
    resizeObserversLive: live.size,
    listenersNet: (c.listenersAdded - baselineListeners.added) - (c.listenersRemoved - baselineListeners.removed),
    domNodesDelta: document.getElementsByTagName('*').length - nodesBefore,
    heapMB: { before: round(heapBefore / 1048576, 1), after: round(heapAfter / 1048576, 1) },
  };
  return result;
}

// ------------------------------------------------------------------------------------------------
type Check = { name: string; ok: boolean; detail?: unknown };

const ID = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
const frame = (o: Partial<SvgaFrame> & { alpha: number }): SvgaFrame => ({
  layout: { x: 0, y: 0, width: 0, height: 0 }, transform: ID, clipPath: '', shapes: [], ...o,
});
const fillStyle = (r: number, g: number, b: number, a = 1) => ({
  fill: { r, g, b, a }, stroke: null, strokeWidth: 0, lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 0, lineDash: { dash: 0, gap: 0, offset: 0 },
});
const sprite = (imageKey: string, frames: SvgaFrame[], matteKey: string | null = null): SvgaSprite => ({ imageKey, matteKey, isMatte: imageKey.endsWith('.matte'), frames });
const movieOf = (sprites: SvgaSprite[], w = 100, h = 100, frames = 4): SvgaMovie => ({
  container: 'protobuf', version: 't', viewBox: { width: w, height: h }, fps: 10, frames,
  images: new Map(), audios: new Map(), audioTracks: [], sprites, warnings: [],
});
const rep = <T>(f: T, n = 4) => Array.from({ length: n }, () => f);
const px = (c: HTMLCanvasElement, x: number, y: number) => [...c.getContext('2d')!.getImageData(Math.round(x), Math.round(y), 1, 1).data];
const solid = async (color: string, size = 8) => {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const x = cv.getContext('2d')!; x.fillStyle = color; x.fillRect(0, 0, size, size);
  return createImageBitmap(cv);
};
const near = (p: number[], rgba: number[], tol = 6) => p.every((v, i) => Math.abs(v - rgba[i]!) <= tol);

async function runReplace() {
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
  const mk = (movie: SvgaMovie, size: [number, number], opts: ConstructorParameters<typeof SvgaRenderer>[3] = {}, bitmaps = new Map<string, ImageBitmap>()) => {
    const cv = document.createElement('canvas');
    cv.style.cssText = `width:${size[0]}px;height:${size[1]}px`;
    box(size[0], size[1]).append(cv);
    return { cv, r: new SvgaRenderer(cv, movie, bitmaps, { devicePixelRatio: 1, ...opts }) };
  };
  const warnings: string[] = [];
  const origWarn = console.warn;
  console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };

  // --- avatar sprite masked by a circular matte (shapes-only), 100x100 ---
  const circle = {
    type: 'ellipse' as const, x: 50, y: 50, radiusX: 40, radiusY: 40, style: fillStyle(1, 1, 1), transform: ID,
  };
  const avatarMovie = () => movieOf([
    sprite('avatar', rep(frame({ alpha: 1, layout: { x: 10, y: 10, width: 80, height: 80 } })), 'circle.matte'),
    sprite('circle.matte', rep(frame({ alpha: 1, shapes: [circle] }))),
  ]);
  {
    // the avatar's original artwork is a blue bitmap (like a designer's placeholder image)
    const { cv, r } = mk(avatarMovie(), [100, 100], {}, new Map([['avatar', await solid('#00f', 16)]]));
    r.drawFrame(0);
    check('matte: centre drawn, corner masked out', near(px(cv, 50, 50), [0, 0, 255, 255]) && px(cv, 14, 14)[3] === 0, [px(cv, 50, 50), px(cv, 14, 14)]);
    await r.setImage('avatar', await solid('#f00'));
    check('setImage + circular matte: centre red, corner still masked', near(px(cv, 50, 50), [255, 0, 0, 255]) && px(cv, 14, 14)[3] === 0, [px(cv, 50, 50), px(cv, 14, 14)]);
    r.drawFrame(3);
    check('replacement survives seek', near(px(cv, 50, 50), [255, 0, 0, 255]));
    r.setHidden('avatar', true);
    check('setHidden hides the sprite', px(cv, 50, 50)[3] === 0);
    r.setHidden('avatar', false);
    check('setHidden(false) shows it again, replacement intact', near(px(cv, 50, 50), [255, 0, 0, 255]));
    r.clearReplacement('avatar');
    check('clearReplacement restores the original', near(px(cv, 50, 50), [0, 0, 255, 255]));
    r.destroy();
  }
  {
    // matteKey that matches no sprite -> drawn unmasked; hidden matte -> masks everything
    const dangling = movieOf([sprite('s', rep(frame({ alpha: 1, shapes: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0, style: fillStyle(0, 1, 0), transform: ID }] })), 'nope.matte')]);
    const a = mk(dangling, [100, 100]);
    a.r.drawFrame(0);
    check('dangling matteKey is ignored (sprite drawn unmasked)', near(px(a.cv, 5, 5), [0, 255, 0, 255]), px(a.cv, 5, 5));
    a.r.destroy();
    const hiddenMatte = movieOf([
      sprite('s', rep(frame({ alpha: 1, shapes: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0, style: fillStyle(0, 1, 0), transform: ID }] })), 'm.matte'),
      sprite('m.matte', [frame({ alpha: 0 }), ...rep(frame({ alpha: 1, shapes: [circle] }), 3)]),
    ]);
    const b = mk(hiddenMatte, [100, 100]);
    b.r.drawFrame(0);
    check('hidden matte frame masks the sprite out', px(b.cv, 50, 50)[3] === 0, px(b.cv, 50, 50));
    b.r.drawFrame(1);
    check('visible matte frame shows it through the matte', near(px(b.cv, 50, 50), [0, 255, 0, 255]));
    b.r.destroy();
  }
  {
    // text
    const m = movieOf([sprite('label', rep(frame({ alpha: 1, layout: { x: 0, y: 40, width: 100, height: 20 } })))]);
    const { cv, r } = mk(m, [100, 100]);
    r.drawFrame(0);
    const blank = cv.getContext('2d')!.getImageData(0, 0, 100, 100).data.every((v) => v === 0);
    r.setText('label', 'MMMM', { color: '#0000ff', size: 18, weight: 'bold' });
    const d = cv.getContext('2d')!.getImageData(0, 0, 100, 100).data;
    let blue = 0, minX = 100, maxX = 0, minY = 100, maxY = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 128 && d[i + 2]! > 200 && d[i]! < 60) { blue++; const x = (i / 4) % 100, y = Math.floor(i / 400); minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    check('text: blank before, blue glyph pixels after', blank && blue > 50, { blue });
    check('text is centred in the layout rect', Math.abs((minX + maxX) / 2 - 50) < 4 && Math.abs((minY + maxY) / 2 - 50) < 6, { minX, maxX, minY, maxY });
    r.setText('label', 'MMMMMMMMMMMMMMMMMMMMMMMMMMMMMMMM', { size: 18 });
    const d2 = cv.getContext('2d')!.getImageData(0, 0, 100, 100).data;
    let outside = false;
    for (let i = 0; i < d2.length; i += 4) { const x = (i / 4) % 100; if (d2[i + 3]! > 0 && (x < 0 || x > 99)) outside = true; }
    check('over-long text is squeezed into the layout width (no throw)', !outside);
    r.setText('label', 'Hi', { color: '#fff', stroke: { color: '#000', width: 4 }, align: 'left' });
    const px2 = cv.getContext('2d')!.getImageData(0, 0, 100, 100).data;
    let leftMost = 100; let black = 0;
    for (let i = 0; i < px2.length; i += 4) if (px2[i + 3]! > 0) { leftMost = Math.min(leftMost, (i / 4) % 100); if (px2[i]! < 40 && px2[i + 3]! > 200) black++; }
    check('left-aligned text with stroke: starts at the left edge, has stroke pixels', leftMost <= 3 && black > 20, { leftMost, black });
    r.destroy();
  }
  {
    // unknown keys: warn, never throw
    const { r } = mk(avatarMovie(), [100, 100]);
    warnings.length = 0;
    let threw = false;
    try {
      r.setText('nope', 'x'); r.setHidden('nope', true); r.clearReplacement('nope');
      await r.setImage('nope', await solid('#000'));
    } catch { threw = true; }
    check('unknown key: no throw, one warning per call', !threw && warnings.length === 4, { threw, warnings: warnings.length });
    r.destroy();
  }
  {
    // replacements survive looping when driven by the Ticker
    const m = movieOf([sprite('label', rep(frame({ alpha: 1, layout: { x: 0, y: 0, width: 100, height: 100 } }), 4)), sprite('bg.vector', rep(frame({ alpha: 1 }), 4))]);
    const { cv, r } = mk(m, [100, 100]);
    r.setText('label', 'MM', { color: '#00f', size: 40 });
    let loops = 0;
    const seenBlue: boolean[] = [];
    await new Promise<void>((resolve) => {
      const t = new Ticker({ fps: 40, frames: 4, loops: 3, onFrame: (f) => { r.drawFrame(f); const d = cv.getContext('2d')!.getImageData(0, 0, 100, 100).data; let b = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 2]! > 200 && d[i + 3]! > 128) b++; seenBlue.push(b > 20); if (f === 3) loops++; }, onEnd: () => { t.destroy(); resolve(); } });
      t.play();
    });
    check('replacement survives 3 loops driven by the Ticker', loops === 3 && seenBlue.length >= 3 && seenBlue.every(Boolean), { loops, frames: seenBlue.length });
    r.destroy();
  }
  {
    // image fit modes
    const m = movieOf([sprite('pic', rep(frame({ alpha: 1, layout: { x: 0, y: 0, width: 100, height: 100 } })))]);
    const wide = document.createElement('canvas'); wide.width = 40; wide.height = 10;
    const wx = wide.getContext('2d')!; wx.fillStyle = '#f00'; wx.fillRect(0, 0, 40, 10);
    const wideBmp = await createImageBitmap(wide);
    const { cv, r } = mk(m, [100, 100]);
    r.drawFrame(0);
    await r.setImage('pic', wideBmp, { fit: 'contain' });
    check('fit=contain letterboxes (top row empty, middle filled)', px(cv, 50, 5)[3] === 0 && px(cv, 50, 50)[3] === 255, [px(cv, 50, 5), px(cv, 50, 50)]);
    await r.setImage('pic', wideBmp, { fit: 'cover' });
    check('fit=cover fills the whole rect', px(cv, 50, 5)[3] === 255 && px(cv, 5, 95)[3] === 255);
    check('caller-owned ImageBitmap is not closed by the renderer', wideBmp.width === 40);
    r.destroy();
    check('...even after destroy()', wideBmp.width === 40);
    wideBmp.close();
  }
  {
    // content modes + DPR + resize. viewBox 100x50, rect fills it.
    const m = movieOf([sprite('r.vector', rep(frame({ alpha: 1, shapes: [{ type: 'rect', x: 0, y: 0, width: 100, height: 50, cornerRadius: 0, style: fillStyle(1, 0, 0), transform: ID }] })))], 100, 50);
    const cases: [ContentMode, (c: HTMLCanvasElement) => boolean][] = [
      ['aspectFit', (c) => px(c, 200, 20)[3] === 0 && px(c, 200, 200)[3] === 255 && px(c, 5, 105)[3] === 255 && px(c, 5, 95)[3] === 0],
      ['aspectFill', (c) => px(c, 200, 5)[3] === 255 && px(c, 5, 395)[3] === 255],
      ['fill', (c) => px(c, 2, 2)[3] === 255 && px(c, 397, 397)[3] === 255],
    ];
    for (const [mode, ok] of cases) {
      const { cv, r } = mk(m, [200, 200], { contentMode: mode, devicePixelRatio: 2 });
      r.drawFrame(0);
      check(`contentMode ${mode}: backing 400x400 at dpr 2, expected pixels`, cv.width === 400 && cv.height === 400 && ok(cv), { w: cv.width, h: cv.height });
      r.destroy();
    }
    const { cv, r } = mk(m, [200, 200], { contentMode: 'aspectFit', devicePixelRatio: 1, cssSize: undefined });
    r.drawFrame(0);
    r.setContentMode('fill');
    check('setContentMode redraws the current frame', px(cv, 2, 2)[3] === 255 && px(cv, 197, 197)[3] === 255);
    r.destroy();
  }
  {
    // ResizeObserver: container resize -> backing store follows, frame is redrawn
    const m = movieOf([sprite('r.vector', rep(frame({ alpha: 1, shapes: [{ type: 'rect', x: 0, y: 0, width: 100, height: 100, cornerRadius: 0, style: fillStyle(1, 0, 0), transform: ID }] })))]);
    const holder = box(100, 100);
    const cv = document.createElement('canvas');
    cv.style.cssText = 'width:100%;height:100%;display:block';
    holder.append(cv);
    const r = new SvgaRenderer(cv, m, new Map(), { devicePixelRatio: 1, contentMode: 'fill' });
    r.drawFrame(0);
    const before = [cv.width, cv.height];
    holder.style.width = '240px'; holder.style.height = '160px';
    await nextFrame(); await nextFrame(); await sleep(50);
    check('ResizeObserver resizes the backing store and redraws', before[0] === 100 && cv.width === 240 && cv.height === 160 && px(cv, 239, 159)[3] === 255, { before, after: [cv.width, cv.height] });
    r.destroy();
    holder.style.width = '50px';
    await nextFrame(); await sleep(50);
    check('after destroy() the observer is gone (no resize)', cv.width === 240, cv.width);
  }
  {
    // Geometry that the real samples do not exercise (no rotated-90deg sprites, dashes, arcs or strokes in them).
    const stroke = (r: number, g: number, b: number, w: number, dash = 0, gap = 0) => ({
      fill: null, stroke: { r, g, b, a: 1 }, strokeWidth: w, lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 0, lineDash: { dash, gap, offset: 0 },
    });
    const one = (f: Partial<SvgaFrame>) => movieOf([sprite('g.vector', rep(frame({ alpha: 1, ...f })))]);
    const draw = (m: SvgaMovie) => { const x = mk(m, [100, 100]); x.r.drawFrame(0); return x; };
    const redRect = (x: number, y: number, w: number, h: number, extra: object = {}) => ({ type: 'rect' as const, x, y, width: w, height: h, cornerRadius: 0, style: fillStyle(1, 0, 0), transform: ID, ...extra });

    let g = draw(one({ transform: { a: 0, b: 1, c: -1, d: 0, tx: 60, ty: 10 }, shapes: [redRect(0, 0, 40, 20)] }));
    check('90-degree rotation (a = d = 0, which proto3 omits) is honoured', near(px(g.cv, 50, 30), [255, 0, 0, 255]) && px(g.cv, 20, 15)[3] === 0 && px(g.cv, 70, 30)[3] === 0, [px(g.cv, 50, 30), px(g.cv, 20, 15)]);
    g.r.destroy();

    g = draw(one({ shapes: [{ type: 'shape' as const, d: 'M0 50 L100 50', style: stroke(0, 1, 0, 10, 10, 10), transform: ID }] }));
    check('dashed stroke: dash, gap, dash', px(g.cv, 5, 50)[3] === 255 && px(g.cv, 15, 50)[3] === 0 && px(g.cv, 25, 50)[3] === 255, [px(g.cv, 5, 50), px(g.cv, 15, 50), px(g.cv, 25, 50)]);
    g.r.destroy();

    g = draw(one({ shapes: [{ type: 'shape' as const, d: 'M0 50 L100 50', style: stroke(0, 1, 0, 0), transform: ID }, { type: 'shape' as const, d: 'M0 20 L100 20', style: stroke(0, 1, 0, 6), transform: ID }] }));
    check('zero-width stroke draws nothing; 6px stroke is 6px', px(g.cv, 50, 50)[3] === 0 && px(g.cv, 50, 20)[3] === 255 && px(g.cv, 50, 24)[3] === 0 && px(g.cv, 50, 17)[3] === 255);
    g.r.destroy();

    g = draw(one({ shapes: [{ type: 'shape' as const, d: 'M 10 50 A 40 40 0 1 1 90 50 Z', style: fillStyle(0, 0, 1), transform: ID }] }));
    check('SVG arc commands (A) render (svgaplayerweb ignores them)', near(px(g.cv, 50, 30), [0, 0, 255, 255]) && px(g.cv, 50, 70)[3] === 0 && px(g.cv, 3, 3)[3] === 0, [px(g.cv, 50, 30), px(g.cv, 50, 70)]); // sweep=1 from left to right = the upper half-disc
    g.r.destroy();

    g = draw(one({ shapes: [redRect(0, 0, 100, 100, { cornerRadius: 30 })] }));
    check('rect cornerRadius rounds the corners', px(g.cv, 2, 2)[3] === 0 && px(g.cv, 50, 50)[3] === 255 && px(g.cv, 50, 1)[3] === 255);
    g.r.destroy();

    g = draw(one({ transform: { a: 2, b: 0, c: 0, d: 2, tx: 0, ty: 0 }, shapes: [redRect(0, 0, 10, 10, { transform: { a: 1, b: 0, c: 0, d: 1, tx: 10, ty: 0 } })] }));
    check("shape transform composes on top of the sprite transform", px(g.cv, 30, 10)[3] === 255 && px(g.cv, 10, 10)[3] === 0 && px(g.cv, 45, 10)[3] === 0, [px(g.cv, 30, 10), px(g.cv, 10, 10)]);
    g.r.destroy();

    g = draw(one({ clipPath: 'M0 0 H50 V100 H0 Z', shapes: [redRect(0, 0, 100, 100)] }));
    check('clipPath clips the sprite', px(g.cv, 25, 50)[3] === 255 && px(g.cv, 75, 50)[3] === 0);
    g.r.destroy();

    g = draw(movieOf([sprite('a.vector', rep(frame({ alpha: 0.5, shapes: [redRect(0, 0, 100, 100)] }))), sprite('b.vector', rep(frame({ alpha: 1, shapes: [{ ...redRect(0, 0, 50, 100), style: fillStyle(0, 0, 1) }] })))]));
    const left = px(g.cv, 25, 50); const right = px(g.cv, 75, 50);
    check('frame alpha applies; later sprites draw on top', near(left, [0, 0, 255, 255]) && Math.abs(right[3]! - 128) <= 2 && right[0]! > 250, { left, right });
    g.r.destroy();
  }
  {
    // Per-run matte compositing (what Android/iOS do): consecutive sprites with one matteKey are composited
    // together and masked ONCE. All values are exact premultiplied-alpha arithmetic, tolerance ~2 levels.
    const full = (r: number, g: number, b: number) => ({ type: 'rect' as const, x: 0, y: 0, width: 100, height: 100, cornerRadius: 0, style: fillStyle(r, g, b), transform: ID });
    const part = (x: number, w: number, r: number, g: number, b: number) => ({ ...full(r, g, b), x, width: w });
    // A: red @ 0.5 alpha, B: blue @ 0.5 alpha over it, matte M: white @ 0.5 alpha. The matte sits BETWEEN
    // A and B in the sprite list, which must not break the run.
    const m = movieOf([
      sprite('a.vector', rep(frame({ alpha: 0.5, shapes: [full(1, 0, 0)] })), 'm.matte'),
      sprite('m.matte', rep(frame({ alpha: 0.5, shapes: [full(1, 1, 1)] }))),
      sprite('b.vector', rep(frame({ alpha: 0.5, shapes: [full(0, 0, 1)] })), 'm.matte'),
    ]);
    const g = mk(m, [100, 100]);
    g.r.drawFrame(0);
    const p0 = px(g.cv, 50, 50);
    // per-run:    (A over B) x m = alpha 0.375, unpremultiplied (85, 0, 170)  -> RGBA ~ (85, 0, 170, 96)
    // per-sprite: (A x m) over (B x m) = alpha 0.4375, (109, 0, 146)           -> RGBA ~ (109, 0, 146, 112)
    check('per-run matte: overlapping semi-transparent sprites are masked once (alpha 96, not 112)', Math.abs(p0[3]! - 96) <= 3 && Math.abs(p0[0]! - 85) <= 6 && Math.abs(p0[2]! - 170) <= 6 && p0[1] === 0, { got: p0, perRun: [85, 0, 170, 96], perSprite: [109, 0, 146, 112] });
    g.r.destroy();

    // Two runs with different matteKeys in one frame: left half red via m1, right half blue via m2.
    const two = movieOf([
      sprite('m1.matte', rep(frame({ alpha: 1, shapes: [part(0, 50, 1, 1, 1)] }))),
      sprite('m2.matte', rep(frame({ alpha: 1, shapes: [part(50, 50, 1, 1, 1)] }))),
      sprite('r.vector', rep(frame({ alpha: 1, shapes: [full(1, 0, 0)] })), 'm1.matte'),
      sprite('b.vector', rep(frame({ alpha: 1, shapes: [full(0, 0, 1)] })), 'm2.matte'),
    ]);
    const t = mk(two, [100, 100]);
    t.r.drawFrame(0);
    check('two runs, two mattes in one frame: each run only shows through its own matte', near(px(t.cv, 25, 50), [255, 0, 0, 255]) && near(px(t.cv, 75, 50), [0, 0, 255, 255]), [px(t.cv, 25, 50), px(t.cv, 75, 50)]);
    t.r.destroy();

    // The same matteKey split by an unmasked sprite is TWO runs, and z-order is preserved:
    // A (red, masked left) < U (green, unmasked, x 40..60) < A2 (blue, masked left, x 45..55).
    const split = movieOf([
      sprite('m1.matte', rep(frame({ alpha: 1, shapes: [part(0, 50, 1, 1, 1)] }))),
      sprite('a.vector', rep(frame({ alpha: 1, shapes: [full(1, 0, 0)] })), 'm1.matte'),
      sprite('u.vector', rep(frame({ alpha: 1, shapes: [part(40, 20, 0, 1, 0)] }))),
      sprite('a2.vector', rep(frame({ alpha: 1, shapes: [part(45, 10, 0, 0, 1)] })), 'm1.matte'),
    ]);
    const sp = mk(split, [100, 100]);
    sp.r.drawFrame(0);
    check('same matteKey split by an unmasked sprite: two runs, z-order kept', near(px(sp.cv, 10, 50), [255, 0, 0, 255]) && near(px(sp.cv, 42, 50), [0, 255, 0, 255]) && near(px(sp.cv, 47, 50), [0, 0, 255, 255]) && near(px(sp.cv, 55, 50), [0, 255, 0, 255]) && px(sp.cv, 80, 50)[3] === 0, [10, 42, 47, 55, 80].map((x) => px(sp.cv, x, 50)));
    sp.r.destroy();

    // Hidden run members are skipped; if every member is hidden nothing is drawn; hidden matte masks the run out.
    const hid = movieOf([
      sprite('m1.matte', rep(frame({ alpha: 1, shapes: [full(1, 1, 1)] }))),
      sprite('a.vector', rep(frame({ alpha: 1, shapes: [part(0, 50, 1, 0, 0)] })), 'm1.matte'),
      sprite('b.vector', rep(frame({ alpha: 1, shapes: [part(50, 50, 0, 0, 1)] })), 'm1.matte'),
    ]);
    const h = mk(hid, [100, 100]);
    h.r.drawFrame(0);
    h.r.setHidden('a.vector', true);
    const onlyB = near(px(h.cv, 75, 50), [0, 0, 255, 255]) && px(h.cv, 25, 50)[3] === 0;
    h.r.setHidden('b.vector', true);
    check('hidden run members are skipped; all hidden draws nothing', onlyB && px(h.cv, 75, 50)[3] === 0, { onlyB });
    h.r.destroy();
  }
  {
    // determinism: same frame twice -> identical pixels
    const { movie, bitmaps } = await load('angel.svga');
    const cv = document.createElement('canvas');
    cv.style.cssText = 'width:375px;height:375px';
    box(375, 375).append(cv);
    const r = new SvgaRenderer(cv, movie, bitmaps, { devicePixelRatio: 1 });
    const grab = () => cv.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data;
    r.drawFrame(30); const a = grab().slice();
    r.drawFrame(7); r.drawFrame(55); r.drawFrame(30); const b = grab();
    let same = a.length === b.length;
    for (let i = 0; same && i < a.length; i++) if (a[i] !== b[i]) same = false;
    check('drawFrame is deterministic (frame 30 twice, other frames between)', same);
    r.destroy();
  }
  console.warn = origWarn;
  return { passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, checks };
}

(async () => {
  try {
    const result = task === 'diff' ? await runDiff() : task === 'corpus' ? await runCorpus() : task === 'diffview' ? await runDiffView() : task === 'perf' ? await runPerf() : task === 'leaks' ? await runLeaks() : await runReplace();
    (window as unknown as { __result: unknown }).__result = result;
    const out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(result, null, 1);
  } catch (e) {
    (window as unknown as { __result: unknown }).__result = { error: String((e as Error).stack ?? e) };
  }
})();
