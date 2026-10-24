// Browser verification of the SVGA renderer: starts the playground dev server and runs every task in one browser (Playwright),
// then writes reports/phase3-verify.json plus a console summary. Exits 1 when a check fails.
//   node scripts/verify-all.mjs [--browser=chromium|webkit|firefox] [--step=5] [--cycles=50]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const browser = opt('browser', 'chromium');
const explicit = process.argv.some((a) => a.startsWith('--browser=')); // a run for one named browser (CI) never overwrites the committed default report
const step = opt('step', '5');
const cycles = opt('cycles', '50');
const port = 5198;
const base = `http://localhost:${port}/verify.html`;

const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = async (query) => (await runInBrowser(browser, `${base}?${query}`, { timeout: 600000 })).result;
let failed = false;

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  const samples = readdirSync(join(root, 'samples')).filter((f) => f.endsWith('.svga')).sort();
  const report = { date: new Date().toISOString(), browser, step: Number(step), diff: [], diffNeutralised: [], synthetic: null, perf: null, leaks: null };
  for (const s of samples) report.diff.push(await run(`task=diff&sample=${s}&step=${step}`));
  // Both known svgaplayerweb quirks neutralised (alpha < 0.05 cutoff; whole-canvas matte): isolates real differences.
  for (const s of samples) report.diffNeutralised.push(await run(`task=diff&sample=${s}&step=${step}&mimicOracleAlpha=1&oracleIsolate=1`));
  report.synthetic = await run('task=replace');
  report.perf = await run('task=perf');
  report.leaks = await run(`task=leaks&cycles=${cycles}`);
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, explicit ? `reports/phase3-verify-${browser}.json` : 'reports/phase3-verify.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`browser: ${browser}`);
  console.log('sample'.padEnd(24), 'mean%'.padStart(7), 'max%'.padStart(7), 'worst'.padStart(6), ' max% (oracle quirks neutralised)');
  report.diff.forEach((d, i) => console.log(d.sample.padEnd(24), String(d.meanPercent).padStart(7), String(d.maxPercent).padStart(7), String(d.worstFrame).padStart(6), ' |', String(report.diffNeutralised[i].meanPercent).padStart(8), report.diffNeutralised[i].maxPercent));
  console.log(`synthetic checks: ${report.synthetic.passed} passed, ${report.synthetic.failed} failed`);
  console.log('perf (software raster):', JSON.stringify(report.perf.dpr1.drawFramePlusRaster));
  console.log(`leaks: open bitmaps ${report.leaks.bitmapsStillOpen}, rAF outstanding ${report.leaks.rafOutstanding}, ResizeObservers live ${report.leaks.resizeObserversLive}`);
  if (report.synthetic.failed > 0) { failed = true; console.error('FAILED: synthetic checks'); }
  if (report.leaks.bitmapsStillOpen || report.leaks.rafOutstanding || report.leaks.resizeObserversLive) { failed = true; console.error('FAILED: leak counters are not zero'); }
  // The reference (svgaplayerweb) has known quirks (documented in PROGRESS.md, Phase 3); the pass criterion is the diff with both neutralised.
  const bad = report.diffNeutralised.filter((d) => d.error || d.maxPercent > 2);
  if (bad.length) { failed = true; console.error(`FAILED: ${bad.length} sample(s) differ from the reference by more than 2 % even with its quirks neutralised: ${bad.map((d) => d.sample).join(', ')}`); }
} finally {
  vite.kill('SIGKILL');
}
if (failed) process.exit(1);
