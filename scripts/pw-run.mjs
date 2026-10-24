// node scripts/pw-run.mjs <chromium|firefox|webkit> <url> [--timeout=ms]
import { runInBrowser } from './lib/pw.mjs';
const [name, url] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const timeout = Number(process.argv.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 180000);
let r;
try {
  r = await runInBrowser(name, url, { timeout });
} catch (e) {
  for (const l of (e.pageLogs ?? []).slice(-25)) console.error(l);
  console.error(String(e.message).split('\n')[0]);
  process.exit(2);
}
for (const l of r.logs.slice(-15)) console.error(l);
console.log(JSON.stringify({ browser: name, version: r.version, result: r.result }));
