// Runs the steps of .github/workflows/ci.yml on this machine, in order, stopping at the first failure.
//   node scripts/ci-local.mjs [--browsers=chromium,webkit]
// (Playwright's Firefox cannot be launched on this macOS version: Firefox results come from the Linux CI job.)
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const browsers = (process.argv.find((a) => a.startsWith('--browsers='))?.split('=')[1] ?? 'chromium,webkit').split(',');
const steps = [
  ['typecheck', ['run', 'typecheck']],
  ['samples:generate', ['run', 'samples:generate']],
  ['unit tests (incl. SSR)', ['test']],
  ['build', ['run', 'build']],
  ['check:bundle', ['run', 'check:bundle']],
  ['npm pack --dry-run', ['pack', '--dry-run']],
  ...browsers.flatMap((b) => [
    [`verify:browser [${b}]`, ['run', 'verify:browser', '--', `--browser=${b}`]],
    [`verify:corpus [${b}]`, ['run', 'verify:corpus', '--', `--browser=${b}`]],
    [`verify:images [${b}]`, ['run', 'verify:images', '--', `--browser=${b}`]],
    [`verify:pag [${b}]`, ['run', 'verify:pag', '--', `--browser=${b}`]],
    [`verify:api [${b}]`, ['run', 'verify:api', '--', `--browser=${b}`]],
  ]),
];
const results = [];
for (const [name, args] of steps) {
  const t0 = Date.now();
  console.log(`\n=== ${name} ===`);
  const r = spawnSync('npm', args, { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] });
  results.push([name, r.status === 0, Math.round((Date.now() - t0) / 1000)]);
  if (r.status !== 0) break;
}
console.log('\n=== summary ===');
for (const [name, ok, s] of results) console.log(`${ok ? 'ok    ' : 'FAILED'} ${String(s).padStart(4)} s  ${name}`);
process.exit(results.every((r) => r[1]) && results.length === steps.length ? 0 : 1);
