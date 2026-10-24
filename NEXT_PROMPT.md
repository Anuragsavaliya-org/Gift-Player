# NEXT PROMPT — Phase 4: GIF and animated WebP

Phase 3.1 is approved (817ed4a). Good catch on the second svgaplayerweb matte bug. The reviewer's hypothesis was wrong and your diagnosis was right. The corpus is still pending files from the owner. **Do not block on it.** Run `verify:corpus` whenever files appear, and mention it in REVIEW.md.

## Key design point: variable frame timing

SVGA has a fixed fps. GIF and WebP have a **delay per frame**. Generalise the internal contract before you write any format code:

- Define an internal `FrameSource` interface that both formats implement: `frameCount`, `frameDuration(i)` (ms), `drawFrame(i)`, `loopCount` (from the file), `destroy()`. SVGA implements it with `1000 / fps` for every frame.
- `Ticker` must use cumulative timestamps from `frameDuration(i)` (prefix sums), not `fps`. It must still skip frames when behind. Existing Ticker tests must keep passing, and new tests must cover variable delays.
- **Delay clamping:** match browser behaviour, where a GIF delay of 10 ms or less is shown as 100 ms. Verify the exact rule in Chrome/Firefox/WebKit, document it, and apply it consistently.
- **Loop count precedence:** the player option wins if set; otherwise use the file's own loop count (GIF NETSCAPE extension, WebP ANIM chunk). Log this decision.

## Decoding strategy

1. **Primary path:** `ImageDecoder` (WebCodecs) where `ImageDecoder.isTypeSupported(mime)` is true.
2. **GIF fallback:** a small decoder such as `gifuct-js` (justify the choice in PROGRESS.md). You must handle **disposal methods 1, 2 and 3**, transparency, and partial-frame patches correctly. This is where most GIF players are wrong.
3. **Animated WebP fallback:** evaluate this approach before falling back to `<img>`:
   - Parse the ANMF chunks yourself.
   - Wrap each frame's bitstream (VP8/VP8L, plus ALPH if present) into a standalone RIFF/WEBP container.
   - Decode it with `createImageBitmap`. Every modern browser, including Safari 14+, decodes static WebP.
   - Composite the frames using the ANMF offsets, blend mode and dispose flag.

   If this works, it gives full frame control everywhere. Only if it is infeasible, fall back to `<img>`, and document that the end event and loop control are unreliable there.
4. **Static WebP:** render a single frame. Add the option `staticDurationMs` (default 2000), then emit `end`. This lets static images behave like gifts in a queue later.

## Memory: no decoding of everything up front

A large GIF (for example 500 frames at 1080², about 2 GB of RGBA) must not be decoded all at once.

- Decode on demand with a small look-ahead ring buffer, and close bitmaps behind the playhead.
- GIF disposal needs the previous composited frame, so keep a single compositing canvas instead of a stored frame for each step.
- Report peak memory or bitmap counts in the leak test.

## Test files

- Generate **synthetic** GIF and WebP files with a dev-only script (justify any dev dependency). They must cover:
  - each disposal method;
  - transparency;
  - variable delays, including 0 ms and 10 ms;
  - loop counts 0, 1 and 3;
  - animated WebP with alpha and with both blend modes.
- Store them in `samples/synthetic/`.
- The real samples `rotating-earth.gif`, `animated.webp` and `static.webp` must also pass.

## Verification

- **Correctness reference:** in Chrome, `ImageDecoder` output is the oracle. Render every frame through each fallback path (GIF decoder, ANMF-wrap WebP) and pixel-diff against ImageDecoder. The target is 0% beyond the tolerance. Explain any mismatch per file.
- **Cross-browser:** add Playwright as a dev dependency and run the verification in **Chromium, Firefox and WebKit**. WebKit matters most, because iOS WebViews are a large share of live-streaming users. Produce a browser support table showing which path each browser takes, plus pass/fail per file.
- **Timing:** a test that the measured on-screen frame times match the file's delays within tolerance.
- **Leaks:** 50 create/play/destroy cycles per format, checked with counters, as in Phase 3.
- **Playground:** add GIF and WebP to the compare page (ours | native `<img>`), with a frame scrubber and a "path used" label.

## Out of scope

PAG, the public API, the queue and the cache.

## End of task

Same as before: build, typecheck, tests and browser verification all pass; commit; update PROGRESS.md; overwrite REVIEW.md in the usual format, adding a **Browser support table** and a **Fallback diff table**. Then stop.
