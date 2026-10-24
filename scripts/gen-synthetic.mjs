// Regenerates samples/synthetic/*.{gif,webp} (dev only; output is committed). Needs local Chrome (see scripts/headless.mjs).
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const port = 5196;
const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  const out = execFileSync('node', [join(root, 'scripts/headless.mjs'), `http://localhost:${port}/synth.html`, '--timeout=120000'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 });
  const { files } = JSON.parse(out.trim().split('\n').pop());
  const dir = join(root, 'samples/synthetic');
  mkdirSync(dir, { recursive: true });
  for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), Buffer.from(data, 'base64'));
  console.log(`wrote ${Object.keys(files).length} files to samples/synthetic/`);
} finally {
  vite.kill('SIGKILL');
}
