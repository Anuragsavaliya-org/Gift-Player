# NEXT PROMPT — Phase 6: Public API, queue, cache (+ PAG text follow-up)

Phase 5 is approved (1c5c9ce). One shared WebGL context, frame-exact mapping and the 0-leak results are excellent. You were right to flag the complex-script text problem instead of hiding it.

## Part A — PAG complex-script text (do first, small)

Owner decision: PAG is low priority for now, and personalised names are not in use yet (they are planned for later). Keep this part minimal.

1. **Warn once:** when `setText` targets a PAG text layer and the text contains characters that need shaping or bidi (Devanagari, Gujarati and other Indic scripts, Arabic, Hebrew, etc.), log one `console.warn` per player that explains the limitation.
2. **Document it** in PROGRESS.md under "Known limitations".
3. **Do NOT build `setTextImage` and do NOT do the upstream libpag check now.** Both are deferred to the future personalisation phase. Log them in PROGRESS.md as deferred items.

## Part B — Public API (`GiftPlayer`)

This is the product's face. Design it carefully and type it fully, with TSDoc on everything exported.

```ts
const player = new GiftPlayer(container, { contentMode, loops, pauseWhenHidden, ... });
const info = await player.load(src, { replacements?, signal? }); // {format, width, height, frameCount, durationMs, editableKeys}
await player.play();            // resolves on end; rejects on error/abort
player.pause(); player.resume(); player.stop(); player.seek(frame);
player.setText / setImage / setHidden / clearReplacement / getEditableKeys
player.on('loaded'|'start'|'loop'|'end'|'error', fn); // 'frame' is opt-in only (cost)
player.destroy(); // idempotent
```

Requirements:
- **Format-agnostic:** one 2D canvas per player, reused across formats when `load()` is called again (PAG keeps its shared-context path).
- **Load races:** `load(A)` followed quickly by `load(B)` means A is aborted and its result discarded; it never flashes on screen. `destroy()` during a load or during play is safe. `signal` is supported.
- **Replacements** can be passed to `load()` so they are applied before the first frame, which avoids a flash of the original text. They can also be set afterwards. Unknown keys warn and never throw.
- **Errors:** typed `GiftPlayerError` codes. Include at least `unsupported-format`, `parse-failed`, `network`, `decode-failed`, `engine-load-failed` (for example when the PAG CDN is blocked by CSP), and `aborted`.
- **pauseWhenHidden** (default true): pause on `visibilitychange` and resume from the same frame, with no fast-forward burst.
- **SSR-safe:** importing the package in Node (Next.js server components and route handlers) must not touch `window` or `document` at import time. Add a test that imports the built package in plain Node. svgagifts.com is Next.js, so this matters on day one.

## Part C — `GiftQueue` (the live-stream use case)

```ts
const queue = new GiftQueue(player, { maxLength, preloadAhead: 2, coalesce: false });
const handle = queue.add(src, { priority?, replacements?, loops? }); // handle.cancel()
queue.pause(); queue.resume(); queue.clear();
queue.on('item-start'|'item-end'|'item-error'|'change'|'idle', fn);
```

- Plays one gift at a time. A higher priority goes first; equal priorities are FIFO.
- `maxLength`: when full, drop the lowest-priority item, oldest first, and emit a `dropped` reason.
- **Preload ahead:** while the current gift plays, fetch, parse and decode the next N gifts, including warming the PAG engine. The first frame of the next gift must appear without a visible gap. Measure the gap between items and report it.
- **On error:** emit `item-error`, skip to the next item, and never stall the queue.
- **`coalesce` (optional):** identical consecutive pending items (same resolved source and same replacements) merge into one item with a `count`. It plays once and exposes `count` for a "×10" combo badge in the host UI. Live streams send the same gift many times in a row.

## Part D — Cache and preload

- An LRU of **loaded assets** (parsed and decoded), keyed by resolved source. The budget is in **estimated decoded bytes** (width × height × 4 for images), not item count. Default 64 MB, configurable.
- **Ref-counting:** an asset in use by any player is never evicted. Two players showing the same gift share the decoded images. Renderers must stop destroying shared images and release them through the cache instead. Re-run the leak tests to prove this.
- `GiftPlayer.preload(srcs)` at module level, which feeds the cache.
- Browser HTTP caching is left to the browser. No Cache Storage persistence.

## Part E — Source resolver

- `GiftPlayer.registerResolver(scheme, async (ref) => url | ArrayBuffer | Blob)`, for example the scheme `gift:` for `gift:12345`.
- Build the hook only, with tests. Do not implement any marketplace API.

## Verification

- **API contract tests in the browser:** load races, destroy mid-load and mid-play, abort via signal, errors for each code, the visibility pause, and replacements applied before the first frame.
- **Queue stress test:** 200 mixed-format items (SVGA, GIF, WebP, PAG, with some deliberately broken), random priorities and some cancels, in Chromium and WebKit. Report:
  - the order is correct;
  - no stalls;
  - the gap between items (avg and p95);
  - peak and final memory counters;
  - open bitmaps, `<img>` holders, WebGL contexts and rAF all return to 0 after `destroy()`.
- **Cache tests:** eviction by byte budget, no eviction of in-use assets, and shared images released exactly once.
- **SSR import test** in Node.
- **Playground:** a "live stream simulator" page that fires random gifts into a queue, with priority, combo/coalesce and a broken-file toggle, and shows a live counters panel.

## Out of scope

The Flutter plugin, the marketplace API, React wrappers, README polish and CI (Phase 7).

## End of task

The usual: all checks pass; commit; update PROGRESS.md; overwrite REVIEW.md. Include:
- the **public API surface**: a list of every export;
- the **queue stress table**;
- **gap-between-items numbers**;
- the **cache test results**;
- confirmation that the PAG complex-script warning is in place.

Then stop.
