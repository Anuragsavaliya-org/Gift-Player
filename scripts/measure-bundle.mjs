// Note: pako is no longer a dependency; to reproduce its rows run `npm i --no-save pako` first.
// Measures minified + gzipped size of decompression options (esbuild, browser ESM, tree-shaken).
import { build } from 'esbuild';
import { gzipSync } from 'node:zlib';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const options = {
  'pako (inflate only)': `import { inflate } from 'pako'; globalThis.x = inflate;`,
  'jszip (unzip)': `import JSZip from 'jszip'; globalThis.x = JSZip;`,
  'fflate unzlibSync only': `import { unzlibSync } from 'fflate'; globalThis.x = unzlibSync;`,
  'fflate unzlibSync + unzipSync': `import { unzlibSync, unzipSync } from 'fflate'; globalThis.x = [unzlibSync, unzipSync];`,
  'pako + jszip': `import { inflate } from 'pako'; import JSZip from 'jszip'; globalThis.x = [inflate, JSZip];`,
};

for (const [name, contents] of Object.entries(options)) {
  let r;
  try {
    r = await build({
      stdin: { contents, resolveDir: root, loader: 'js' },
      bundle: true, minify: true, format: 'esm', platform: 'browser', write: false, treeShaking: true, logLevel: 'silent',
    });
  } catch {
    console.log(`${name.padEnd(34)} (skipped: package not installed)`);
    continue;
  }
  const code = r.outputFiles[0].contents;
  console.log(`${name.padEnd(34)} min ${String(code.length).padStart(7)} B   gzip ${String(gzipSync(code).length).padStart(6)} B`);
}
