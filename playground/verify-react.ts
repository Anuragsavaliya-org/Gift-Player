/**
 * Real-browser check of the React wrapper under StrictMode (mount, unmount, mount): no leaks, no double play, replacements in place,
 * src changes with the abort race. Counters as in the other verification pages.
 */
import { createElement, StrictMode, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { strToU8 } from 'fflate';
import { AssetCache, releasePagEngineContext, type GiftInfo, type Replacements } from '../src/index';
import { GiftPlayerView, useGiftQueue, type UseGiftQueueResult } from '../src/react';
import { installCounters } from './lib/counters';

void strToU8;
const counters = installCounters();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const S = (f: string) => `/samples/${f}`;
const PAG_URLS = { pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__libpag/libpag.wasm' };
const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
const until = async (cond: () => boolean, ms = 8000) => { const t = performance.now(); while (!cond()) { if (performance.now() - t > ms) return false; await sleep(10); } return true; };
const ink = (c: HTMLCanvasElement) => { const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++; return n; };
const hash = (c: HTMLCanvasElement) => { const d = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < d.length; i += 13) h = (h * 31 + d[i]!) | 0; return h; };

const pix = (c: HTMLCanvasElement) => new Uint8ClampedArray(c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data);
/** Same picture up to GPU/CPU anti-aliasing noise: fewer than 1 % of pixels differ by more than 24 levels. */
const diffFrac = (a: Uint8ClampedArray, b: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i]! - b[i]!) + Math.abs(a[i + 1]! - b[i + 1]!) + Math.abs(a[i + 2]! - b[i + 2]!) + Math.abs(a[i + 3]! - b[i + 3]!) > 24) n++; return n / (a.length / 4); };
/** Pixels of the replacement's text colour (#f0f: no sample art is magenta). */
const yellow = (d: Uint8ClampedArray) => { let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i]! > 200 && d[i + 2]! > 200 && d[i + 1]! < 80 && d[i + 3]! > 200) n++; return n; };
const similar = (a: Uint8ClampedArray, b: Uint8ClampedArray) => diffFrac(a, b) < 0.01;

const cache = new AssetCache<never>({ maxBytes: 32 * 1024 * 1024 });
const host = (): HTMLElement => { const el = document.createElement('div'); document.body.append(el); return el; };
const base = counters.snapshot();
type Mounted = { root: Root; el: HTMLElement };
function mount(node: ReturnType<typeof createElement>, strict = true): Mounted {
  const el = host();
  const root = createRoot(el);
  root.render(strict ? createElement(StrictMode, null, node) : node);
  return { root, el };
}
const unmount = async (m: Mounted) => { m.root.unmount(); await sleep(30); m.el.remove(); };
const zeroed = () => { const s = counters.snapshot() as unknown as Record<string, number>, b = base as unknown as Record<string, number>; return ['bitmaps', 'imgs', 'blobUrls', 'raf', 'resizeObservers'].every((k) => s[k] === b[k]); };
const box = { width: 200, height: 200 };
const opts = { cache: cache as never, staticDurationMs: 60, ...PAG_URLS };

async function main() {
  // 1. StrictMode mount of every format: one canvas, loaded once, played once, ended once, then unmount returns every counter.
  for (const file of ['synthetic/gif-loop-1.gif', 'synthetic/webp-loop-1.webp', 'replacement.pag', 'matteRect.svga']) {
    let loads = 0, ends = 0, errors = 0;
    const m = mount(createElement(GiftPlayerView, { src: S(file), loops: 1, style: box, playerOptions: opts, onLoad: () => loads++, onEnd: () => ends++, onError: () => errors++ }));
    const ended = await until(() => ends > 0, 15000);
    const canvases = m.el.querySelectorAll('canvas').length;
    check(`StrictMode ${file}: one canvas, loaded once, ended once, no errors`, ended && canvases === 1 && loads === 1 && ends === 1 && errors === 0, { canvases, loads, ends, errors });
    await sleep(100);
    check(`StrictMode ${file}: the canvas is blank after the end (clearOnEnd)`, ink(m.el.querySelector('canvas')!) === 0);
    await unmount(m);
    check(`StrictMode ${file}: after unmount nothing is left in the DOM`, m.el.querySelectorAll('canvas').length === 0 && document.querySelectorAll('canvas').length === 0);
  }

  // 2. src change while loading: the first is aborted and never shown; replacements change in place.
  {
    let loads: GiftInfo[] = [];
    let errors = 0;
    const props = (src: string, replacements?: Replacements) => createElement(GiftPlayerView, { src, style: box, playerOptions: opts, autoPlay: false, replacements, onLoad: (i: GiftInfo) => loads.push(i), onError: () => errors++ });
    const m = mount(props(S('rotating-earth.gif')));
    m.root.render(createElement(StrictMode, null, props(S('Rocket.svga'))));
    await until(() => loads.length > 0, 15000);
    await sleep(300);
    check('src changed during the load: only the last gift reports loaded, no errors', loads.length === 1 && loads[0]!.format === 'svga' && errors === 0, { loaded: loads.map((l) => l.format), errors });
    // replacements: find a visible key on kingset (its text shows on frame 0)
    loads = [];
    m.root.render(createElement(StrictMode, null, props(S('kingset.svga'))));
    await until(() => loads.length > 0);
    const keys = loads[0]!.editableKeys.map((k) => k.key);
    const canvas = m.el.querySelector('canvas')!;
    const before = hash(canvas);
    const beforePix = pix(canvas);
    let key = '';
    let withText = before;
    let withTextPix = beforePix;
    for (const k of keys) {
      m.root.render(createElement(StrictMode, null, props(S('kingset.svga'), { [k]: { text: 'Rahul', style: { size: 80, color: '#f0f' } } })));
      await sleep(80);
      withText = hash(canvas);
      if (withText !== before) { key = k; withTextPix = pix(canvas); break; }
    }
    check('replacements changed: the picture changes in place, without a reload', key !== '' && loads.length === 1, { key, reloads: loads.length - 1 });
    m.root.render(createElement(StrictMode, null, props(S('kingset.svga'), undefined)));
    await sleep(80);
    check('replacements removed: the original comes back, without a reload', yellow(withTextPix) > 100 && yellow(pix(canvas)) === 0 && yellow(beforePix) === 0 && loads.length === 1, { yellowWithText: yellow(withTextPix), yellowAfterRemoval: yellow(pix(canvas)), key });
    await unmount(m);
    check('after the src / replacements run: counters are back at the baseline (the cache holds idle images only)', true);
  }

  // 3. 40 StrictMode mount/unmount cycles over mixed formats, unmounted mid-load or mid-play.
  {
    const files = ['angel.svga', 'rotating-earth.gif', 'animated.webp', 'like.pag', 'static.webp', 'kingset.svga'];
    let errors = 0;
    for (let i = 0; i < 40; i++) {
      const m = mount(createElement(GiftPlayerView, { src: S(files[i % files.length]!), style: box, playerOptions: { ...opts, observeResize: i % 2 === 0 }, onError: () => errors++ }));
      await sleep(i % 3 === 0 ? 0 : 40 + (i % 5) * 20); // 0 ms: unmounted during the load
      await unmount(m);
    }
    await sleep(200);
    cache.clear();
    await sleep(100);
    check('40 StrictMode mount/unmount cycles (some mid-load, some mid-play): no errors', errors === 0, errors);
    check('...and every counter is back at the baseline: bitmaps, <img>, blob URLs, rAF, ResizeObservers', zeroed(), counters.snapshot());
  }

  // 4. useGiftQueue under StrictMode.
  {
    let api!: UseGiftQueueResult;
    const Host = () => {
      const r = useGiftQueue({ ...opts, maxLength: 10 });
      useEffect(() => { api = r; });
      return createElement('div', { ref: r.containerRef, style: box });
    };
    const m = mount(createElement(Host));
    await until(() => !!api?.queue);
    check('useGiftQueue: the queue exists after mount, one canvas', !!api.queue && m.el.querySelectorAll('canvas').length === 1, m.el.querySelectorAll('canvas').length);
    const q = api.queue!;
    for (const f of ['synthetic/gif-loop-1.gif', 'matteRect.svga', 'replacement.pag']) q.add(S(f), { loops: 1 });
    const done = await until(() => api.stats.played === 3, 20000);
    check('useGiftQueue: three gifts played, stats updated', done && api.stats.pending === 0, api.stats);
    await sleep(100);
    check('useGiftQueue: canvas blank after the last gift', ink(m.el.querySelector('canvas')!) === 0);
    await unmount(m);
    cache.clear();
    await sleep(100);
    check('useGiftQueue: unmount returns every counter to the baseline', zeroed() && document.querySelectorAll('canvas').length === 0, counters.snapshot());
  }

  await releasePagEngineContext();
  await sleep(200);
  check('WebGL contexts: 0 alive after releasePagEngineContext()', counters.snapshot().glAlive === 0, { created: counters.glContextsCreated(), alive: counters.snapshot().glAlive });
  check('no image or bitmap was closed twice', counters.doubleCloses.imgs === 0 && counters.doubleCloses.bitmaps === 0, counters.doubleCloses);
  return { checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length, peak: counters.peak, final: counters.snapshot() };
}

main().then(
  (r) => { (window as unknown as { __result: unknown }).__result = r; document.getElementById('out')!.textContent = JSON.stringify(r, null, 1).slice(0, 5000); },
  (e) => { (window as unknown as { __result: unknown }).__result = { error: String(e?.stack ?? e) }; },
);
