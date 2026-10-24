// node scripts/pw-run.mjs <chromium|firefox|webkit> <url> [--timeout=ms]
import { runInBrowser } from './lib/pw.mjs';
const [name, url] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const timeout = Number(process.argv.find((a) => a.startsWith('--timeout='))?.split('=')[1] ?? 180000);
const r = await runInBrowser(name, url, { timeout });
for (const l of r.logs.slice(-15)) console.error(l);
console.log(JSON.stringify({ browser: name, version: r.version, result: r.result }));
