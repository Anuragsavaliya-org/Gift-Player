# REVIEW — Phase 3.1: per-run mattes + real-corpus test

## Status
Done. Build, typecheck, 136 tests and `npm run verify:browser` (38/38 synthetic checks) pass. Commit: filled in below.

## What was built
- **Per-run matte compositing**: draw list precomputed at load; each run of consecutive sprites with one matteKey is drawn into one offscreen canvas, the matte is applied once with `destination-in`, then composited (matte sprites in the sequence do not break a run; dangling key = unmasked; hidden matte masks the run out).
- **`npm run verify:corpus`** (parse + render-vs-oracle every 10th frame + feature census + automatic diagnosis of files over 2 %), writes `reports/corpus.json` and `reports/corpus.md`. `samples/corpus/` is git-ignored.
- New browser diagnostics (`diffview`, `oracleIsolate`, `corpus` tasks) in `playground/verify.ts`.

## Decisions taken
- **Run = consecutive non-matte sprites with the same non-empty matteKey; matte sprites inside do not break it** (Android behaviour, as specified).
- **Diagnosis is evidence-based**: a file over threshold is re-rendered with each oracle quirk neutralised; only a drop below 2 % is called "proven". Census-based guesses (rotation, arcs, dashes, strokes) are labelled "heuristic".
- **Corpus must live under `samples/`** (the dev server only serves that folder); non-default directories write `reports/corpus-<dir>.*`, so a dry run never overwrites the real corpus report.

## Visual diff table (native size, dpr 1, every 5th frame + last, tolerance 10/255, % of canvas pixels; target < 2 %)
| Sample | mean % | max % | worst frame | Explanation | with oracle quirks neutralised (mean / max) |
|---|---|---|---|---|---|
| Fiery-Red-Dragon | 0 | 0.002 | 15 | clean | 0 / 0.002 |
| Glossy-Pink-Lips | 0.052 | 0.224 | 30 | oracle alpha < 0.05 cutoff | 0.027 / 0.083 |
| **Pink-Heart-Rocket** | 0.216 | **10.504** | **125** | **only frame over 2 %**: oracle skips sprites with alpha < 0.05 (proven) | 0.002 / 0.029 |
| Rocket (1.x) | 0.327 | 0.437 | 55 | **oracle matte bug** (proven, see flags) | 0.001 / 0.052 |
| angel | 0.011 | 0.062 | 35 | clean | 0.011 / 0.062 |
| kingset | 0.002 | 0.007 | 30 | clean (168 clipPath frames) | 0.002 / 0.007 |
| matteBitmap | 0 | 0 | 0 | identical on all 30 frames | 0 / 0 |
| matteRect | 0 | 0 | 0 | identical on all 30 frames | 0 / 0 |
**Rocket.svga residual before / after the per-run change: 0.327 % / 0.327 % mean, 0.437 % / 0.437 % max, worst frame 55 both times. No sample changed at all.** Nothing regressed.

## Perf
Pink-Heart-Rocket (170 sprites, 750x1334): avg 4.5 ms, p95 8.2 ms per drawFrame incl. forced raster (software canvas); GPU flags on: avg 4.4, p95 8.0. Unchanged from Phase 3 (target < 8 ms avg).

## Flags / questions for reviewer
- **The reviewer hypothesis for the Rocket residual was not the cause.** Per-run gave identical numbers on Rocket (its masked sprites do not overlap with partial alpha). The per-run change is still correct and now proven by a synthetic check that fails on the old code with exactly the predicted per-sprite pixels (109, 0, 146, 112 vs per-run 85, 0, 170, 96).
- **Actual cause of the residual: a second svgaplayerweb matte bug.** It applies `destination-in` directly on the main canvas, so it also erases everything drawn *before* the masked run. In Rocket the unmasked dark disc (`E511KDMP`, tx 273) is cut at x = 276 (the matte's left edge) instead of 273: a 1-px ring of mismatches. Isolating each run on its own layer in the oracle (diagnostic switch) drops Rocket to mean 0.001 % / max 0.052 %. So our rendering is right; the oracle is wrong. This is the second oracle matte bug (the first: crash when a masked run is followed by an unmasked sprite). Worth knowing if anyone uses svgaplayerweb as a reference or in production.
- **The corpus is empty**: `reports/corpus.md` says it is waiting for files. Dry run on `samples/` (`reports/corpus-samples.md`): 8/8 parse, 0 over 2 %. Census of the repo samples shows what the real corpus must cover: 0 files with a == 0/d == 0 rotation, strokes, dashes, arcs or rounded rects; only 2 files with vector shapes (fills only); 0 replaceable-looking keys. Please drop real svgagifts.com `.svga` files into `samples/corpus/` and run `npm run verify:corpus`.
- Replaceable-looking-key detection is a name regex (avatar, nick, name, text, ...) and will miss opaque keys; it is a census aid, not a classifier.
- Browser work still uses local headless Chrome over CDP (extension not connected).

## Test summary
136 Vitest tests pass (unchanged). Browser: 38/38 synthetic checks (+4 per-run matte checks), 8-sample diff, perf, leaks via `npm run verify:browser`; corpus dry run 8/8 parsed, 0 over 2 %, diagnosis path exercised on Pink-Heart-Rocket at step 5 (correctly proven as the alpha cutoff).

## Files changed
REVIEW.md, PROGRESS.md, NEXT_PROMPT.md, .gitignore, package.json, src/formats/svga/render/renderer.ts, playground/verify.ts, playground/lib/{oracle,samples}.ts, scripts/{verify-all,verify-corpus}.mjs, reports/{phase3-verify.json,corpus.json,corpus.md,corpus-samples.json,corpus-samples.md}
