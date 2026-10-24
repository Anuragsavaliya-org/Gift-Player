import { describe, expect, it } from 'vitest';
import { AssetCache, type CacheLoaded } from '../src/cache/asset-cache';

/** A loader that records how often each asset was created and disposed. */
function world() {
  const log = { loads: [] as string[], disposed: [] as string[] };
  const loader = (name: string, bytes: number, delay = 0) => async (signal: AbortSignal): Promise<CacheLoaded<string>> => {
    log.loads.push(name);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (signal.aborted) throw new Error('load aborted');
    return { asset: name, bytes, dispose: () => log.disposed.push(name) };
  };
  return { log, loader };
}

describe('AssetCache', () => {
  it('evicts the least recently used idle asset when the byte budget is exceeded', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>({ maxBytes: 100 });
    for (const [k, n] of [['a', 40], ['b', 40], ['c', 40]] as const) (await c.acquire(k, loader(k, n))).release();
    expect(log.disposed).toEqual(['a']); // 120 > 100: oldest idle goes
    expect(c.has('a')).toBe(false);
    expect(c.stats).toMatchObject({ bytes: 80, entries: 2, evictions: 1 });
    // touching b makes c the oldest
    (await c.acquire('b', loader('b', 40))).release();
    (await c.acquire('d', loader('d', 40))).release();
    expect(log.disposed).toEqual(['a', 'c']);
  });

  it('never evicts an asset that is in use, even over budget, and evicts it when released', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>({ maxBytes: 50 });
    const held = await c.acquire('big', loader('big', 200));
    (await c.acquire('x', loader('x', 10))).release();
    expect(log.disposed).not.toContain('big');
    expect(log.disposed).toEqual(['x']); // the idle one is the only candidate while over budget
    expect(c.stats.bytes).toBe(200); // the leased one stays, over budget
    held.release();
    expect(log.disposed).toEqual(['x', 'big']);
    expect(c.stats.bytes).toBe(0);
  });

  it('shares one copy between two holders and disposes it exactly once', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>({ maxBytes: 10 });
    const a = await c.acquire('k', loader('k', 100));
    const b = await c.acquire('k', loader('k', 100));
    expect(a.asset).toBe(b.asset);
    expect(log.loads).toEqual(['k']);
    a.release();
    a.release(); // idempotent
    expect(log.disposed).toEqual([]);
    b.release();
    expect(log.disposed).toEqual(['k']);
    c.clear();
    expect(log.disposed).toEqual(['k']);
  });

  it('shares one load between concurrent requests', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>();
    const [a, b] = await Promise.all([c.acquire('k', loader('k', 1, 10)), c.acquire('k', loader('k', 1, 10))]);
    expect(log.loads).toEqual(['k']);
    expect(c.stats.inUse).toBe(1);
    a.release();
    b.release();
  });

  it('aborts a load only when every requester has aborted', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>();
    const x = new AbortController();
    const y = new AbortController();
    const pa = c.acquire('k', loader('k', 1, 30), x.signal);
    const pb = c.acquire('k', loader('k', 1, 30), y.signal);
    x.abort();
    await expect(pa).rejects.toMatchObject({ code: 'aborted' });
    const lb = await pb; // y still wanted it
    expect(lb.asset).toBe('k');
    lb.release();
    const z = new AbortController();
    const pc = c.acquire('slow', loader('slow', 1, 30), z.signal);
    z.abort();
    await expect(pc).rejects.toMatchObject({ code: 'aborted' });
    await new Promise((r) => setTimeout(r, 50));
    expect(c.has('slow')).toBe(false);
    expect(log.disposed.filter((n) => n === 'slow')).toEqual([]); // the aborted loader threw before producing anything
  });

  it('does not keep failures, and a later request retries', async () => {
    const c = new AssetCache<string>();
    let n = 0;
    const flaky = async (): Promise<CacheLoaded<string>> => {
      if (n++ === 0) throw new Error('boom');
      return { asset: 'ok', bytes: 1, dispose() {} };
    };
    await expect(c.acquire('k', flaky)).rejects.toThrow('boom');
    expect((await c.acquire('k', flaky)).asset).toBe('ok');
  });

  it('setMaxBytes evicts idle assets; destroy disposes idle ones now and leased ones on release', async () => {
    const { log, loader } = world();
    const c = new AssetCache<string>({ maxBytes: 1000 });
    (await c.acquire('a', loader('a', 300))).release();
    const b = await c.acquire('b', loader('b', 300));
    c.setMaxBytes(300);
    expect(log.disposed).toEqual(['a']);
    c.destroy();
    expect(log.disposed).toEqual(['a']);
    b.release();
    expect(log.disposed).toEqual(['a', 'b']);
    expect(c.stats.disposed).toBe(2);
  });
});
