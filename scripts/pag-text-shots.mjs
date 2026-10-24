// Renders Latin / Hindi / Gujarati / Arabic / emoji text through SVGA setText and a PAG text layer in every browser and
// saves the pictures to reports/text/ (one file per browser x format x script, plus a side-by-side composite per browser).
//   node scripts/pag-text-shots.mjs [--browsers=chromium,webkit] [--base=http://localhost:5190]
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInBrowser } from './lib/pw.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const opt = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1] ?? d;
const base = opt('base', 'http://localhost:5190');
const out = join(root, 'reports/text');
mkdirSync(out, { recursive: true });
for (const b of opt('browsers', 'chromium,webkit').split(',')) {
  const { result } = await runInBrowser(b, `${base}/verify-pag.html?task=text`, { timeout: 120000 });
  if (result.error) throw new Error(result.error);
  for (const [name, url] of Object.entries(result.shots)) writeFileSync(join(out, `${b}-${name}.png`), Buffer.from(url.split(',')[1], 'base64'));
  console.log(b, Object.keys(result.shots).length, 'images;', JSON.stringify(result.rows.map((r) => `${r.format}/${r.script}:${r.brightPixels}`)));
}
