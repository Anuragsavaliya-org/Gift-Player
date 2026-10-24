/**
 * Lazy loader for libpag (the PAG engine: ~300 KB JS + ~1.5 MB WASM). Nothing here is imported until a PAG file is
 * actually opened, and the engine's JS is fetched at runtime by URL, so it is never part of this package's bundle.
 *
 * Content-Security-Policy needs for the defaults (self-hosting removes the CDN entries):
 *   script-src  https://cdn.jsdelivr.net 'wasm-unsafe-eval'   (the engine module, and compiling its WebAssembly)
 *   connect-src https://cdn.jsdelivr.net                      (fetching the .wasm)
 */
import { GiftPlayerError } from '../../core/errors';
import type { PagModuleExports, PagModuleLike } from './types';

/** The libpag version this SDK is tested with. Keep in sync with package.json (a test checks it). */
export const PAG_VERSION = '4.5.85';
/** Where the PAG engine module is fetched from by default (pinned jsDelivr copy). */
export const DEFAULT_PAG_MODULE_URL = `https://cdn.jsdelivr.net/npm/libpag@${PAG_VERSION}/lib/libpag.esm.js`;
/** Where the PAG engine WebAssembly is fetched from by default (pinned jsDelivr copy). */
export const DEFAULT_PAG_WASM_URL = `https://cdn.jsdelivr.net/npm/libpag@${PAG_VERSION}/lib/libpag.wasm`;

/** Where to load the PAG engine from (all optional). */
export interface PagEngineOptions {
  /** URL of `libpag.esm.js`. Default: the pinned jsDelivr copy. Override to self-host. */
  pagModuleUrl?: string;
  /** URL of `libpag.wasm`. Default: the pinned jsDelivr copy. Override to self-host. */
  pagWasmUrl?: string;
  /** Load the engine yourself instead, e.g. `() => import('libpag')` when your bundler has the package installed. */
  pagModule?: () => Promise<PagModuleExports>;
}

/** A loaded PAG engine. */
export interface PagEngine {
  PAG: PagModuleLike;
  /** Wall-clock milliseconds the engine took to download, compile and initialise (first load only). */
  loadMs: number;
}

let loading: Promise<PagEngine> | null = null;
let loadedKey = '';
let anchorHeld = false;

/** Holds one reference to libpag's shared WebGL canvas (see below); idempotent. */
function holdContext(PAG: PagModuleLike): void {
  if (anchorHeld) return;
  try {
    // Every PAG view in Canvas2D mode retains/releases the same shared WebGL canvas, so without this the context would be
    // destroyed whenever the last gift ends and a new one created for the next. With hundreds of gifts the browser's
    // ~16 context limit becomes a real risk. Holding one reference keeps exactly one context alive for the page.
    PAG.globalCanvas.retain();
    anchorHeld = true;
  } catch (cause) {
    throw new GiftPlayerError('unsupported-format', 'WebGL is not available, which PAG needs.', { cause });
  }
}

/**
 * Loads (once per page) and initialises the PAG engine. Safe to call concurrently; later calls with different URLs reuse
 * the first engine (WebAssembly modules cannot be swapped in a running page) and warn.
 */
export async function loadPagEngine(options: PagEngineOptions = {}): Promise<PagEngine> {
  const moduleUrl = options.pagModuleUrl ?? DEFAULT_PAG_MODULE_URL;
  const wasmUrl = options.pagWasmUrl ?? DEFAULT_PAG_WASM_URL;
  const key = options.pagModule ? 'custom-loader' : `${moduleUrl}|${wasmUrl}`;
  if (loading) {
    if (key !== loadedKey) console.warn(`[gift-player] the PAG engine is already loaded from ${loadedKey}; ignoring ${key}.`);
  } else {
    loadedKey = key;
    loading = (async () => {
      const t0 = performance.now();
      let exports: PagModuleExports;
      try {
        // A variable specifier on purpose: bundlers must not try to resolve (and include) libpag.
        exports = options.pagModule ? await options.pagModule() : ((await import(/* @vite-ignore */ /* webpackIgnore: true */ moduleUrl)) as PagModuleExports);
      } catch (cause) {
        throw new GiftPlayerError('engine-load-failed', `Could not load the PAG engine from ${options.pagModule ? 'the custom loader' : moduleUrl}. Check the URL, CORS and your Content-Security-Policy (script-src).`, { cause });
      }
      let PAG: PagModuleLike;
      try {
        PAG = await exports.PAGInit({ locateFile: () => wasmUrl });
      } catch (cause) {
        throw new GiftPlayerError('engine-load-failed', `Could not initialise the PAG engine (WebAssembly from ${wasmUrl}). Check the URL, CORS and that your CSP allows 'wasm-unsafe-eval' and connect-src.`, { cause });
      }
      return { PAG, loadMs: Math.round(performance.now() - t0) };
    })();
    loading.catch(() => {
      loading = null; // allow a retry after a failed load
    });
  }
  const engine = await loading;
  holdContext(engine.PAG);
  return engine;
}

/**
 * Releases the page-lifetime WebGL context reference. The WASM module stays in memory; the next `loadPagEngine` takes a
 * context again. Views that are still alive keep their own reference.
 */
export async function releasePagEngineContext(): Promise<void> {
  if (!loading || !anchorHeld) return;
  const engine = await loading.catch(() => null);
  if (!engine) return;
  anchorHeld = false;
  const canvas = engine.PAG.globalCanvas.canvas;
  const gl = canvas ? (canvas.getContext('webgl') as WebGLRenderingContext | null) : null; // the existing context, not a new one
  engine.PAG.globalCanvas.release();
  // libpag only drops its references; the browser would keep the context alive until garbage collection. When this was the last
  // reference (no PAG view is alive), give it back explicitly so the page's WebGL context count really returns to zero.
  if (gl && !engine.PAG.globalCanvas.canvas) gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * Appends font families that libpag tries, in order, for characters its primary font lacks (it is added in front of libpag's
 * built-in list: Arial, Microsoft YaHei, PingFang, emoji fonts, ...). This changes which font a glyph is taken from; it does NOT
 * add text shaping (see the Hindi / Gujarati / Arabic finding in PROGRESS.md).
 */
export async function setPagFallbackFonts(families: string[], options: PagEngineOptions = {}): Promise<void> {
  const { PAG } = await loadPagEngine(options);
  PAG.PAGFont.registerFallbackFontNames(families);
}
