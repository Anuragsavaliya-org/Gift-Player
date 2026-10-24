# NEXT PROMPT — Phase 4.1: SVGA downscale quality decision + Firefox

Phase 4 is approved (82e7ba9). The self-test routing instead of UA sniffing is exactly right. Finding the downscale problem through the real corpus is the most valuable result so far.

## Task 1 — SVGA minification quality (decide with data, using the criteria below)

**Problem:** 14 of the 16 real corpus files are over 2%, because heavily shrunk particle sprites drawn from an `ImageBitmap` alias (they look sparkly) in Chromium, while the same images drawn from an `<img>` source come out smooth. This is visible to end users, so it must be fixed. Accepting lower quality is not an option.

Prototype both candidates and measure them in **Chromium and WebKit** on the full corpus plus the repo samples.

**Option A: `<img>` sources.**
- Decode with `img.decode()` before the first draw.
- Release on destroy by setting `src = ''` and dropping references.
- Measure: diff, drawFrame time, load time, and memory after 20 load/destroy cycles. Check memory with `performance.measureUserAgentSpecificMemory` or a heap snapshot where available. The concern is GC-only release while a queue of gifts plays.

**Option B: ImageBitmap plus our own mipmaps.**
- At load time, compute for each image the minimum on-screen scale it is ever drawn at, across all frames: content-mode scale × DPR × sprite transform × layout.
- Build a mip chain only as deep as that scale needs (1, ½, ¼ …). Build each level by repeated halving, so ½ is made from 1, ¼ from ½, and so on. Use `createImageBitmap(src, { resizeWidth, resizeHeight, resizeQuality: 'high' })`. If `resizeQuality` is not honoured, fall back to halving with a 2D canvas.
- At draw time, pick the level from the current frame's effective scale. The level choice must not allocate.
- Rebuild the chain on resize or content-mode change only if the minimum scale changes level.
- Images used by `setImage` replacements follow the same path.
- Measure the same four things as Option A, plus the extra memory used by the mip levels.

**Decision rule.** Apply it yourself and log the numbers in PROGRESS.md:
1. Choose **B** if, in BOTH browsers, every corpus file and every repo sample is under 2% max diff, load time is no more than 30% higher, and decoded-image memory is no more than 40% higher. B keeps deterministic `close()` memory control, which the gift queue needs, and it doesn't depend on browser-specific `<img>` filtering. It also keeps the door open to OffscreenCanvas or a Worker later.
2. Otherwise choose **A**, provided A passes under 2% in both browsers **and** its memory returns to baseline after 20 cycles once GC has run. Note: `<img>` sources cannot be used in a Worker later.
3. If neither passes, implement nothing. Write up the numbers and stop.

Keep the losing option out of the codebase, apart from a short note in PROGRESS.md. Re-run `verify:browser`, `verify:corpus` and perf afterwards. The Phase 3 numbers on the repo samples must not regress.

## Task 2 — Firefox

Firefox matters for svgagifts.com desktop visitors. The project lives on an external volume (`/Volumes/XITIJ`), and the "Could not find profile folder" error may be related. This is the reviewer's guess.

- Try running Playwright with `PLAYWRIGHT_BROWSERS_PATH` and `TMPDIR` pointing to the internal disk, for example `~/Library/Caches/ms-playwright` and `/tmp`.
- If Firefox launches, run `verify:images` and the SVGA checks in it, and add a Firefox column to the support table.
- Time-box this to a reasonable effort. If it still fails, report what you tried and move on.

## Out of scope

PAG and the public API.

## End of task

The usual: all checks pass; commit; update PROGRESS.md; overwrite REVIEW.md. Include:
- an **A vs B table** (per browser: worst-file max diff %, mean diff across the corpus, load time, drawFrame avg/p95, memory, memory after 20 cycles);
- which option won, under which rule;
- the updated corpus table and the browser support table.

Then stop.
