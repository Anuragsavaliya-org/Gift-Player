# REVIEW — Phase 5: PAG via libpag (lazy-loaded)

## Status
Done, with **one failing item you need to decide on: PAG cannot render Hindi, Gujarati or Arabic correctly** (details and options below). Build, typecheck, 228 Vitest tests, `check:bundle`, `verify:pag` (22/22 task runs, Chromium 156 + WebKit 27.2), `verify:browser` and `verify:images` pass. Raw numbers: `reports/phase5-pag.json`. Commit hash: see git log (`Phase 5: ...`).

## What was built
- `libpag` 4.5.85 (Apache-2.0), exact-pinned, **lazy**: dynamic `import()` from jsDelivr (pinned version) the first time detection returns `pag`. Options `pagModuleUrl`, `pagWasmUrl` (self-host), `pagModule`. `npm run check:bundle` fails if the core bundle contains libpag (core incl. the PAG adapter: 34.3 KB min / 13.3 KB gzip).
- `PagRenderer` implements `FrameSource`; our `Ticker` drives libpag via `setProgress` + `flush` (libpag's own loop is not used and was not needed). Shares `Viewport`.
- **One shared WebGL context for any number of gifts** (libpag Canvas2D mode, refcounted global canvas, SDK holds one reference). `destroy()` releases view, file, replacement images.
- `getEditableKeys()`, `setText`, `setImage`, `setHidden`, `clearReplacement` for PAG (key = layer name or `#<index>`); `getEditableKeys()` also added to SVGA. `registerFont()` for custom fonts. CSP notes in PROGRESS.md (`wasm-unsafe-eval`, `script-src`/`connect-src` for the CDN).
- Playground: PAG on compare page ("PAG engine loading…", libpag's own player as reference, editable-keys list, live replacement demo).

## Sizes and cold load (jsDelivr, pinned URLs)
| | Chromium 156 | WebKit 27.2 |
|---|---|---|
| JS chunk (libpag.esm.js) | 296.5 KB (62.1 KB on the wire) | 296.5 KB (wire size not reported by WebKit) |
| WASM (libpag.wasm) | 1,575 KB (460.6 KB on the wire) | 1,575 KB (not reported) |
| first PAG, cold: engine + first frame | 598 ms (engine 558 ms) | 523 ms (engine 487 ms) |
| second renderer to first frame | 11 ms | 6 ms |
| same, local server | 135 ms | 118 ms |

## WebGL context leak table
| test | browser | created | lost | other counters |
|---|---|---|---|---|
| 100× create → play → setImage → destroy | Chromium | 1 | 0 | rAF outstanding 0, ResizeObservers 0, bitmaps 100/100 closed, WASM heap flat (16.97 MB at cycle 10 and 100) |
| same | WebKit | 1 | 0 | same |
| 5 players alive + playing, destroyed in random order, 6 rounds | Chromium | 1 | 0 | each destroy cleared its canvas; others kept playing |
| same | WebKit | 1 | 0 | same |
| control: libpag default mode, 24 views alive | both | 24 | **9 lost by the browser** | shows the cap is real; our design avoids it |

## Frame accuracy, timing, loops (both browsers pass)
- `drawFrame(i)` vs libpag rendering the same frame directly: **0 differing frames** (like.pag 28, replacement.pag 60), no wrong frame index. Naive `setProgress(i/n)` lands on the wrong frame for some i; we use a mid-frame reference + 1 µs.
- Timing, 2 plays: max abs error 14.9 ms (Chromium) / 11.3 ms (WebKit); total 2348 vs 2333 ms expected. Loops: default 1, `3` → 3, `0` → forever.
- Replacement: 7 checks pass in both; font registration: 3 checks pass in both.

## Text rendering results (screenshots in `reports/text/<browser>-<format>-<script>.png`; side-by-side: `<browser>-composite.png`)
| script | text | SVGA `setText` | PAG text layer |
|---|---|---|---|
| Latin | Rahul | PASS | PASS |
| Hindi | राहुल | PASS (correct shaping) | **FAIL**: dotted circles, matras misplaced |
| Gujarati | અનુરાગ | PASS | **FAIL**: same |
| Arabic (RTL) | محمد | PASS (joined, right-to-left) | **FAIL**: isolated letters, left-to-right order |
| Emoji | Sam 😀🎁 | PASS (colour) | PASS (colour) |
Identical in Chromium and WebKit (e.g. `reports/text/chromium-pag-hindi.png`, `reports/text/webkit-svga-arabic.png`). No tofu anywhere on this macOS (system fonts cover the scripts). Fonts: system fonts are used; `registerFont()` makes custom glyphs available in both formats (verified), but cannot give PAG a shaper. **Cause:** libpag draws text glyph by glyph on a canvas with no shaping/bidi. **Judgment call for you:** (1) document the limitation; (2) SDK renders complex-script text itself (browser shaping) to an ImageBitmap and feeds it to the PAG layer (loses PAG text styling/animation). I did neither silently.

## Perf (ms per frame, our Ticker path; render+copy / including a GPU readback)
| file | backing | Chromium avg / p95 | Chromium w/ readback avg / p95 | WebKit avg / p95 | WebKit w/ readback avg / p95 |
|---|---|---|---|---|---|
| like.pag | 244², dpr 1 | 0.40 / 0.6 | 2.56 / 3.0 | 0.49 / 1 | 4.67 / 6 |
| like.pag | 488², dpr 2 | 0.52 / 0.8 | 7.26 / 10.5 | 0.38 / 1 | 3.29 / 3 |
| replacement.pag | 800², dpr 1 | 0.21 / 0.3 | 7.27 / 8.9 | 0.12 / 1 | 4.11 / 3 |
| replacement.pag | 1600², dpr 2 | 0.18 / 0.3 | 7.09 / 8.5 | 0.10 / 1 | 3.56 / 3 |
WebKit timer resolution is 1 ms (values are coarse); isolated WebKit readback outliers up to 424 ms (first uses), not seen during playback timing.

## Other flags
- Chromium: re-rendering frame 0 after other frames differs by ≤1 level in ≤5 bytes (libpag's first-frame render is not bit-stable); all other frames identical. WebKit: none.
- libpag declares its own runtime dependencies; installed as devDependency only (never bundled).
- Firefox: not covered (Linux CI in Phase 7).
- Throwaway `playground/pag-probe.*` removed.
