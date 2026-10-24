import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Runtime exports per entry point. A rename or removal is a breaking change and must show up here. */
const ENTRIES: Record<string, string[]> = {
  index: ['AssetCache', 'DEFAULT_CACHE_BYTES', 'GiftPlayer', 'GiftPlayerError', 'GiftQueue', 'VERSION', 'detectFormat', 'getDefaultCache', 'registerFont', 'registerResolver', 'releasePagEngineContext', 'setPagFallbackFonts'],
  advanced: ['DEFAULT_PAG_MODULE_URL', 'DEFAULT_PAG_WASM_URL', 'PAG_VERSION', 'PagRenderer', 'decodeSvgaImages', 'detectSource', 'loadPagEngine', 'parseSvga', 'readSource', 'releaseSvgaImages'],
  react: ['GiftPlayerView', 'useGiftQueue'],
};

// Next.js evaluates the package on the server (route handlers, server components): importing it must not touch window/document.
const probe = `
  for (const k of ['window', 'document', 'navigator', 'self', 'location', 'requestAnimationFrame', 'HTMLElement']) {
    Object.defineProperty(globalThis, k, { configurable: true, get() { throw new Error('touched ' + k + ' at import time'); } });
  }
`;
const listKeys = (v: string) => `console.log(JSON.stringify(Object.keys(${v}).sort()));`;

describe('SSR safety and export lists', () => {
  beforeAll(() => {
    execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'ignore' });
  }, 180_000);

  for (const [entry, names] of Object.entries(ENTRIES)) {
    it(`${entry}: the built ESM entry imports in plain Node without touching browser globals, and exports exactly the contract`, () => {
      const out = execFileSync(process.execPath, ['--input-type=module', '-e', `${probe}; const m = await import(${JSON.stringify(join(root, `dist/${entry}.js`))}); ${listKeys('m')}`], { encoding: 'utf8' });
      expect(JSON.parse(out.trim())).toEqual(names);
    });

    it(`${entry}: so does the CommonJS entry`, () => {
      const out = execFileSync(process.execPath, ['-e', `${probe}; const m = require(${JSON.stringify(join(root, `dist/${entry}.cjs`))}); ${listKeys('m')}`], { encoding: 'utf8' });
      expect(JSON.parse(out.trim())).toEqual(names);
    });
  }

  it('the PAG engine state is shared between the root and /advanced entries (one engine per page)', () => {
    const out = execFileSync(
      process.execPath,
      ['-e', `const a = require(${JSON.stringify(join(root, 'dist/index.cjs'))}); const b = require(${JSON.stringify(join(root, 'dist/advanced.cjs'))});
        const key = Symbol.for('@gift-player/pag-engine');
        console.log(JSON.stringify({ stateOnGlobal: typeof globalThis[key], sameChunk: a.GiftPlayer !== undefined && b.PagRenderer !== undefined }));`],
      { encoding: 'utf8' },
    );
    expect(JSON.parse(out.trim())).toEqual({ stateOnGlobal: 'object', sameChunk: true });
  });

  it('server-side helpers work; constructing a player on the server is a clear error', () => {
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
