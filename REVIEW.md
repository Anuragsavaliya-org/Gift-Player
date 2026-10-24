# REVIEW — Example app using the published package

## Open the demo (dev server is running)
**http://localhost:5300/** (Vite dev server, left running). To start it again later:
```sh
cd examples/web-demo
npm install
npm run gifts:copy
npm run dev
```

## What was built (`examples/web-demo/`)
Vite + React 19 + TypeScript, plain CSS, no UI library. Dependencies: `@incodes/gift-player` **exactly `0.1.0` from the npm registry** (checked: `node_modules/@incodes/gift-player/package.json` is 0.1.0 with the published `dist/`), react, react-dom. No alias, no workspace link, no `file:`, no path into `src/`, and no bundler config for the package (see friction: none needed).
- **Stage:** a 3:4 area with an animated "fake live video" (moving stripes + hue-shifting gradient, "● LIVE" tag). A single gift plays over it through `<GiftPlayerView contentMode="aspectFit">`; the stage clears when it ends.
- **Gift grid:** a tile per gift with format badge; **Play** (stage) and **Send** (queue).
- **Live-stream panel (`useGiftQueue`):** priority (normal / high), coalesce switch, **Burst ×20**, **Combo ×10** (selected gift sent 10 times; "×10" overlay when merged), **Clear waiting**, live stats (waiting, playing, played, errors, dropped).
- **Info panel:** format, size, frames, duration, editable keys, load time (click → first frame).
- **Controls:** replay, stop, pause/resume (queue), loops 1 / 3 / infinite, content mode, cache size in MB, **Clear cache**.
- **Errors:** toasts with the `GiftPlayerError` code (stage and queue).
- Not touched: root `package.json` `files`, root build/tests/CI. `npm pack --dry-run` has **0** entries from `examples/` (28 files as before); root typecheck and the 274 tests pass.
- `gifts:copy`, `README.md` (run, no-gifts-in-git rule, own gifts, PAG note), and `scripts/verify-demo.mjs` (the Playwright check below).

## Gifts (9 in the manifest; `public/gifts/` and `screenshots/` are git-ignored)
| name | format | source (git-ignored `samples/`) |
|---|---|---|
| Fiery Red Dragon | SVGA | samples/Fiery-Red-Dragon.svga (720×1280, 97 frames) |
| Pink Heart Rocket | SVGA | samples/Pink-Heart-Rocket.svga (750×1334, 240 frames) |
| Pink Sports Car | SVGA | corpus/40001575.svga |
| Cherry Blossoms | SVGA | corpus/40001576.svga |
| Moon Night | SVGA | corpus/40001421.svga |
| Rotating Earth | GIF | samples/rotating-earth.gif |
| Animated WebP | WebP (alpha, 40 frames) | corpus/10014_android_…_middle.webp |
| Like | PAG | samples/like.pag |
| Broken file | SVGA | first 40 % of Fiery-Red-Dragon.svga (labelled "deliberately broken") |
I picked the corpus SVGAs by rendering all 16 and choosing the ones that look best over a video (transparent, distinct): car, blossoms, moon.

## Verify results (`node scripts/verify-demo.mjs`, Chromium, 16/16 pass; `npm run build` in the example also passes)
- Every gift loads, plays (non-empty canvas) and the stage clears when it ends: Dragon 126 ms, Rocket 73 ms, Car 45 ms, Blossoms 88 ms, Moon 37 ms, Earth 31 ms, WebP 23 ms (load time shown in the info panel), **Like (PAG) 453 ms** (engine from jsDelivr on its first use, 919 ms the very first time in one run).
- Broken file: error toast "Broken file: unsupported-format".
- **Burst ×20** (coalesce off so 20 sends are 20 items): drained to 0 waiting / not playing in 63–78 s, 20 of 20 accounted (16 played, 4 errors from the broken file), **0 stalls** (longest time without progress 7.8 s, one long gift), canvas blank afterwards.
- **Combo ×10** (coalesce on): the stage shows **"×10"**, and the 10 sends played as **one** queue item.
- No console errors or warnings from the app.
- Screenshots (`examples/web-demo/screenshots/`): `1-grid.png` (full page), `2-gift-over-video.png` (dragon mid-play over the video), `3-queue-burst.png` (queue during a burst), `4-error-toast.png`, `5-combo.png` (×10).

## Developer friction with the published 0.1.0 (library not changed)
Worked without friction: install from npm, Vite + React 19 + TS strict, `/react` entry typings, StrictMode (the demo runs it), no bundler configuration, root + `/react` share one cache (`getDefaultCache()` showed the same bytes for both).
1. **`<GiftPlayerView>` has no imperative handle.** No `ref`/callback for the underlying `GiftPlayer`, so a developer cannot pause, resume, stop, seek or call `setText`/`setImage` on the instance. I could only replay (remount via `key`) and stop (unmount); the demo's Pause acts on the *queue*. This is the biggest gap for the React entry (replacements can be changed by props, but not pause/seek).
2. **`useGiftQueue` reads its options once.** Toggling `coalesce` needed a remount of the component (`key`), which also resets the stats. A `queue.setOptions(...)`/option reactivity would be natural.
3. **Queue events carry no `GiftInfo`.** `item-start` has `{id, src, priority, count}` only, so the info panel (format, size, frames, editable keys) can only describe stage gifts, not queued ones. Also no load time anywhere (I measured click → `onLoad` myself).
4. **Error code for a truncated SVGA is `unsupported-format`**, not `parse-failed`: a cut-off file is not recognised as SVGA at all. For a developer the message "unsupported" for a corrupt download is misleading (README says `parse-failed` = "corrupt container").
5. **`useGiftQueue` returns `queue: GiftQueue | null`** (null until mounted): every use needs `queue?.`; and `GiftQueue` has no readable paused state, so the app tracks it itself (the hook's `stats.paused` exists but only updates on change events).
6. **`Clear cache`:** `getDefaultCache().clear()` only drops *idle* assets, so the MB readout does not return to 0 while a gift is playing (documented in TSDoc, but surprising next to a button called "Clear cache").
7. **README gaps:** it shows `GiftPlayer.getCache()` but the React-friendly `getDefaultCache()` export is not mentioned; no example of reading cache stats; nothing on how `GiftPlayerView` and `useGiftQueue` interact (two canvases, one shared cache); no sizing note for `useGiftQueue`'s container (`containerRef` element needs a size); no Vite/React demo link.
8. **Queue + endless gifts:** `loops` must be given per `send` to be safe; the queue default of once is good, but `GiftPlayerView` follows the file (the GIF would loop forever) unless `loops` is set: easy to trip over, mentioned only in the README's limitations.
9. **PAG first-use cost** (453–919 ms from the CDN) is visible as a slow first tile; a documented `GiftPlayer.preload`/engine-warm helper for React (e.g. `preloadPagEngine()`) would help (only `GiftPlayer.preload([...pag urls])` warms it today, and that is not mentioned in the PAG section).
