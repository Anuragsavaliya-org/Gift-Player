import type { Replacement, Replacements } from '@gift-player/root';

const sameStyle = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** True when two replacements would show the same thing (images are compared by identity). */
export function sameReplacement(a: Replacement, b: Replacement): boolean {
  if ('text' in a) return 'text' in b && a.text === b.text && sameStyle(a.style, b.style);
  if ('image' in a) return 'image' in b && a.image === b.image && sameStyle(a.options, b.options);
  return 'hidden' in b && a.hidden === b.hidden;
}

/** What has to be applied to go from `prev` to `next`: the keys whose replacement is new or different, and the keys that went away. */
export function diffReplacements(prev: Replacements | undefined, next: Replacements | undefined): { changed: [string, Replacement][]; cleared: string[] } {
  const changed: [string, Replacement][] = [];
  const cleared: string[] = [];
  for (const [key, r] of Object.entries(next ?? {})) {
    const before = prev?.[key];
    if (!before || !sameReplacement(before, r)) changed.push([key, r]);
  }
  for (const key of Object.keys(prev ?? {})) if (!next || !(key in next)) cleared.push(key);
  return { changed, cleared };
}
