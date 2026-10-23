import { Ticker } from '../src/core/ticker';
import { decodeSvgaImages, parseSvga } from '../src/formats/svga';
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

const MODES: Record<string, OracleMode> = { fill: 'Fill', aspectFit: 'AspectFit', aspectFill: 'AspectFill' };

let renderer: SvgaRenderer | null = null;
let oracle: Oracle | null = null;
let ticker: Ticker | null = null;
let movie: SvgaMovie | null = null;
let bytes: Uint8Array | null = null;
let objectUrl: string | null = null;
let frame = 0;

for (const n of sampleNames) sampleSel.append(new Option(n, n));
sampleSel.append(new Option('(dropped file)', ''));

function teardown(): void {
  ticker?.destroy();
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
    keySel.replaceChildren(...[...new Set(movie.sprites.filter((s) => !s.isMatte).map((s) => s.imageKey))].map((k) => new Option(k, k)));
    ticker = new Ticker({ fps: movie.fps, frames: movie.frames, loops: 0, onFrame: (f) => show(f, true) });
    show(0, false);
  } catch (e) {
    $('error').textContent = `${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`;
  }
}

function show(f: number, playing: boolean): void {
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
  if (!movie) return;
  for (const [view, box] of [['mineView', 'mineBox'], ['refView', 'refBox']] as const) {
    $(box).style.transform = `scale(${z})`;
    $(view).style.width = `${movie.viewBox.width * z}px`;
    $(view).style.height = `${movie.viewBox.height * z}px`;
  }
}

sampleSel.addEventListener('change', async () => {
  if (sampleSel.value) await open(await sampleBytes(sampleSel.value), await sampleUrl(sampleSel.value));
});
modeSel.addEventListener('change', async () => {
  if (!bytes || !movie) return;
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
  renderer?.setText(keySel.value, text, { color: $<HTMLInputElement>('color').value, size: Number($<HTMLInputElement>('size').value), stroke: { color: '#000', width: 3 } });
  updateDiff();
});
$('img').addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) await renderer?.setImage(keySel.value, file, { fit: $<HTMLSelectElement>('fit').value as 'fill' | 'cover' | 'contain' });
});
$('hide').addEventListener('change', (e) => renderer?.setHidden(keySel.value, (e.target as HTMLInputElement).checked));
$('clear').addEventListener('click', () => { renderer?.clearReplacement(keySel.value); $<HTMLInputElement>('hide').checked = false; });

const wanted = new URLSearchParams(location.search).get('sample');
sampleSel.value = wanted && sampleNames.includes(wanted) ? wanted : sampleNames[0]!;
await open(await sampleBytes(sampleSel.value), await sampleUrl(sampleSel.value));

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
