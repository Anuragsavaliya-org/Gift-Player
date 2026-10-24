# REVIEW — Phase 4.1: SVGA minification quality + Firefox

## Status
Done. Build, typecheck, 218 Vitest tests, `verify:browser` (41/41 checks), `verify:corpus` (16/16 under 2 %) and `verify:images` all pass. Prototype of both options: commit `99afaf0`. Final commit: `1c97792` (a tiny follow-up commit only adds this file).

## What was built
- **Option A (`<img>` sources) won; Option B (mip chains) was removed from the code.** `decodeSvgaImages` now defaults to decoded `<img>` elements (`img.decode()` before first use; `close()` sets `src = ''`), and `SvgaRenderer.setImage(Blob | URL)` uses the same path. `source: 'bitmap'` stays available for Worker use / comparisons.
- Measurement tooling: `scripts/measure-image-strategy.mjs` (diff, drawFrame, load time and browser RSS at phase markers, Chromium + WebKit), harness tasks `diffall`, `loadtime`, `memory`.
- Firefox: time-boxed attempt, still not launchable (below).

## Decision, by the rule you gave
- **Rule 1 (choose B): FAILS in both browsers.** B leaves 8/16 corpus files above 2 % in Chromium (worst 9.4 %) and **makes WebKit worse than the baseline** (14/16 above 2 %, worst 18.4 %; WebKit had 0/16 before). It was tuned first: level-selection bias 0 was best; levels from `createImageBitmap(resizeQuality 'high')` beat canvas halving; still 1.2-9.4 % on the worst files.
- **Rule 2 (choose A): PASSES.** A is under 2 % in both browsers (Chromium worst 0.236 %, WebKit 0.201 %), and memory returns to baseline after 20 cycles once settled, with no upward trend to 60 cycles.
- The neither-passes rule was not needed.

## A vs B table (all 24 SVGA files, every 10th frame; Chromium 156, WebKit 27.2)
| browser | variant | worst corpus file max % | corpus files > 2 % | mean diff over corpus % | repo samples worst % | load: Pink-Heart-Rocket / 40001576 ms | drawFrame avg / p95 ms (Pink-Heart-Rocket) | RSS after load vs baseline MB | RSS after 20 cycles vs baseline MB |
|---|---|---|---|---|---|---|---|---|---|
| chromium | ImageBitmap (before) | 15.721 (40001144) | 14/16 | 3.799 | 0.434 | 8.8 / 12.2 | 4.209 / 7.6 | +39.4 | -316.7 |
| chromium | **A: `<img>`** (chosen) | 0.236 (40001423) | 0/16 | 0.003 | 0.434 | 14.2 / 22.3 | 4.222 / 7.6 | +45.3 | -576.8 |
| chromium | B: ImageBitmap + mip chain | 9.38 (40001427) | 8/16 | 1.252 | 0.434 | 10.1 / 18.2 | 4.875 / 9.1 | -37.8 | -365.2 |
| webkit | ImageBitmap (before) | 1.188 (40001576) | 0/16 | 0.152 | 0.434 | 31 / 33 | 0.443 / 1 | +8.2 | -91 |
| webkit | **A: `<img>`** (chosen) | 0.201 (40001143) | 0/16 | 0.013 | 0.434 | 20 / 28 | 0.481 / 1 | -9.3 | -92.7 |
| webkit | B: ImageBitmap + mip chain | 18.429 (40001427) | 14/16 | 5.004 | 0.434 | 65 / 135 | n/a | +22.3 | -90.6 |

Memory trend (A and the old path, clean re-run; RSS MB, baseline -> after-cycles-settled): 
- chromium ImageBitmap (before): 20 cycles 890 -> 774.2; 60 cycles 854.8 -> 686.6
- chromium **A: `<img>`** (chosen): 20 cycles 903.7 -> 912.8; 60 cycles 1046.8 -> 795.7
- webkit ImageBitmap (before): 20 cycles 351 -> 301.5; 60 cycles 363.8 -> 360.6
- webkit **A: `<img>`** (chosen): 20 cycles 424.3 -> 376; 60 cycles 355.7 -> 320.5

Notes: repo-samples worst 0.434 % is Rocket.svga's oracle matte bug at this sampling, identical for all variants. RSS = summed resident memory of the browser's processes sampled at phase markers (noisy; Chromium has a forced `gc()`, WebKit has none so an allocate-and-drop pass stands in for it). WebKit drawFrame is not raster-synchronous, so it only shows nothing got slower. B's WebKit perf could not be measured in the matrix run (the perf task read a Chromium-only API; fixed afterwards) and its quality had already disqualified it.

## Corpus table: before vs after (diff vs svgaplayerweb, every 10th frame, Chromium)
| file | before (ImageBitmap): mean / max % | after (`<img>`): mean / max % |
|---|---|---|
| 119040-20211122_111625_1637550985956.svga | 0 / 0 | 0 / 0 |
| 119040-20220228_151532_1646032532038.svga | 0 / 0 | 0 / 0 |
| 40001099.svga | 3.081 / 3.658 | 0 / 0 |
| 40001114.svga | 3.557 / 4.376 | 0 / 0 |
| 40001143.svga | 3.058 / 4.581 | 0.014 / 0.176 |
| 40001144.svga | 14.378 / 15.721 | 0 / 0 |
| 40001289.svga | 2.113 / 5.694 | 0 / 0 |
| 40001415.svga | 4.84 / 6.869 | 0 / 0 |
| 40001421.svga | 3.473 / 3.742 | 0 / 0 |
| 40001423.svga | 2.79 / 3.306 | 0 / 0 |
| 40001427.svga | 9.516 / 15.57 | 0 / 0 |
| 40001508.svga | 3.014 / 5.138 | 0 / 0 |
| 40001575.svga | 3.829 / 4.974 | 0 / 0 |
| 40001576.svga | 4.918 / 6.065 | 0 / 0 |
| 40001577.svga | 5.814 / 6.715 | 0 / 0 |
| 40001578.svga | 7.254 / 7.953 | 0.001 / 0.003 |

**Before: 14/16 over 2 % (worst 15.72 %). After: 0/16 (worst 0.176 %, mean of means 0.001 %).** Repo samples: with the oracle's two known quirks neutralised every sample is now exactly 0.000 % (previously 0.002-0.083 %: the same filtering difference); plain numbers did not regress (Glossy-Pink-Lips 0.224 -> 0.215, angel 0.062 -> 0, kingset 0.007 -> 0, Fiery-Red-Dragon 0.002 -> 0; Rocket 0.437 and Pink-Heart-Rocket frame 125 are the oracle's matte bug / alpha cut-off). Perf 4.21 ms avg, 7.5 p95 (was 4.3 / 7.7).

## Browser support table (GIF / WebP, from `verify:images`)
| browser | ImageDecoder (gif / webp) | self-tests: GIF disposal / WebP alpha | createImageBitmap(WebP) | path for GIF | path for animated WebP | still / 1-frame |
|---|---|---|---|---|---|---|
| chromium 156.0.8078.4 | yes / yes | pass / pass | yes | imagedecoder | imagedecoder | still / still |
| webkit 27.2 | yes / yes | **FAIL** / **FAIL** | yes | gif-fallback | webp-anmf | still / still |
| firefox | **could not be launched here**: browserType.launch: Failed to launch the browser process. | | | | | |

Firefox is still unavailable. **Task 2:** tried `PLAYWRIGHT_BROWSERS_PATH` + `TMPDIR` on the internal disk with the working directory also off `/Volumes/XITIJ`: same failure, so **the external volume is not the cause**. Also tried an ad-hoc `codesign` of the bundle (verifies, same failure), `--profile` / `-foreground` / `MOZ_HEADLESS` variants, `-CreateProfile` + `-P` (does not even create the directory), sandbox-free runs and a forced re-download. The machine runs **macOS 27.0.1**; this looks like a Firefox 157 / macOS 27 incompatibility. No Firefox results (SVGA or GIF/WebP) exist.

## Flags / questions for reviewer
- **Load time in Chromium is +61-83 % with A** (Pink-Heart-Rocket 8.8 -> 14.2 ms, 40001576: 12.2 -> 22.3 ms): `img.decode()` is slower than `createImageBitmap`. It is faster in WebKit (31 -> 20 ms). drawFrame time is unchanged. If first-frame latency matters for the gift queue, preload and `decode()` ahead of time.
- **`<img>` sources cannot be used in a Worker.** The `source: 'bitmap'` option exists for that; it has the old minification quality in Chromium.
- A caller-supplied `ImageBitmap` passed to `setImage` is used as is (never closed by us) and therefore gets bitmap-quality minification; pass a Blob or URL to get the `<img>` path. Documented in code.
- **Memory is measured with RSS, which is noisy;** the conclusion rests on "no growth after cycles and no trend from 20 to 60 cycles", plus the exact release evidence from the leak test (**1,450 decoded `<img>` elements over 50 cycles, 0 still holding a resource after `destroy()`**). WebKit's "after GC" is an approximation (no `gc()`).
- The opt-in `imageSmoothing` renderer option from the investigation was removed again: `medium` halves the old mismatch but costs 2.4x draw time and is not needed.

## Test summary
218 Vitest tests. Browser: `verify:browser` 41/41 synthetic checks (3 new: `setImage` from Blob / URL via `<img>`, replacing a replacement), 8 repo diffs, perf, leaks (0 open bitmaps, 0 `<img>` holding a resource, 0 rAF, 0 ResizeObservers); `verify:corpus` 16/16; `verify:images` all pass in Chromium and WebKit (the GIF/WebP code is unchanged since Phase 4).

## Files changed
REVIEW.md, PROGRESS.md, NEXT_PROMPT.md, src/formats/svga/decode-images.ts, src/formats/svga/render/renderer.ts, playground/verify.ts, scripts/measure-image-strategy.mjs, scripts/verify-corpus.mjs, scripts/lib/pw.mjs (`--expose-gc` for Chromium), reports/phase4.1-image-strategy.json, reports/corpus.{json,md}, reports/phase3-verify.json, reports/phase4-images.{json,md}; removed src/formats/svga/render/mips.ts (kept in commit 99afaf0).
