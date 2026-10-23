import {
  decodeSvgaImages,
  detectFormat,
  parseSvga,
  readSource,
  releaseSvgaImages,
  type GiftSource,
  type SvgaMovie,
} from '../src';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const drop = $('drop');
const select = $<HTMLSelectElement>('sample');
const summary = $<HTMLTableElement>('summary');
const grid = $('grid');
let current: Map<string, ImageBitmap> | null = null;

// Samples live in /samples; expose them through a dropdown (dev server only).
const samples = import.meta.glob('../samples/*.svga', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;
for (const path of Object.keys(samples).sort()) {
  const opt = document.createElement('option');
  opt.value = path;
  opt.textContent = path.split('/').pop()!;
  select.append(opt);
}
// `?sample=angel.svga` auto-loads a sample (handy for scripted checks).
const wanted = new URLSearchParams(location.search).get('sample');
if (wanted) {
  const path = Object.keys(samples).find((p) => p.endsWith(`/${wanted}`));
  if (path) void samples[path]!().then((url) => inspect(url, wanted));
}

select.addEventListener('change', async () => {
  const loader = samples[select.value];
  if (loader) await inspect(await loader(), select.options[select.selectedIndex]!.textContent!);
});

drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
drop.addEventListener('dragleave', () => drop.classList.remove('over'));
drop.addEventListener('drop', async (e) => {
  e.preventDefault();
  drop.classList.remove('over');
  const file = e.dataTransfer?.files[0];
  if (file) await inspect(file, file.name);
});

function row(label: string, value: string | number): string {
  return `<tr><td>${label}</td><td>${value}</td></tr>`;
}

async function inspect(src: GiftSource, name: string): Promise<void> {
  $('error').textContent = '';
  $('warnings').textContent = '';
  grid.replaceChildren();
  if (current) releaseSvgaImages(current);
  current = null;
  try {
    const bytes = await readSource(src);
    const info = detectFormat(bytes);
    if (info.format !== 'svga') throw new Error(`Detected ${info.format}; the inspect view only handles SVGA in this phase.`);
    const t0 = performance.now();
    const movie = parseSvga(bytes);
    const parseMs = performance.now() - t0;
    const t1 = performance.now();
    const { bitmaps, failed } = await decodeSvgaImages(movie);
    const decodeMs = performance.now() - t1;
    current = bitmaps;
    renderSummary(name, bytes.length, movie, parseMs, decodeMs, failed);
    renderGrid(movie, bitmaps);
  } catch (e) {
    summary.hidden = true;
    $('error').textContent = `${(e as { code?: string }).code ?? 'error'}: ${(e as Error).message}`;
  }
}

function renderSummary(name: string, size: number, m: SvgaMovie, parseMs: number, decodeMs: number, failed: string[]): void {
  summary.hidden = false;
  summary.innerHTML = [
    row('file', `${name} (${(size / 1024).toFixed(1)} KB)`),
    row('format', `SVGA ${m.container} (version ${m.version || '?'})`),
    row('viewBox', `${m.viewBox.width} x ${m.viewBox.height}`),
    row('fps', m.fps),
    row('frames', `${m.frames} (${(m.frames / m.fps).toFixed(2)} s)`),
    row('sprites', m.sprites.length),
    row('matte sprites', m.sprites.filter((s) => s.isMatte).length),
    row('masked sprites', m.sprites.filter((s) => s.matteKey).length),
    row('images', m.images.size),
    row('audios', `${m.audios.size} (${m.audioTracks.length} track(s), not played)`),
    row('parse time', `${parseMs.toFixed(1)} ms`),
    row('image decode time', `${decodeMs.toFixed(1)} ms${failed.length ? ` — failed: ${failed.join(', ')}` : ''}`),
  ].join('');
  $('warnings').textContent = m.warnings.map((w) => `warning: ${w}`).join('\n');
}

function renderGrid(m: SvgaMovie, bitmaps: Map<string, ImageBitmap>): void {
  for (const [key, bmp] of bitmaps) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    const pic = document.createElement('div');
    pic.className = 'pic';
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    pic.append(canvas);
    const label = document.createElement('div');
    label.className = 'name';
    label.textContent = key;
    const dim = document.createElement('div');
    dim.className = 'dim';
    dim.textContent = `${bmp.width}x${bmp.height} ${m.images.get(key)!.mime.replace('image/', '')}`;
    cell.append(pic, label, dim);
    grid.append(cell);
  }
}
