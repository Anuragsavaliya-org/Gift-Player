import { afterEach, describe, expect, it } from 'vitest';
import { registerResolver, resolveSource, sourceIdentity } from '../src/player/asset';

const undo: (() => void)[] = [];
afterEach(() => undo.splice(0).forEach((f) => f()));

describe('source resolvers', () => {
  it('a string result is the URL and the cache key', async () => {
    undo.push(registerResolver('gift', async (ref) => `https://cdn.test/${ref}.svga`));
    expect(await resolveSource('gift:12345')).toEqual({ key: 'https://cdn.test/12345.svga', source: 'https://cdn.test/12345.svga' });
  });

  it('bytes / Blob results are cached under the original reference', async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    undo.push(registerResolver('local', () => bytes));
    expect(await resolveSource('local:x')).toEqual({ key: 'local:x', source: bytes });
  });

  it('is case-insensitive on the scheme, passes the signal, and unregisters', async () => {
    const ctl = new AbortController();
    let seen: AbortSignal | undefined;
    const off = registerResolver('Gift', (_ref, ctx) => ((seen = ctx.signal), 'https://x.test/a.svga'));
    await resolveSource('GIFT:1', ctl.signal);
    expect(seen).toBe(ctl.signal);
    off();
    expect(await resolveSource('gift:1')).toEqual({ key: 'gift:1', source: 'gift:1' }); // no resolver: treated as a plain string
  });

  it('a throwing resolver is a network error; an abort is aborted', async () => {
    undo.push(registerResolver('bad', () => { throw new Error('no such gift'); }));
    await expect(resolveSource('bad:1')).rejects.toMatchObject({ code: 'network' });
    const ctl = new AbortController();
    ctl.abort();
    await expect(resolveSource('bad:1', ctl.signal)).rejects.toMatchObject({ code: 'aborted' });
  });

  it('refuses reserved and malformed schemes', () => {
    expect(() => registerResolver('https', () => 'x')).toThrow(/Cannot register/);
    expect(() => registerResolver('1bad', () => 'x')).toThrow(/Cannot register/);
  });

  it('files handed over directly are not cached, relative URLs become absolute when a location exists', async () => {
    const blob = new Blob(['x']);
    expect((await resolveSource(blob)).key).toBeNull();
    expect(sourceIdentity(blob)).toBe(sourceIdentity(blob));
    expect(sourceIdentity(blob)).not.toBe(sourceIdentity(new Blob(['x'])));
    expect((await resolveSource('/a.svga')).key).toBe('/a.svga'); // no `location` in Node
  });
});
