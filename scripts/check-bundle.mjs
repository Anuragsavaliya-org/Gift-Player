// Fails (exit 1) if the package bloats or leaks. Run after `npm run build`. For each entry point (root, /advanced, /react):
//   - what a consumer's bundler produces (minified) must stay under CAP = measured size + 10 %
//   - libpag (the PAG engine) must not be anywhere in it, nor in any dist file
// Also: React must not be in the root or /advanced bundle, libpag must not be a runtime dependency, and the pinned versions must agree.
// After an intended size change, re-measure with `node scripts/check-bundle.mjs --measure` and update CAPS (keep the +10 %).
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// String literals from inside libpag / its emscripten runtime: they survive minification (identifiers do not).
const LIBPAG = ['PAGInit fail! Please check', 'Make context current fail!', 'ANGLE_instanced_arrays', 'EXT_texture_filter_anisotropic', 'Tencent is pleased'];
// Strings from inside React itself.
const REACT = ['react.transitional.element', 'react.element', '__SECRET_INTERNALS_DO_NOT_USE', 'react.fragment'];

/** Measured minified consumer-bundle bytes (React external) x 1.10, rounded up. Measured on 2026-10-24 (see REVIEW.md of Phase 7). */
const MEASURED = { index: 83488, advanced: 35786, react: 85084 };
const CAPS = Object.fromEntries(Object.entries(MEASURED).map(([k, v]) => [k, Math.ceil(v * 1.1)]));

const problems = [];
const results = {};
for (const entry of ['index', 'advanced', 'react']) {
  const bundled = await build({
    entryPoints: [join(root, `dist/${entry}.js`)], bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent',
    external: entry === 'react' ? ['react', 'react/jsx-runtime'] : [],
  });
  const out = bundled.outputFiles[0].text;
  results[entry] = { bytes: out.length, gzip: gzipSync(Buffer.from(out)).length };
  for (const m of LIBPAG) if (out.includes(m)) problems.push(`${entry}: a bundler consuming dist/${entry}.js pulls in libpag (marker "${m}")`);
  if (entry !== 'react') for (const m of REACT) if (out.includes(m)) problems.push(`${entry}: React ended up in the ${entry} bundle (marker "${m}")`);
  if (entry !== 'react' && /from\s*["']react/.test(readFileSync(join(root, `dist/${entry}.js`), 'utf8'))) problems.push(`dist/${entry}.js imports react`);
  if (out.length > CAPS[entry]) problems.push(`${entry}: minified consumer bundle is ${out.length} bytes, cap ${CAPS[entry]} (measured ${MEASURED[entry]} + 10 %)`);
  if (entry === 'index' && !/import\(/.test(out)) problems.push('the lazy import() of the PAG engine is missing from the bundled root output');
}

// No dist file may contain libpag either (shared chunks, CommonJS files).
for (const f of readdirSync(join(root, 'dist')).filter((n) => /\.(c?js)$/.test(n))) {
  const text = readFileSync(join(root, 'dist', f), 'utf8');
  for (const m of LIBPAG) if (text.includes(m)) problems.push(`dist/${f} contains libpag marker "${m}"`);
}

if (pkg.dependencies?.libpag) problems.push('libpag must not be a runtime dependency');
if (!/^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.libpag ?? '')) problems.push('libpag must be pinned to an exact version in devDependencies');
const src = readFileSync(join(root, 'src/formats/pag/engine.ts'), 'utf8');
const pinned = /PAG_VERSION = '([^']+)'/.exec(src)?.[1];
if (pinned !== pkg.devDependencies?.libpag) problems.push(`PAG_VERSION (${pinned}) differs from the pinned devDependency (${pkg.devDependencies?.libpag})`);

for (const [k, r] of Object.entries(results)) console.log(`${k.padEnd(9)} ${String(r.bytes).padStart(6)} B minified, ${String(r.gzip).padStart(6)} B gzip, cap ${CAPS[k]} B`);
if (process.argv.includes('--measure')) process.exit(0);
if (problems.length) {
  console.error('BUNDLE CHECK FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('bundle check passed (libpag not included anywhere)');
