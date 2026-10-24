# NEXT PROMPT — Phase 5: PAG via libpag (lazy-loaded)

Phase 4.1 is approved (1c97792). The decision rule did its job: the reviewer's preferred option (B) lost on data, and A is correct. The extra load time (+6–10 ms absolute) is negligible next to the network fetch; Phase 6 preloading will hide it anyway.

**Firefox:** stop trying locally. The macOS 27 incompatibility is out of our hands. Firefox coverage will come from a Linux CI job in Phase 7. Log this in PROGRESS.md.

## Part A — Integration design

- Use the official `libpag` npm package, **pinned to an exact version**. Check its license and record it in PROGRESS.md.
- **Lazy load:** a dynamic `import()` runs only when detection returns `pag`. The core bundle must not contain libpag; verify this with a bundle check that fails if it does.
- **WASM location:** add an option `pagWasmUrl`. The default is a pinned-version jsDelivr URL; self-hosting is an override. Document the CSP needs (`wasm-unsafe-eval`, plus `connect-src`/`script-src` for the CDN). Measure the JS and WASM sizes and the first-PAG cold load time, and report them.
- **Rendering model:** libpag renders through WebGL into its own canvas, so don't fight that.
  - Implement a `PagFrameSource` adapter that satisfies the existing `FrameSource` contract (`frameCount`, `frameDuration`, `loopCount`, `drawFrame`, `destroy`). Get these values from the PAG file's duration and frame rate.
  - Drive libpag from **our** `Ticker` (setProgress for the frame, then flush), not from libpag's own play loop. This keeps loops, events, seek and the later queue behaving identically for every format.
  - If driving it frame by frame turns out to be too slow, measure it, and only then consider libpag's own loop with mapped events. Record why.
  - Share `Viewport` for content modes, DPR and resize, as SVGA and images do.

## Part B — WebGL context safety (critical for the gift queue)

Browsers cap active WebGL contexts at about 16. A live stream that plays hundreds of PAG gifts must never hit "Too many active WebGL contexts".

- `destroy()` must release everything: PAGView, PAGFile, the surface, and the WebGL context. Use `WEBGL_lose_context` if libpag doesn't release it itself.
- Leak test: 100 create → play → destroy cycles in Chromium and WebKit. Count live WebGL contexts and listen for `webglcontextlost` warnings. Report the counts.
- Also test 5 PAG players alive at once, playing, then destroyed in a random order.

## Part C — Dynamic replacement (the ecosystem feature)

PAG addresses editable layers by index and layer name, not by our SVGA keys.

- Map `setText(key, text, style)` and `setImage(key, source)` onto PAG's editable text and image layers. A key can be the layer name, or `#<index>` as a fallback.
- Add `getEditableKeys()`, which returns the available replaceable layers (name, index, type). Add the same method to SVGA, returning sprite image keys, so the API matches across formats.
- Use `replacement.pag` as the test file.
- **Non-Latin text test, for both PAG and SVGA:** gift sender names arrive in every script. Test `setText` with Hindi (e.g. "राहुल"), Gujarati (e.g. "અનુરાગ"), Arabic (RTL, e.g. "محمد") and an emoji name. If PAG needs registered fallback fonts, find out how and document what the SDK user has to do.
  - Visually check that glyphs render: no tofu boxes, and correct RTL order.
  - Save screenshots to `reports/text/` for the reviewer.

## Part D — Verification

- **Frame accuracy:** for both samples, compare our `drawFrame(i)` against libpag rendering the same progress directly. The output must be identical, which proves the adapter's frame and progress mapping.
- **Timing and loops:** the same checks as the Phase 4 timing test.
- **Browsers:** Chromium and WebKit, with per-browser results.
- **Perf:** average and p95 frame time for both samples in both browsers.
- **Playground:** PAG on the compare page, with a "PAG engine loading…" state, the editable-keys list, and a live replacement demo.

## Out of scope

The public `GiftPlayer` API, queue and cache (Phase 6), VAP, Lottie.

## End of task

The usual: all checks pass; commit; update PROGRESS.md; overwrite REVIEW.md. Include:
- **Sizes:** JS chunk, WASM, cold-load time;
- a **WebGL context leak table**;
- **Text rendering results**: for each script and format, pass or fail plus the screenshot path;
- the perf table.

Then stop.
