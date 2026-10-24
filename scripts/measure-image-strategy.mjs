// Phase 4.1: compares how SVGA bitmaps are held (baseline ImageBitmap, A = <img>, B = ImageBitmap + mip chain)
// in Chromium and WebKit: diff vs the reference on every SVGA file, drawFrame time, load time, and memory
// (summed resident memory of the browser's processes, sampled from here at phase markers).
//   node scripts/measure-image-strategy.mjs [--browsers=chromium,webkit] [--variants=baseline,A,B] [--step=10]
import { spawn, execSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const browsers = opt('browsers', 'chromium,webkit').split(',');
const variantNames = opt('variants', 'baseline,A,B').split(',');
const step = opt('step', '10');
const port = 5194;
const base = `http://localhost:${port}/verify.html`;
const VARIANTS = {
  baseline: { src: 'bitmap' },
  A: { src: 'img' },
  B: { src: 'bitmap', mips: '1', resize: 'high', bias: '0' },
};
const MARK = { chromium: 'ms-playwright/chromium-1248/', webkit: 'ms-playwright/webkit-2370/' };

const rssMB = (browser) => {
  const lines = execSync('ps -axo rss=,command=').toString().split('\n');
  let kb = 0;
  for (const l of lines) if (l.includes(MARK[browser]) && !l.includes('/bin/zsh')) kb += Number(l.trim().split(/\s+/)[0]) || 0;
  return Math.round((kb / 1024) * 10) / 10;
};

const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const files = [...readdirSync(join(root, 'samples')).filter((f) => f.endsWith('.svga')), ...readdirSync(join(root, 'samples/corpus')).filter((f) => f.endsWith('.svga')).map((f) => `corpus/${f}`)];
const repo = files.filter((f) => !f.startsWith('corpus/'));
const q = (task, params) => `${base}?${new URLSearchParams({ task, ...params })}`;
const report = { date: new Date().toISOString(), step: Number(step), files: files.length, results: {} };

try {
  for (let i = 0; i < 80; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  for (const b of browsers) {
    report.results[b] = {};
    for (const v of variantNames) {
      const flags = VARIANTS[v];
      const R = (report.results[b][v] = {});
      const run = async (task, params, opts = {}) => (await runInBrowser(b, q(task, { ...flags, ...params }), { timeout: 3000000, ...opts })).result;
      console.log(`${b} / ${v}: diff ...`);
      R.diff = await run('diffall', { files: files.join(','), step });
      console.log(`${b} / ${v}: perf, load time ...`);
      R.perfLarge = await run('perf', { sample: 'Pink-Heart-Rocket.svga', passes: 3 });
      R.perfSmall = await run('perf', { sample: 'corpus/40001427.svga', passes: 3 });
      R.loadtime = await run('loadtime', { files: ['Pink-Heart-Rocket.svga', 'Fiery-Red-Dragon.svga', 'corpus/40001576.svga', 'corpus/40001427.svga'].join(','), reps: 7 });
      console.log(`${b} / ${v}: memory (20 cycles) ...`);
      const samples = {};
      R.memoryRun = await run('memory', { file: 'Pink-Heart-Rocket.svga', cycles: 20 }, {
        setup: async (page) => { await page.exposeFunction('__sample', (label) => { samples[label] = rssMB(b); }); },
      });
      R.memoryRss = samples;
    }
  }
} finally {
  vite.kill('SIGKILL');
}
mkdirSync(join(root, 'reports'), { recursive: true });
writeFileSync(join(root, 'reports/phase4.1-image-strategy.json'), JSON.stringify(report, null, 1) + '\n');
console.log('wrote reports/phase4.1-image-strategy.json');
