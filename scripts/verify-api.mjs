// Phase 6 verification: runs the public-API tasks of playground/verify-player.html in Chromium and WebKit (Playwright)
// against the playground dev server and writes reports/phase6-api.json.
//   node scripts/verify-api.mjs [--browsers=chromium,webkit] [--items=200] [--cycles=100]
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const browsers = opt('browsers', 'chromium,webkit').split(',');
const items = opt('items', '200');
const cycles = opt('cycles', '100');
const port = 5196;
const base = `http://localhost:${port}/verify-player.html`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });

// `engine` first and alone: the PAG engine loads once per page, and that task needs the first load to fail.
const TASKS = [
  ['engine', 'task=engine'],
  ['api', 'task=api'],
  ['cache', 'task=cache'],
  ['leaks', `task=leaks&cycles=${cycles}`],
  ['stress', `task=stress&items=${items}`],
];

try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  mkdirSync(join(root, 'reports'), { recursive: true });
  const report = { date: new Date().toISOString(), items: Number(items), cycles: Number(cycles), browsers: {} };
  let failed = false;
  for (const b of browsers) {
    const entry = (report.browsers[b] = {});
    for (const [name, query] of TASKS) {
      try {
        const { result, version } = await runInBrowser(b, `${base}?${query}`, { timeout: 900000 });
        entry.version = version;
        entry[name] = result;
        const ok = result?.error ? false : name === 'stress' || name === 'leaks' ? result.ok === true : result.failed === 0;
        if (!ok) failed = true;
        console.log(`${b.padEnd(9)} ${name.padEnd(7)} ${ok ? 'ok' : 'FAILED'}${result.checks ? ` (${result.passed}/${result.checks.length})` : ''}`);
        if (!ok && result.checks) for (const c of result.checks.filter((x) => !x.ok)) console.log('   x', c.name, JSON.stringify(c.detail)?.slice(0, 200));
      } catch (e) {
        failed = true;
        entry[name] = { error: String(e.message).split('\n')[0] };
        console.log(`${b.padEnd(9)} ${name.padEnd(7)} ERROR ${entry[name].error}`);
      }
    }
  }
  writeFileSync(join(root, 'reports/phase6-api.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('wrote reports/phase6-api.json');
  if (failed) process.exitCode = 1;
} finally {
  vite.kill('SIGKILL');
}
