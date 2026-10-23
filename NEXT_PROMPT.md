# NEXT PROMPT — Phase 3.1: Matte grouping fix + real-corpus test

Phase 3 is approved (af448cb). This is excellent work. Before Phase 4 there is one correctness fix and one verification step.

## Reviewer findings (checked against the official players' source)

- **Alpha cutoff 0 is correct.** SVGAPlayer-Android (`SVGACanvasDrawer.kt`) and SVGAPlayer-iOS (`SVGAContentLayer.m`, `if (frameItem.alpha > 0.0)`) both draw faint sprites. svgaplayerweb's 0.05 cutoff is the outlier, so keep ours. The Pink-Heart-Rocket frame 125 difference is explained.
- **"Hidden matte masks the group out" is correct.** Android's `requestFrameSprites` keeps `.matte` sprites even at alpha 0 and draws them into the matte canvas, so the group comes out invisible. iOS uses the matte layer as a CALayer mask, with the same result. Keep it.
- **Matte compositing must be PER RUN, not per sprite.** Both official players group consecutive sprites that share a `matteKey` into one layer, composite them together, and apply the matte **once** to the group. Android does this with `saveLayer` plus `isMatteBegin`/`isMatteEnd`; iOS does it with a hostLayer whose `mask` is the matte layer.
  - Per-run gives `(A over B) × m`. Per-sprite gives `(A×m) over (B×m)`. These differ wherever the matte is partially transparent and masked sprites overlap. This is very likely the unexplained 0.33% residual on Rocket.svga.

## Task 1 — Per-run matte compositing

- A run is a maximal sequence of consecutive non-matte sprites with the same non-empty `matteKey`. Matte sprites inside the sequence are skipped and do not break the run, which matches Android.
- For each run: draw all its sprites into one reusable offscreen canvas, draw the matte sprite for that frame over it with `destination-in`, then composite the result onto the main canvas.
- Pre-compute run boundaries at load time, not per frame.
- A dangling `matteKey` (no such matte sprite) means the run is drawn unmasked.
- Re-run the full browser verification. Report Rocket.svga's residual before and after. Report all other samples too, which must not regress.
- Add synthetic pixel checks for:
  - two overlapping semi-transparent sprites under a 50%-alpha matte, which proves per-run behaviour;
  - two separate runs with different matteKeys in one frame.

## Task 2 — Real-corpus smoke test

Our 8 samples don't cover rotated sprites, strokes, dashes, arcs or rounded rects. The real marketplace files are the test set that matters.

- Add `samples/corpus/` to `.gitignore`. The owner will drop real svgagifts.com files there; the corpus may be empty at first.
- Add a script `npm run verify:corpus` that runs over every file in `samples/corpus/`:
  1. **Parse:** pass or fail, plus warnings.
  2. **Render** every 10th frame in headless Chrome against the patched oracle, recording mean and max diff %.
  3. **Feature census:** for each file, record whether it contains rotated sprites (a == 0 or d == 0), strokes, dashes, arcs, rounded rects, mattes, audio, and replaceable-looking keys.
- Output `reports/corpus.json` plus a short markdown summary that lists:
  - failures;
  - every file above 2% max diff, each with a one-line diagnosis attempt;
  - totals from the feature census.
- If `samples/corpus/` is empty, build the script, run it on `samples/` as a dry run, and note in REVIEW.md that the corpus is waiting for files.

## Out of scope

Phase 4 (GIF/WebP) and any public API work.

## End of task

1. Build, typecheck, tests and `verify:browser` must all pass. Commit, and update PROGRESS.md.
2. Overwrite `REVIEW.md` in the usual format, including the updated visual diff table.
3. Stop.
