// Reproduces the Phase 3 browser verification: starts the playground dev server, runs every task in
// headless Chrome (scripts/headless.mjs) and writes reports/phase3-verify.json plus a console summary.
//   node scripts/verify-all.mjs [--step=5] [--cycles=50]
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const step = opt('step', '5');
const cycles = opt('cycles', '50');
const port = 5198;
const base = `http://localhost:${port}/verify.html`;

const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (query, extra = []) =>
  JSON.parse(execFileSync('node', [join(root, 'scripts/headless.mjs'), `${base}?${query}`, '--timeout=600000', ...extra], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }).trim().split('\n').pop());

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  const samples = readdirSync(join(root, 'samples')).filter((f) => f.endsWith('.svga')).sort();
  const report = { date: new Date().toISOString(), step: Number(step), diff: [], diffNeutralised: [], synthetic: null, perf: null, perfGpu: null, leaks: null };
  for (const s of samples) report.diff.push(run(`task=diff&sample=${s}&step=${step}`));
  // Both known svgaplayerweb quirks neutralised (alpha < 0.05 cutoff; whole-canvas matte): isolates real differences.
  for (const s of samples) report.diffNeutralised.push(run(`task=diff&sample=${s}&step=${step}&mimicOracleAlpha=1&oracleIsolate=1`));
  report.synthetic = run('task=replace');
  report.perf = run('task=perf');
  report.perfGpu = run('task=perf', ['--gpu']);
  report.leaks = run(`task=leaks&cycles=${cycles}`);
  mkdirSync(join(root, 'reports'), { recursive: true });
  writeFileSync(join(root, 'reports/phase3-verify.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('sample'.padEnd(24), 'mean%'.padStart(7), 'max%'.padStart(7), 'worst'.padStart(6), ' max% (oracle quirks neutralised)');
  report.diff.forEach((d, i) => console.log(d.sample.padEnd(24), String(d.meanPercent).padStart(7), String(d.maxPercent).padStart(7), String(d.worstFrame).padStart(6), ' |', String(report.diffNeutralised[i].meanPercent).padStart(8), report.diffNeutralised[i].maxPercent));
  console.log(`synthetic checks: ${report.synthetic.passed} passed, ${report.synthetic.failed} failed`);
  console.log('perf (software raster):', JSON.stringify(report.perf.dpr1.drawFramePlusRaster));
  console.log(`leaks: open bitmaps ${report.leaks.bitmapsStillOpen}, rAF outstanding ${report.leaks.rafOutstanding}, ResizeObservers live ${report.leaks.resizeObserversLive}`);
} finally {
  vite.kill('SIGKILL');
}
