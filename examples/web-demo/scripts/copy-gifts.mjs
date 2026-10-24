// Copies a selection of gift files from the repository's git-ignored `samples/` folders into public/gifts/ and writes
// public/gifts/manifest.json, which the app reads. Gift files are never committed (no .svga/.webp in git).
//
//   npm run gifts:copy
//
// A missing source file is skipped with a warning; the script never fails. To use your own gifts instead, drop files into
// public/gifts/ and list them in manifest.json (or edit GIFTS below).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');
const out = join(here, '../public/gifts');
mkdirSync(out, { recursive: true });

/** name: shown in the UI; from: path inside the repository; file: name in public/gifts/. */
const GIFTS = [
  { name: 'Fiery Red Dragon', from: 'samples/Fiery-Red-Dragon.svga', file: 'fiery-red-dragon.svga' },
  { name: 'Pink Heart Rocket', from: 'samples/Pink-Heart-Rocket.svga', file: 'pink-heart-rocket.svga' },
  { name: 'Pink Sports Car', from: 'samples/corpus/40001575.svga', file: 'pink-sports-car.svga' },
  { name: 'Cherry Blossoms', from: 'samples/corpus/40001576.svga', file: 'cherry-blossoms.svga' },
  { name: 'Moon Night', from: 'samples/corpus/40001421.svga', file: 'moon-night.svga' },
  { name: 'Rotating Earth', from: 'samples/rotating-earth.gif', file: 'rotating-earth.gif' },
  { name: 'Animated WebP', from: 'samples/corpus/10014_android_1519293401_middle.webp', file: 'animated.webp' },
  { name: 'Like', from: 'samples/like.pag', file: 'like.pag' },
];
/** One deliberately broken file (the first 40 % of a real SVGA) to show error handling. */
const BROKEN = { name: 'Broken file', from: 'samples/Fiery-Red-Dragon.svga', file: 'broken-truncated.svga' };

const FORMATS = { '.svga': 'svga', '.gif': 'gif', '.webp': 'webp', '.pag': 'pag' };
const manifest = [];
const skipped = [];

for (const g of GIFTS) {
  const src = join(repo, g.from);
  if (!existsSync(src)) {
    skipped.push(g.name);
    console.warn(`skipped "${g.name}": ${g.from} not found`);
    continue;
  }
  copyFileSync(src, join(out, g.file));
  manifest.push({ name: g.name, file: g.file, format: FORMATS[extname(g.file)] });
}

const brokenSrc = join(repo, BROKEN.from);
if (existsSync(brokenSrc)) {
  const bytes = readFileSync(brokenSrc);
  writeFileSync(join(out, BROKEN.file), bytes.subarray(0, Math.floor(bytes.length * 0.4)));
  manifest.push({ name: BROKEN.name, file: BROKEN.file, format: 'svga', broken: true });
} else {
  console.warn(`skipped "${BROKEN.name}": ${BROKEN.from} not found`);
}

writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const mb = manifest.reduce((n, g) => n + statSync(join(out, g.file)).size, 0) / 1048576;
console.log(`public/gifts/: ${manifest.length} gift(s), ${mb.toFixed(1)} MB${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`);
