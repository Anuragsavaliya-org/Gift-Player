// Runs a page in headless Chrome over the DevTools protocol and prints `window.__result` as JSON.
//   node scripts/headless.mjs <url> [--timeout=120000] [--screenshot=path.png] [--size=1200x900] [--gpu]
// No dependencies: uses Node's built-in WebSocket and the locally installed Chrome.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const opt = (name, dflt) => args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? dflt;
const timeout = Number(opt('timeout', 120000));
const shot = opt('screenshot', '');
const [w, h] = opt('size', '1200x900').split('x').map(Number);
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
if (!url) throw new Error('usage: headless.mjs <url>');

const profile = mkdtempSync(join(tmpdir(), 'gp-chrome-'));
const flags = ['--headless=new', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
  '--remote-debugging-port=0', `--window-size=${w},${h}`, '--hide-scrollbars', '--mute-audio', '--js-flags=--expose-gc'];
if (!args.includes('--gpu')) flags.push('--disable-gpu');
const proc = spawn(chrome, [...flags, 'about:blank'], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
try {
  const portFile = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 100 && !existsSync(portFile); i++) await sleep(100);
  const port = readFileSync(portFile, 'utf8').split('\n')[0];
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = list.find((t) => t.type === 'page');
    if (!target) await sleep(100);
  }
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const logs = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    else if (msg.method === 'Runtime.consoleAPICalled') {
      logs.push(`[console.${msg.params.type}] ${msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ')}`);
    } else if (msg.method === 'Runtime.exceptionThrown') {
      logs.push(`[exception] ${msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text}`);
    }
  };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url });
  const t0 = Date.now();
  let result;
  while (Date.now() - t0 < timeout) {
    const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.__result ?? null)', returnByValue: true });
    const v = r.result?.result?.value;
    if (v && v !== 'null') { result = v; break; }
    await sleep(200);
  }
  if (shot) {
    const r = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(shot, Buffer.from(r.result.data, 'base64'));
  }
  for (const l of logs.slice(-30)) console.error(l);
  if (!result) { console.error('TIMEOUT waiting for window.__result'); process.exitCode = 2; }
  else console.log(result);
} finally {
  try { ws?.close(); } catch {}
  proc.kill('SIGKILL');
  await sleep(200);
  rmSync(profile, { recursive: true, force: true });
}
