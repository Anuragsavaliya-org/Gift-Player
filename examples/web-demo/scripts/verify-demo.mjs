// Drives the running demo (npm run dev, http://localhost:5300) in Chromium and checks it works: every gift plays, the broken one
// shows its error, Burst x20 drains without stalling, Combo x10 is merged into "x10". Saves screenshots to screenshots/ (git-ignored).
//   node scripts/verify-demo.mjs [url]     (needs `playwright`; resolved from the repository root's node_modules)
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const url = process.argv[2] ?? 'http://localhost:5300/';
const shots = join(dirname(fileURLToPath(import.meta.url)), '../screenshots');
mkdirSync(shots, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail === undefined ? '' : ' ' + JSON.stringify(detail)}`); };

const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
const problems = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !/polygon_mode|willReadFrequently|Failed to load resource/.test(m.text())) problems.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.goto(url);
await page.waitForSelector('.tile');
const names = await page.$$eval('.tile strong', (els) => els.map((e) => e.textContent));
await page.screenshot({ path: join(shots, '1-grid.png'), fullPage: true });

// the stage player's canvas lives in the box <GiftPlayerView> renders; the queue draws in `.layer`
const STAGE = '.stage > div:not(.video):not(.layer)';
const stageInk = () => page.evaluate(() => { const c = document.querySelector('.stage > div:not(.video):not(.layer) canvas'); if (!c) return -1; const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++; return n; });
const tile = (name) => page.locator('.tile', { has: page.locator('strong', { hasText: new RegExp(`^${name}$`) }) });
const stat = async (label) => (await page.locator(`.stats li:has-text("${label}") strong`).textContent()).trim();

// 1. every gift on the stage
for (const name of names) {
  const broken = name === 'Broken file';
  const toastsBefore = await page.locator('.toast').count();
  await tile(name).getByRole('button', { name: 'Play' }).click();
  if (broken) {
    await page.waitForSelector('.toast', { timeout: 8000 }).catch(() => {});
    const text = await page.locator('.toast').last().textContent().catch(() => '');
    check(`${name}: shows an error toast with the code`, /Broken file: (parse-failed|unsupported-format|decode-failed)/.test(text ?? ''), text);
    await page.screenshot({ path: join(shots, '4-error-toast.png') });
    continue;
  }
  let shown = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < 15000 && shown <= 0) { await sleep(100); shown = await stageInk(); }
  if (name === 'Fiery Red Dragon') { await sleep(1200); await page.screenshot({ path: join(shots, '2-gift-over-video.png') }); }
  const info = await page.locator('.info').innerText().catch(() => '');
  const ms = Number(/Load time\s+(\d+) ms/.exec(info)?.[1] ?? NaN);
  // Rotating Earth loops forever by file: the stage player has `loops=1` from the controls, which overrides it
  const t1 = Date.now();
  while (Date.now() - t1 < 25000 && (await page.locator(`${STAGE} canvas`).count()) > 0) await sleep(250);
  const gone = (await page.locator(`${STAGE} canvas`).count()) === 0;
  check(`${name}: loads (${isNaN(ms) ? '?' : ms} ms), plays (ink ${shown}), and the stage clears when it ends`, shown > 0 && gone && info.includes(name), { toastsBefore, toasts: await page.locator('.toast').count() });
}

// 2. Burst x20 (coalesce off, so that 20 sends are 20 queue items; with it on, identical neighbours merge)
await page.getByLabel(/merge identical sends/).uncheck();
await sleep(500);
const before = { played: Number(await stat('Played')), errors: Number(await stat('Errors')), dropped: Number(await stat('Dropped')) };
await page.getByRole('button', { name: 'Burst ×20' }).click();
let last = Date.now(), lastDone = 0, maxSilence = 0, shot = false;
const t2 = Date.now();
while (Date.now() - t2 < 240000) {
  await sleep(300);
  if (!shot && Date.now() - t2 > 2500) { shot = true; await page.screenshot({ path: join(shots, '3-queue-burst.png') }); }
  const done = Number(await stat('Played')) + Number(await stat('Errors')) + Number(await stat('Dropped')) - before.played - before.errors - before.dropped;
  if (done !== lastDone) { lastDone = done; last = Date.now(); }
  maxSilence = Math.max(maxSilence, Date.now() - last);
  if (Number(await stat('Waiting')) === 0 && (await stat('Playing')) === 'no' && done >= 1) break;
}
const after = { played: Number(await stat('Played')), errors: Number(await stat('Errors')), dropped: Number(await stat('Dropped')) };
const processed = after.played + after.errors + after.dropped - before.played - before.errors - before.dropped;
check('Burst ×20 drains to 0 waiting, nothing playing', Number(await stat('Waiting')) === 0 && (await stat('Playing')) === 'no', { seconds: Math.round((Date.now() - t2) / 1000) });
check('Burst ×20: all 20 accounted for (played + errors + dropped)', processed === 20, { processed, played: after.played - before.played, errors: after.errors - before.errors, dropped: after.dropped - before.dropped });
check('Burst ×20: no stall (longest time without progress < 20 s)', maxSilence < 20000, { maxSilenceMs: maxSilence });
await sleep(500);
check('queue canvas is blank after the burst', await page.evaluate(() => { const c = document.querySelector('.stage .layer canvas'); if (!c) return true; const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return false; return true; }));

// 3. Combo x10 with coalesce on: select the short "Like" gift, then one click sends it 10 times
await page.getByLabel(/merge identical sends/).check();
await tile('Like').getByRole('button', { name: 'Play' }).click();
await page.waitForSelector(`${STAGE} canvas`, { state: 'detached', timeout: 15000 }).catch(() => {});
const playedBefore = Number(await stat('Played'));
await page.getByRole('button', { name: /Combo ×10/ }).click();
let badge = '';
const t3 = Date.now();
while (Date.now() - t3 < 20000 && !/×10/.test(badge)) { await sleep(50); badge = (await page.locator('.badge').textContent().catch(() => '')) ?? ''; }
check('Combo ×10 with coalesce on shows "×10" on the stage', /×10/.test(badge), badge);
await page.screenshot({ path: join(shots, '5-combo.png') });
await sleep(2500);
check('Combo ×10 played as ONE queue item', Number(await stat('Played')) - playedBefore === 1, { played: Number(await stat('Played')) - playedBefore });

check('no console errors or warnings from the app', problems.length === 0, problems.slice(0, 5));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed; screenshots in ${shots}`);
process.exit(failed ? 1 : 0);
