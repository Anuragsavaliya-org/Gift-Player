# REVIEW — Phase 6: Public API, queue, cache (+ PAG text follow-up)

## Status
Done. Typecheck, 256 Vitest tests (incl. the Node SSR import test), build, `check:bundle`, `verify:api` (all tasks, Chromium 156 + WebKit 27.2), and the regressions `verify:pag`, `verify:browser`, `verify:images` pass. Numbers: `reports/phase6-api.json`. Commit: see `git log` (`Phase 6: ...`).

## Part A: PAG complex-script warning: in place
`PagRenderer.setText` logs one `console.warn` per player for Indic / Arabic / Hebrew / Thai / Khmer / Myanmar text; none for Latin, none for SVGA. Verified in both browsers (Hindi + Gujarati + Arabic → exactly 1 warning on the first player, 1 on a second; Latin → 0). Documented under "Known limitations" in PROGRESS.md; `setTextImage` and the upstream libpag check are logged there as deferred.

## Public API surface (runtime exports of the package; every export has TSDoc)
`GiftPlayer`, `GiftQueue`, `AssetCache`, `GiftPlayerError`, `registerResolver`, `getDefaultCache`, `DEFAULT_CACHE_BYTES`, `registerFont`, `detectFormat`, `detectSource`, `readSource`, `parseSvga`, `decodeSvgaImages`, `releaseSvgaImages`, `PagRenderer`, `loadPagEngine`, `releasePagEngineContext`, `setPagFallbackFonts`, `PAG_VERSION`, `DEFAULT_PAG_MODULE_URL`, `DEFAULT_PAG_WASM_URL`, `VERSION`.
Types: `GiftPlayerOptions`, `LoadOptions`, `GiftInfo`, `GiftPlayerEvents`, `Replacement(s)`, `ReplacementImage`, `PreloadOptions`, `PreloadResult`, `LoadedGift`, `SourceResolver`, `ResolvedSource`, `GiftQueueOptions`, `QueueAddOptions`, `QueueHandle`, `QueueItemInfo`, `QueueItemStatus`, `DropReason`, `GiftQueueEvents`, `QueueStats`, `AssetCacheOptions`, `CacheLoaded`, `CacheStats`, `Lease`, `GiftErrorCode`, `FormatInfo`, `GiftFormat`, `GiftSource`, `EditableKey`, `TextStyle`, `ImageOptions`, `ContentMode`, `FontData`, the SVGA types, `PagRendererOptions`, `PagEngineOptions`.
`GiftPlayer`: `load(src, {replacements, signal, loops})`, `play()`, `pause()`, `resume()`, `stop()`, `seek()`, `setText/setImage/setHidden/clearReplacement/getEditableKeys`, `on/off`, `destroy()`, getters `playing`, `current`, `lastSwapMs`; statics `preload`, `registerResolver`, `getCache`, `setCacheBudget`. `GiftQueue`: `add` (returns a handle with `cancel()` and `done`), `pause/resume/clear/skip/destroy`, `stats`, events `item-begin|item-start|item-end|item-error|item-dropped|change|idle`. Full description: PROGRESS.md.

Decisions you may want to veto:
1. **Error codes renamed:** `fetch-failed` → `network`; the PAG engine failing to load is now `engine-load-failed`; added `decode-failed`, `aborted`.
2. **`GiftQueue` plays each gift once by default** (`defaultLoops: 1`): a GIF/WebP that loops forever would otherwise hold the queue for good (the stress test stalled on exactly that before I added it). `loops: 0` on an item keeps the old behaviour.
3. **`add()` starts playing in a microtask**, so a burst added together is ordered by priority as a whole (otherwise the first add always played first regardless of priority).
4. **While a new gift downloads, the previous one stays on screen** and is swapped at the moment the new one is ready.
5. `releasePagEngineContext()` now explicitly loses the WebGL context when it dropped the last reference (libpag only drops its references; the context otherwise lived until GC).

## API contract tests (browser): 45 checks + 4 engine checks, both browsers pass
Load races (A aborted, never drawn; burst of 5), destroy mid-load / mid-play / twice, `AbortSignal` (in flight and already aborted), one test per error code (`unsupported-format`, `network` ×2, `parse-failed` ×2, `decode-failed`, `engine-load-failed` ×2 on a fresh page, `invalid-input`, `aborted`), visibility pause (no frames while hidden; resumes ≤ 3 frames from where it stopped), `pauseWhenHidden:false`, SVGA text and PAG image replacements on screen at `loaded`, unknown keys, events (`loaded start loop loop end`, `frame` only with a listener), pause/resume/seek, resolver, preload, no unhandled rejections.

## Queue stress (200 mixed items: SVGA, GIF, WebP, PAG; 26 deliberately broken; random priorities; cancels; waves of arrivals)
| | Chromium | WebKit |
|---|---|---|
| items | 200 | 200 |
| played / failed / cancelled | 152 / 21 / 27 | 152 / 21 / 27 |
| order violations (a lower priority, or a later equal priority, began while a better one waited) | 0 | 0 |
| stalls (handles not settled / silence > 15 s) | 0 / longest silence 8.0 s = one SVGA played in full on purpose | 0 / 8.0 s (same) |
| broken items all failed or removed, queue kept going | yes (26 of 26) | yes |
| **run 2: 120 items, maxLength 20** | 22 played, 3 failed, 95 dropped; every drop was the lowest waiting priority, oldest first; 0 order violations | same |
| peak open `<img>` / ImageBitmaps / blob URLs / WebGL contexts | 52 / 1 / 26 (transient, during decode) / 1 | 52 / 3 / 26 / 1 |
| peak cache | 13.1 MB, 14 gifts, 3 in use (budget 24 MB) | same |
| peak JS heap | 24 MB | n/a (not exposed) |
| **after `queue.destroy()`, `player.destroy()`, `cache.destroy()`** | `<img>` 0, bitmaps 0, blob URLs 0, rAF 0, ResizeObservers 0 | same |
| WebGL contexts after destroy | 1 (the engine's page-lifetime anchor) → **0 after `releasePagEngineContext()`** | same |
| images closed twice | 0 | 0 |
The seeded run is the same in both browsers, hence identical counts. To keep 200 items fast, items jump near their last frame on start (a few play in full).

## Gap between items (gifts that were already waiting; gift end → next first frame on screen; 133 transitions per browser)
| | avg ms | p95 ms | max ms |
|---|---|---|---|
| Chromium, all | 5.7 | 17.5 | 26.7 |
| WebKit, all | 6.0 | 17.0 | 27.0 |
| of which the canvas was blank (previous removed → next frame drawn) | 5.3 / 5.6 | 17.1 / 17.0 | |
| next is SVGA (Chromium / WebKit) | 1.9 / 1.8 | 3.3 / 3.0 | |
| next is GIF | 2.5 / 2.1 | 5.6 / 5.0 | |
| next is WebP | 4.1 / 6.6 | 10 / 15 | |
| next is PAG | 14.2 / 13.8 | 18.7 / 26 | |
So the blank time is about one frame at p95 (PAG the slowest: view creation + first flush). It is not zero: the previous gift's canvas is cleared when the next is created. A gap-free hand-over would need a second canvas (not done; say if you want it).

## Cache tests (13 checks, both browsers pass; plus 7 unit tests with fake loaders)
- Two players on the same gift share one set of decoded images: 26 images open after the first player and still 26 after the second (not 52); 1 miss, 1 hit, 1 entry in use.
- Destroying one player leaves the shared images open; the other keeps drawing the same picture.
- A `setImage` replacement belongs to its player: +1 while set, closed when the player is destroyed.
- `clear()`: images closed exactly once (disposed 1, 0 double closes), nothing left.
- Budget of 1 byte: assets in use are never evicted (both stay open and keep rendering); on release the idle one is evicted at once and its images closed.
- Byte budget (sum of two gifts + 10 bytes): bytes stay within the budget, the least recently used are evicted, the newest stay.
- Leak run (100 create → load → play → destroy over SVGA/GIF/WebP/PAG, tiny 1.5 MB cache so it churns, 94 evictions, half the players with ResizeObserver): bitmaps / `<img>` / blob URLs / rAF / ResizeObservers all back to the baseline 0, 1 WebGL context created for the whole run, 0 after `releasePagEngineContext()`, 0 double closes. Both browsers.

## Also
- **SSR:** the built ESM and CJS packages import in plain Node with `window`, `document`, `navigator`, `self`, `location`, `requestAnimationFrame` set to throw on any access; the 9 key exports are functions; `new GiftPlayer` on the server throws `invalid-input`. Bundle: 80.8 KB minified, 28.2 KB gzip, libpag not included (`check:bundle` caps raised to 190 KB / 120 KB because the package entry now includes the renderers).
- **Playground:** `playground/stream.html` (live stream simulator): send / burst / auto-rate, priority, combo (same gift), broken-file slider, name replacement, maxLength, preloadAhead, coalesce toggle, pause/skip/clear, live counters (queue, gaps, cache, open images, bitmaps, blob URLs, WebGL, rAF).
- Bugs found by this phase's tests and fixed: failed `<img>` decodes left a holder with `src` set; a queue item could begin before `add()` returned; an infinitely looping GIF stalled the queue (hence `defaultLoops`).
- Not done (out of scope): Flutter, marketplace API, React wrappers, README, CI. Firefox: Linux CI in Phase 7.
