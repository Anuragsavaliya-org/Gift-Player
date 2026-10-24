// Generates the test files that are NOT committed: samples/synthetic/*.webp (and the .gif / self-test files next to them) and the
// stand-ins for the real sample files (samples/*.svga, samples/animated.webp, samples/static.webp). Runs in Chromium (Playwright).
//   node scripts/gen-synthetic.mjs [--force]
// Stand-ins are written only where the file does not exist yet, so a developer who keeps the real files next to them is not
// overwritten; --force replaces them. samples/synthetic/ is always rewritten.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const force = process.argv.includes('--force');
const port = 5194;
const vite = spawn('npx', ['vite', 'playground', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 60; i++) { try { await fetch(`http://localhost:${port}/`); break; } catch { await sleep(250); } }
  const { result } = await runInBrowser('chromium', `http://localhost:${port}/synth.html`, { timeout: 300000 });
  if (!result?.files) throw new Error(`synth.html failed: ${JSON.stringify(result).slice(0, 300)}`);
  const synthetic = join(root, 'samples/synthetic');
  mkdirSync(synthetic, { recursive: true });
  let nSynthetic = 0, nStandIn = 0, nKept = 0;
  for (const [name, data] of Object.entries(result.files)) {
    if (name.startsWith('@root/')) {
      const path = join(root, 'samples', name.slice('@root/'.length));
      if (existsSync(path) && !force) { nKept++; continue; }
      writeFileSync(path, Buffer.from(data, 'base64'));
      nStandIn++;
    } else {
      writeFileSync(join(synthetic, name), Buffer.from(data, 'base64'));
      nSynthetic++;
    }
  }
  console.log(`wrote ${nSynthetic} files to samples/synthetic/, ${nStandIn} stand-in samples to samples/ (${nKept} existing files kept; use --force to replace)`);
} finally {
  vite.kill('SIGKILL');
}
