// The /react build imports the root entry through the alias `@gift-player/root`; point JS and declarations at the built root files.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '../dist');
for (const [file, target] of [['react.js', './index.js'], ['react.cjs', './index.cjs'], ['react.d.ts', './index.js'], ['react.d.cts', './index.cjs']]) {
  const path = join(dist, file);
  const src = readFileSync(path, 'utf8');
  if (!src.includes('@gift-player/root')) throw new Error(`${file}: expected an import of @gift-player/root`);
  writeFileSync(path, src.replaceAll('@gift-player/root', target));
}
console.log('react entry points at the root entry');
