# REVIEW — Phase 3: SVGA Canvas2D renderer

## Status
Done. Build, typecheck and 136 tests pass; browser verification (`npm run verify:browser`) reproduces every number below. Commit: filled in below.

## What was built
- Part A: `maxInflatedBytes` (default 64 MB; streaming zlib abort, zip central-directory check, detection too) and the sprites x frames cap lowered to 2M.
- `SvgaRenderer` (`drawFrame(i)`, content modes, DPR sizing, ResizeObserver, offscreen mattes, `setImage/setText/setHidden/clearReplacement`, `destroy`) and `Ticker` (rAF clock that skips frames; play/pause/stop/seek/loops/onEnd). Internal, not exported.
- Load-time `Path2D`/colour/dash compilation; the draw path allocates nothing (0 KB heap growth over 2,400 draws).
- Playground: `/compare.html` (ours | svgaplayerweb, scrubber, play/pause, live diff %, replacement demo with text box, image picker, fit, hide, clear) and the earlier inspect page. Headless-Chrome harness (`scripts/headless.mjs`, `playground/verify.ts`) for the diff, perf, leak and synthetic checks.

## Decisions taken
- **Hidden matte masks its sprites out** (alpha 0 matte, not "no mask"): a bare `destination-in` with nothing drawn would show them fully, which is wrong.
- **Alpha cutoff is 0, not svgaplayerweb's 0.05**: faint sprites are drawn.
- **Zero-width strokes draw nothing**; `miterLimit` 0 keeps the canvas default; dash = `[dash, gap]` + offset (svgaplayerweb builds a 3-element array).
- **Replacement images stretch into the layout rect by default** (like the original bitmap); `fit: 'cover' | 'contain'` optional. Text is squeezed to the layout width when too long.
- **Renderer owns the bitmaps** it is given and closes them in `destroy()`; caller-provided ImageBitmaps for `setImage` are not closed.
- **`Path2D(d)` used directly** (no custom path parser): identical to the oracle on every sample, and it supports arcs, which svgaplayerweb silently skips.
- **Oracle workarounds, harness only**: svgaplayerweb crashes on any file where a masked run is followed by an unmasked sprite (it looks the matte up with the wrong sprite's matteKey), so Rocket.svga cannot be rendered by it as shipped. I copied its `drawFrame` with that one-word fix and cleared Rocket's 3 dangling matteKeys on its in-memory copy. matteBitmap/matteRect render fine unpatched (masked run is last).
- Sprites x frames cap 2M: each frame is several objects; 20M = GBs; the largest real sample is 40,800.

## Visual diff table (native size, dpr 1, every 5th frame + last, tolerance 10/255, % of all canvas pixels; target < 2 %)
| Sample | mean % | max % | worst frame | Explanation |
|---|---|---|---|---|
| Fiery-Red-Dragon | 0 | 0.002 | 15 | clean |
| Glossy-Pink-Lips | 0.052 | 0.224 | 30 | oracle alpha cutoff (0.083 max when mimicked) |
| **Pink-Heart-Rocket** | 0.216 | **10.504** | **125** | **Only frame over 2 %.** Oracle skips sprites with alpha < 0.05; at frame 125 two do (alpha 0.048 and 0.027; one is a ~4x-scaled glow). Mimicking that cutoff on our side: max 0.029 %. Oracle approximation, not our bug. |
| Rocket (1.x) | 0.327 | 0.437 | 55 | needed the oracle workarounds above; small residual unexplained (probably per-sprite vs per-run matte compositing; unconfirmed) |
| angel | 0.011 | 0.062 | 35 | clean |
| kingset | 0.002 | 0.007 | 30 | 168 clipPath frames match |
| matteBitmap | 0 | 0 | 0 | non-blank, identical on all 30 frames |
| matteRect | 0 | 0 | 0 | non-blank, identical on all 30 frames |
Threshold not relaxed. Content modes at 1000x1500 vs oracle: max <= 0.07 % (angel, Glossy-Pink-Lips, matteBitmap, all three modes).

## Perf
Pink-Heart-Rocket (170 sprites, 750x1334): **avg 4.3 ms, p95 7.7 ms** per drawFrame incl. forced raster (software canvas); GPU flags on: avg 4.7, p95 8.7. svgaplayerweb: 4.4 / 8.2 (software), 4.6 / 8.3 (GPU). JS recording alone is 0.05 ms avg, so cost is raster-bound with no JS hotspot. Desktop headless only; no mobile, no dpr 3.

## Leaks (50 cycles, counters)
Bitmaps 1550 created / 1550 closed; rAF 250 requested = 200 fired + 50 cancelled (0 outstanding); ResizeObservers 50 / 50 disconnected; listeners added 0 / removed 0; DOM delta 0; heap flat at 8.4 MB from 10 to 200 cycles.

## Flags / questions for reviewer
- **Rotated-sprite oracle bug did not show up**: no sample has `a == 0` or `d == 0`, so the diff cannot demonstrate it. Likewise no sample has dashes, strokes, arcs or rounded rects (only the two matte files have shapes, all fills). Those are verified by 34 synthetic pixel checks (ours only), not against the oracle. If you have a sample with a rotated sprite or strokes, it would close that gap.
- Rocket's 0.33 % mean residual: unexplained, under threshold.
- The `matte hidden => masked out` rule is my reading of the format; svgaplayerweb does the opposite by accident. Say if you prefer otherwise.
- `imageSmoothingQuality` left at default (same as oracle). Perf numbers are desktop-only.
- The Claude-in-Chrome extension was not connected; browser work used local headless Chrome over CDP (no new dependency).

## Test summary
136 Vitest tests pass (+8 inflate/zip bomb, +1 frame-entries cap, +12 Ticker, +7 view). Browser: 34/34 synthetic checks, 8-sample diff, perf, leaks via `npm run verify:browser` (`reports/phase3-verify.json`). Renderer logic cannot run in Node, so it is tested in headless Chrome, not Vitest.

## Files changed
CLAUDE.md (unchanged), REVIEW.md, PROGRESS.md, NEXT_PROMPT.md, package.json, src/core/{inflate,ticker,detect}.ts, src/formats/svga/parse.ts, src/formats/svga/render/{renderer,compile,view}.ts, tests/{svga-parse,ticker,view}.test.ts, playground/{index.html,compare.html,compare.ts,verify.html,verify.ts}, playground/lib/{oracle,diff,samples}.ts, scripts/{headless.mjs,verify-all.mjs}, reports/phase3-verify.json
