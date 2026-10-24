import { GiftPlayerError } from '../core/errors';

/** What a loader hands to the cache. */
export interface CacheLoaded<T> {
  asset: T;
  /** Estimated decoded size in bytes (images: width x height x 4). Counts against the budget. */
  bytes: number;
  /** Frees the asset's resources (closes images). Called exactly once, when the entry is evicted/cleared with no users. */
  dispose(): void;
}

/** A hold on a cached asset. While any lease is open the asset is never evicted. */
export interface Lease<T> {
  readonly asset: T;
  /** Gives the asset back. Idempotent. */
  release(): void;
}

/** Snapshot of a cache (`cache.stats`). */
export interface CacheStats {
  /** Estimated decoded bytes held (in use + idle). */
  bytes: number;
  /** Budget. In-use assets can push `bytes` above it; they are never evicted. */
  maxBytes: number;
  entries: number;
  /** Entries with at least one open lease. */
  inUse: number;
  hits: number;
  misses: number;
  evictions: number;
  /** How many times an asset's `dispose` ran. */
  disposed: number;
  /** Loads currently in flight. */
  loading: number;
}

/** Options for `new AssetCache(options)`. */
export interface AssetCacheOptions {
  /** Budget for idle + in-use assets, in estimated decoded bytes. Default 64 MB. */
  maxBytes?: number;
}

interface Entry<T> {
  key: string;
  loaded: CacheLoaded<T> | null;
  refs: number;
  /** Callers still waiting for the load (the load is aborted when the last one gives up). */
  waiters: number;
  controller: AbortController;
  promise: Promise<CacheLoaded<T>> | null;
  bytes: number;
}

/** Default cache budget: 64 MB of estimated decoded bytes. */
export const DEFAULT_CACHE_BYTES = 64 * 1024 * 1024;

const aborted = () => new GiftPlayerError('aborted', 'The operation was aborted.');

/**
 * LRU cache of loaded (parsed and decoded) assets, keyed by resolved source, with a budget in estimated decoded bytes and
 * reference counting: an asset any player holds is never evicted, and two players showing the same gift share one copy.
 * Concurrent requests for a key share one load; the load is aborted only when every requester has aborted.
 */
export class AssetCache<T = unknown> {
  private maxBytes: number;
  private readonly entries = new Map<string, Entry<T>>(); // insertion order = recency (oldest first)
  private stats_ = { hits: 0, misses: 0, evictions: 0, disposed: 0 };

  constructor(options: AssetCacheOptions = {}) {
    this.maxBytes = options.maxBytes ?? DEFAULT_CACHE_BYTES;
  }

  /** Changes the budget and evicts idle assets until it fits. */
  setMaxBytes(maxBytes: number): void {
    this.maxBytes = maxBytes;
    this.evict();
  }

  /**
   * Returns a lease on the asset for `key`, loading it with `load` when it is not cached (or in flight).
   * `load` receives an AbortSignal that fires when every requester has aborted.
   */
  async acquire(key: string, load: (signal: AbortSignal) => Promise<CacheLoaded<T>>, signal?: AbortSignal): Promise<Lease<T>> {
    if (signal?.aborted) throw aborted();
    let entry = this.entries.get(key);
    if (entry?.loaded) {
      this.stats_.hits++;
      this.touch(entry);
      return this.lease(entry);
    }
    if (!entry) {
      this.stats_.misses++;
      const controller = new AbortController();
      const e: Entry<T> = { key, loaded: null, refs: 0, waiters: 0, controller, promise: null, bytes: 0 };
      e.promise = load(controller.signal).then(
        (loaded) => {
          if (controller.signal.aborted) {
            // Everyone gave up while it loaded: do not keep it.
            this.stats_.disposed++;
            loaded.dispose();
            throw aborted();
          }
          e.loaded = loaded;
          e.bytes = loaded.bytes;
          return loaded;
        },
        (err) => {
          if (this.entries.get(key) === e) this.entries.delete(key);
          throw err;
        },
      );
      e.promise.catch(() => {}); // failures are reported to the waiters, never as an unhandled rejection
      this.entries.set(key, e);
      entry = e;
    } else {
      this.stats_.hits++; // joined a load in flight
    }
    const e = entry;
    e.waiters++;
    let onAbort: (() => void) | undefined;
    try {
      await Promise.race([
        e.promise!,
        new Promise<never>((_, reject) => {
          if (!signal) return;
          onAbort = () => reject(aborted());
          signal.addEventListener('abort', onAbort, { once: true });
        }),
      ]);
    } catch (err) {
      e.waiters--;
      if (e.waiters === 0 && !e.loaded) {
        e.controller.abort();
        if (this.entries.get(key) === e) this.entries.delete(key);
      }
      throw err;
    } finally {
      if (onAbort) signal!.removeEventListener('abort', onAbort);
    }
    e.waiters--;
    if (signal?.aborted) {
      // Aborted at the same moment the load finished: keep the asset cached, hand nothing out.
      this.evict();
      throw aborted();
    }
    this.touch(e);
    const lease = this.lease(e);
    this.evict();
    return lease;
  }

  /** Loads `key` into the cache without keeping a lease (the asset may be evicted later). */
  async preload(key: string, load: (signal: AbortSignal) => Promise<CacheLoaded<T>>, signal?: AbortSignal): Promise<void> {
    (await this.acquire(key, load, signal)).release();
  }

  has(key: string): boolean {
    return !!this.entries.get(key)?.loaded;
  }

  /** Disposes every idle asset. Assets in use stay until their leases are released (then they are evicted if over budget; call again). */
  clear(): void {
    for (const e of [...this.entries.values()]) if (e.loaded && e.refs === 0) this.drop(e, false);
  }

  /** Disposes everything idle and aborts loads in flight. Leased assets are disposed when their last lease is released. */
  destroy(): void {
    this.maxBytes = 0;
    for (const e of [...this.entries.values()]) {
      if (!e.loaded) e.controller.abort();
      else if (e.refs === 0) this.drop(e, false);
    }
  }

  get stats(): CacheStats {
    let bytes = 0;
    let inUse = 0;
    let loading = 0;
    for (const e of this.entries.values()) {
      if (e.loaded) bytes += e.bytes;
      else loading++;
      if (e.refs > 0) inUse++;
    }
    return { bytes, maxBytes: this.maxBytes, entries: [...this.entries.values()].filter((e) => e.loaded).length, inUse, loading, ...this.stats_ };
  }

  private lease(e: Entry<T>): Lease<T> {
    e.refs++;
    let open = true;
    return {
      asset: e.loaded!.asset,
      release: () => {
        if (!open) return;
        open = false;
        e.refs--;
        if (e.refs === 0) this.evict();
      },
    };
  }

  private touch(e: Entry<T>): void {
    this.entries.delete(e.key);
    this.entries.set(e.key, e);
  }

  private evict(): void {
    let bytes = 0;
    for (const e of this.entries.values()) if (e.loaded) bytes += e.bytes;
    if (bytes <= this.maxBytes) return;
    for (const e of [...this.entries.values()]) { // oldest first
      if (bytes <= this.maxBytes) break;
      if (!e.loaded || e.refs > 0) continue;
      bytes -= e.bytes;
      this.drop(e, true);
    }
  }

  private drop(e: Entry<T>, eviction: boolean): void {
    this.entries.delete(e.key);
    if (eviction) this.stats_.evictions++;
    this.stats_.disposed++;
    const loaded = e.loaded!;
    e.loaded = null;
    try {
      loaded.dispose();
    } catch (err) {
      console.error('[gift-player] disposing a cached asset failed', err);
    }
  }
}
