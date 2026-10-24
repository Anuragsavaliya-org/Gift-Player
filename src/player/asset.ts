import type { AssetCache, CacheLoaded } from '../cache/asset-cache';
import { detectFormat, type FormatInfo } from '../core/detect';
import { GiftPlayerError } from '../core/errors';
import { readSource, type GiftSource } from '../core/source';
import { readGifMeta, readWebpMeta } from '../formats/image/meta';
import { loadPagEngine, type PagEngineOptions } from '../formats/pag/engine';
import { decodeSvgaImages, releaseSvgaImages, type SvgaBitmap } from '../formats/svga/decode-images';
import { parseSvga } from '../formats/svga/parse';
import type { SvgaMovie } from '../formats/svga/types';

/** A gift file that is fetched, parsed and decoded as far as can be shared between players. */
export interface LoadedGift {
  info: FormatInfo;
  bytes: Uint8Array;
  /** SVGA only: the parsed movie and its decoded images (shared and read-only; the cache closes the images). */
  svga?: { movie: SvgaMovie; images: Map<string, SvgaBitmap> };
}

/** What a resolver may return for a reference like `gift:12345`: a URL to fetch, or the file itself. */
export type ResolvedSource = string | ArrayBuffer | ArrayBufferView | Blob;

/**
 * Maps the part after `scheme:` to a gift file. Return a URL (fetched, and used as the cache key) or the bytes directly
 * (cached under the original `scheme:ref` string).
 */
export type SourceResolver = (ref: string, context: { signal: AbortSignal | undefined }) => ResolvedSource | Promise<ResolvedSource>;

const resolvers = new Map<string, SourceResolver>();

/**
 * Registers a resolver for `scheme` (without the colon), e.g. `registerResolver('gift', async (id) => `https://cdn.example/${id}.svga`)`
 * so `player.load('gift:12345')` works. Replaces an earlier resolver for the same scheme. Returns a function that unregisters it.
 * Schemes `http`, `https`, `blob` and `data` are reserved and cannot be registered.
 */
export function registerResolver(scheme: string, resolver: SourceResolver): () => void {
  const s = scheme.toLowerCase().replace(/:$/, '');
  if (!/^[a-z][a-z0-9+.-]*$/.test(s) || ['http', 'https', 'blob', 'data', 'file'].includes(s)) {
    throw new GiftPlayerError('invalid-input', `Cannot register a resolver for the scheme "${scheme}".`);
  }
  resolvers.set(s, resolver);
  return () => {
    if (resolvers.get(s) === resolver) resolvers.delete(s);
  };
}

/** A source after resolvers have run: what to read, and the cache key (null = do not cache). */
export interface ResolvedGift {
  key: string | null;
  source: GiftSource;
}

const SCHEME = /^([a-z][a-z0-9+.-]*):(.*)$/is;
const blobIds = new WeakMap<object, number>();
let nextBlobId = 1;

/** Stable identity string for a non-string source (used by the queue to compare items). */
export function sourceIdentity(src: GiftSource): string {
  if (typeof src === 'string') return src;
  let id = blobIds.get(src as object);
  if (!id) blobIds.set(src as object, (id = nextBlobId++));
  return `#object:${id}`;
}

const absolute = (url: string): string => {
  try {
    return typeof location !== 'undefined' ? new URL(url, location.href).href : url;
  } catch {
    return url;
  }
};

/** Runs the resolver for `src` (if its scheme is registered) and works out the cache key. */
export async function resolveSource(src: GiftSource, signal?: AbortSignal): Promise<ResolvedGift> {
  if (typeof src !== 'string') return { key: null, source: src }; // files handed over directly are not cached
  const m = SCHEME.exec(src);
  const resolver = m && m[1] ? resolvers.get(m[1].toLowerCase()) : undefined;
  if (!resolver || !m) return { key: absolute(src), source: src };
  let out: ResolvedSource;
  try {
    out = await resolver(m[2] ?? '', { signal });
  } catch (cause) {
    if (signal?.aborted) throw new GiftPlayerError('aborted', 'The load was aborted.', { cause });
    if (cause instanceof GiftPlayerError) throw cause;
    throw new GiftPlayerError('network', `The "${m[1]}" resolver failed for "${src}".`, { cause });
  }
  if (typeof out === 'string') return { key: absolute(out), source: out };
  return { key: src, source: out };
}

const imageBytes = (b: SvgaBitmap) => b.width * b.height * 4;

/** Fetches, detects, parses and decodes (SVGA images) one gift. Used as the cache loader. */
export function loadGift(source: GiftSource, pag: PagEngineOptions, signal: AbortSignal): Promise<CacheLoaded<LoadedGift>> {
  return (async () => {
    const bytes = await readSource(source, { signal });
    if (signal.aborted) throw new GiftPlayerError('aborted', 'The load was aborted.');
    const info = detectFormat(bytes);
    if (info.format === 'svga') {
      const movie = parseSvga(bytes);
      const { bitmaps, failed } = await decodeSvgaImages(movie);
      if (signal.aborted) {
        releaseSvgaImages(bitmaps);
        throw new GiftPlayerError('aborted', 'The load was aborted.');
      }
      if (failed.length > 0 && bitmaps.size === 0) throw new GiftPlayerError('decode-failed', `None of the ${failed.length} images in this SVGA could be decoded.`);
      if (failed.length > 0) console.warn(`[gift-player] ${failed.length} image(s) of this SVGA could not be decoded and are skipped: ${failed.join(', ')}`);
      let size = 0;
      for (const b of bitmaps.values()) size += imageBytes(b);
      for (const img of movie.images.values()) size += img.data.byteLength; // the parsed movie keeps the encoded copies
      return { asset: { info, bytes: new Uint8Array(0), svga: { movie, images: bitmaps } }, bytes: size, dispose: () => releaseSvgaImages(bitmaps) };
    }
    if (info.format === 'gif' || info.format === 'webp') {
      let meta;
      try {
        meta = info.format === 'gif' ? readGifMeta(bytes) : readWebpMeta(bytes);
      } catch (cause) {
        throw cause instanceof GiftPlayerError ? cause : new GiftPlayerError('parse-failed', 'This image file is corrupt.', { cause });
      }
      // One decoded frame is the working set; the encoded bytes are kept.
      const size = bytes.byteLength + Math.max(meta.width, 1) * Math.max(meta.height, 1) * 4;
      return { asset: { info, bytes }, bytes: size, dispose: () => {} };
    }
    // PAG: the decoded layers live inside the engine per player; here we keep the file and warm the engine, so the first
    // frame of a queued gift does not wait for the WASM download.
    await loadPagEngine(pag);
    if (signal.aborted) throw new GiftPlayerError('aborted', 'The load was aborted.');
    return { asset: { info, bytes }, bytes: bytes.byteLength * 4, dispose: () => {} };
  })();
}

/** A hold on a loaded gift. Release it when done; a cached gift then becomes evictable again. */
export interface GiftLease {
  readonly gift: LoadedGift;
  release(): void;
}

/** The cache type used for gifts. */
export type GiftCache = AssetCache<LoadedGift>;

/**
 * Resolves `src` and returns a lease on the loaded gift: from the cache when it is a cacheable source (URL / resolved reference),
 * otherwise loaded privately and disposed on release.
 */
export async function acquireGift(cache: GiftCache, src: GiftSource, pag: PagEngineOptions, signal?: AbortSignal): Promise<GiftLease> {
  const resolved = await resolveSource(src, signal);
  if (resolved.key !== null) {
    const lease = await cache.acquire(resolved.key, (s) => loadGift(resolved.source, pag, s), signal);
    return { gift: lease.asset, release: () => lease.release() };
  }
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const loaded = await loadGift(resolved.source, pag, ctl.signal);
    if (signal?.aborted) {
      loaded.dispose();
      throw new GiftPlayerError('aborted', 'The load was aborted.');
    }
    let open = true;
    return { gift: loaded.asset, release: () => { if (open) { open = false; loaded.dispose(); } } };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
