import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf8'));

/** A fresh copy of the engine module (it keeps page-wide singletons). */
const fresh = async () => {
  vi.resetModules();
  delete (globalThis as Record<symbol, unknown>)[Symbol.for('@gift-player/pag-engine')]; // the engine state lives on globalThis
  return import('../src/formats/pag/engine');
};

function mockEngine() {
  const calls = { init: 0, retain: 0, release: 0, locate: [] as string[] };
  const PAG = { globalCanvas: { retain: () => void calls.retain++, release: () => void calls.release++ } };
  const pagModule = async () => ({
    PAGInit: async (o?: { locateFile?: (f: string) => string }) => {
      calls.init++;
      calls.locate.push(o?.locateFile?.('libpag.wasm') ?? '');
      return PAG as never;
    },
  });
  return { calls, pagModule, PAG };
}

describe('pinned engine version', () => {
  it('PAG_VERSION is the exact libpag version in devDependencies (an exact pin, no range)', async () => {
    const { PAG_VERSION } = await fresh();
    expect(pkg.devDependencies.libpag).toBe(PAG_VERSION);
    expect(PAG_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('the default URLs are the version-pinned jsDelivr files', async () => {
    const e = await fresh();
    expect(e.DEFAULT_PAG_MODULE_URL).toBe(`https://cdn.jsdelivr.net/npm/libpag@${e.PAG_VERSION}/lib/libpag.esm.js`);
    expect(e.DEFAULT_PAG_WASM_URL).toBe(`https://cdn.jsdelivr.net/npm/libpag@${e.PAG_VERSION}/lib/libpag.wasm`);
  });

  it('libpag is not a runtime dependency of the package', () => {
    expect(pkg.dependencies?.libpag).toBeUndefined();
  });
});

describe('loadPagEngine', () => {
  let e: Awaited<ReturnType<typeof fresh>>;
  beforeEach(async () => {
    e = await fresh();
  });

  it('initialises once however often and however concurrently it is called, holding exactly one context reference', async () => {
    const m = mockEngine();
    const [a, b, c] = await Promise.all([e.loadPagEngine({ pagModule: m.pagModule }), e.loadPagEngine({ pagModule: m.pagModule }), e.loadPagEngine({ pagModule: m.pagModule })]);
    await e.loadPagEngine({ pagModule: m.pagModule });
    expect(m.calls.init).toBe(1);
    expect(m.calls.retain).toBe(1);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it('points the engine at the pinned WASM URL by default, and at an override when given', async () => {
    const m = mockEngine();
    await e.loadPagEngine({ pagModule: m.pagModule });
    expect(m.calls.locate[0]).toBe(e.DEFAULT_PAG_WASM_URL);
    const e2 = await fresh();
    const m2 = mockEngine();
    await e2.loadPagEngine({ pagModule: m2.pagModule, pagWasmUrl: '/self-hosted/libpag.wasm' });
    expect(m2.calls.locate[0]).toBe('/self-hosted/libpag.wasm');
  });

  it('a second call with different URLs reuses the first engine and warns', async () => {
    const m = mockEngine();
    await e.loadPagEngine({ pagModule: m.pagModule });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await e.loadPagEngine({ pagModuleUrl: '/elsewhere.js' });
    expect(warn).toHaveBeenCalledOnce();
    expect(m.calls.init).toBe(1);
    warn.mockRestore();
  });

  it('wraps a failed module load in a engine-load-failed error that names the CSP, and allows a retry', async () => {
    await expect(e.loadPagEngine({ pagModule: async () => { throw new Error('blocked by CSP'); } })).rejects.toMatchObject({ code: 'engine-load-failed', message: expect.stringMatching(/Content-Security-Policy/) });
    const m = mockEngine();
    await expect(e.loadPagEngine({ pagModule: m.pagModule })).resolves.toBeTruthy(); // not stuck on the failure
  });

  it('wraps a WASM failure and mentions wasm-unsafe-eval', async () => {
    await expect(e.loadPagEngine({ pagModule: async () => ({ PAGInit: async () => { throw new Error('CompileError'); } }) })).rejects.toMatchObject({ code: 'engine-load-failed', message: expect.stringMatching(/wasm-unsafe-eval/) });
  });

  it('reports "WebGL is not available" as unsupported-format', async () => {
    const pagModule = async () => ({ PAGInit: async () => ({ globalCanvas: { retain: () => { throw new Error('Canvas context is not WebGL!'); }, release() {} } }) as never });
    await expect(e.loadPagEngine({ pagModule })).rejects.toMatchObject({ code: 'unsupported-format', message: expect.stringMatching(/WebGL/) });
  });

  it('releasePagEngineContext gives the context back once; the next load takes it again without re-initialising WASM', async () => {
    const m = mockEngine();
    await e.loadPagEngine({ pagModule: m.pagModule });
    await e.releasePagEngineContext();
    await e.releasePagEngineContext(); // idempotent
    expect(m.calls.release).toBe(1);
    await e.loadPagEngine({ pagModule: m.pagModule });
    expect(m.calls.retain).toBe(2);
    expect(m.calls.init).toBe(1);
  });
});
