// Runs a page in Chromium / Firefox / WebKit (Playwright) and returns `window.__result`.
import { chromium, firefox, webkit } from 'playwright';

export const BROWSERS = { chromium, firefox, webkit };

/**
 * @returns {{ result: any, logs: string[], userAgent: string, version: string }}
 */
export async function runInBrowser(name, url, { timeout = 180000, viewport = { width: 1000, height: 800 }, setup } = {}) {
  // 'chromium' uses the full Chromium in its new headless mode (channel 'chromium'): the default headless
  // *shell* does not run image animations or paint like a real browser.
  const browser = await BROWSERS[name].launch(name === 'chromium' ? { channel: 'chromium', headless: true, args: ['--js-flags=--expose-gc'] } : { headless: true });
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const logs = [];
    page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
    page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
    if (setup) await setup(page);
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__result !== undefined, null, { timeout, polling: 200 });
    const result = await page.evaluate(() => window.__result);
    const userAgent = await page.evaluate(() => navigator.userAgent);
    return { result, logs, userAgent, version: browser.version() };
  } finally {
    await browser.close();
  }
}
