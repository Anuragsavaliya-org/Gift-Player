import { detectFormat } from '../src/core/detect';
import { resolveLoops } from '../src/core/frame-source';
import { Ticker } from '../src/core/ticker';
import { AnimatedImageRenderer } from '../src/formats/image';
import { decodeSvgaImages, parseSvga } from '../src/formats/svga';
import type { PagRenderer } from '../src/formats/pag';
import { SvgaRenderer, type ContentMode } from '../src/formats/svga/render/renderer';
import type { SvgaMovie } from '../src/formats/svga/types';
import { pixelDiff } from './lib/diff';
import { createOracle, type Oracle, type OracleMode } from './lib/oracle';
import { sampleBytes, sampleNames, sampleUrl } from './lib/samples';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const sampleSel = $<HTMLSelectElement>('sample');
const modeSel = $<HTMLSelectElement>('mode');
const keySel = $<HTMLSelectElement>('key');
const scrub = $<HTMLInputElement>('scrub');
const playBtn = $<HTMLButtonElement>('play');
const diffEl = $('diff');
const mineCanvas = $<HTMLCanvasElement>('mine');
const pathSel = $<HTMLSelectElement>('path');

const MODES: Record<string, OracleMode> = { fill: 'Fill', aspectFit: 'AspectFit', aspectFill: 'AspectFill' };

let imageRenderer: AnimatedImageRenderer | null = null;
let pagRenderer: PagRenderer | null = null;
let pagSize: { width: number; height: number } | null = null;
let pagRef: { destroy(): void } | null = null;
let renderer: SvgaRenderer | null = null;
let oracle: Oracle | null = null;
let ticker: Ticker | null = null;
let movie: SvgaMovie | null = null;
let bytes: Uint8Array | null = null;
let objectUrl: string | null = null;
let frame = 0;

for (const n of sampleNames) sampleSel.append(new Option(n, n));
// GIF / WebP samples (synthetic, real and corpus) come from the dev server's folder listing.
for (const dir of ['', 'synthetic', 'corpus']) {
  try {
    const names: string[] = await (await fetch(`/__list/${dir}`)).json();
    for (const n of names.filter((f) => /\.(gif|webp|pag)$/i.test(f))) sampleSel.append(new Option(dir ? `${dir}/${n}` : n, dir ? `${dir}/${n}` : n));
  } catch { /* listing is a dev-server convenience */ }
}
sampleSel.append(new Option('(dropped file)', ''));
const isImageName = (n: string) => /\.(gif|webp|pag)$/i.test(n); // fetched straight from /samples (not SVGA)
const PAG_URLS = { pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__libpag/libpag.wasm' }; // dev: local copy of the pinned engine
const keyList = $('keyList');
const showKeys = (keys: { key: string; type: string; name?: string }[]) => {
  keyList.textContent = keys.length ? `editable keys (getEditableKeys): ${keys.map((k) => `${k.key} [${k.type}${k.name ? `, "${k.name}"` : ''}]`).join(' · ')}` : 'editable keys: none';
};

function teardown(): void {
  ticker?.destroy();
  imageRenderer?.destroy();
  imageRenderer = null;
  pagRef?.destroy();
  pagRef = null;
  pagRenderer?.destroy();
  pagRenderer = null;
  keyList.textContent = '';
  pagSize = null;
  $('refBox').replaceChildren();
  $('info').textContent = '';
  $('replaceBox').hidden = false;
  $('mineTitle').textContent = 'this SDK (SvgaRenderer)';
  $('refTitle').textContent = 'svgaplayerweb (reference)';
  renderer?.destroy();
  oracle?.destroy();
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  ticker = renderer = oracle = movie = null;
  objectUrl = null;
}

async function open(data: Uint8Array, url: string): Promise<void> {
  $('error').textContent = '';
  teardown();
  bytes = data;
  if (url.startsWith('blob:')) objectUrl = url; // revoked on the next teardown
  try {
    const kind = detectFormat(data);
    if (kind.format === 'gif' || kind.format === 'webp') return await openImage(data);
    if (kind.format === 'pag') return await openPag(data);
    movie = parseSvga(data);
    const { bitmaps } = await decodeSvgaImages(movie);
    const w = movie.viewBox.width;
    const h = movie.viewBox.height;
    for (const id of ['mineBox', 'refBox']) {
      $(id).style.width = `${w}px`;
      $(id).style.height = `${h}px`;
    }
    mineCanvas.style.cssText = `width:${w}px;height:${h}px;display:block`;
    // dpr 1 on purpose: the reference draws at CSS pixels, so the diff compares like with like.
    renderer = new SvgaRenderer(mineCanvas, movie, bitmaps, { contentMode: modeSel.value as ContentMode, devicePixelRatio: 1 });
    oracle = await createOracle($('refBox') as HTMLDivElement, url, MODES[modeSel.value]);
    applyZoom();
    scrub.max = String(movie.frames - 1);
    const keys = renderer.getEditableKeys();
    keySel.replaceChildren(...keys.map((k) => new Option(k.key, k.key)));
    showKeys(keys);
    ticker = new Ticker({ fps: movie.fps, frames: movie.frames, loops: 0, onFrame: (f) => show(f, true) });
    show(0, false);
  } catch (e) {
    $('error').textContent = `${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`;
  }
}

/** GIF / WebP: our renderer next to the browser's own <img>. */
async function openImage(data: Uint8Array): Promise<void> {
  const mime = detectFormat(data).format === 'gif' ? 'image/gif' : 'image/webp';
  const native = new Image();
  native.src = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  await native.decode();
  const w = native.naturalWidth;
  const h = native.naturalHeight;
  for (const id of ['mineBox', 'refBox']) {
    $(id).style.width = `${w}px`;
    $(id).style.height = `${h}px`;
  }
  mineCanvas.style.cssText = `width:${w}px;height:${h}px;display:block`;
  native.style.cssText = `width:${w}px;height:${h}px;display:block`;
  $('refBox').append(native);
  imageRenderer = await AnimatedImageRenderer.create(mineCanvas, data, { path: pathSel.value as 'auto', contentMode: modeSel.value as ContentMode, devicePixelRatio: 1 });
  const r = imageRenderer;
  const total = Array.from({ length: r.frameCount }, (_, i) => r.frameDuration(i)).reduce((a, b) => a + b, 0);
  const plays = resolveLoops(undefined, r);
  $('mineTitle').textContent = `this SDK (AnimatedImageRenderer, path: ${r.path})`;
  $('refTitle').textContent = 'browser native <img> (animates on its own, not synchronised)';
  $('info').textContent = `${r.format.toUpperCase()} ${w}x${h} · ${r.frameCount} frame(s) · ${Math.round(total)} ms per play · ${plays === 0 ? 'loops forever' : `${plays} play(s)`} (file says ${r.loopCount === null ? 'nothing' : r.loopCount === 0 ? 'forever' : r.loopCount}) · path: ${r.path} (${r.pathReason})`;
  $('replaceBox').hidden = true;
  scrub.max = String(r.frameCount - 1);
  ticker = new Ticker({
    frames: r.frameCount,
    frameDuration: (i) => r.frameDuration(i),
    loops: plays,
    onFrame: (f) => show(f, true),
    onEnd: () => { playBtn.textContent = 'Play'; },
  });
  show(0, false);
}

/** PAG: lazy-loaded engine ("PAG engine loading…"), our renderer next to libpag's own player on the same file. */
async function openPag(data: Uint8Array): Promise<void> {
  $('info').textContent = 'PAG engine loading…';
  $('mineTitle').textContent = 'this SDK (PagRenderer: Ticker + libpag setProgress)';
  $('refTitle').textContent = 'libpag PAGView with its own loop (reference)';
  const { PagRenderer: Pag } = await import('../src/formats/pag');
  // Probe the size first so the box fits the file.
  const probe = document.createElement('canvas');
  const sizer = await Pag.create(probe, data, { devicePixelRatio: 1, observeResize: false, ...PAG_URLS });
  const { width: w, height: h } = sizer.size;
  pagSize = { width: w, height: h };
  sizer.destroy();
  await sizer.disposed;
  for (const id of ['mineBox', 'refBox']) {
    $(id).style.width = `${w}px`;
    $(id).style.height = `${h}px`;
  }
  mineCanvas.style.cssText = `width:${w}px;height:${h}px;display:block`;
  pagRenderer = await Pag.create(mineCanvas, data, { contentMode: modeSel.value as ContentMode, devicePixelRatio: 1, ...PAG_URLS });
  const r = pagRenderer;
  applyZoom();
  const PAG = r.internals.PAG;
  const refCanvas = document.createElement('canvas');
  refCanvas.width = w;
  refCanvas.height = h;
  refCanvas.style.cssText = `width:${w}px;height:${h}px;display:block`;
  $('refBox').append(refCanvas);
  const refFile = await PAG.PAGFile.load(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer);
  // libpag's own player (its loop, not our Ticker); typed loosely because the SDK's adapter types only what it uses.
  const refView = (await PAG.PAGView.init(refFile, refCanvas, { useCanvas2D: true, useScale: false, firstFrame: true }))! as unknown as { destroy(): void; setScaleMode(m: number): void; setRepeatCount(n: number): void; play(): Promise<void> };
  refView.setScaleMode(2);
  refView.setRepeatCount(0);
  await refView.play();
  pagRef = { destroy: () => { refView.destroy(); refFile.destroy(); refCanvas.remove(); } };
  const plays = resolveLoops(undefined, r);
  const keys = r.getEditableKeys();
  keySel.replaceChildren(...keys.map((k) => new Option(`${k.key} (${k.type})`, k.key)));
  showKeys(keys);
  $('info').textContent = `PAG ${w}x${h} · ${r.frameCount} frame(s) @ ${(1000 / r.frameDuration()).toFixed(2)} fps · ${Math.round(r.frameCount * r.frameDuration())} ms per play · ${plays === 0 ? 'loops forever' : `${plays} play(s)`} · engine loaded in ${Math.round(r.engineLoadMs)} ms`;
  $('replaceBox').hidden = false;
  scrub.max = String(r.frameCount - 1);
  ticker = new Ticker({
    frames: r.frameCount,
    frameDuration: () => r.frameDuration(),
    loops: plays,
    onFrame: (f) => show(f, true),
    onEnd: () => { playBtn.textContent = 'Play'; },
  });
  show(0, false);
}

function show(f: number, playing: boolean): void {
  if (pagRenderer) {
    frame = f;
    pagRenderer.drawFrame(f);
    scrub.value = String(f);
    $('frameLabel').textContent = `frame ${f} / ${pagRenderer.frameCount - 1}`;
    diffEl.textContent = 'n/a: libpag renders on its own clock (frame accuracy is checked by scripts/verify-pag.mjs)';
    return;
  }
  if (imageRenderer) {
    frame = f;
    imageRenderer.drawFrame(f);
    scrub.value = String(f);
    $('frameLabel').textContent = `frame ${f} / ${imageRenderer.frameCount - 1} (${Math.round(imageRenderer.frameDuration(f))} ms)`;
    diffEl.textContent = 'n/a: the native <img> cannot be sampled per frame';
    return;
  }
  if (!renderer || !oracle) return;
  frame = f;
  renderer.drawFrame(f);
  oracle.draw(f);
  scrub.value = String(f);
  $('frameLabel').textContent = `frame ${f} / ${movie!.frames - 1}`;
  if (!playing || f % 15 === 0) updateDiff();
}

function updateDiff(): void {
  if (!renderer || !oracle || oracle.canvas.width !== mineCanvas.width || oracle.canvas.height !== mineCanvas.height) {
    diffEl.textContent = 'sizes differ';
    return;
  }
  const d = pixelDiff(mineCanvas, oracle.canvas, 10);
  diffEl.textContent = `${d.percent.toFixed(3)} % of canvas · ${d.percentOfActive.toFixed(2)} % of drawn pixels`;
  diffEl.classList.toggle('bad', d.percent > 2);
}

function applyZoom(): void {
  const z = Number($<HTMLInputElement>('zoom').value);
  const size = movie?.viewBox ?? pagSize;
  if (!size) return;
  for (const [view, box] of [['mineView', 'mineBox'], ['refView', 'refBox']] as const) {
    $(box).style.transform = `scale(${z})`;
    $(view).style.width = `${size.width * z}px`;
    $(view).style.height = `${size.height * z}px`;
  }
}

const loadAny = async (name: string): Promise<[Uint8Array, string]> => {
  if (isImageName(name)) {
    const data = new Uint8Array(await (await fetch(`/samples/${name}`)).arrayBuffer());
    return [data, `/samples/${name}`];
  }
  return [await sampleBytes(name), await sampleUrl(name)];
};
sampleSel.addEventListener('change', async () => {
  if (sampleSel.value) await open(...(await loadAny(sampleSel.value)));
});
pathSel.addEventListener('change', async () => {
  if (bytes && imageRenderer) await open(bytes, '');
});
modeSel.addEventListener('change', async () => {
  if (!bytes) return;
  if (imageRenderer) {
    imageRenderer.setContentMode(modeSel.value as ContentMode);
    return;
  }
  if (pagRenderer) {
    pagRenderer.setContentMode(modeSel.value as ContentMode);
    return;
  }
  if (!movie) return;
  // The reference only takes its mode before setVideoItem, so reload both sides.
  const url = sampleSel.value ? await sampleUrl(sampleSel.value) : URL.createObjectURL(new Blob([bytes as BlobPart]));
  await open(bytes, url);
});
$('zoom').addEventListener('input', applyZoom);
scrub.addEventListener('input', () => { ticker?.pause(); playBtn.textContent = 'Play'; ticker?.seek(Number(scrub.value)); });
playBtn.addEventListener('click', () => {
  if (!ticker) return;
  if (ticker.playing) { ticker.pause(); playBtn.textContent = 'Play'; updateDiff(); }
  else { ticker.seek(frame); ticker.play(); playBtn.textContent = 'Pause'; }
});
$('diffNow').addEventListener('click', updateDiff);

// drag & drop a file
const drop = $('drop');
drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (!file) return;
  sampleSel.value = '';
  const data = new Uint8Array(await file.arrayBuffer());
  await open(data, URL.createObjectURL(new Blob([data as BlobPart])));
});

// dynamic replacement demo
$('applyText').addEventListener('click', () => {
  const text = $<HTMLInputElement>('text').value;
  pagRenderer?.setText(keySel.value, text, { color: $<HTMLInputElement>('color').value, size: Number($<HTMLInputElement>('size').value) });
  renderer?.setText(keySel.value, text, { color: $<HTMLInputElement>('color').value, size: Number($<HTMLInputElement>('size').value), stroke: { color: '#000', width: 3 } });
  updateDiff();
});
$('img').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) await pagRenderer?.setImage(keySel.value, file, { fit: $<HTMLSelectElement>('fit').value as 'fill' | 'cover' | 'contain' });
  if (file) await renderer?.setImage(keySel.value, file, { fit: $<HTMLSelectElement>('fit').value as 'fill' | 'cover' | 'contain' });
});
$('hide').addEventListener('change', (e) => { pagRenderer?.setHidden(keySel.value, (e.target as HTMLInputElement).checked); renderer?.setHidden(keySel.value, (e.target as HTMLInputElement).checked); });
$('clear').addEventListener('click', () => { pagRenderer?.clearReplacement(keySel.value); renderer?.clearReplacement(keySel.value); $<HTMLInputElement>('hide').checked = false; });

const wanted = new URLSearchParams(location.search).get('sample');
const known = [...sampleSel.options].map((o) => o.value);
sampleSel.value = wanted && known.includes(wanted) ? wanted : sampleNames[0]!;
await open(...(await loadAny(sampleSel.value)));

// Scripted shots: ?frame=40&key=xin02&text=Rahul
function scriptedShot(): void {
  const params = new URLSearchParams(location.search);
  if (params.get('key') && params.get('text')) {
    keySel.value = params.get('key')!;
    renderer?.setText(keySel.value, params.get('text')!, { color: '#ffffff', size: 40, stroke: { color: '#000', width: 3 } });
  }
  if (params.get('frame')) ticker?.seek(Number(params.get('frame')));
}
scriptedShot();
