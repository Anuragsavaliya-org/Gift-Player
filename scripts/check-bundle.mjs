// Fails (exit 1) if the engine for PAG (libpag) has leaked into this package's bundle. Run after `npm run build`.
//   - dist files must not contain libpag / emscripten internals
//   - bundling dist/index.js with a real bundler must not pull libpag in either
//   - package.json must not list libpag as a runtime dependency
//   - the default engine URLs must match the pinned version
import { build } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
// String literals from inside libpag / its emscripten runtime: they survive minification (identifiers do not).
const MARKERS = ['PAGInit fail! Please check', 'Make context current fail!', 'ANGLE_instanced_arrays', 'EXT_texture_filter_anisotropic', 'Tencent is pleased'];
const MAX_BYTES = 130 * 1024; // each dist file; the whole package without the PAG engine
const MAX_BUNDLED = 80 * 1024; // what a consumer's minified bundle of everything may weigh; libpag alone adds ~130 KB minified
const problems = [];

for (const f of ['dist/index.js', 'dist/index.cjs']) {
  const text = readFileSync(join(root, f), 'utf8');
  for (const m of MARKERS) if (text.includes(m)) problems.push(`${f} contains libpag marker "${m}"`);
  const size = statSync(join(root, f)).size;
  if (size > MAX_BYTES) problems.push(`${f} is ${size} bytes (limit ${MAX_BYTES}): is something big bundled?`);
}

// What a consumer's bundler would produce from our entry point.
const bundled = await build({ entryPoints: [join(root, 'dist/index.js')], bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, logLevel: 'silent' });
const out = bundled.outputFiles[0].text;
for (const m of MARKERS) if (out.includes(m)) problems.push(`a bundler consuming dist/index.js pulls in libpag (marker "${m}")`);
if (out.length > MAX_BUNDLED) problems.push(`a minified consumer bundle is ${out.length} bytes (limit ${MAX_BUNDLED}): is libpag, or something else big, in it?`);
if (!/import\(/.test(out)) problems.push('the lazy import() of the PAG engine is missing from the bundled output');

if (pkg.dependencies?.libpag) problems.push('libpag must not be a runtime dependency');
if (!/^\d+\.\d+\.\d+$/.test(pkg.devDependencies?.libpag ?? '')) problems.push('libpag must be pinned to an exact version in devDependencies');
const src = readFileSync(join(root, 'src/formats/pag/engine.ts'), 'utf8');
const pinned = /PAG_VERSION = '([^']+)'/.exec(src)?.[1];
if (pinned !== pkg.devDependencies?.libpag) problems.push(`PAG_VERSION (${pinned}) differs from the pinned devDependency (${pkg.devDependencies?.libpag})`);

const gz = gzipSync(Buffer.from(out)).length;
console.log(`core bundle (everything incl. the PAG adapter, minified): ${(out.length / 1024).toFixed(1)} KB, ${(gz / 1024).toFixed(1)} KB gzip; libpag NOT included`);
if (problems.length) {
  console.error('BUNDLE CHECK FAILED:\n - ' + problems.join('\n - '));
  process.exit(1);
}
console.log('bundle check passed');
