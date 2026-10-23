/** Samples in /samples, available on the dev server through Vite's URL imports. */
const loaders = import.meta.glob('../../samples/*.svga', { query: '?url', import: 'default' }) as Record<string, () => Promise<string>>;

export const sampleNames = Object.keys(loaders).map((p) => p.split('/').pop()!).sort();

export async function sampleUrl(name: string): Promise<string> {
  const path = Object.keys(loaders).find((p) => p.endsWith(`/${name}`));
  if (!path) throw new Error(`unknown sample ${name}`);
  return loaders[path]!();
}

export async function sampleBytes(name: string): Promise<Uint8Array> {
  return new Uint8Array(await (await fetch(await sampleUrl(name))).arrayBuffer());
}
