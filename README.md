# @incodes/gift-player

Play animated gift files through one API: **SVGA** (1.x and 2.x), **GIF**, **animated and static WebP**, and **PAG**. Plain TypeScript, no framework needed, with a React wrapper and a queue for live streams.

> The package name and license are placeholders until the owner decides them (`package.json` says `UNLICENSED`).

```sh
npm install @incodes/gift-player
```

React 18 or newer is an optional peer dependency (only for `@incodes/gift-player/react`).

## Quick start

### Vanilla

```ts
import { GiftPlayer } from '@incodes/gift-player';

const player = new GiftPlayer(document.getElementById('stage')!); // the element needs a size (CSS)
await player.load('https://cdn.example.com/rocket.svga');         // SVGA, GIF, WebP or PAG: detected from the bytes
await player.play();                                              // resolves when the gift has ended
player.destroy();
```

The player puts one `<canvas>` in the element and reuses it for every `load()`. After the last play the canvas is cleared, so a finished gift never stays frozen on top of your video (`clearOnEnd: false` keeps the last frame).

### Queue (live streams)

```ts
import { GiftPlayer, GiftQueue } from '@incodes/gift-player';

const queue = new GiftQueue(new GiftPlayer(stage), { maxLength: 50, preloadAhead: 2, coalesce: true });
queue.on('item-start', (i) => badge.show(i.count)); // "x10" combo badge when identical gifts are merged
queue.on('item-error', (i) => console.warn(i.src, i.error.code)); // a broken gift is skipped, the queue goes on
queue.add('https://cdn.example.com/rocket.svga', { priority: 5, replacements: { name: { text: 'Rahul' } } });
```

One gift at a time; higher `priority` first, first come first served within a priority. When `maxLength` waiting gifts are queued, the lowest priority (oldest first) is dropped (`item-dropped`, reason `overflow`). The next `preloadAhead` gifts are fetched, parsed and decoded while the current one plays. Each gift plays once unless you pass `loops` (`0` = forever) or `defaultLoops`.

### React and Next.js

```tsx
'use client';
import { GiftPlayerView } from '@incodes/gift-player/react';

export function Gift({ name }: { name: string }) {
  return <GiftPlayerView src="/gifts/rocket.svga" replacements={{ name: { text: name } }} style={{ width: 360, height: 360 }} onEnd={() => console.log('done')} />;
}
```

* `<GiftPlayerView>` is client-only: use it from a Client Component (the entry already carries `'use client'`). Changing `src` reloads (the load in flight is aborted), changing `replacements` updates in place, unmounting destroys the player, and React StrictMode's double mount leaves exactly one player.
* `useGiftQueue(options)` returns `{ queue, containerRef, stats }`: attach `containerRef` to a sized element, call `queue?.add(...)` from event handlers.
* **Server components and route handlers can import the package** (it touches no browser global at import time), e.g. for `detectFormat`, `GiftPlayerError` or types. Constructing `GiftPlayer` on the server throws `invalid-input`.

## Formats and browsers

| format | notes |
|---|---|
| SVGA 1.x / 2.x | parsed and drawn by this package (Canvas 2D): shapes, mattes, clip paths, text and image replacement |
| GIF | own decoder, or the browser's `ImageDecoder` where it is reliable |
| WebP (animated and still) | `ImageDecoder` where reliable, otherwise a built-in frame re-wrapper |
| PAG | [libpag](https://github.com/Tencent/libpag) 4.5.85 (Apache-2.0), **loaded on first use** (see below); text and image layers can be replaced |

| browser | status |
|---|---|
| Chrome / Chromium | verified (Chromium 156) |
| Safari / WebKit | verified with Playwright WebKit 27.2 on macOS; real iPhones not yet tested |
| Firefox | verified in CI only (the CI workflow runs the whole suite in Firefox; no local results yet) |

Needs: Canvas 2D, ES2022, `fetch`. PAG additionally needs WebAssembly and WebGL.

## PAG setup

PAG files are played by libpag (≈ 300 KB JS + 1.5 MB WASM). It is **not part of this package's bundle**: it is imported at runtime the first time a PAG file is opened, from a pinned jsDelivr URL by default. Gifts in other formats never download it. The first PAG gift costs about half a second on a cold load (measured: 523–598 ms from the CDN, then 6–11 ms for the next ones).

Self-host instead (recommended for production): copy `libpag.esm.js` and `libpag.wasm` from the `libpag@4.5.85` npm package to your own origin and point the player at them:

```ts
new GiftPlayer(el, { pagModuleUrl: '/vendor/libpag.esm.js', pagWasmUrl: '/vendor/libpag.wasm' });
// or load it yourself: pagModule: () => import('libpag')
```

Content-Security-Policy for the default CDN (drop the CDN host when self-hosting):

```
script-src  'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval';
connect-src 'self' https://cdn.jsdelivr.net;
```

If the engine is blocked, `load()` rejects with `engine-load-failed` and the message names the CSP directive to check. `releasePagEngineContext()` gives the page's one shared WebGL context back (all PAG players share a single context, so any number of gifts is safe).

## Replacements

Gifts can carry a name, a picture, a banner. `getEditableKeys()` lists what can be replaced for the loaded gift:

```ts
const info = await player.load(url, { replacements: { name: { text: 'Rahul', style: { size: 40, color: '#fff' } }, avatar: { image: blobOrUrl } } });
info.editableKeys;                       // [{ key: 'name', type: 'image' }, { key: 'banner', type: 'vector' }, ...]
player.setText('name', 'Anurag');        // later, no reload; survives seeking and looping
player.setImage('avatar', file, { fit: 'cover' });
player.setHidden('banner', true);
player.clearReplacement('name');
```

* SVGA keys are the sprite image keys; PAG keys are the editable layer name, or `#<index>` when the name is empty or ambiguous.
* Replacements passed to `load()` are applied **before the first frame**, so the original text never flashes.
* Unknown keys log a warning and are ignored; they never throw. GIF and WebP have nothing to replace (warning).
* Custom fonts: `registerFont('MyFont', arrayBuffer)` makes a font available to SVGA and PAG text.

## Cache and preload

Loaded gifts (fetched, parsed, images decoded) live in an LRU cache with a budget in **estimated decoded bytes** (default 64 MB; `GiftPlayer.setCacheBudget(bytes)`). A gift any player is showing is never evicted, and two players showing the same gift share one set of decoded images.

```ts
await GiftPlayer.preload(['https://cdn.example.com/a.svga', 'https://cdn.example.com/b.pag']); // never rejects; a later load() is instant
GiftPlayer.getCache().stats; // { bytes, maxBytes, entries, inUse, hits, misses, evictions, ... }
```

Pass `{ cache: new AssetCache({ maxBytes }) }` to a player for a private cache. Files you hand over as `ArrayBuffer`/`Blob` are not cached. HTTP caching is left to the browser. `GiftPlayer.registerResolver('gift', async (id) => url)` teaches `load('gift:12345')` a custom scheme.

## Errors

Everything rejects with a `GiftPlayerError`; `error.code` is one of:

| code | meaning |
|---|---|
| `unsupported-format` | not SVGA / GIF / WebP / PAG, or the browser cannot run it (e.g. no WebGL for PAG) |
| `invalid-input` | wrong argument type, no 2D canvas, `play()` before `load()`, `GiftPlayer` constructed on a server |
| `network` | fetch failed (offline, CORS, HTTP error) or a registered resolver failed |
| `parse-failed` | corrupt container, or newer than the parser supports |
| `decode-failed` | parsed, but the pixels could not be decoded |
| `engine-load-failed` | the PAG engine (JS or WASM) could not be loaded: URL, CORS or CSP |
| `aborted` | cancelled by an `AbortSignal`, a newer `load()`, `stop()` or `destroy()` (not reported through the `error` event) |

## API reference

`npm run docs` generates the full reference from the TSDoc comments into `docs/api/` (not committed). Entry points: `@incodes/gift-player` (the supported API), `@incodes/gift-player/react`, and `@incodes/gift-player/advanced` (low-level parts: the SVGA parser, the PAG renderer, source readers; **unstable, not covered by semver**).

## Known limitations

* **PAG text cannot shape complex scripts.** libpag draws text glyph by glyph: Hindi / Gujarati marks come out misplaced, Arabic is drawn as isolated letters in left-to-right order. Latin, CJK and emoji are fine. `setText` on a PAG gift logs one warning per player when the text needs shaping. SVGA renders these scripts correctly: use SVGA for personalised names in them.
* **Firefox is verified in CI only.** Playwright's Firefox does not start on the macOS version this was developed on; the GitHub Actions workflow runs the whole suite in Firefox on Linux.
* **iOS on real devices is not yet tested.** Safari is covered through Playwright's WebKit build on macOS.
* **SVGA images are decoded through `<img>` elements** (they scale down better than `ImageBitmap` in Chromium), so SVGA playback needs a DOM: it cannot run in a Web Worker / `OffscreenCanvas`.
* A GIF or WebP that loops forever never ends: `play()` stays pending (the queue plays each gift once by default for this reason).
* A gift that is still playing when you call `load()` keeps playing until the new one is ready; a gift that has ended is already gone. Between two queue items the canvas is blank for about one frame while the next gift is created (p95 17 ms measured).
