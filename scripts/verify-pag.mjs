// Phase 5 verification: runs every task of playground/verify-pag.html in Chromium and WebKit (Playwright) against the
// playground dev server and writes reports/phase5-pag.json (+ the text screenshots to reports/text/).
//   node scripts/verify-pag.mjs [--browsers=chromium,webkit] [--cycles=100]
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const browsers = (opt('browser', null) ?? opt('browsers', 'chromium,webkit')).split(','); // --browser=webkit or --browsers=chromium,webkit
const cycles = opt('cycles', '100');
const port = 5197;
const base = `http://localhost:${port}/verify-pag.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });

const TASKS = [
  ['gl', 'task=gl'], // informational: what WebGL this browser offers
  ['support', 'task=support'],
  ['supportCdn', 'task=support&cdn=1'], // pinned jsDelivr defaults: the real cold load
  ['frames', 'task=frames'],
  ['timing', 'task=timing'],
  ['loops', 'task=loops'],
  ['leaks', `task=leaks&cycles=${cycles}`],
  ['multi', 'task=multi&rounds=6'],
  ['replace', 'task=replace'],
  ['fonts', 'task=fonts'],
  ['text', 'task=text'],
  ['perf', 'task=perf'],
];

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  mkdirSync(join(root, 'reports/text'), { recursive: true });
  let failed = false;
  const report = { date: new Date().toISOString(), cycles: Number(cycles), browsers: {} };
  for (const b of browsers) {
    const entry = (report.browsers[b] = {});
    for (const [name, query] of TASKS) {
      try {
        const { result, version, logs } = await runInBrowser(b, `${base}?${query}`, { timeout: 600000 });
        if (name === 'gl') { entry.glLogs = logs.filter((l) => !/vite/.test(l)).slice(0, 30); for (const l of entry.glLogs) console.log('   gl log:', l); }
        entry.version = version;
        if (name === 'text') {
          for (const [shot, url] of Object.entries(result.shots)) writeFileSync(join(root, 'reports/text', `${b}-${shot}.png`), Buffer.from(url.split(',')[1], 'base64'));
          entry[name] = result.rows;
        } else entry[name] = result;
        const ok = result?.error ? false : Array.isArray(result) ? result.every((r) => r.ok !== false) : result?.ok !== false && (result?.failed ?? 0) === 0;
        if (!ok) failed = true;
        console.log(`${b.padEnd(9)} ${name.padEnd(11)} ${result?.skipped ? `skipped (${result.skipped})` : ok ? 'ok' : 'CHECK'}`);
      } catch (e) {
        failed = true;
        entry[name] = { error: String(e.message).split('\n')[0] };
        console.log(`${b.padEnd(9)} ${name.padEnd(11)} ERROR ${entry[name].error}`);
      }
    }
  }
  // A run for one browser (--browser=webkit) keeps the other browsers' earlier results in the file.
  const file = join(root, 'reports/phase5-pag.json');
  const earlier = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).browsers ?? {} : {};
  report.browsers = { ...earlier, ...report.browsers };
  writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
  console.log('wrote reports/phase5-pag.json');
  if (failed) process.exitCode = 1;
} finally {
  vite.kill('SIGKILL');
}
