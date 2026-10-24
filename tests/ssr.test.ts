import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The names a host app imports. A rename or removal is a breaking change and must show up here. */
const PUBLIC = ['GiftPlayer', 'GiftQueue', 'GiftPlayerError', 'AssetCache', 'registerResolver', 'getDefaultCache', 'detectFormat', 'registerFont', 'PAG_VERSION'];

// Next.js evaluates the package on the server (route handlers, server components): importing it must not touch window/document.
const probe = `
  for (const k of ['window', 'document', 'navigator', 'self', 'location', 'requestAnimationFrame', 'HTMLElement']) {
    Object.defineProperty(globalThis, k, { configurable: true, get() { throw new Error('touched ' + k + ' at import time'); } });
  }
`;

describe('SSR safety', () => {
  beforeAll(() => {
    execFileSync('npx', ['tsup'], { cwd: root, stdio: 'ignore' });
  }, 120_000);

  it('the built ESM package imports in plain Node without touching browser globals', () => {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', `${probe}; const m = await import(${JSON.stringify(join(root, 'dist/index.js'))}); console.log(JSON.stringify(${JSON.stringify(PUBLIC)}.map((k) => typeof m[k])));`], { encoding: 'utf8' });
    expect(JSON.parse(out.trim())).toEqual(PUBLIC.map((k) => (k === 'PAG_VERSION' ? 'string' : 'function')));
  });

  it('the built CJS package does too', () => {
    const out = execFileSync(process.execPath, ['-e', `${probe}; const m = require(${JSON.stringify(join(root, 'dist/index.cjs'))}); console.log(JSON.stringify(${JSON.stringify(PUBLIC)}.map((k) => typeof m[k])));`], { encoding: 'utf8' });
    expect(JSON.parse(out.trim())).toEqual(PUBLIC.map((k) => (k === 'PAG_VERSION' ? 'string' : 'function')));
  });

  it('server-side helpers work: detect, error codes, queue construction is deferred to the browser', () => {
    const out = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `const m = await import(${JSON.stringify(join(root, 'dist/index.js'))});
        const f = m.detectFormat(new TextEncoder().encode('GIF89a' + '\\0'.repeat(20)));
        let code = ''; try { new m.GiftPlayer({}); } catch (e) { code = e.code; }
        console.log(JSON.stringify({ format: f.format, constructorOnServer: code }));`],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(out.trim())).toEqual({ format: 'gif', constructorOnServer: 'invalid-input' });
  });

  it('the TypeScript source also imports in Node (what vitest and bundlers see)', async () => {
    const m = await import('../src/index');
    expect(typeof m.GiftPlayer).toBe('function');
    expect(typeof (globalThis as { window?: unknown }).window).toBe('undefined');
  });
});
