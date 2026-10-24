/**
 * Browser verification for PAG. `?task=` is one of:
 *   support   engine load (sizes, cold-load time), WebGL availability
 *   frames    our drawFrame(i) vs libpag rendering the same progress directly, + frame-index mapping
 *   timing    on-screen frame times vs the file's frame rate (Ticker + renderer)
 *   loops     play counts with the option / default
 *   leaks     N create -> play -> destroy cycles with WebGL-context counters (plus a control run in libpag's default mode)
 *   multi     5 players alive at once, destroyed in random order
 *   replace   image replacement on replacement.pag, editable keys, unknown keys
 *   text      Hindi / Gujarati / Arabic / emoji in SVGA and PAG (screenshots)
 *   perf      frame time (render + copy, and with a pixel readback)
 * Engine URLs: local copy by default (`/__libpag/...`), `cdn=1` uses the SDK defaults (pinned jsDelivr).
 */
import { resolveLoops } from '../src/core/frame-source';
import { registerFont } from '../src/core/fonts';
import { Ticker } from '../src/core/ticker';
import { PagRenderer, type PagEngineOptions } from '../src/formats/pag';
import { SvgaRenderer } from '../src/formats/svga/render/renderer';
import type { SvgaMovie } from '../src/formats/svga/types';

const q = new URLSearchParams(location.search);
const task = q.get('task') ?? 'support';
const files = (q.get('files') ?? 'like.pag,replacement.pag').split(',').filter(Boolean);
const engineOpts: PagEngineOptions = q.get('cdn') === '1' ? {} : { pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__libpag/libpag.wasm' };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextFrame = () => new Promise<number>((r) => requestAnimationFrame(r));
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const bytesOf = async (f: string) => new Uint8Array(await (await fetch(`/samples/${f}`)).arrayBuffer());

// ---- WebGL context accounting (installed before anything can create a context) ---------------------------------
const gl = { created: 0, lost: 0, live: new Set<object>(), types: [] as string[] };
function track(canvas: object, type: string) {
  if (!/webgl/.test(type) || gl.live.has(canvas) || (canvas as { __seen?: boolean }).__seen) return;
  (canvas as { __seen?: boolean }).__seen = true;
  gl.created++;
  gl.live.add(canvas);
  gl.types.push(canvas instanceof HTMLCanvasElement ? 'html' : 'offscreen');
  (canvas as HTMLCanvasElement).addEventListener('webglcontextlost', () => { gl.lost++; gl.live.delete(canvas); });
}
for (const proto of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype] as unknown as { getContext: (this: object, type: string, ...a: unknown[]) => unknown }[]) {
  const orig = proto.getContext;
  proto.getContext = function (this: object, type: string, ...a: unknown[]) {
    const ctx = orig.call(this, type, ...a);
    if (ctx) track(this, type);
    return ctx;
  };
}

function mount(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.style.cssText = `width:${w}px;height:${h}px`;
  document.body.append(c);
  return c;
}
const pixels = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
const inkOf = (d: Uint8ClampedArray) => { let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++; return n; };
const same = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false; return true; };
const newRenderer = async (c: HTMLCanvasElement, bytes: Uint8Array, extra = {}) => PagRenderer.create(c, bytes, { devicePixelRatio: 1, observeResize: false, ...engineOpts, ...extra });
const show = async (r: PagRenderer, i: number) => { r.drawFrame(i); await r.ready(i); };

// ------------------------------------------------------------------------------------------------
async function runSupport() {
  const out: Record<string, unknown> = { userAgent: navigator.userAgent, offscreenCanvas: typeof OffscreenCanvas !== 'undefined', webAssembly: typeof WebAssembly !== 'undefined' };
  const bytes = await bytesOf('like.pag');
  const t0 = performance.now();
  const c = mount(244, 244);
  const r = await newRenderer(c, bytes);
  await show(r, 0);
  out.engineLoadMs = r.engineLoadMs;
  out.coldLoadToFirstFrameMs = Math.round(performance.now() - t0);
  const res = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const sizes = (re: RegExp) => { const e = res.find((x) => re.test(x.name)); return e ? { url: e.name, encodedBytes: e.encodedBodySize, decodedBytes: e.decodedBodySize, transferBytes: e.transferSize, ms: Math.round(e.duration) } : null; };
  out.moduleResource = sizes(/libpag\.esm/);
  out.wasmResource = sizes(/libpag\.wasm/);
  out.frameCount = r.frameCount;
  out.glContexts = { created: gl.created, types: gl.types };
  // warm: a second renderer must not re-download or re-init
  const t1 = performance.now();
  const c2 = mount(244, 244);
  const r2 = await newRenderer(c2, bytes);
  await show(r2, 0);
  out.secondRendererToFirstFrameMs = Math.round(performance.now() - t1);
  r.destroy(); r2.destroy();
  await Promise.all([r.disposed, r2.disposed]);
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runFrames() {
  const out: unknown[] = [];
  for (const f of files) {
    const bytes = await bytesOf(f);
    const c = mount(10, 10);
    try {
      const probe = await newRenderer(mount(1, 1), bytes);
      const { width, height } = probe.size;
      probe.destroy();
      await probe.disposed;
      c.style.cssText = `width:${width}px;height:${height}px`;
      const r = await newRenderer(c, bytes);
      const PAG = r.internals.PAG;
      // The reference: a second, independent PAGView on the same file bytes, driven straight with `progress = i / frames`.
      const c2 = mount(width, height);
      c2.width = width;
      c2.height = height;
      const file2 = await PAG.PAGFile.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      const view2 = (await PAG.PAGView.init(file2, c2, { useCanvas2D: true, useScale: false, firstFrame: false }))!;
      view2.setScaleMode(2);
      const n = r.frameCount;
      const sequential: Uint8ClampedArray[] = [];
      const diffOf = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let bytes = 0, max = 0; for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i]! - b[i]!); if (d) { bytes++; if (d > max) max = d; } } return { bytes, max }; };
      const vsDirect: { frame: number; bytes: number; max: number }[] = [];
      const wrongIndex: number[] = [];
      const directBoundaryWrong: number[] = [];
      const hashes = new Set<string>();
      for (let i = 0; i < n; i++) {
        await show(r, i);
        const a = new Uint8ClampedArray(pixels(c));
        sequential.push(a);
        // The reference: libpag driven directly with the progress in the MIDDLE of frame i (unambiguous: libpag quantises time to frames).
        view2.setProgress((i + 0.5) / n);
        await view2.flush();
        const b = pixels(c2);
        if (view2.currentFrame() !== i) wrongIndex.push(-i - 1); // the reference itself must land on i
        const d = diffOf(a, b);
        if (d.bytes) vsDirect.push({ frame: i, ...d });
        if (r.internals.view.currentFrame() !== i) wrongIndex.push(i);
        // libpag's own setProgress(i / n) at the exact boundary (what a naive caller would do)
        view2.setProgress(i / n);
        if (view2.currentFrame() !== i) directBoundaryWrong.push(i);
        let h = 0;
        for (let k = 0; k < a.length; k += 97) h = (h * 31 + a[k]!) | 0;
        hashes.add(String(h));
      }
      // Random access (seeks, backwards, repeats) must give the same pixels as playing in order.
      const order = [n - 1, 0, n >> 1, 1, n - 2, 2, 0, n >> 2, (3 * n) >> 2, n - 1].filter((i) => i >= 0 && i < n);
      const seeks: { frame: number; bytes: number; max: number }[] = [];
      for (const i of order) { await show(r, i); const d = diffOf(new Uint8ClampedArray(pixels(c)), sequential[i]!); if (d.bytes) seeks.push({ frame: i, ...d }); }
      // Is p = (i + 0.5) / n the same picture as p = (i + 0.9) / n? (does libpag quantise time to frames?)
      let quantised = true;
      for (const i of [1, n >> 1, n - 2].filter((x) => x >= 0 && x < n)) {
        view2.setProgress((i + 0.5) / n); await view2.flush(); const m = new Uint8ClampedArray(pixels(c2));
        view2.setProgress((i + 0.9) / n); await view2.flush();
        if (!same(pixels(c2), m)) quantised = false;
      }
      view2.destroy(); file2.destroy();
      out.push({ file: f, size: `${width}x${height}`, frames: n, fps: round(1000 / r.frameDuration(), 3), durationMs: round(n * r.frameDuration(), 1), compared: n, framesDifferingFromDirect: vsDirect.length, directDiffs: vsDirect.slice(0, 4), wrongFrameIndex: wrongIndex, naiveBoundaryProgressLandsOnWrongFrame: directBoundaryWrong.length, distinctPictures: hashes.size, seekDifferences: seeks, libpagQuantisesTimeToFrames: quantised, ok: vsDirect.length === 0 && wrongIndex.length === 0 && seeks.every((x) => x.max <= 1 && x.bytes <= 16) && hashes.size > 1 });
      r.destroy();
      await r.disposed;
    } catch (e) {
      out.push({ file: f, error: String((e as Error).stack ?? e).slice(0, 400), ok: false });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function playOnce(r: PagRenderer, loops: number, maxMs: number) {
  const events: { f: number; t: number }[] = [];
  let endedAt = -1;
  let t0 = 0;
  await new Promise<void>((resolve) => {
    const ticker = new Ticker({
      frames: r.frameCount, frameDuration: (i) => r.frameDuration(), loops,
      onFrame: (f) => { events.push({ f, t: performance.now() - t0 }); r.drawFrame(f); },
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
    const bytes = await bytesOf(f);
    const { width, height } = await sizeOf(bytes);
    const c = mount(width, height);
    try {
      const r = await newRenderer(c, bytes);
      for (let i = 0; i < Math.min(8, r.frameCount); i++) await show(r, i); // warm up (first-use shader / texture work)
      const n = r.frameCount;
      const full = n * r.frameDuration();
      const loops = full <= 3000 ? 2 : 1;
      // One scheduler hiccup on a busy machine must not fail the run: measure up to 3 times (the thresholds stay the same) and report how many it took.
      let row: Record<string, unknown> = {};
      for (let attempt = 1; attempt <= 3; attempt++) {
        const { events, endedAt } = await playOnce(r, loops, full * loops + 1500);
        let play = 0, prev = -1;
        const errs: number[] = [];
        for (const e of events) { if (e.f < prev) play++; prev = e.f; errs.push(e.t - (play * full + e.f * r.frameDuration())); }
        const abs = errs.map(Math.abs);
        row = { file: f, frames: n, emitted: events.length, meanErrMs: round(errs.reduce((a, b) => a + b, 0) / Math.max(1, errs.length), 1), maxAbsErrMs: round(Math.max(0, ...abs), 1), expectedTotalMs: round(full * loops, 0), measuredTotalMs: endedAt < 0 ? null : round(endedAt, 0), attempts: attempt, ok: abs.length > 0 && Math.max(...abs) <= 60 && endedAt >= 0 && Math.abs(endedAt - full * loops) <= 60 };
        if (row.ok) break;
      }
      out.push(row);
      r.destroy(); await r.disposed;
    } catch (e) {
      out.push({ file: f, error: String((e as Error).stack ?? e).slice(0, 300), ok: false });
    } finally { c.remove(); }
  }
  return out;
}

async function sizeOf(bytes: Uint8Array) {
  const p = await newRenderer(mount(1, 1), bytes);
  const s = p.size;
  p.destroy();
  await p.disposed;
  return s;
}

async function runLoops() {
  const out: unknown[] = [];
  for (const [option, expected] of [[undefined, 1], [3, 3], [0, 0]] as const) {
    const bytes = await bytesOf('like.pag');
    const c = mount(244, 244);
    const r = await newRenderer(c, bytes);
    for (let i = 0; i < r.frameCount; i++) await show(r, i);
    const loops = resolveLoops(option, r);
    const forever = expected === 0;
    const cycle = r.frameCount * r.frameDuration();
    const { events, endedAt } = await playOnce(r, loops, forever ? cycle * 2.6 : cycle * expected + 800);
    const plays = events.filter((e) => e.f === 0).length;
    out.push({ file: 'like.pag', option: option ?? null, fileLoopCount: r.loopCount, resolvedLoops: loops, expectedPlays: forever ? 'forever' : expected, observedPlays: plays, endedAfterMs: endedAt < 0 ? null : round(endedAt, 0), expectedMs: forever ? null : round(cycle * expected, 0), ok: forever ? endedAt < 0 && plays >= 2 : plays === expected && endedAt >= 0 && Math.abs(endedAt - cycle * expected) <= 60 });
    r.destroy(); await r.disposed; c.remove();
  }
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runLeaks() {
  const cycles = Number(q.get('cycles') ?? 100);
  const out: Record<string, unknown> = { cycles };
  const raf = { requested: 0, fired: 0, cancelled: 0 };
  const outstanding = new Set<number>();
  const oRaf = window.requestAnimationFrame.bind(window), oCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { raf.requested++; const h = oRaf((t) => { outstanding.delete(h); raf.fired++; cb(t); }); outstanding.add(h); return h; };
  window.cancelAnimationFrame = (h) => { if (outstanding.delete(h)) raf.cancelled++; oCaf(h); };
  const OrigRO = window.ResizeObserver; let roLive = 0;
  window.ResizeObserver = class extends OrigRO { constructor(cb: ResizeObserverCallback) { super(cb); roLive++; } override disconnect() { roLive--; super.disconnect(); } } as typeof ResizeObserver;
  const bitmaps = { created: 0, closed: 0 };
  const oCib = window.createImageBitmap.bind(window);
  window.createImageBitmap = (async (...a: Parameters<typeof createImageBitmap>) => { const b = await oCib(...a); bitmaps.created++; return b; }) as typeof createImageBitmap;
  const oClose = ImageBitmap.prototype.close; const closedSet = new WeakSet<object>();
  ImageBitmap.prototype.close = function (this: ImageBitmap) { if (!closedSet.has(this)) { closedSet.add(this); bitmaps.closed++; } oClose.call(this); };

  const bytes = await bytesOf('replacement.pag');
  const red = await new Promise<Blob>((res) => { const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d')!; x.fillStyle = '#e22'; x.fillRect(0, 0, 16, 16); c.toBlob((b) => res(b!)); });
  let viewsCreated = 0, viewsDisposed = 0, framesDrawn = 0, errors = 0;
  const wasmMem = (r: PagRenderer) => ((r.internals.PAG as unknown as { HEAPU8?: Uint8Array }).HEAPU8?.length ?? 0);
  let mem10 = 0, memLast = 0;
  for (let i = 0; i < cycles; i++) {
    const c = mount(800, 800);
    const r = await newRenderer(c, bytes, { observeResize: true, onError: () => errors++ });
    viewsCreated++;
    await r.setImage('#0', red); // owned bitmap + PAGImage
    const ticker = new Ticker({ frames: r.frameCount, frameDuration: () => 8, loops: 0, onFrame: (f) => { framesDrawn++; r.drawFrame(f); } });
    ticker.play();
    for (let k = 0; k < 4; k++) await nextFrame();
    ticker.destroy();
    r.destroy();
    await r.disposed;
    viewsDisposed++;
    c.remove();
    if (i === 9) mem10 = wasmMem(r);
    memLast = wasmMem(r);
  }
  await sleep(200);
  out.sharedMode = {
    viewsCreated, viewsDisposed, framesDrawn, errors,
    webglContextsCreated: gl.created, webglContextTypes: [...new Set(gl.types)], webglContextsLost: gl.lost,
    rafOutstanding: outstanding.size, resizeObserversLive: roLive, replacementBitmaps: { created: bitmaps.created, closed: bitmaps.closed },
    wasmHeapBytesAfter10Cycles: mem10, wasmHeapBytesAfterAll: memLast,
  };
  // Control: libpag's own default mode (a WebGL context on every canvas), views kept alive: shows the browser limit is real.
  const control = Number(q.get('control') ?? 24);
  if (control > 0) {
    const r0 = await newRenderer(mount(1, 1), bytes);
    const { PAG } = r0.internals;
    const before = { created: gl.created, lost: gl.lost };
    const views: { destroy(): void }[] = [];
    let controlErr = '';
    try {
      const f0 = await PAG.PAGFile.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      for (let i = 0; i < control; i++) {
        const c = document.createElement('canvas'); c.width = c.height = 64; document.body.append(c);
        const v = await PAG.PAGView.init(f0, c, { useCanvas2D: false, useScale: false, firstFrame: true });
        if (v) views.push(v);
      }
    } catch (e) { controlErr = String((e as Error).message ?? e).slice(0, 120); }
    await sleep(300);
    out.controlDefaultMode = { viewsKeptAlive: views.length, webglContextsCreated: gl.created - before.created, webglContextsLostByBrowser: gl.lost - before.lost, error: controlErr };
    for (const v of views) { try { v.destroy(); } catch { /* ignore */ } }
    r0.destroy(); await r0.disposed;
  }
  const sm = out.sharedMode as Record<string, number>;
  out.ok = viewsCreated === cycles && viewsDisposed === cycles && errors === 0 && (sm.webglContextsCreated ?? 99) <= 1 && sm.webglContextsLost === 0 && sm.rafOutstanding === 0 && sm.resizeObserversLive === 0 && (out.sharedMode as { replacementBitmaps: { created: number; closed: number } }).replacementBitmaps.created === (out.sharedMode as { replacementBitmaps: { created: number; closed: number } }).replacementBitmaps.closed;
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runMulti() {
  const out: Record<string, unknown> = {};
  const bytesA = await bytesOf('like.pag'), bytesB = await bytesOf('replacement.pag');
  const rounds = Number(q.get('rounds') ?? 6);
  const rows: unknown[] = [];
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const created0 = gl.created;
  for (let round_ = 0; round_ < rounds; round_++) {
    const players: { r: PagRenderer; c: HTMLCanvasElement; ticker: Ticker; seen: Set<number> }[] = [];
    for (let k = 0; k < 5; k++) {
      const bytes = k % 2 ? bytesB : bytesA;
      const c = mount(k % 2 ? 200 : 244, k % 2 ? 200 : 244);
      const r = await newRenderer(c, bytes, { observeResize: false });
      const seen = new Set<number>();
      const ticker = new Ticker({ frames: r.frameCount, frameDuration: () => r.frameDuration(), loops: 0, onFrame: (f) => { seen.add(f); r.drawFrame(f); } });
      ticker.play();
      players.push({ r, c, ticker, seen });
    }
    for (let k = 0; k < 18; k++) await nextFrame();
    const aliveInk = players.map((p) => inkOf(pixels(p.c)));
    const order = players.map((_, i) => i).sort(() => rnd() - 0.5);
    const orderLog: number[] = [];
    const survivorsOk: boolean[] = [];
    for (const idx of order) {
      const p = players[idx]!;
      p.ticker.destroy(); p.r.destroy(); await p.r.disposed;
      orderLog.push(idx);
      const inkAfterDestroy = inkOf(pixels(p.c));
      // everyone still alive keeps animating
      const alive = players.filter((x) => !orderLog.includes(players.indexOf(x)));
      const before = alive.map((x) => x.seen.size);
      await sleep(120);
      survivorsOk.push(inkAfterDestroy === 0 && alive.every((x, j) => x.seen.size >= before[j]! && inkOf(pixels(x.c)) > 0) && alive.every((x, j) => x.seen.size > before[j]! || x.seen.size === x.r.frameCount));
    }
    players.forEach((p) => p.c.remove());
    rows.push({ round: round_, order: orderLog, allRenderedBeforeDestroy: aliveInk.every((n) => n > 0), eachDestroyClearedItsCanvasAndOthersKeptPlaying: survivorsOk.every(Boolean) });
  }
  out.rounds = rows;
  out.webglContextsCreatedDuringTest = gl.created - created0;
  out.webglContextsLost = gl.lost;
  out.ok = rows.every((r) => (r as { allRenderedBeforeDestroy: boolean; eachDestroyClearedItsCanvasAndOthersKeptPlaying: boolean }).allRenderedBeforeDestroy && (r as { eachDestroyClearedItsCanvasAndOthersKeptPlaying: boolean }).eachDestroyClearedItsCanvasAndOthersKeptPlaying) && gl.lost === 0 && (out.webglContextsCreatedDuringTest as number) <= 1;
  return out;
}

// ------------------------------------------------------------------------------------------------
async function runReplace() {
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
  const warnings: string[] = [];
  const oWarn = console.warn; console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
  const bytes = await bytesOf('replacement.pag');
  const c = mount(800, 800);
  const r = await newRenderer(c, bytes);
  check('getEditableKeys lists the one editable image layer', JSON.stringify(r.getEditableKeys()) === JSON.stringify([{ key: '#0', type: 'image', index: 0, name: '' }]), r.getEditableKeys());
  await show(r, 30);
  const base = new Uint8ClampedArray(pixels(c));
  const solid = async (color: string) => { const k = document.createElement('canvas'); k.width = k.height = 32; const g = k.getContext('2d')!; g.fillStyle = color; g.fillRect(0, 0, 32, 32); return createImageBitmap(k); };
  await r.setImage('#0', await solid('#0f0'));
  await r.ready(30); await sleep(50);
  const green = new Uint8ClampedArray(pixels(c));
  const changed = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) > 60) n++; return n; };
  const greenish = (d: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200 && d[i + 1]! > 200 && d[i]! < 60 && d[i + 2]! < 60) n++; return n; };
  check('setImage replaces the picture (many pixels changed, green appears)', changed(base, green) > 2000 && greenish(green) > 2000 && greenish(base) < 200, { changed: changed(base, green), greenNow: greenish(green), greenBefore: greenish(base) });
  await show(r, 5); await show(r, 30);
  check('replacement survives seeking (frame 30 again is green)', greenish(new Uint8ClampedArray(pixels(c))) > 2000);
  await r.setImage('#0', await solid('#00f'), { fit: 'cover' });
  await r.ready(30); await sleep(50);
  const blueish = (d: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200 && d[i + 2]! > 200 && d[i]! < 60 && d[i + 1]! < 60) n++; return n; };
  check('a second setImage replaces the first (blue, no green left)', blueish(new Uint8ClampedArray(pixels(c))) > 2000 && greenish(new Uint8ClampedArray(pixels(c))) < 200);
  // blob + url paths
  const redBlob = await new Promise<Blob>((res) => { const k = document.createElement('canvas'); k.width = k.height = 16; const g = k.getContext('2d')!; g.fillStyle = '#f00'; g.fillRect(0, 0, 16, 16); k.toBlob((b) => res(b!)); });
  await r.setImage('#0', redBlob);
  const url = URL.createObjectURL(redBlob);
  await r.setImage('#0', url);
  URL.revokeObjectURL(url);
  await r.ready(30); await sleep(50);
  const reddish = (d: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i + 3]! > 200 && d[i]! > 200 && d[i + 1]! < 60 && d[i + 2]! < 60) n++; return n; };
  check('setImage from a Blob and from a URL both work (red)', reddish(new Uint8ClampedArray(pixels(c))) > 2000);
  // unknown keys never throw
  warnings.length = 0;
  let threw = false;
  try { r.setText('nope', 'x'); await r.setImage('nope', await solid('#000')); r.setHidden('nope', true); r.clearReplacement('nope'); } catch { threw = true; }
  check('unknown keys: no throw, a warning each', !threw && warnings.length >= 3, { threw, warnings: warnings.length });
  // hide a layer by name: pick a name from the file's own layers
  const { file } = r.internals;
  const root = file as unknown as { getLayerAt(i: number): { layerName(): string; setVisible(v: boolean): void } ; numChildren(): number };
  const names: string[] = [];
  for (let i = 0; i < root.numChildren(); i++) names.push(root.getLayerAt(i).layerName());
  check('the file exposes its layers (diagnostic)', true, { topLevelLayerNames: names });
  console.warn = oWarn;
  const stale = r.getEditableKeys();
  r.destroy(); await r.disposed;
  return { checks, passed: checks.filter((x) => x.ok).length, failed: checks.filter((x) => !x.ok).length, keys: stale };
}

// ------------------------------------------------------------------------------------------------
/** Width in canvas pixels of the bright (text) pixels. */
function inkWidth(d: Uint8ClampedArray, w: number): number {
  let min = w, max = 0;
  for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200) { const x = (i / 4) % w; if (x < min) min = x; if (x > max) max = x; }
  return max >= min ? max - min + 1 : 0;
}

const SCRIPTS: [string, string][] = [['latin', 'Rahul'], ['hindi', 'राहुल'], ['gujarati', 'અનુરાગ'], ['arabic', 'محمد'], ['emoji', 'Sam 😀🎁']];
const TEXT_W = 420, TEXT_H = 110;

function svgaTextMovie(): SvgaMovie {
  const id = { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
  const fr = (extra: object) => ({ alpha: 1, layout: { x: 0, y: 0, width: 0, height: 0 }, transform: id, clipPath: '', shapes: [], ...extra });
  const bg = { type: 'rect' as const, x: 0, y: 0, width: TEXT_W, height: TEXT_H, cornerRadius: 0, style: { fill: { r: 0.08, g: 0.08, b: 0.16, a: 1 }, stroke: null, strokeWidth: 0, lineCap: 'butt' as const, lineJoin: 'miter' as const, miterLimit: 0, lineDash: { dash: 0, gap: 0, offset: 0 } }, transform: id };
  return {
    container: 'protobuf', version: 't', viewBox: { width: TEXT_W, height: TEXT_H }, fps: 10, frames: 1, images: new Map(), audios: new Map(), audioTracks: [], warnings: [],
    sprites: [
      { imageKey: 'bg.vector', matteKey: null, isMatte: false, frames: [fr({ shapes: [bg] })] },
      { imageKey: 'name', matteKey: null, isMatte: false, frames: [fr({ layout: { x: 10, y: 10, width: TEXT_W - 20, height: TEXT_H - 20 } })] },
    ],
  };
}

async function runText() {
  const rows: Record<string, unknown>[] = [];
  const shots: Record<string, string> = {};
  for (const [script, text] of SCRIPTS) {
    // SVGA
    const c = document.createElement('canvas');
    c.style.cssText = `width:${TEXT_W}px;height:${TEXT_H}px`;
    document.body.append(c);
    const r = new SvgaRenderer(c, svgaTextMovie(), new Map(), { devicePixelRatio: 2, observeResize: false });
    r.drawFrame(0);
    r.setText('name', text, { size: 56, color: '#ffffff', font: 'sans-serif' });
    shots[`svga-${script}`] = c.toDataURL('image/png');
    const d = pixels(c);
    let bright = 0; for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200) bright++;
    rows.push({ format: 'svga', script, text, brightPixels: bright, inkWidth: inkWidth(d, c.width) });
    r.destroy(); c.remove();
  }
  // PAG: a composition built with the engine (no sample file has an editable text layer): solid background + a text layer
  const seedBytes = await bytesOf('like.pag');
  const seed = await newRenderer(mount(1, 1), seedBytes);
  const { PAG } = seed.internals;
  const P = PAG as unknown as Record<string, any>;
  for (const [script, text] of SCRIPTS) {
    const c = mount(TEXT_W, TEXT_H);
    c.width = TEXT_W * 2; c.height = TEXT_H * 2; // 2x like the SVGA shot
    const comp = P.PAGComposition.make(TEXT_W, TEXT_H);
    const bg = P.PAGSolidLayer.make(1_000_000, TEXT_W, TEXT_H, { red: 20, green: 20, blue: 41 }, 255);
    comp.addLayer(bg);
    const layer = P.PAGTextLayer.make(1_000_000, text, 56, 'sans-serif', 'Regular');
    layer.setFillColor({ red: 255, green: 255, blue: 255 });
    try { layer.setMatrix(P.Matrix.makeTrans(14, 10)); } catch { /* matrix helper not available in every build */ }
    comp.addLayer(layer);
    const view = await P.PAGView.init(comp, c, { useCanvas2D: true, useScale: false, firstFrame: false });
    view.setScaleMode(1);
    view.setProgress(0.1);
    await view.flush();
    shots[`pag-${script}`] = c.toDataURL('image/png');
    const d = pixels(c);
    let bright = 0; for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 1]! > 200) bright++;
    rows.push({ format: 'pag', script, text, brightPixels: bright, inkWidth: inkWidth(d, c.width) });
    view.destroy(); comp.destroy?.(); c.remove();
  }
  seed.destroy(); await seed.disposed;
  // one picture for review: a row per script, SVGA on the left and PAG on the right, with captions
  const W = TEXT_W * 2, H = TEXT_H * 2, pad = 36;
  const comp = document.createElement('canvas');
  comp.width = W * 2 + 30; comp.height = SCRIPTS.length * (H + pad) + 10;
  const g = comp.getContext('2d')!;
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, comp.width, comp.height);
  g.fillStyle = '#000'; g.font = '16px sans-serif';
  for (let i = 0; i < SCRIPTS.length; i++) {
    const [script, text] = SCRIPTS[i]!;
    const y = i * (H + pad) + 10;
    g.fillText(`${script}: "${text}"    (left: SVGA setText, right: PAG text layer)`, 10, y + 18);
    for (let k = 0; k < 2; k++) {
      const img = new Image();
      img.src = shots[`${k ? 'pag' : 'svga'}-${script}`]!;
      await img.decode();
      g.drawImage(img, 10 + k * (W + 10), y + 26);
    }
  }
  shots.composite = comp.toDataURL('image/png');
  return { rows, shots };
}

// ------------------------------------------------------------------------------------------------
async function runPerf() {
  const out: unknown[] = [];
  const stats = (ms: number[]) => { const s = [...ms].sort((a, b) => a - b); return { n: s.length, avg: round(ms.reduce((a, b) => a + b, 0) / ms.length), p50: round(s[Math.floor(s.length * 0.5)]!), p95: round(s[Math.floor(s.length * 0.95)]!), max: round(s[s.length - 1]!) }; };
  for (const f of files) {
    const bytes = await bytesOf(f);
    const { width, height } = await sizeOf(bytes);
    for (const dpr of [1, 2]) {
      const c = document.createElement('canvas');
      c.style.cssText = `width:${width / dpr}px;height:${height / dpr}px`;
      document.body.append(c);
      const r = await newRenderer(c, bytes, { devicePixelRatio: dpr });
      for (let i = 0; i < r.frameCount; i++) await show(r, i); // warm-up pass
      const render: number[] = [], readback: number[] = [];
      for (let pass = 0; pass < 4; pass++) {
        for (let i = 0; i < r.frameCount; i++) {
          const t0 = performance.now();
          r.drawFrame(i === 0 && pass % 2 ? 1 : i);
          await r.ready(i === 0 && pass % 2 ? 1 : i);
          const t1 = performance.now();
          c.getContext('2d')!.getImageData(0, 0, 1, 1); // forces the copy to finish on the GPU
          const t2 = performance.now();
          render.push(t1 - t0); readback.push(t2 - t0);
        }
      }
      out.push({ file: f, backing: `${c.width}x${c.height}`, dpr, frames: r.frameCount, renderAndCopy: stats(render), withReadback: stats(readback) });
      r.destroy(); await r.disposed; c.remove();
    }
  }
  return out;
}

async function runDiag() {
  const out: Record<string, unknown> = {};
  for (const f of files) {
    const bytes = await bytesOf(f);
    const { width, height } = await sizeOf(bytes);
    const c = mount(width, height);
    const r = await newRenderer(c, bytes);
    const n = r.frameCount;
    const PAG = r.internals.PAG;
    const c2 = mount(width, height); c2.width = width; c2.height = height;
    const file2 = await PAG.PAGFile.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    const v2 = (await PAG.PAGView.init(file2, c2, { useCanvas2D: true, useScale: false, firstFrame: false }))!;
    v2.setScaleMode(2);
    const directLandsOn: Record<string, number> = {};
    const boundary: number[] = [];
    for (let i = 0; i < n; i++) {
      v2.setProgress(i / n);
      directLandsOn[i] = v2.currentFrame();
      if (v2.currentFrame() !== i) boundary.push(i);
    }
    // is the first render of frame 0 complete? render 0, then 5, then 0 again, then 0 twice in a row
    await show(r, 0); const a0 = inkOf(pixels(c)); const first = new Uint8ClampedArray(pixels(c));
    await show(r, 5); await show(r, 0); const a1 = inkOf(pixels(c)); const again = new Uint8ClampedArray(pixels(c));
    r.drawFrame(1); await r.ready(1); r.drawFrame(0); await r.ready(0); const again2 = new Uint8ClampedArray(pixels(c));
    let diffFirstAgain = 0; for (let i = 0; i < first.length; i++) if (first[i] !== again[i]) diffFirstAgain++;
    let diffAgainAgain2 = 0; for (let i = 0; i < first.length; i++) if (again[i] !== again2[i]) diffAgainAgain2++;
    // and the reference: frame 0 first vs after other frames
    v2.setProgress(0.5 / n); await v2.flush(); const ref0a = new Uint8ClampedArray(pixels(c2));
    v2.setProgress(5.5 / n); await v2.flush(); v2.setProgress(0.5 / n); await v2.flush(); const ref0b = new Uint8ClampedArray(pixels(c2));
    let refDiff = 0; for (let i = 0; i < ref0a.length; i++) if (ref0a[i] !== ref0b[i]) refDiff++;
    out[f] = { frames: n, directIOverNLandsOnWrongFrame: boundary.length, directLandsOn_firstFew: Object.values(directLandsOn).slice(0, 8), ink: { first: a0, again: a1 }, bytesDifferingFirstVsAgain: diffFirstAgain, bytesDifferingAgainVsAgain2: diffAgainAgain2, referenceFrame0FirstVsAfterOthers: refDiff };
    v2.destroy(); file2.destroy(); r.destroy(); await r.disposed;
  }
  return out;
}

async function runFonts() {
  const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
  const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
  // The test font is a system font copied into the git-ignored samples/.fonts/ (not redistributable): skip cleanly without it (CI).
  const fontRes = await fetch('/samples/.fonts/test-mono.ttf');
  if (!fontRes.ok) return { checks, passed: 0, failed: 0, skipped: 'samples/.fonts/test-mono.ttf is not present' };
  const fontBytes = await fontRes.arrayBuffer();
  const sample = 'MMMMiiiiWWWW';
  const width = async (family: string, format: 'svga' | 'pag') => {
    if (format === 'svga') {
      const c = document.createElement('canvas'); c.style.cssText = `width:${TEXT_W}px;height:${TEXT_H}px`; document.body.append(c);
      const r = new SvgaRenderer(c, svgaTextMovie(), new Map(), { devicePixelRatio: 2, observeResize: false });
      r.drawFrame(0); r.setText('name', sample, { size: 40, color: '#fff', font: family });
      const w = inkWidth(pixels(c), c.width); r.destroy(); c.remove(); return w;
    }
    const seed = await newRenderer(mount(1, 1), await bytesOf('like.pag'));
    const P = seed.internals.PAG as unknown as Record<string, any>;
    const c = mount(TEXT_W, TEXT_H); c.width = TEXT_W * 2; c.height = TEXT_H * 2;
    const comp = P.PAGComposition.make(TEXT_W, TEXT_H);
    comp.addLayer(P.PAGSolidLayer.make(1_000_000, TEXT_W, TEXT_H, { red: 20, green: 20, blue: 41 }, 255));
    const layer = P.PAGTextLayer.make(1_000_000, sample, 40, family, 'Regular'); layer.setFillColor({ red: 255, green: 255, blue: 255 }); comp.addLayer(layer);
    const view = await P.PAGView.init(comp, c, { useCanvas2D: true, useScale: false, firstFrame: false }); view.setScaleMode(1); view.setProgress(0.1); await view.flush();
    const w = inkWidth(pixels(c), c.width); view.destroy(); c.remove(); seed.destroy(); await seed.disposed; return w;
  };
  const before = { svga: await width('GiftTestMono', 'svga'), pag: await width('GiftTestMono', 'pag') };
  const unregister = await registerFont('GiftTestMono', fontBytes);
  const after = { svga: await width('GiftTestMono', 'svga'), pag: await width('GiftTestMono', 'pag') };
  const sans = { svga: await width('sans-serif', 'svga'), pag: await width('sans-serif', 'pag') };
  check('SVGA: a registered font changes the rendering (monospace is not as wide as the fallback)', Math.abs(after.svga - before.svga) > 8 && after.svga !== sans.svga, { before: before.svga, after: after.svga, sansSerif: sans.svga });
  check('PAG: the same registered font is picked up by name', Math.abs(after.pag - before.pag) > 8 && after.pag !== sans.pag, { before: before.pag, after: after.pag, sansSerif: sans.pag });
  unregister();
  const removed = { svga: await width('GiftTestMono', 'svga') };
  check('the disposer returned by registerFont removes the font again', Math.abs(removed.svga - before.svga) <= 2, { before: before.svga, afterRemoval: removed.svga });
  return { checks, passed: checks.filter((x) => x.ok).length, failed: checks.filter((x) => !x.ok).length };
}

(async () => {
  try {
    const result = task === 'fonts' ? await runFonts() : task === 'diag' ? await runDiag() : task === 'support' ? await runSupport() : task === 'frames' ? await runFrames() : task === 'timing' ? await runTiming() : task === 'loops' ? await runLoops() : task === 'leaks' ? await runLeaks() : task === 'multi' ? await runMulti() : task === 'replace' ? await runReplace() : task === 'text' ? await runText() : await runPerf();
    (window as unknown as { __result: unknown }).__result = result;
    const out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(result, (k, v) => (typeof v === 'string' && v.startsWith('data:image') ? '[image]' : v), 1).slice(0, 4000);
  } catch (e) {
    (window as unknown as { __result: unknown }).__result = { error: String((e as Error).stack ?? e) };
  }
})();
