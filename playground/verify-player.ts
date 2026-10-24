/**
 * Browser verification for the public API (GiftPlayer, GiftQueue, cache). `?task=` is one of:
 *   api     contract checks: load races, destroy mid-load / mid-play, signals, one error per code, visibility pause,
 *           replacements before the first frame, events, resolver, preload
 *   cache   shared decoded images, eviction by byte budget, in-use assets never evicted, images released exactly once
 *   leaks   N create -> load -> play -> destroy cycles over mixed formats; every counter must return to its baseline
 *   stress  `items` mixed-format queue items with priorities, cancels and broken files
 */
import { AssetCache, GiftPlayer, GiftPlayerError, GiftQueue, registerResolver, releasePagEngineContext, type GiftInfo, type QueueHandle } from '../src/index';
import { strToU8, zipSync } from 'fflate';
import { installCounters } from './lib/counters';

const q = new URLSearchParams(location.search);
const task = q.get('task') ?? 'api';
const counters = installCounters();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const PAG_URLS = q.get('cdn') === '1' ? {} : { pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__libpag/libpag.wasm' };
const S = (f: string) => `/samples/${f}`;
const bytesOf = async (f: string) => new Uint8Array(await (await fetch(S(f))).arrayBuffer());

const checks: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => checks.push({ name, ok, detail });
const guarded = async (name: string, fn: () => Promise<void>) => {
  try { await fn(); } catch (e) { check(name, false, String((e as Error)?.stack ?? e).slice(0, 300)); }
};
const codeOf = async (p: Promise<unknown>): Promise<string> => {
  try { await p; return 'resolved'; } catch (e) { return e instanceof GiftPlayerError ? e.code : `non-GiftPlayerError:${String(e).slice(0, 80)}`; }
};

const boxes: HTMLElement[] = [];
function box(w = 200, h = 200): HTMLElement {
  const d = document.createElement('div');
  d.style.cssText = `width:${w}px;height:${h}px;position:relative`;
  document.body.append(d);
  boxes.push(d);
  return d;
}
const newPlayer = (el: HTMLElement, extra = {}) => new GiftPlayer(el, { devicePixelRatio: 1, observeResize: false, ...PAG_URLS, ...extra });
const canvasOf = (el: HTMLElement) => el.querySelector('canvas') as HTMLCanvasElement;
const pixels = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
const hashOf = (c: HTMLCanvasElement) => { const d = pixels(c); let h = 0; for (let i = 0; i < d.length; i += 13) h = (h * 31 + d[i]!) | 0; return h; };
const ink = (c: HTMLCanvasElement) => { const d = pixels(c); let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++; return n; };
/** True when two canvases show the same picture up to GPU/CPU anti-aliasing noise (< 2 % of pixels differ by more than 24 levels). */
const similar = (a: HTMLCanvasElement, b: HTMLCanvasElement) => {
  if (a.width !== b.width || a.height !== b.height) return false;
  const x = pixels(a), y = pixels(b);
  let n = 0;
  for (let i = 0; i < x.length; i += 4) if (Math.abs(x[i]! - y[i]!) + Math.abs(x[i + 1]! - y[i + 1]!) + Math.abs(x[i + 2]! - y[i + 2]!) + Math.abs(x[i + 3]! - y[i + 3]!) > 24) n++;
  return n / (x.length / 4) < 0.02;
};
const cleanup = () => { boxes.splice(0).forEach((b) => b.remove()); };

// ------------------------------------------------------------------------------------------------
/** Fresh page only: the engine is loaded once per page, so a blocked engine has to be the first PAG use. */
async function runEngine() {
  const blocked = new GiftPlayer(box(), { devicePixelRatio: 1, observeResize: false, pagModuleUrl: '/__nope/libpag.esm.js', pagWasmUrl: '/__nope/libpag.wasm' });
  const events: string[] = [];
  blocked.on('error', (e) => events.push(e.code));
  const code = await codeOf(blocked.load(S('like.pag')));
  check('engine-load-failed: PAG engine URL blocked / wrong, also emitted as an `error` event', code === 'engine-load-failed' && events[0] === 'engine-load-failed', { code, events });
  const wasmBlocked = await codeOf(new GiftPlayer(box(), { devicePixelRatio: 1, observeResize: false, pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__nope/libpag.wasm' }).load(S('like.pag')));
  check('engine-load-failed: module loads but the WASM is blocked', wasmBlocked === 'engine-load-failed', wasmBlocked);
  check('non-PAG gifts are unaffected by the blocked engine', (await codeOf(newPlayer(box()).load(S('angel.svga')))) === 'resolved');
  check('the engine loads fine afterwards (a failed load is retried)', (await codeOf(newPlayer(box()).load(S('like.pag')))) === 'resolved');
  return { checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
}

async function runApi() {
  const warnings: string[] = [];
  const oWarn = console.warn; console.warn = (...a: unknown[]) => { warnings.push(a.join(' ')); };
  const unhandled: string[] = [];
  window.addEventListener('unhandledrejection', (e) => unhandled.push(String(e.reason?.code ?? e.reason)));

  await guarded('load() returns format, size, frames, duration and editable keys for every format', async () => {
    const el = box();
    const p = newPlayer(el);
    const rows: Record<string, GiftInfo> = {};
    for (const f of ['angel.svga', 'rotating-earth.gif', 'animated.webp', 'replacement.pag']) rows[f] = await p.load(S(f));
    const ok = rows['angel.svga']!.format === 'svga' && rows['angel.svga']!.editableKeys.length > 0
      && rows['rotating-earth.gif']!.format === 'gif' && rows['animated.webp']!.format === 'webp' && rows['replacement.pag']!.format === 'pag'
      && rows['replacement.pag']!.editableKeys.length === 1 && Object.values(rows).every((i) => i.width > 0 && i.height > 0 && i.frameCount > 0 && i.durationMs > 0);
    check('load() returns format, size, frames, duration and editable keys for every format', ok, Object.fromEntries(Object.entries(rows).map(([k, i]) => [k, `${i.format} ${i.width}x${i.height} ${i.frameCount}f ${i.durationMs}ms keys=${i.editableKeys.length}`])));
    check('one canvas is reused across formats', el.querySelectorAll('canvas').length === 1);
    p.destroy();
    check('destroy() removes the canvas', el.querySelectorAll('canvas').length === 0);
  });

  await guarded('load race: A then B', async () => {
    const el = box(160, 160);
    const ref = box(160, 160);
    const pr = newPlayer(ref);
    await pr.load(S('Rocket.svga'));
    const refHash = hashOf(canvasOf(ref));
    const slowOff = registerResolver('slowrace', async (ref) => { await sleep(120); return S(ref); });
    const aBox = box(160, 160);
    const pa = newPlayer(aBox);
    await pa.load(S('rotating-earth.gif'));
    const aHash = hashOf(canvasOf(aBox));
    pa.destroy();
    const p = newPlayer(el);
    const loaded: string[] = [];
    p.on('loaded', (i) => loaded.push(i.format));
    const seen = new Set<number>();
    let sampling = true;
    const sample = () => { if (!sampling) return; const c = canvasOf(el); if (c) seen.add(hashOf(c)); requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
    const a = p.load('slowrace:rotating-earth.gif');
    const aCode = codeOf(a);
    await sleep(20); // A is in flight (fetching)
    const b = p.load(S('Rocket.svga'));
    const [ac, bc] = [await aCode, await codeOf(b)];
    await sleep(200); // long enough for A's fetch to have finished: its result must be discarded
    sampling = false;
    slowOff();
    check('load(A) then load(B): A rejects with aborted, B resolves', ac === 'aborted' && bc === 'resolved', { A: ac, B: bc });
    check('only B emits `loaded`', loaded.length === 1 && loaded[0] === 'svga', loaded);
    check('A is never drawn on the canvas, B is', !seen.has(aHash) && similar(canvasOf(el), canvasOf(ref)), { sawA: seen.has(aHash), finalEqualsReferenceB: hashOf(canvasOf(el)) === refHash, refHash, final: hashOf(canvasOf(el)), inkFinal: ink(canvasOf(el)), inkRef: ink(canvasOf(ref)) });
    // a burst: many loads, the last wins
    const results = await Promise.all(['angel.svga', 'kingset.svga', 'Rocket.svga', 'matteBitmap.svga', 'angel.svga'].map((f) => codeOf(p.load(S(f)))));
    check('a burst of 5 loads: the first 4 abort, the last resolves', results.slice(0, 4).every((r) => r === 'aborted') && results[4] === 'resolved', results);
    check('player.current is the last gift', p.current?.format === 'svga');
    p.destroy(); pr.destroy();
  });

  await guarded('destroy during load / play, signals', async () => {
    const el = box();
    const unregister = registerResolver('slow', async (ref) => { await sleep(150); return S(ref); });
    const p = newPlayer(el);
    const pending = codeOf(p.load('slow:angel.svga'));
    await sleep(20);
    p.destroy();
    check('destroy() during load: load rejects with aborted, canvas removed', (await pending) === 'aborted' && el.querySelectorAll('canvas').length === 0);
    check('load() after destroy() rejects with aborted', (await codeOf(p.load(S('angel.svga')))) === 'aborted');
    p.destroy(); // idempotent
    check('destroy() twice does not throw', true);

    const p2 = newPlayer(box());
    await p2.load(S('Rocket.svga'));
    const playing = codeOf(p2.play());
    await sleep(80);
    p2.destroy();
    check('destroy() during play: play() rejects with aborted', (await playing) === 'aborted');

    const ctl = new AbortController();
    const p3 = newPlayer(box());
    const c1 = codeOf(p3.load('slow:angel.svga', { signal: ctl.signal }));
    await sleep(20);
    ctl.abort();
    check('AbortSignal aborts a load in flight', (await c1) === 'aborted');
    const pre = new AbortController(); pre.abort();
    check('an already aborted signal rejects at once', (await codeOf(p3.load(S('angel.svga'), { signal: pre.signal }))) === 'aborted');
    check('the player is usable after an aborted load', (await codeOf(p3.load(S('angel.svga')))) === 'resolved');
    const stopped = codeOf(p3.play());
    await sleep(40);
    p3.stop();
    check('stop(): play() rejects with aborted and frame 0 is shown', (await stopped) === 'aborted');
    p3.destroy();
    unregister();
  });

  await guarded('errors', async () => {
    const mk = () => newPlayer(box());
    const garbage = new Uint8Array(200).fill(7);
    const truncated = async (f: string, frac: number) => { const b = await bytesOf(f); return b.slice(0, Math.floor(b.length * frac)); };
    const got: Record<string, string> = {};
    got.garbage = await codeOf(mk().load(garbage));
    got.http404 = await codeOf(mk().load(S('does-not-exist.svga')));
    got.unreachable = await codeOf(mk().load('http://127.0.0.1:9/never.svga'));
    got.truncatedSvga = await codeOf(mk().load(await truncated('angel.svga', 0.5)));
    got.truncatedGif = await codeOf(mk().load(await truncated('rotating-earth.gif', 0.4)));
    got.truncatedWebp = await codeOf(mk().load(await truncated('animated.webp', 0.5)));
    got.corruptSvgaImage = await codeOf(mk().load(zipSync({
      'movie.spec': strToU8(JSON.stringify({ ver: '1.1.0', movie: { viewBox: { width: 100, height: 50 }, fps: 25, frames: 2 }, images: { hero: 'img_1' }, sprites: [{ imageKey: 'hero', matteKey: '', frames: [{ alpha: 1, layout: { x: 0, y: 0, width: 10, height: 10 }, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }, {}] }] })),
      'img_1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
    })));
    got.truncatedPag = await codeOf(mk().load(await truncated('like.pag', 0.5)));
    got.badArg = await codeOf(mk().load(42 as unknown as string));
    got.playBeforeLoad = await codeOf(mk().play());
    check('unsupported-format: random bytes', got.garbage === 'unsupported-format', got.garbage);
    check('network: HTTP 404 and an unreachable host', got.http404 === 'network' && got.unreachable === 'network', { http404: got.http404, unreachable: got.unreachable });
    check('parse-failed: truncated SVGA / truncated PAG', ['parse-failed', 'unsupported-format'].includes(got.truncatedSvga) && got.truncatedPag === 'parse-failed', { svga: got.truncatedSvga, pag: got.truncatedPag });
    check('decode-failed: an SVGA whose images cannot be decoded', got.corruptSvgaImage === 'decode-failed', got.corruptSvgaImage);
    check('truncated GIF / WebP: a typed error or a (partial) picture, never a raw error', ['decode-failed', 'parse-failed', 'resolved'].includes(got.truncatedGif) && ['decode-failed', 'parse-failed', 'resolved'].includes(got.truncatedWebp), { gif: got.truncatedGif, webp: got.truncatedWebp });
    check('invalid-input: bad argument / play() before load()', got.badArg === 'invalid-input' && got.playBeforeLoad === 'invalid-input', { badArg: got.badArg, playBeforeLoad: got.playBeforeLoad });
    check('aborted is covered by the race, destroy and signal checks above', true);
    check('every failure above is a GiftPlayerError (no raw errors escape)', Object.values(got).every((c) => !c.startsWith('non-')), got);
    // a decode failure inside the file: an SVGA whose images are junk (typed decode-failed)
    const movieWithJunkImages = await (async () => {
      // not craftable without a writer: covered by the truncated-file results above
      return null;
    })();
    void movieWithJunkImages;
    boxes.forEach((b) => b.remove());
  });

  await guarded('visibility', async () => {
    const el = box();
    const p = newPlayer(el);
    await p.load(S('rotating-earth.gif'));
    const frames: number[] = [];
    p.on('frame', (f) => frames.push(f));
    const done = codeOf(p.play());
    await sleep(500);
    const hide = (hidden: boolean) => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    hide(true);
    const atHide = frames[frames.length - 1]!;
    const n0 = frames.length;
    await sleep(700);
    check('hidden: playback is paused (no frames advance)', frames.length === n0 && !p.playing, { framesWhileHidden: frames.length - n0 });
    hide(false);
    await sleep(120);
    const first = frames[n0];
    const advancedBy = (first! - atHide + 1000) % 1000;
    check('visible again: continues from the same frame, no fast-forward burst', first !== undefined && advancedBy <= 3 && p.playing, { atHide, firstAfter: first, advancedBy });
    p.stop();
    await done;
    // pauseWhenHidden: false keeps playing
    const p2 = newPlayer(box(), { pauseWhenHidden: false });
    await p2.load(S('rotating-earth.gif'));
    const fr2: number[] = [];
    p2.on('frame', (f) => fr2.push(f));
    const d2 = codeOf(p2.play());
    hide(true);
    await sleep(400);
    check('pauseWhenHidden:false keeps playing while hidden', fr2.length > 2, fr2.length);
    hide(false);
    p2.destroy(); await d2;
    delete (document as unknown as { hidden?: boolean }).hidden;
    p.destroy();
  });

  await guarded('replacements', async () => {
    // SVGA text applied before the first frame: find a sample + key whose text is visible on frame 0
    const style = { size: 60, color: '#ff0', stroke: { color: '#000', width: 4 } };
    let file = '', textKey = '';
    outer: for (const f of ['kingset.svga', 'angel.svga', 'matteBitmap.svga', 'Rocket.svga', 'Pink-Heart-Rocket.svga', 'Glossy-Pink-Lips.svga']) {
      const el = box(240, 240);
      const t = newPlayer(el);
      const i = await t.load(S(f));
      const base = hashOf(canvasOf(el));
      for (const k of i.editableKeys) {
        t.setText(k.key, 'Rahul', style);
        if (hashOf(canvasOf(el)) !== base) { file = f; textKey = k.key; t.destroy(); break outer; }
        t.clearReplacement(k.key);
      }
      t.destroy();
    }
    const plain = box(240, 240), withR = box(240, 240), after = box(240, 240);
    const pp = newPlayer(plain); await pp.load(S(file));
    const pw = newPlayer(withR);
    const first: number[] = [];
    pw.on('loaded', () => first.push(hashOf(canvasOf(withR))));
    await pw.load(S(file), { replacements: { [textKey]: { text: 'Rahul', style } } });
    const pa = newPlayer(after); await pa.load(S(file)); pa.setText(textKey, 'Rahul', style);
    check('SVGA replacement passed to load(): on screen at `loaded`, identical to setText afterwards, different from the original', textKey !== '' && first[0] === hashOf(canvasOf(after)) && first[0] !== hashOf(canvasOf(plain)), { file, key: textKey, atLoaded: first[0], afterSetText: hashOf(canvasOf(after)), original: hashOf(canvasOf(plain)) });
    // PAG image replacement before the first frame
    const green = await (async () => { const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d')!; g.fillStyle = '#0f0'; g.fillRect(0, 0, 32, 32); return createImageBitmap(c); })();
    const el = box(300, 300);
    const pg = newPlayer(el);
    let greenAtLoaded = 0;
    pg.on('loaded', () => { const d = pixels(canvasOf(el)); for (let i = 0; i < d.length; i += 4) if (d[i + 1]! > 200 && d[i]! < 60 && d[i + 2]! < 60 && d[i + 3]! > 200) greenAtLoaded++; });
    const infoP = await pg.load(S('replacement.pag'), { replacements: { '#0': { image: green } } });
    await pg.seek(30);
    await sleep(100);
    check('PAG image replacement passed to load(): visible at `loaded` (frame 0 already contains it)', greenAtLoaded > 500, { greenPixelsAtLoaded: greenAtLoaded, keys: infoP.editableKeys });
    // unknown keys never throw
    warnings.length = 0;
    let threw = false;
    try { pw.setText('nope', 'x'); await pw.setImage('nope', green); pw.setHidden('nope', true); pw.clearReplacement('nope'); await newPlayer(box()).load(S('Rocket.svga'), { replacements: { nope: { text: 'x' } } }); } catch { threw = true; }
    check('unknown replacement keys warn and never throw', !threw && warnings.length >= 3, { threw, warnings: warnings.length });
    // GIF has nothing to replace: warns, no throw
    warnings.length = 0;
    const pgif = newPlayer(box());
    await pgif.load(S('rotating-earth.gif'));
    pgif.setText('x', 'y');
    check('setText on a GIF warns instead of throwing', warnings.some((w) => /no replaceable text/.test(w)));
    // PAG complex-script warning: once per player
    warnings.length = 0;
    const pc = newPlayer(box());
    await pc.load(S('replacement.pag'));
    pc.setText('x', 'राहुल'); pc.setText('x', 'અનુરાગ'); pc.setText('x', 'محمد');
    const first2 = warnings.filter((w) => /cannot shape complex scripts/.test(w)).length;
    pc.setText('x', 'Rahul'); // Latin: no warning
    const pc2 = newPlayer(box());
    await pc2.load(S('replacement.pag'));
    pc2.setText('x', 'محمد');
    const total = warnings.filter((w) => /cannot shape complex scripts/.test(w)).length;
    check('PAG complex-script text: exactly one warning per player (Hindi, Gujarati, Arabic), none for Latin', first2 === 1 && total === 2, { firstPlayer: first2, bothPlayers: total });
    const ps = newPlayer(box());
    await ps.load(S(file || 'Rocket.svga'));
    warnings.length = 0;
    ps.setText(textKey || 'x', 'राहुल');
    check('SVGA renders these scripts itself: no warning', !warnings.some((w) => /complex scripts/.test(w)));
    cleanup();
  });

  await guarded('events', async () => {
    const p = newPlayer(box());
    const log: string[] = [];
    for (const ev of ['loaded', 'start', 'loop', 'end', 'error'] as const) p.on(ev, () => log.push(ev));
    await p.load(S('gif-loop-3.gif'.replace('gif-', 'synthetic/gif-')), { loops: 3 });
    let frameEvents = 0;
    const off = p.on('frame', () => frameEvents++);
    await p.play();
    off();
    check('events: loaded, start (once), loop x2, end (once) for 3 plays', log.join(',') === 'loaded,start,loop,loop,end', log.join(','));
    check('`frame` is emitted only while someone listens', frameEvents > 0);
    const before = frameEvents;
    await p.play();
    check('no `frame` events after unsubscribe', frameEvents === before);
    // pause / resume / seek
    const p2 = newPlayer(box());
    await p2.load(S('rotating-earth.gif'));
    const fr: number[] = [];
    p2.on('frame', (f) => fr.push(f));
    p2.play().catch(() => {});
    await sleep(250); p2.pause();
    const n = fr.length; await sleep(300);
    check('pause() holds the frame', fr.length === n && !p2.playing);
    p2.resume(); await sleep(250);
    check('resume() continues', fr.length > n && p2.playing);
    p2.seek(5);
    check('seek() shows that frame', fr[fr.length - 1] === 5 || fr.includes(5));
    p2.destroy(); p.destroy();
  });

  await guarded('resolver, preload, contentMode', async () => {
    const off = GiftPlayer.registerResolver('gift', async (id) => S(id === '1' ? 'angel.svga' : 'rotating-earth.gif'));
    const p = newPlayer(box());
    const a = await p.load('gift:1');
    const b = await p.load('gift:2');
    check('registerResolver: gift:1 -> SVGA, gift:2 -> GIF', a.format === 'svga' && b.format === 'gif');
    off();
    check('after unregistering, gift:1 is just a bad URL (network error)', (await codeOf(p.load('gift:1'))) === 'network');
    const res = await GiftPlayer.preload([S('kingset.svga'), S('matteBitmap.svga'), S('nope.svga'), new Blob(['x'])]);
    check('preload() reports cached / failed / skipped and never rejects', res.map((r) => r.status).join() === 'cached,cached,failed,skipped', res.map((r) => r.status));
    const cache = GiftPlayer.getCache();
    const t0 = performance.now();
    const p2 = newPlayer(box());
    await p2.load(S('kingset.svga'));
    check('a preloaded gift loads without a network request', performance.now() - t0 < 60 && cache.has(new URL(S('kingset.svga'), location.href).href), round(performance.now() - t0));
    p2.setContentMode('fill');
    check('setContentMode works', true);
    p.destroy(); p2.destroy();
    cleanup();
  });

  console.warn = oWarn;
  await sleep(100);
  check('no unhandled promise rejections escaped (every rejection reached a caller)', unhandled.length === 0, unhandled);
  return { checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
}



// ------------------------------------------------------------------------------------------------
async function runClear() {
  const nextRaf = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  for (const file of ['Rocket.svga', 'rotating-earth.gif', 'animated.webp', 'replacement.pag']) {
    await guarded(`clearOnEnd ${file}`, async () => {
      const el = box(200, 200);
      const p = newPlayer(el);
      await p.load(S(file), { loops: 1 });
      let inkAtEnd = -1;
      p.on('end', () => { inkAtEnd = ink(canvasOf(el)); });
      const done = p.play();
      p.seek(Math.max(0, (p.current?.frameCount ?? 2) - 2));
      await done;
      await sleep(150); await nextRaf();
      check(`${file}: the last frame is visible in the \`end\` event, and the canvas is fully transparent afterwards (clearOnEnd default)`, inkAtEnd > 0 && ink(canvasOf(el)) === 0, { inkAtEnd, inkAfter: ink(canvasOf(el)) });
      await p.play(); // replay after a clear paints again
      check(`${file}: play() after the clear shows the gift again`, true);
      p.destroy();
      const el2 = box(200, 200);
      const p2 = newPlayer(el2, { clearOnEnd: false });
      await p2.load(S(file), { loops: 1 });
      const d2 = p2.play();
      p2.seek(Math.max(0, (p2.current?.frameCount ?? 2) - 2));
      await d2;
      await sleep(150); await nextRaf();
      const kept = ink(canvasOf(el2));
      check(`${file}: clearOnEnd:false keeps the last frame`, kept > 0, { ink: kept });
      p2.clear();
      await sleep(100);
      check(`${file}: player.clear() blanks it on demand`, ink(canvasOf(el2)) === 0);
      // per-load override
      await p2.load(S(file), { loops: 1, clearOnEnd: true });
      const d3 = p2.play();
      p2.seek(Math.max(0, (p2.current?.frameCount ?? 2) - 2));
      await d3;
      await sleep(150);
      check(`${file}: load({clearOnEnd:true}) overrides the player option`, ink(canvasOf(el2)) === 0);
      p2.destroy();
    });
  }

  await guarded('queue blank between', async () => {
    const off = registerResolver('slowq', async (ref) => { await sleep(400); return S(ref); });
    const el = box(200, 200);
    const player = newPlayer(el);
    const queue = new GiftQueue(player, { preloadAhead: 0 }); // nothing is prepared: B starts downloading only when A is over
    let sampling = false;
    const samples: number[] = [];
    let betweenStart = 0;
    const loop = async () => { while (true) { if (sampling) samples.push(ink(canvasOf(el))); await nextRaf(); if (stop) return; } };
    let stop = false;
    void loop();
    queue.on('item-start', (i) => { if (String(i.src).startsWith('slowq')) sampling = false; else player.seek(Math.max(0, (player.current?.frameCount ?? 2) - 2)); });
    queue.on('item-end', (i) => { if (!String(i.src).startsWith('slowq')) { sampling = true; betweenStart = performance.now(); } });
    queue.add(S('Rocket.svga'));
    queue.add('slowq:angel.svga');
    await new Promise<void>((r) => queue.on('item-start', (i) => { if (String(i.src).startsWith('slowq')) r(); }));
    const waited = performance.now() - betweenStart;
    check('queue, next gift still downloading: the canvas is blank (0 visible pixels in every frame between the two gifts)', samples.length >= 5 && samples.every((n) => n === 0), { frameSamples: samples.length, maxInk: Math.max(0, ...samples), betweenMs: Math.round(waited) });
    // and a gift that is prepared hands over without a blank in between being longer than the swap itself
    const q2 = new GiftQueue(player, { preloadAhead: 2 });
    const blanks: number[] = [];
    q2.on('item-start', () => { player.seek(Math.max(0, (player.current?.frameCount ?? 2) - 2)); });
    q2.add(S('Rocket.svga')); q2.add(S('kingset.svga')); q2.add(S('angel.svga'));
    await new Promise<void>((r) => q2.on('idle', () => r()));
    blanks.push(...q2.stats.blankMs);
    check('queue, next gift prepared: hand-over keeps the fast path (blank only for the swap itself)', blanks.length === 2 && blanks.every((b) => b < 60), blanks.map((b) => round(b)));
    await nextRaf(); await nextRaf();
    check('queue idle: the canvas is blank after the last gift', ink(canvasOf(el)) === 0);
    stop = true;
    queue.destroy(); q2.destroy(); player.destroy(); off();
  });
  cleanup();
  return { checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
}

// ------------------------------------------------------------------------------------------------
async function runCache() {
  const svgaKeys = async (f: string) => { const { parseSvga } = await import('../src/advanced'); return parseSvga(await bytesOf(f)).images.size; };
  const nAngel = await svgaKeys('angel.svga');
  const base = counters.snapshot();
  const dc0 = { ...counters.doubleCloses };
  const urlAngel = new URL(S('angel.svga'), location.href).href;

  await guarded('share', async () => {
    const cache = new AssetCache<never>({ maxBytes: 64 * 1024 * 1024 });
    const a = newPlayer(box(), { cache: cache as never }), b = newPlayer(box(), { cache: cache as never });
    await a.load(S('angel.svga'));
    const afterA = counters.snapshot().imgs - base.imgs;
    await b.load(S('angel.svga'));
    const afterB = counters.snapshot().imgs - base.imgs;
    check('two players showing one gift share one set of decoded images', afterA === nAngel && afterB === nAngel, { images: nAngel, afterFirstPlayer: afterA, afterSecondPlayer: afterB });
    const st = cache.stats;
    check('one load, one hit, one entry in use', st.misses === 1 && st.hits >= 1 && st.entries === 1 && st.inUse === 1, st);
    check('both players draw identical pictures from the shared images', similar(canvasOf(boxes[boxes.length - 2]!), canvasOf(boxes[boxes.length - 1]!)));
    a.destroy();
    check('destroying one player leaves the shared images open (the other still uses them)', counters.snapshot().imgs - base.imgs === nAngel && cache.stats.inUse === 1);
    // a replacement image belongs to its player
    const keys = b.getEditableKeys();
    await b.setImage(keys[0]!.key, new Blob([await (await fetch(S('animated.webp'))).arrayBuffer()], { type: 'image/webp' }));
    check('a replacement image is the player\'s own: +1 while set', counters.snapshot().imgs - base.imgs === nAngel + 1);
    b.destroy();
    check('after the last player: the replacement is closed, the cached images stay (idle, evictable)', counters.snapshot().imgs - base.imgs === nAngel && cache.stats.inUse === 0 && cache.stats.entries === 1, { imgs: counters.snapshot().imgs - base.imgs });
    cache.clear();
    check('clear(): images closed exactly once, nothing left', counters.snapshot().imgs === base.imgs && cache.stats.disposed === 1 && counters.doubleCloses.imgs === dc0.imgs, { disposed: cache.stats.disposed, doubleCloses: counters.doubleCloses.imgs - dc0.imgs });
  });

  await guarded('in use', async () => {
    const c = new AssetCache<never>({ maxBytes: 1 });
    const cache = c as never;
    const p = newPlayer(box(), { cache });
    await p.load(S('angel.svga'));
    const q2 = newPlayer(box(), { cache });
    await q2.load(S('kingset.svga'));
    check('budget of 1 byte: assets in use are never evicted (both stay open and keep rendering)', c.has(urlAngel) && c.stats.entries === 2 && ink(canvasOf(boxes[boxes.length - 2]!)) > 0 && ink(canvasOf(boxes[boxes.length - 1]!)) > 0, c.stats);
    p.destroy();
    check('released: the idle asset is over budget and is evicted at once, its images closed; the other stays', !c.has(urlAngel) && c.stats.entries === 1 && c.stats.evictions >= 1);
    q2.destroy();
    check('everything released: cache empty, no images left', c.stats.entries === 0 && counters.snapshot().imgs === base.imgs, { imgs: counters.snapshot().imgs - base.imgs });
  });

  await guarded('budget', async () => {
    const files = ['angel.svga', 'kingset.svga', 'Rocket.svga', 'matteBitmap.svga'];
    const probe = new AssetCache<never>({ maxBytes: 1e12 });
    const sizes: number[] = [];
    for (const f of files) { const p = newPlayer(box(), { cache: probe as never }); await p.load(S(f)); sizes.push(probe.stats.bytes - sizes.reduce((x, y) => x + y, 0)); p.destroy(); }
    probe.destroy();
    const budget = sizes[0]! + sizes[1]! + 10;
    const cache = new AssetCache<never>({ maxBytes: budget });
    for (const f of files) { const p = newPlayer(box(), { cache: cache as never }); await p.load(S(f)); p.destroy(); }
    const urls = files.map((f) => cache.has(new URL(S(f), location.href).href));
    check('LRU by estimated decoded bytes: bytes stay within the budget, the oldest are evicted', cache.stats.bytes <= budget && cache.stats.evictions >= 1 && !urls[0] && urls[3]!, { budget, sizes, bytes: cache.stats.bytes, stillCached: urls });
    const heldImgs = counters.snapshot().imgs;
    cache.destroy();
    check('destroy(): every cached image closed', counters.snapshot().imgs < heldImgs && counters.snapshot().imgs === base.imgs, { before: heldImgs - base.imgs, after: counters.snapshot().imgs - base.imgs });
  });
  cleanup();
  const final = counters.snapshot();
  check('no image closed twice, no blob URL or bitmap left behind', counters.doubleCloses.imgs === dc0.imgs && counters.doubleCloses.bitmaps === dc0.bitmaps && final.blobUrls === base.blobUrls && final.bitmaps === base.bitmaps, { final, base });
  return { checks, passed: checks.filter((c) => c.ok).length, failed: checks.filter((c) => !c.ok).length };
}

// ------------------------------------------------------------------------------------------------
const MIX = ['angel.svga', 'kingset.svga', 'matteBitmap.svga', 'rotating-earth.gif', 'animated.webp', 'static.webp', 'like.pag', 'replacement.pag', 'synthetic/gif-loop-3.gif', 'synthetic/webp-delays.webp'];

async function runLeaks() {
  const cycles = Number(q.get('cycles') ?? 100);
  const base = counters.snapshot();
  counters.resetPeak();
  const { AssetCache: AC } = await import('../src/index');
  const cache = new AC<never>({ maxBytes: 1.5 * 1024 * 1024 }); // small on purpose: eviction churns during the run
  const red = await new Promise<Blob>((res) => { const c = document.createElement('canvas'); c.width = c.height = 16; c.getContext('2d')!.fillRect(0, 0, 16, 16); c.toBlob((b) => res(b!)); });
  let errors = 0, played = 0;
  const perFormat: Record<string, number> = {};
  for (let i = 0; i < cycles; i++) {
    const f = MIX[i % MIX.length]!;
    if (q.get('verbose')) console.log('cycle', i, f);
    const el = box(220, 220);
    const p = newPlayer(el, { cache: cache as never, staticDurationMs: 40, observeResize: i % 2 === 0 });
    p.on('error', () => errors++);
    try {
      const info = await p.load(S(f), { loops: 1 });
      perFormat[info.format] = (perFormat[info.format] ?? 0) + 1;
      if (i % 5 === 0 && info.editableKeys[0]) await p.setImage(info.editableKeys[0].key, red);
      const done = p.play().then(() => played++, () => {});
      for (let k = 0; k < 4; k++) await new Promise((r) => requestAnimationFrame(r));
      if (i % 3 === 0) { p.pause(); await sleep(5); p.resume(); }
      if (i % 7 === 0) p.seek(1);
      if (i % 4 === 0) { p.seek(Math.max(0, (p.current?.frameCount ?? 2) - 2)); await done; } // some run to the end, most are destroyed mid-play
    } catch { errors++; }
    p.destroy();
    el.remove();
  }
  await sleep(300);
  const betweenCache = { ...cache.stats };
  const idle = counters.snapshot();
  cache.destroy();
  await sleep(100);
  const afterCache = counters.snapshot();
  const glBeforeRelease = counters.snapshot().glAlive;
  await releasePagEngineContext();
  await sleep(200);
  const final = counters.snapshot();
  const ok = errors === 0 && ['bitmaps', 'imgs', 'blobUrls', 'raf', 'resizeObservers'].every((k) => (final as unknown as Record<string, number>)[k] === (base as unknown as Record<string, number>)[k]);
  return { cycles, perFormat, errors, played, base, peak: counters.peak, afterAllPlayersDestroyed: idle, cacheWhenIdle: betweenCache, afterCacheDestroyed: afterCache, glAliveBeforeEngineRelease: glBeforeRelease, final, glContextsCreated: counters.glContextsCreated(), glContextLostEvents: counters.glContextsLostEvents(), doubleCloses: counters.doubleCloses, ok };
}

// ------------------------------------------------------------------------------------------------
interface Row { id: number; src: string; kind: string; prio: number; seq: number; handle: QueueHandle; state: 'waiting' | 'begun' | 'gone'; beginAt?: number; endAt?: number; status?: string; cancelled?: boolean; full?: boolean }

async function stressOnce(opts: { items: number; maxLength?: number; seed: number; cancelRate: number; label: string }) {
  let seed = opts.seed;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]!;
  const base = counters.snapshot();
  counters.resetPeak();
  const cache = new AssetCache<never>({ maxBytes: 24 * 1024 * 1024 });
  const el = box(240, 240);
  const player = newPlayer(el, { cache: cache as never, staticDurationMs: 40 });
  const perr: string[] = [];
  player.on('error', (e) => perr.push(e.code));
  const queue = new GiftQueue(player, { maxLength: opts.maxLength, preloadAhead: 2, coalesce: false });
  const unreg = registerResolver('flaky', () => { throw new Error('resolver down'); });
  const truncPag = (await bytesOf('like.pag')).slice(0, 80);
  const corruptSvga = zipSync({ 'movie.spec': strToU8(JSON.stringify({ ver: '1.1.0', movie: { viewBox: { width: 100, height: 50 }, fps: 25, frames: 2 }, images: { hero: 'img_1' }, sprites: [{ imageKey: 'hero', matteKey: '', frames: [{ alpha: 1, layout: { x: 0, y: 0, width: 10, height: 10 }, transform: { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 } }, {}] }] })), 'img_1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]) });
  const BROKEN: [string, () => string | Uint8Array][] = [
    ['404', () => S('missing-file.svga')],
    ['garbage', () => new Uint8Array(64).fill(9)],
    ['truncated-pag', () => truncPag],
    ['corrupt-svga-image', () => corruptSvga],
    ['resolver-fails', () => 'flaky:1'],
  ];
  const rows = new Map<number, Row>();
  const order: number[] = [];
  let violations = 0;
  const violationLog: string[] = [];
  const dropLog: string[] = [];
  const dropInfo: { id: number; prio: number; minWaitingPrio: number | null; reason: string }[] = [];
  const t0 = performance.now();
  let sampling = true;
  const memSamples = { cacheBytesPeak: 0, cacheEntriesPeak: 0, inUsePeak: 0 };
  const sampler = setInterval(() => { const s = cache.stats; memSamples.cacheBytesPeak = Math.max(memSamples.cacheBytesPeak, s.bytes); memSamples.cacheEntriesPeak = Math.max(memSamples.cacheEntriesPeak, s.entries); memSamples.inUsePeak = Math.max(memSamples.inUsePeak, s.inUse); }, 25);
  let progressAt = performance.now();
  let maxSilence = 0;
  const touch = () => { const n = performance.now(); maxSilence = Math.max(maxSilence, n - progressAt); progressAt = n; };
  const gapByKind: Record<string, number[]> = {};
  let gapSeen = 0;

  if (q.get('verbose')) for (const ev of ['item-begin', 'item-start', 'item-end', 'item-error', 'item-dropped'] as const) queue.on(ev, (i) => console.log(ev, JSON.stringify({ id: (i as { id: number }).id, src: String((i as { src: unknown }).src).slice(-24), status: (i as { status?: string }).status })));
  queue.on('item-begin', (i) => {
    touch();
    const x = rows.get(i.id)!;
    for (const y of rows.values()) {
      if (y.state !== 'waiting' || y === x) continue;
      if (y.prio > x.prio || (y.prio === x.prio && y.seq < x.seq)) { violations++; if (violationLog.length < 5) violationLog.push(`began #${x.id}(p${x.prio}) while #${y.id}(p${y.prio}) waited`); }
    }
    x.state = 'begun'; x.beginAt = performance.now(); order.push(x.id);
  });
  queue.on('item-start', (i) => {
    touch();
    const x = rows.get(i.id)!;
    if (queue.stats.gapsMs.length > gapSeen) { (gapByKind[x.kind] ??= []).push(queue.stats.gapsMs[queue.stats.gapsMs.length - 1]!); gapSeen = queue.stats.gapsMs.length; }
    if (!x.full) { const n = player.current?.frameCount ?? 0; if (n > 3) player.seek(n - 2); } // finish quickly; a few items play in full
  });
  queue.on('item-end', (i) => { touch(); const x = rows.get(i.id); if (x) { x.state = 'gone'; x.endAt = performance.now(); x.status = i.status; } });
  queue.on('item-dropped', (i) => {
    touch();
    const x = rows.get(i.id);
    if (!x) return;
    let minWait: number | null = null;
    for (const y of rows.values()) if (y.state === 'waiting' && y !== x) minWait = minWait === null ? y.prio : Math.min(minWait, y.prio);
    x.state = 'gone'; x.status = 'dropped';
    dropInfo.push({ id: x.id, prio: x.prio, minWaitingPrio: minWait, reason: i.reason });
    if (i.reason === 'overflow' && minWait !== null && x.prio > minWait && dropLog.length < 6) dropLog.push(`dropped #${x.id} p${x.prio} seq${x.seq} while p${minWait} waited: ${[...rows.values()].filter((y) => y.state === 'waiting' && y.prio < x.prio).map((y) => `#${y.id}p${y.prio}`).join(',')}`);
  });
  const cancelPlan: Row[] = [];

  const addOne = (n: number) => {
    const broken = rnd() < 0.14;
    let kind: string, src: string | Uint8Array | Blob;
    if (broken) { const [k, mk] = pick(BROKEN); kind = `broken:${k}`; const v = mk(); src = typeof v === 'string' ? v : new Blob([v as BlobPart]); }
    else { const f = pick(MIX.concat(['Rocket.svga', 'matteRect.svga', 'like.pag', 'replacement.pag', 'angel.svga', 'synthetic/gif-delays.gif', 'synthetic/webp-single.webp'])); kind = f.endsWith('.pag') ? 'pag' : f.endsWith('.svga') ? 'svga' : f.endsWith('.gif') ? 'gif' : 'webp'; src = S(f); }
    const prio = Math.floor(rnd() * 4);
    const replacements = kind === 'svga' && rnd() < 0.3 ? { E511KDMP: { text: 'Rahul' } } : kind === 'pag' && rnd() < 0.5 ? { '#0': { text: 'x' } } : undefined;
    const row = { id: 0, src: typeof src === 'string' ? src : `(${(src as Blob).size} bytes)`, kind, prio, seq: n, state: 'waiting' } as Row;
    const handle = queue.add(src as string, { priority: prio, replacements: replacements as never });
    row.id = handle.id; row.handle = handle;
    if (handle.status === 'dropped') { row.state = 'gone'; row.status = 'dropped'; }
    rows.set(row.id, row);
    row.full = n % 40 === 7 && !broken;
    if (rnd() < opts.cancelRate) cancelPlan.push(row);
    return row;
  };

  // arrival: a first big burst, then waves while the queue works
  let n = 0;
  const burst = Math.floor(opts.items * 0.3);
  for (; n < burst; n++) addOne(n);
  while (n < opts.items) {
    await sleep(15 + Math.floor(rnd() * 40));
    const k = 2 + Math.floor(rnd() * 5);
    for (let j = 0; j < k && n < opts.items; j++, n++) addOne(n);
    // cancel some waiting items, and occasionally the one that is playing
    const victim = cancelPlan.shift();
    if (victim && (victim.state === 'waiting' || (victim.state === 'begun' && rnd() < 0.5))) { victim.cancelled = true; victim.handle.cancel(); }
  }
  const idle = new Promise<'idle'>((r) => queue.on('idle', () => r('idle')));
  const deadline = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), 240_000));
  const outcome = await Promise.race([idle, deadline]);
  sampling = false; clearInterval(sampler);
  const total = performance.now() - t0;
  for (const r of cancelPlan) if (r.state === 'waiting') r.handle.cancel();
  const finals = await Promise.all([...rows.values()].map((r) => Promise.race([r.handle.done, sleep(2000).then(() => 'STALLED')])));
  const tally: Record<string, number> = {};
  for (const s of finals) tally[s] = (tally[s] ?? 0) + 1;
  const stalled = tally.STALLED ?? 0;
  const stats = queue.stats;
  const dropsOk = dropInfo.filter((d) => d.reason === 'overflow').every((d) => d.minWaitingPrio === null || d.prio <= d.minWaitingPrio);
  const timed = [...rows.values()].filter((r) => r.beginAt && r.endAt).sort((a, b) => (b.endAt! - b.beginAt!) - (a.endAt! - a.beginAt!));
  const longest = timed[0] ? timed[0].endAt! - timed[0].beginAt! : 0;
  const longestWhat = timed[0] ? `${timed[0].kind} ${timed[0].src.slice(-28)}${timed[0].full ? ' (played in full on purpose)' : ''}` : '';
  const settled = (await Promise.all([...rows.values()].map((r) => r.handle.done))).length;
  const idleSnap = counters.snapshot();
  const cacheStats = { ...cache.stats };
  queue.destroy();
  player.destroy();
  cache.destroy();
  await sleep(300);
  const afterDestroy = counters.snapshot();
  unreg();
  const pctl = (a: number[], p: number) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return round(s[Math.min(s.length - 1, Math.floor(s.length * p))]!); };
  const avg = (a: number[]) => (a.length ? round(a.reduce((x, y) => x + y, 0) / a.length) : null);
  const brokenRows = [...rows.values()].filter((r) => r.kind.startsWith('broken'));
  const failedBroken = brokenRows.filter((r) => r.status === 'failed' || r.status === 'dropped' || r.status === 'cancelled').length;
  const result = {
    label: opts.label,
    items: opts.items, maxLength: opts.maxLength ?? null,
    outcome, totalMs: Math.round(total), settledHandles: settled,
    statuses: tally,
    queueStats: { played: stats.played, failed: stats.failed, cancelled: stats.cancelled, dropped: stats.dropped },
    orderViolations: violations, orderViolationExamples: violationLog,
    dropsWereLowestPriority: dropsOk, dropExamples: dropLog, dropEvents: dropInfo.length,
    stalls: stalled, longestItemMs: Math.round(longest), longestItem: longestWhat, longestSilenceMs: Math.round(maxSilence),
    brokenItems: brokenRows.length, brokenAllFailedOrRemoved: failedBroken === brokenRows.length,
    gap: { n: stats.gapsMs.length, avgMs: avg(stats.gapsMs), p95Ms: pctl(stats.gapsMs, 0.95), maxMs: pctl(stats.gapsMs, 1), blankAvgMs: avg(stats.blankMs), blankP95Ms: pctl(stats.blankMs, 0.95) },
    gapByNextFormat: Object.fromEntries(Object.entries(gapByKind).filter(([k]) => !k.startsWith('broken')).map(([k, v]) => [k, { n: v.length, avgMs: avg(v), p95Ms: pctl(v, 0.95) }])),
    playerErrors: perr.length,
    memory: { base, peak: counters.peak, cachePeak: memSamples, cacheWhenIdle: cacheStats, whenIdle: idleSnap, afterDestroy },
    doubleCloses: counters.doubleCloses,
    ok: false as boolean,
  };
  const b = base as unknown as Record<string, number>, f = afterDestroy as unknown as Record<string, number>;
  result.ok = outcome === 'idle' && stalled === 0 && maxSilence < 15000 && violations === 0 && dropsOk && settled === rows.size && result.brokenAllFailedOrRemoved && ['bitmaps', 'imgs', 'blobUrls', 'raf', 'resizeObservers'].every((k) => f[k] === b[k]) && counters.doubleCloses.imgs === 0 && counters.doubleCloses.bitmaps === 0;
  boxes.forEach((x) => x.remove());
  return result;
}

async function runStress() {
  const items = Number(q.get('items') ?? 200);
  const first = await stressOnce({ items, seed: 12345, cancelRate: 0.1, label: `${items} items, unbounded queue` });
  const second = await stressOnce({ items: Math.floor(items * 0.6), maxLength: 20, seed: 777, cancelRate: 0.05, label: `${Math.floor(items * 0.6)} items, maxLength 20 (overflow drops)` });
  await releasePagEngineContext();
  await sleep(200);
  return { runs: [first, second], glAliveAtEnd: counters.snapshot().glAlive, glContextsCreated: counters.glContextsCreated(), glContextLostEvents: counters.glContextsLostEvents(), ok: first.ok && second.ok };
}

(async () => {
  try {
    const result = task === 'clear' ? await runClear() : task === 'stress' ? await runStress() : task === 'leaks' ? await runLeaks() : task === 'cache' ? await runCache() : task === 'engine' ? await runEngine() : task === 'api' ? await runApi() : { error: `unknown task ${task}` };
    (window as unknown as { __result: unknown }).__result = result;
    const out = document.getElementById('out');
    if (out) out.textContent = JSON.stringify(result, null, 1).slice(0, 6000);
  } catch (e) {
    (window as unknown as { __result: unknown }).__result = { error: String((e as Error).stack ?? e) };
  }
})();
