# NEXT PROMPT — Phase 3: SVGA Canvas2D renderer

Phase 2 is approved (c90a455). Good work. Your transform decision (proto3 omitted = 0) is correct: a sprite rotated 90° has a = d = 0, which proto3 omits, so svgaplayerweb's `|| 1.0` is a bug in svgaplayerweb. **Expect this to cause visual differences against the oracle on rotated sprites.** When you see a difference like that, check whether this is the cause before you change our renderer.

## Part A — Phase 2 leftovers (do these first)

1. **Inflate size cap.** These files come from a public marketplace, so treat them as untrusted. Add an option `maxInflatedBytes` (default 64 MB).
   - For zips: check each entry's uncompressed size in the central directory before inflating it.
   - For zlib: use fflate's streaming `Unzlib` and abort once the output passes the cap.
   - When the cap is exceeded, throw `parse-failed` with a clear message.
   - Add a test with a small zip-bomb-style input.
2. **Lower the sprites × frames cap from 20M to 2M.** Every frame is an object, so 20M of them means gigabytes of memory, which kills a mobile WebView. Our largest real sample is about 41k. Log the reasoning in PROGRESS.md.

## Part B — Renderer architecture

- `SvgaRenderer` (internal, not public API yet) takes a canvas, an `SvgaMovie` and the decoded bitmaps. Its core method is `drawFrame(index)`. This should be close to deterministic, so that the same frame always gives the same pixels.
- `Ticker` is a separate class: a `requestAnimationFrame` loop. It computes the frame from elapsed time × fps and **skips** frames when it is behind rather than catching up. It also supports play, pause, stop, seek(frame), a loop count, and an `onEnd` callback. Keep it internal; the public `GiftPlayer` API is Phase 6.
- Size the canvas backing store using `devicePixelRatio`. Support the content modes `fill`, `aspectFit` and `aspectFill`. Handle container resizes with a `ResizeObserver`.
- **No allocations per frame in the hot path.** Cache `Path2D` objects per unique path string, reuse offscreen canvases for mattes, and pre-compute colour strings at load time.

## Part C — Drawing rules

For each sprite, in array order, skipping matte sprites and frames where alpha is 0:

1. `save()`. Set `globalAlpha` to the frame alpha. Set the transform to content-mode/DPR scale × `frame.transform`.
2. If `clipPath` is non-empty, clip with the cached `Path2D`.
3. Draw the bitmap scaled into the layout rect (x, y, width, height).
4. Draw the shapes. Apply each shape's own transform on top of the sprite transform. Colours are 0..1 floats and must be converted to `rgba()`. Apply the line dash, cap, join and miter limit.
5. `restore()`.

**SVG path data.** Try `new Path2D(d)` first. If any sample's path renders wrongly or throws, look at how svgaplayerweb parses SVGA path strings and match it. Record what you found.

**Mattes.**
- Draw a masked sprite into a reusable offscreen canvas. Then draw its matte sprite (for the same frame) over it using `destination-in`, and composite the result onto the main canvas.
- Matte sprites are never drawn directly.
- A `matteKey` that matches no sprite is ignored, and the sprite is drawn unmasked.
- Verify this with `matteBitmap.svga` and `matteRect.svga`.

**Dynamic replacement.** This is the core ecosystem feature, so test it properly.
- `setImage(key, source)`, where source is an ImageBitmap, image URL or Blob. The image is drawn into the sprite's layout rect in place of the original bitmap. The sprite's existing clip and matte still apply, so a circular avatar works if the designer made a circular matte.
- `setText(key, text, style)`, where style covers font, size, color, align and an optional stroke. The text is drawn centred in the sprite's layout rect, on top of the bitmap.
- `setHidden(key, boolean)`.
- Replacements must survive `seek` and looping.
- If a key is unknown, log a warning and do not throw.

## Part D — Verification

This is the part that matters most. Do not skip it.

1. **Playground compare view:** our renderer on the left and svgaplayerweb on the right (devDependency, used by the playground only). Add a frame scrubber, play/pause, and a pixel-diff percentage for the current frame.
2. **Automated diff in headless Chrome:** for every SVGA sample, render every 5th frame with both renderers at the same size and compute the percentage of mismatching pixels, using a small per-channel tolerance for anti-aliasing. Report per sample: mean and max diff %, and the worst frame.
   - Target: under 2% on every frame.
   - For any frame above that, find out why: our bug, the oracle bug (transform), or something else. Note it per sample.
   - **Never relax the threshold just to get a pass.**
3. **Performance:** report the average and p95 `drawFrame` time on `Pink-Heart-Rocket.svga` (170 sprites) in headless Chrome. The target is under 8 ms average. If you miss it, report the numbers and the hotspots; don't hide it.
4. **Leaks:** create, play and destroy the renderer 50 times in a row. Check that bitmaps are closed, rAF loops are cancelled and listeners are removed. Show this with counters, not by assumption.
5. **Replacement demo** in the playground: a text box and an image picker that live-replace a chosen sprite key in any loaded file.

## Out of scope

The public `GiftPlayer` API, queue, cache, GIF/WebP/PAG, audio playback and WebGL.

## End of task

1. Build, typecheck and tests must all pass. Commit, and update PROGRESS.md.
2. Overwrite `REVIEW.md` using the same section format as last time. Add a **Visual diff table** (sample → mean %, max %, worst frame, explanation) and a **Perf** line.
3. Stop. Do not start Phase 4.
