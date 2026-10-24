import { strToU8, zipSync } from 'fflate';
import { AssetCache, GiftPlayer, GiftQueue, type QueueHandle } from '../src/index';
import { installCounters } from './lib/counters';

const counters = installCounters();
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const PAG_URLS = { pagModuleUrl: '/__libpag/libpag.esm.js', pagWasmUrl: '/__libpag/libpag.wasm' };
const GIFTS = ['angel.svga', 'kingset.svga', 'Rocket.svga', 'matteBitmap.svga', 'rotating-earth.gif', 'animated.webp', 'synthetic/gif-delays.gif', 'like.pag', 'replacement.pag'];
const corrupt = zipSync({ 'movie.spec': strToU8(JSON.stringify({ ver: '1.1.0', movie: { viewBox: { width: 100, height: 50 }, fps: 25, frames: 2 }, images: { a: 'img_1' }, sprites: [{ imageKey: 'a', matteKey: '', frames: [{ alpha: 1 }, {}] }] })), 'img_1.png': Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 1, 2, 3]) });
const BROKEN: (() => string | Blob)[] = [() => '/samples/missing.svga', () => new Blob([new Uint8Array(64).fill(9)]), () => new Blob([corrupt as BlobPart])];

const cache = new AssetCache<never>({ maxBytes: 32 * 1024 * 1024 });
let player: GiftPlayer | null = null;
let queue: GiftQueue | null = null;
let timer = 0;
let sent = 0;
const waiting = new Map<number, string>();

function log(msg: string): void {
  const el = $('log');
  el.textContent = `${new Date().toLocaleTimeString()}  ${msg}\n${el.textContent}`.slice(0, 4000);
}

function build(): void {
  queue?.destroy();
  player?.destroy();
  $('badge').textContent = '';
  player = new GiftPlayer($('stage'), { cache: cache as never, staticDurationMs: 800, ...PAG_URLS });
  player.on('error', (e) => log(`player error: ${e.code}`));
  queue = new GiftQueue(player, { maxLength: Number($<HTMLInputElement>('maxLength').value), preloadAhead: Number($<HTMLInputElement>('ahead').value), coalesce: $<HTMLInputElement>('coalesce').checked });
  queue.on('item-start', (i) => { $('badge').textContent = i.count > 1 ? `x${i.count}` : ''; log(`start  #${i.id} ${String(i.src).slice(-26)} (p${i.priority}, x${i.count})`); });
  queue.on('item-end', (i) => { if (i.status !== 'done') log(`end    #${i.id} ${i.status}`); waiting.delete(i.id); });
  queue.on('item-begin', (i) => waiting.delete(i.id));
  queue.on('item-error', (i) => log(`ERROR  #${i.id} ${String(i.src).slice(-26)} -> ${i.error.code}`));
  queue.on('item-dropped', (i) => { waiting.delete(i.id); log(`dropped #${i.id} (${i.reason})`); });
  queue.on('idle', () => { $('badge').textContent = ''; log('queue idle'); });
}

function send(): QueueHandle | undefined {
  if (!queue) return;
  const p = $<HTMLSelectElement>('prio').value;
  const priority = p === 'random' ? Math.floor(Math.random() * 4) : Number(p);
  const broken = Math.random() * 100 < Number($<HTMLInputElement>('broken').value);
  const file = $<HTMLInputElement>('same').checked ? GIFTS[0]! : GIFTS[Math.floor(Math.random() * GIFTS.length)]!;
  const name = $<HTMLInputElement>('name').value;
  const src = broken ? BROKEN[Math.floor(Math.random() * BROKEN.length)]!() : `/samples/${file}`;
  const replacements = !broken && name && /\.(svga)$/.test(file) ? { E511KDMP: { text: name } } : undefined;
  const h = queue.add(src, { priority, replacements, loops: 1 });
  sent++;
  if (h.status === 'pending') waiting.set(h.id, `${broken ? '(broken) ' : ''}${typeof src === 'string' ? src.slice(-24) : 'blob'} p${priority}`);
  return h;
}

const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
const pct = (a: number[], p: number) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))]!.toFixed(1) : '-');
function render(): void {
  if (!queue) return;
  const s = queue.stats;
  const c = counters.snapshot();
  const cs = cache.stats;
  const avg = s.gapsMs.length ? (s.gapsMs.reduce((a, b) => a + b, 0) / s.gapsMs.length).toFixed(1) : '-';
  const rows: [string, string][] = [
    ['sent', String(sent)], ['waiting', String(queue.length)], ['playing', queue.isPlaying ? 'yes' : 'no'],
    ['played / failed', `${s.played} / ${s.failed}`], ['cancelled / dropped', `${s.cancelled} / ${s.dropped}`],
    ['gap between gifts avg / p95 (ms)', `${avg} / ${pct(s.gapsMs, 0.95)}`], ['blank canvas avg / p95 (ms)', `${s.blankMs.length ? (s.blankMs.reduce((a, b) => a + b, 0) / s.blankMs.length).toFixed(1) : '-'} / ${pct(s.blankMs, 0.95)}`],
    ['cache', `${mb(cs.bytes)} of ${mb(cs.maxBytes)}, ${cs.entries} gifts, ${cs.inUse} in use, ${cs.evictions} evicted`],
    ['open <img> / bitmaps / blob URLs', `${c.imgs} / ${c.bitmaps} / ${c.blobUrls}`], ['WebGL contexts alive', String(c.glAlive)], ['rAF / ResizeObservers', `${c.raf} / ${c.resizeObservers}`],
  ];
  $('counters').replaceChildren(...rows.map(([k, v]) => { const tr = document.createElement('tr'); const th = document.createElement('th'); th.textContent = k; const td = document.createElement('td'); td.textContent = v; tr.append(th, td); return tr; }));
  $('pending').replaceChildren(...[...waiting.values()].slice(0, 40).map((t) => { const li = document.createElement('li'); li.textContent = t; return li; }));
}

$('fire').addEventListener('click', send);
$('burst').addEventListener('click', () => { for (let i = 0; i < 10; i++) send(); });
$('pause').addEventListener('click', () => { if (!queue) return; const b = $('pause'); if (b.textContent === 'Pause queue') { queue.pause(); b.textContent = 'Resume queue'; } else { queue.resume(); b.textContent = 'Pause queue'; } });
$('skip').addEventListener('click', () => queue?.skip());
$('clear').addEventListener('click', () => { queue?.clear(); waiting.clear(); });
$('apply').addEventListener('click', () => { waiting.clear(); build(); log('new queue'); });
const setRate = () => {
  const r = Number($<HTMLInputElement>('rate').value);
  $('rateLabel').textContent = r ? `${r}/s` : 'off';
  clearInterval(timer);
  if (r) timer = window.setInterval(send, 1000 / r);
};
$('rate').addEventListener('input', setRate);
$('broken').addEventListener('input', () => { $('brokenLabel').textContent = `${$<HTMLInputElement>('broken').value} %`; });
build();
setInterval(render, 250);
render();
