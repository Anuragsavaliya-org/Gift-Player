/** Samples in /samples, available on the dev server through Vite's URL imports. */
const loaders = import.meta.glob(['../../samples/*.svga', '../../samples/corpus/*.svga'], { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

const PREFIX = '../../samples/';
/** Names relative to /samples: `angel.svga`, or `corpus/<file>.svga` for files in the (git-ignored) corpus. */
export const sampleNames = Object.keys(loaders).map((p) => p.slice(PREFIX.length)).sort();

export async function sampleUrl(name: string): Promise<string> {
  const loader = loaders[`${PREFIX}${name}`];
  if (!loader) throw new Error(`unknown sample ${name}`);
  return loader();
}

export async function sampleBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(await sampleUrl(name))).arrayBuffer());
}
