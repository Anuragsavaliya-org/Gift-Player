# PROGRESS

## Pre-Phase-1 housekeeping ✅
- `git init`; Phase 0 committed. Commit after every phase from now on.
- `typescript` pinned to exact `5.9.3` (no caret).
- Package name stays as placeholder.
- **Expected SVGA values** (`samples/expected.json`): `svgaplayerweb@2.3.2` added as devDependency (reference implementation only, never shipped). It runs in Node: `scripts/gen-expected.cjs` loads its built bundle (`build/svga.min.js`) in a `vm` sandbox with minimal browser stubs (`window`, `document.querySelectorAll`, a fake `XMLHttpRequest` that reads from `/samples`, `btoa`/`atob`), then calls `new SVGA.Parser().load()` and writes fps / frames / spriteCount / imageCount / viewBox. No browser needed. Re-run with `npm run samples:expected`.
  - Fiery-Red-Dragon: 15 fps, 97 frames, 126 sprites, 720x1280
  - Glossy-Pink-Lips: 20 fps, 66 frames, 34 sprites, 750x1334
  - Pink-Heart-Rocket: 30 fps, 240 frames, 170 sprites, 750x1334
  - Caveat: this only verifies *header-level/structure* values, and svgaplayerweb is itself the oracle; it does not check rendering.


## Phase 0 — Project setup ✅ (awaiting review)

### Done
- Single package `@incodes/gift-player` (placeholder name, owner to confirm). ESM + CJS + `.d.ts` via `tsup`.
- TypeScript strict (+ `noUncheckedIndexedAccess`, `noImplicitOverride`). Vitest for tests. Vite app in `/playground`.
- Folder layout per roadmap: `src/core`, `src/formats/{svga,image,pag}`, `src/queue`, `src/cache` (empty, `.gitkeep`), plus `tests/`, `samples/`.
- Verified: `npm run build`, `npm test`, `npm run typecheck` pass; `npm run playground` serves the page and module (checked via curl on a test port).

### Dependencies (all dev-only; no runtime deps yet)
| Package | Why |
|---|---|
| `typescript@5` | Compiler / type checking. |
| `tsup` | Required build tool (ESM+CJS+dts). |
| `vitest` | Required test runner. |
| `vite` | Playground dev server. |

### Decisions
- **TypeScript pinned to 5.x, not 7.** `npm i typescript` pulled 7.0.2 (native rewrite), which lacks the JS compiler API that tsup's dts bundler (`rollup-plugin-dts`) needs — build crashed with `useCaseSensitiveFileNames` error. Revisit when tsup supports TS 7.
- Package is `"type": "module"` with `exports` map for `import`/`require` with matching types; `sideEffects: false` for tree-shaking.
- Entry is `src/index.ts` (placeholder exporting `VERSION`).
- `.gitkeep` files in empty src dirs; the project is not a git repo yet (no `git init` done — not requested).

### Known issues
- `npm audit`: 1 low severity (esbuild dev-server file read, **Windows only**, dev dependency). Not fixed; `npm audit fix` available if desired.
- **`/samples` does not exist/was empty (I created an empty `samples/`).** Phase 1+ need real files (svga 2.x, ideally svga 1.x, gif, animated + static webp, pag). Per working rules, I'm stopping here to request them.

### Needed from owner before Phase 1
- Sample files in `/samples` (svga, gif, webp, pag), plus the known values (fps, frame count, sprite count) for each SVGA file for Phase 2 tests.
- Confirm the final package name.

### Roadmap note (not a change)
- Phase numbering in the roadmap's body: PAG is Phase 5 and "Unified API" is Phase 6, but Phase 6 references "Phase 5" for the resolver hook. I'm treating the resolver as part of Phase 6 as written.


---

## Phase 1 — Format detection ✅ (awaiting review)

### Done
- `src/core/detect.ts`: `detectFormat(bytes) -> FormatInfo` from magic bytes only:
  `PK\x03\x04` -> svga 1.x · `GIF87a/89a` -> gif · `RIFF....WEBP` -> webp (`animated` from VP8X flag bit 1) · `PAG` -> pag · else zlib inflate + protobuf structure check -> svga 2.x · else throws `GiftPlayerError('unsupported-format')` with size + header hex in the message.
- `src/core/source.ts`: `readSource()` accepts URL string (fetch), `ArrayBuffer`, typed-array/DataView (offset-aware), `Blob`/`File`. Errors: `fetch-failed` (network or non-2xx), `invalid-input` (wrong type).
- `src/core/inspect.ts`: `detectSource(src)` = read + detect. Exported from `src/index.ts` with `GiftPlayerError`.
- `src/core/errors.ts`: `GiftPlayerError` with `code`.
- Tests (`tests/detect.test.ts`, 23 total passing): all real files in `/samples`, rename-proof check (SVGA bytes in a `.png`-named File), synthetic headers, garbage cases (empty, text, PNG, random bytes, valid-zlib-non-protobuf, truncated SVGA), and each input type.

### Dependencies added
| Package | Kind | Why |
|---|---|---|
| `pako` | runtime | zlib inflate for SVGA 2.x (needed in detection now, parser in Phase 2). |
| ~~`@types/pako`~~ | — | **Removed in review fixes**: pako 3 ships its own types (`dist/pako.d.ts`). |
| `@types/node` | dev | tests use `node:fs`. |
| `svgaplayerweb` | dev | reference oracle for `expected.json`. |

### Decisions
- **No protobufjs in detection.** SVGA 2.x is recognised by inflating and walking protobuf wire format with a ~40-line reader, checking `MovieEntity` shape (field 1 version string, field 2 `params` with float/float/int/int fields, fields 3-5 length-delimited, nothing else). Keeps detection light; protobufjs choice stays open for Phase 2. Note: svga.proto numbering is `version=1, params=2` (my first draft had this wrong; caught by real samples).
- SVGA 1.x is identified by the ZIP signature alone (per roadmap). Any ZIP is reported as svga 1.x; the Phase 2 parser must validate `movie.spec`. Flagging: a non-SVGA zip will pass detection and fail later.
- Static WebP is detected as `{format:'webp', animated:false}`, not an error (still a valid image; player can decide).
- Whole file is read before detection (no range requests) — simple, and files are small.

### Known issues / gaps
- **`/samples` contains only 3 SVGA 2.x files.** No GIF, WebP (animated/static), PAG, or SVGA 1.x. GIF/WebP/PAG/zip detection is verified only on **synthetic headers**, not real files. **Please add real samples**, esp. an animated WebP and a PAG (PAG header assumption `PAG` at byte 0 is unverified against a real libpag file). Phase 4 and 5 cannot be called done without them.


---

## Phase 1 review fixes ✅ (awaiting review)

1. **No double inflate.** `detectInternal(bytes) -> { info, inflated? }` in `src/core/detect.ts`; for SVGA 2.x it returns the inflated MovieEntity buffer. Not exported from `src/index.ts`; public `detectFormat` is a thin wrapper returning `info` only. Phase 2 parser should import `detectInternal`. Test asserts `inflated` is set for SVGA 2.x and undefined otherwise.
2. **Unknown fields are skipped.** `looksLikeMovieEntity` now only requires well-formed wire format plus field 2 `params` containing fps (3) and frames (4) as varints. Tests: unknown varint/fixed32/length-delimited fields at top level and inside params; missing fps/frames rejected; malformed length rejected.
3. **SVGA 1.x via central directory.** Finds the EOCD record (scanning back over a possible zip comment), walks central-directory entries, requires `movie.spec` or `movie.binary`. Real `Rocket.svga` has `movie.spec` as a non-first entry and is detected. A plain zip, or a zip truncated so its central directory is missing, throws `unsupported-format` (tests added; a small stored-zip builder is in the test file). Limitation: no zip64 support (not needed for SVGA).
4. **pako types:** removed `@types/pako`.
5. See Phase 2 notes below.

### Samples added and covered by detection tests
All 13 files in `/samples` are asserted by name in a table in `tests/detect.test.ts` (a test fails if a sample has no expectation): 7 SVGA 2.x, `Rocket.svga` (1.x), `rotating-earth.gif`, `animated.webp` (animated:true), `static.webp` (animated:false), `like.pag`, `replacement.pag`. Note the roadmap message said `animated.weatic.webp`; the file on disk is `animated.webp`. The real PAG files start `50 41 47 01`, so the "`PAG` at byte 0" assumption is now **verified on real files**. Total: 44 tests passing.

### `samples/expected.json` re-run
| File | fps | frames | sprites | images | viewBox |
|---|---|---|---|---|---|
| angel | 15 | 60 | 125 | 26 | 750x750 |
| kingset | 20 | 56 | 17 | 10 | 750x750 |
| matteBitmap | 30 | 30 | 4 | 1 | 400x400 |
| matteRect | 30 | 30 | 4 | 0 | 400x400 |
| (earlier 3 unchanged) | | | | | |

- **`Rocket.svga` (1.x): svgaplayerweb could not parse it in Node** (`incorrect header check`: without JSZip it takes the 2.x inflate path). `expected.json` records `{"unparsed": true, ...}`, no values guessed. The script now continues past per-file failures. Options for later: add `jszip` as a devDependency for the oracle script, or run it in the playground. Not done: judgment call (extra dev dependency).
- For reference only, **not oracle-verified**: reading `movie.spec` directly from the zip gives ver `1.1.0`, viewBox 1080x630, fps 60, frames 480, 20 sprites, 16 images. Phase 2 tests for 1.x should be treated as self-consistency checks until an oracle confirms them.

### Notes for Phase 2 (parser)
- **Decompression:** evaluate native `DecompressionStream('deflate')` (zlib format) with pako fallback. Considerations: it is async/streaming (fine for the parser), unavailable in older Safari/Node-less envs, and its error behaviour on truncated data differs from pako. Detection currently needs sync inflate, so either keep pako for detection or make detection async; decide then.
- **Varints:** the parser's varint reader must handle full 10-byte values (negative int32/int64 encode as 10 bytes). Detection's reader already accepts up to 10 bytes but only approximates values above 2^53; the parser should decode properly (protobufjs does this via `Long`; a hand-rolled decoder needs BigInt or hi/lo handling).
- The parser must reuse `Detected.inflated` rather than inflating again.
- The 1.x path should accept both `movie.spec` (JSON, ver 1.x) and `movie.binary` (1.5, protobuf inside zip); `svgaplayerweb` treats presence of `movie.binary` as version 1.5.

---

## Phase 2 — SVGA parser ✅ (awaiting review)

### Done
- `src/formats/svga/`: `wire.ts` (bounds-checked protobuf wire reader, 10-byte varints, group skipping), `proto.ts` (full `MovieEntity` decoder), `spec-json.ts` (1.x `movie.spec` normaliser), `parse.ts` (`parseSvga(bytes, detected?)`: assembly, KEEP resolution, media classification, validation), `media.ts` (magic-byte classifier), `decode-images.ts` (`decodeSvgaImages` / `releaseSvgaImages`, browser-only), `types.ts` (`SvgaMovie` model), `svga.proto` (reference copy).
- `parseSvga` is pure/sync and runs in Node. One model for 2.x protobuf, 1.x zip+JSON and 1.5 zip+`movie.binary`. Images stay raw bytes; audio is split out by magic bytes and never reaches `createImageBitmap`.
- Playground "inspect" view (drop a file or pick a sample; `?sample=<file>.svga` auto-loads): summary (version, fps, frames, sprites, matte/masked sprites, images, audios, times) plus a grid of decoded images.
- `GiftErrorCode` gained `parse-failed`. Every parser failure is a `GiftPlayerError('parse-failed')`; non-`GiftPlayerError` exceptions (RangeError etc.) are wrapped.
- `CLAUDE.md` created with the standing REVIEW.md workflow rule.

### Schema source
`svga.proto` fetched from https://raw.githubusercontent.com/svga/SVGA-Format/master/proto/svga.proto; last commit touching it: `c5c26c14fc2a1e104a067d0b58f237646d2e9de1` (2019-06-13, "feat: add matte key for matte layer"). Reference copy (with a 3-line source header, content unmodified) in `src/formats/svga/svga.proto`. SVGAPlayer-Web has no proto/ path (404). Field numbers: MovieEntity version=1, params=2, images=3, sprites=4, audios=5.

### Dependency decision: fflate replaces pako (+ a zip lib)
Measured with esbuild (browser ESM, minified, tree-shaken; `scripts/measure-bundle.mjs`):
| Option | min | gzip |
|---|---|---|
| pako (inflate only) | 30,319 B | 10,059 B |
| jszip (unzip) | 98,711 B | 30,501 B |
| **pako + jszip** | 129,222 B | 39,779 B |
| **fflate `unzlibSync` + `unzipSync`** | 5,818 B | 2,891 B |
| fflate `unzlibSync` only | 4,002 B | 2,082 B |
fflate is ~14x smaller gzipped for the same capability and passed all tests (all 44 detection tests unchanged, incl. truncated-file cases), so detection and parser use it and **pako was removed**. `jszip` stays as a devDependency only for the oracle script. Whole core build now: `dist/index.js` 27 KB unminified (parser + detection + fflate).

### Oracle (`samples/expected.json`) with jszip
Regenerated with `jszip` injected into the svgaplayerweb sandbox. `Rocket.svga` (1.x) now parses in the oracle: **60 fps, 480 frames, 20 sprites, 1080x630, 16 images**: identical to the values I read directly from `movie.spec`. **No mismatch.** Notes: the oracle's `version` ("1.0"/"2.0") is its own label, not the file's version string, so tests don't compare it; its `imageCount` includes audio blobs in 2.x files (Fiery-Red-Dragon 37 = 36 images + 1 mp3; Pink-Heart-Rocket 30 = 29 + 1), so tests assert `images + audios == imageCount`.

### Behaviour decisions
- **proto3 defaults:** missing scalar = 0 / ''; missing `transform` message = identity; missing `layout` = zeros; *a present* transform with omitted scalars follows proto3 (omitted = 0). This deliberately differs from svgaplayerweb, which uses `parseFloat(x) || 1.0` for `a`/`d` (so a legit 0 becomes 1). Alpha 0 stays 0 (hidden).
- **KEEP** is resolved per sprite at parse time: a frame whose first shape is KEEP gets the previous frame's resolved shapes; first-frame KEEP -> `[]`; stray KEEPs elsewhere are dropped; empty-shape frames reset "previous" to `[]`. svgaplayerweb keeps `lastShapes` in a global static (leaks across sprites): we do not copy that. The `SvgaShape` type has no `keep`.
- **Frame count normalisation:** each sprite is padded (hidden frame) or truncated to exactly `movie.frames`, with a warning. Entirely-default frames share one frozen `HIDDEN_FRAME`.
- **Validation (parse-failed):** viewBox non-positive, frames <= 0, frames > 100,000, sprites x frames > 20M (allocation guard). **fps <= 0 defaults to 20 with a warning** (matches svgaplayerweb/Android behaviour). 
- **Dangling matteKeys are kept, with a warning.** `Rocket.svga` has 3 masked sprites whose `matteKey` points at a mask sprite that does not exist in the file (verified in the raw JSON). Phase 3 renderer must ignore a matteKey it cannot resolve.
- **Unrecognised blobs in `images`** (not PNG/JPEG/WebP/audio) are dropped with a warning. Audio classified: MP3 (ID3 or frame sync), WAV, OGG, FLAC, MP4/M4A.
- **1.5 (`movie.binary`):** preferred over `movie.spec` when present; decoded as raw protobuf, else as zlib+protobuf; image values are file names resolved as `<name>.png`, `<name>`, `<key>.png`, `<key>`; on failure falls back to `movie.spec` with a warning. svgaplayerweb ignores `movie.binary` entirely.
- `decodeSvgaImages` is tolerant: undecodable images are skipped and listed in `failed` instead of failing the whole gift. Caller must `releaseSvgaImages`.
- Public exports added to `src/index.ts`: `parseSvga`, `decodeSvgaImages`, `releaseSvgaImages`, model types. `detectInternal` remains non-exported; `parseSvga(bytes, detected)` reuses its inflated buffer (tested: passes empty bytes + detected and still parses).

### Verification
- 109 tests (Vitest): all 8 SVGA samples vs `expected.json`; invariants per sample (frame count == `frames`, imageKey resolves or is `.matte`/`.vector`, no `keep`); matte keys on `matteBitmap`, `matteRect`, `Rocket`; synthetic protobuf (encoder helper in `tests/helpers/pb.ts`) for defaults, LE floats, styles/shapes, unknown fields, 10-byte varints, KEEP edge cases, audio/image classification, padding; synthetic 1.x/1.5 zips; corrupt-input fuzz (truncation of every sample, random bytes after zlib/zip headers, every-prefix truncation and 300 bit-flips of a valid payload): always `parse-failed`, never a raw RangeError.
- **`decodeSvgaImages` checked in real Chrome** (headless, local Chrome via `--dump-dom`/`--screenshot`, since the Claude-in-Chrome extension was not connected): all 8 samples decoded exactly `images.size` bitmaps, no failures, no errors; screenshot of `angel.svga` shows the grid correctly. Timings printed by that headless run are virtual-time artefacts and should be ignored.

### Parse time (Node 22, Apple silicon laptop; information only)
| File | size | cold | warm median (20 runs) |
|---|---|---|---|
| Pink-Heart-Rocket.svga (largest, 2.x) | 643 KB | 51 ms | 17 ms |
| Fiery-Red-Dragon.svga | 516 KB | 10 ms | 6 ms |
| Rocket.svga (1.x, 787 KB JSON) | 101 KB | 23 ms | 6 ms |

### Known issues / not verified
- No real SVGA 1.5 (`movie.binary`) sample: that path is covered by synthetic zips only.
- 1.x JSON shapes/audio are covered by synthetic tests only; `Rocket.svga` has no vector shapes and no audio.
- No decompression-size cap (zip bombs): parse allocates whatever inflate produces.
- 2.x numbers read through 32-bit varint truncation (schema has no 64-bit fields).

---

## Phase 3 — SVGA Canvas2D renderer ✅ (awaiting review)

Reproduce all browser numbers with `npm run verify:browser` (starts the playground, drives headless Chrome over CDP via `scripts/headless.mjs`, writes `reports/phase3-verify.json`). Interactive: `npm run playground`, then `/compare.html` (compare + replacement demo) and `/index.html` (inspect).

### Part A — Phase 2 leftovers
1. **Inflate cap `maxInflatedBytes` (default 64 MB)**, `src/core/inflate.ts`. zlib: fflate's streaming `Unzlib`, fed 16 KB input slices and aborted the moment output passes the cap (deflate expands <= ~1032:1, so overshoot is bounded to ~16 MB, not unbounded). Zip: `unzipSync` `filter` rejects from the central directory (per entry and cumulative `originalSize`) before inflating anything; fflate sizes its output from that declared size, so a lying header cannot overshoot it (tested by patching a header). The inner zlib `movie.binary` path and detection (`detectFormat(bytes, {maxInflatedBytes})`) use the same cap. All throw `parse-failed` ("... exceeds the limit of N MB (maxInflatedBytes) ..."). 8 tests (zlib bomb at small and default cap, detection, zip single/cumulative/lying header, under-cap OK).
2. **sprites x frames cap 20M -> 2M.** Every frame is an object (plus its transform/layout objects): 20M of them is multiple GB of heap, which kills a mobile WebView; 2M is already ~100+ MB. Real files are tiny against it (largest sample 170 x 240 = 40,800; ~2% of the cap). Frames are separately capped at 100,000. Test at 70 x 30,000 (rejected) and 60 x 30,000 (accepted).
3. Parse time unchanged after the streaming inflate: Pink-Heart-Rocket 17.6 ms warm (was 17).

### Part B/C — Renderer (`src/formats/svga/render/`, `src/core/ticker.ts`; internal, not exported from `src/index.ts`)
- `SvgaRenderer(canvas, movie, bitmaps, options)`: `drawFrame(i)` (clamps, deterministic), `resize()`, `setContentMode()`, `setImage/setText/setHidden/clearReplacement`, `destroy()`. Takes ownership of `bitmaps` and of bitmaps it creates for replacements; ImageBitmaps passed by the caller to `setImage` are never closed by it.
- Sizing: backing store = CSS size x `devicePixelRatio` (option to override); `fill` / `aspectFit` / `aspectFill` via pure `computeView` (unit-tested); `ResizeObserver` on the canvas re-fits and redraws. The canvas must be sized by CSS.
- Hot path: all `Path2D`s built at load (`PathCache`, shared between identical geometry; rects/ellipses become paths too), colours pre-converted to `rgba()` strings, dash arrays pre-built; per-frame code only looks things up. Measured **0 KB JS heap growth over 2,400 `drawFrame` calls**.
- Draw order per prompt: sprites in array order; matte sprites and alpha <= 0 skipped; `save`, `globalAlpha`, `setTransform(view x frame.transform)`, clip, bitmap into the layout rect, shapes (each with its own transform on top), replacement text, `restore`.
- Mattes: masked sprite drawn into a reusable offscreen canvas, matte drawn over it with `destination-in`, composited back. Matte bitmaps are looked up without the `.matte` suffix (as the file stores them). A `matteKey` matching no sprite is ignored (drawn unmasked). **A matte that is hidden (alpha 0) in a frame masks its sprites out entirely** (a plain `destination-in` with nothing drawn would have left them fully visible).
- Dynamic replacement: `setImage(key, ImageBitmap | Blob | url, {fit})` (default `fill` = stretch into layout rect like the original; `cover`/`contain` available), `setText(key, text, {font,size,weight,color,align,stroke})` (centred in layout rect; text wider than the rect is squeezed with `maxWidth`), `setHidden`, `clearReplacement`. Sprite clip and matte still apply. Replacements are per `imageKey`, apply to every sprite using it, survive `seek`/loops. Unknown key: `console.warn`, no throw. Drawn on top of *that sprite's* bitmap only, so a later sprite in the array can cover it (seen with `Ren01` on angel.svga: head/hair/hands paint over the body centre).
- `Ticker` (`src/core/ticker.ts`): rAF loop, frame = elapsed x fps (skips, never catches up), `play/pause/stop/seek`, loop count (0 = forever), `onFrame` only on change, `onEnd`; injectable clock for tests (12 tests).

### SVG path data
`new Path2D(d)` is used as is. Every path in the samples (matteBitmap/matteRect shapes, kingset clip paths) matches svgaplayerweb pixel for pixel. svgaplayerweb's own parser (`renderer.js`) **ignores `A`/`a` arc commands** (the cases are empty) and has quirky `S`/`s`; `Path2D` implements the full SVG grammar, so we render arcs where it does not (synthetic test: half-disc from an `A` path). No sample contains an arc, so the diff cannot show that difference.

### Visual diff vs svgaplayerweb (headless Chrome, native size = viewBox, dpr 1, every 5th frame + last, tolerance 10/255 per premultiplied channel)
| Sample | frames | mean % | max % | worst frame | note |
|---|---|---|---|---|---|
| Fiery-Red-Dragon | 20 | 0 | 0.002 | 15 | |
| Glossy-Pink-Lips | 14 | 0.052 | 0.224 | 30 | 0.083 max when the oracle's alpha cutoff is mimicked |
| Pink-Heart-Rocket | 49 | 0.216 | **10.504** | **125** | **oracle alpha cutoff**, see below; 0.029 max when mimicked |
| Rocket (1.x) | 97 | 0.327 | 0.437 | 55 | oracle needed two workarounds; small residual unexplained |
| angel | 13 | 0.011 | 0.062 | 35 | |
| kingset | 12 | 0.002 | 0.007 | 30 | 168 frames use `clipPath`: validated |
| matteBitmap | 7 | 0 | 0 | 0 | non-blank (8.8k-12.7k drawn px/frame), identical on all 30 frames at step 1 |
| matteRect | 7 | 0 | 0 | 0 | non-blank (12.5k-17.8k px/frame), identical on all 30 frames |
The metric is % of all canvas pixels. `reports/phase3-verify.json` also has % of drawn pixels (e.g. Rocket mean 1.04 %, max 1.55 %).
**Threshold 2 %: one frame fails it: Pink-Heart-Rocket frame 125 (10.5 %).** Threshold not relaxed. Cause (proven): svgaplayerweb skips any sprite with frame alpha < 0.05 (`if (frameItem.alpha < 0.05) return`). At frame 125 sprite 4 (`psd_318`, alpha 0.0478, scaled 3.97x: a large faint glow) and sprite 18 (alpha 0.027) are below that cutoff; we draw them (alpha > 0), the oracle drops them. A diagnostic switch that zeroes alpha < 0.05 on our side (`mimicOracleAlpha=1`) brings the same sample to max 0.029 % (and Glossy-Pink-Lips to 0.083 %). So this is an oracle approximation, not our bug; we deliberately keep drawing faint sprites.
Content modes against the oracle at a 1000x1500 container: angel fill 0 / aspectFit 0.009 / aspectFill 0.001 % max; Glossy-Pink-Lips 0.045 / 0.068 / 0.051; matteBitmap 0 / 0 / 0.
Rotated-sprite oracle bug: **no sample exercises it** (0 frames with a == 0 or d == 0 in any sample), so the diff cannot show it. Verified instead with a synthetic 90-degree sprite (a = d = 0): drawn in the right place.
Not exercised by any sample (so verified only synthetically, ours alone): 90-degree rotation, dashed strokes, strokes in general, arc paths, rounded rects, shape-over-sprite transform composition. Samples with vector shapes are only the two matte files (fills).

#### Oracle workarounds (playground/lib/oracle.ts; comparison harness only, never in the SDK)
1. **svgaplayerweb cannot render Rocket.svga (or any file where a masked run is followed by an unmasked sprite).** When a run ends, it looks the matte up with the *new* sprite's matteKey (`matteSprites.get(sprite.matteKey)`, i.e. `''`) and crashes in `drawSprite(undefined)`. It only works when the masked run is last in the array (true of matteBitmap/matteRect). The harness overrides `drawFrame` on the oracle instance with a copy of its own logic plus the one-word fix (`lastSprite.matteKey`).
2. The 3 dangling matteKeys in Rocket.svga are cleared on the oracle's in-memory copy (same rule as ours: ignore).
3. 1.x needs JSZip/JSZipUtils globals (injected from the `jszip` devDependency).
Rocket's remaining 0.33 % mean (1 % of drawn pixels) is unexplained; plausible cause: we composite each masked sprite separately while the oracle composites a whole run once and then masks (they differ only where masked sprites overlap with partial alpha). Not confirmed.

### Performance (Pink-Heart-Rocket: 170 sprites, 750x1334 backing, headless Chrome on this laptop)
`drawFrame` only records canvas commands; the raster happens later, so each draw was followed by a 1x1 `getImageData` to force it to finish (that figure is "drawFrame + raster").
| | avg | p50 | p95 | max |
|---|---|---|---|---|
| drawFrame call (JS only) | 0.05 ms | 0.0 | 0.1 | 0.5 |
| drawFrame + raster, software canvas (`--disable-gpu`) | **4.3 ms** | 4.5 | 7.7 | 10.1 |
| svgaplayerweb, same method | 4.4 ms | 4.5 | 8.2 | 12.4 |
| drawFrame + raster, GPU flags on | 4.7 ms | 4.7 | 8.7 | 18.2 |
| svgaplayerweb, GPU flags on | 4.6 ms | 4.7 | 8.3 | 17.2 |
Target (< 8 ms average) met with room. Cost is raster-bound (large bitmaps), not JS; there is no JS hotspot to report. dpr 2 (375x667 CSS) gives the same 750x1334 backing store and the same timings; a dpr 3 phone (1125x2001) was not measured. Real devices will be slower; this is a desktop headless number.

### Leaks (50 create -> play -> replace image twice -> destroy cycles, counters in `reports/phase3-verify.json`)
ImageBitmaps created 1550 / closed 1550 (31 per cycle: 29 decoded + 2 replacements) -> **0 open**; rAF requested 250 = 200 fired + 50 cancelled -> **0 outstanding**; ResizeObservers created 50 / disconnected 50 -> **0 live**; event listeners added 0 / removed 0 (the renderer and ticker register none); DOM nodes delta 0. JS heap 4.8 -> 8.4 MB after 10 cycles and still 8.4 MB after 200 (a one-time warm-up, not growth).

### Synthetic checks in real Chrome (34, all pass; `task=replace`)
Mattes with a circular matte + `setImage` (centre replaced, corner stays masked); hidden matte masks out; dangling matteKey ignored; text (centred, bold, long text squeezed, left-aligned with stroke); unknown keys warn once each and never throw; replacement survives seek, loops (3 loops via the Ticker), hide/unhide, clear; `fit` fill/cover/contain; caller-owned bitmap not closed (even after destroy); content modes at dpr 2 (backing 400x400, expected pixels); `setContentMode`; ResizeObserver resize + disconnect after destroy; determinism (same frame twice with others between: byte-identical); geometry (rotation, dashes, zero-width stroke, arcs, rounded rect, shape transform composition, clip, alpha, sprite order).

### Tests
136 Vitest tests (renderer/browser parts are verified in headless Chrome, not in Vitest, as `createImageBitmap`/`Path2D` do not exist in Node): +8 inflate/zip-bomb, +1 sprites x frames, +12 Ticker, +7 view math.

### Known issues / open
- Renderer, Ticker and compare tooling are internal; the public `GiftPlayer` API is Phase 6.
- Rocket residual (above) unexplained; one Pink-Heart-Rocket frame is above 2 % because of the oracle's alpha cutoff.
- Samples do not cover rotated sprites, dashes, arcs or strokes: only synthetic checks.
- Perf measured on desktop Chrome only; no mobile device, no dpr 3.
- `imageSmoothingQuality` left at the default (low), same as the oracle; at heavy downscaling a `high` option may look better but costs time.
- The Claude-in-Chrome extension was unavailable (account mismatch); all browser work used local headless Chrome through the DevTools protocol.

---

## Phase 3.1 — Per-run matte compositing + real-corpus smoke test ✅ (awaiting review)

### Task 1 — per-run matte compositing
- `src/formats/svga/render/renderer.ts`: the draw list is now built **at load time** as `DrawItem`s: either one unmasked sprite or a *run* = maximal sequence of consecutive non-matte sprites sharing one non-empty `matteKey` (matte sprites in between are skipped and do not break the run, as in Android; an unmasked sprite or a dangling matteKey ends it). Per frame, each run is drawn into one reusable offscreen canvas, the matte is drawn over it with `destination-in` once, and the result is composited onto the main canvas (z-order preserved because a run is composited where it sits in the list). A hidden matte (alpha 0) masks the whole run out; hidden run members are skipped; a run with nothing visible draws nothing. The per-sprite `matte` field is gone.
- **New synthetic checks (4, all pass; 38 total):** (a) two overlapping 50%-alpha sprites under a 50%-alpha matte, with the matte *between* them in the list: per-run gives (85, 0, 170, **96**), per-sprite would give (109, 0, 146, **112**). I ran this check against the previous per-sprite renderer too: it fails there with exactly (109, 0, 146, 112), so the check discriminates. (b) two runs with different mattes in one frame; (c) the same matteKey split by an unmasked sprite = two runs with z-order kept (red < green < blue); (d) hidden members skipped / all hidden draws nothing.
- **Result on Rocket.svga: UNCHANGED.** Before: mean 0.327 %, max 0.437 %, worst frame 55. After: mean 0.327 %, max 0.437 %, worst frame 55 (every other sample also identical to the digit; perf unchanged, 4.5 ms avg). So **per-run vs per-sprite was not the cause of Rocket's residual**; it is still the right behaviour (matches Android/iOS, proven by the synthetic check) but the real files here have no overlapping partially-masked sprites.
- **Real cause of the Rocket residual (found and proven): a second svgaplayerweb matte bug.** Zooming into frame 55 showed the mismatch is a 1-px-wide ring, and a row scan showed the oracle's disc `E511KDMP` (an *unmasked* sprite at tx 273) ending at x = 276 = the matte sprite's left edge (tx 276) while ours starts at 273. svgaplayerweb applies the matte with `destination-in` **directly on the main canvas**, which erases everything drawn before the masked run (here the unmasked background disc), instead of masking only the run (Android `saveLayer`, iOS mask layer). Proof: a diagnostic oracle mode (`oracleIsolate=1`: each run drawn on its own layer first) gives Rocket **mean 0.001 %, max 0.052 %**. So our output is correct and the residual is the oracle's bug.
- Both known oracle quirks can now be neutralised in the harness (`mimicOracleAlpha=1&oracleIsolate=1`; diagnostic only, never used for the headline numbers).

### Task 2 — real-corpus smoke test
- `.gitignore`: `samples/corpus/` (the owner drops real svgagifts.com files there; the folder may not exist yet).
- `npm run verify:corpus [-- --dir=samples/corpus --step=10 --limit=N --threshold=2]` (`scripts/verify-corpus.mjs`, one headless Chrome per file via `task=corpus` in `playground/verify.ts`): (1) **parse** pass/fail + warnings; (2) **render** every 10th frame against the patched oracle, mean/max diff % and worst frame; (3) **feature census**: rotated sprites (a == 0 or d == 0), rotated/skewed (b or c != 0), strokes, dashes, arc commands, rounded rects, vector shapes, clipPath, mattes (matte/masked sprites, dangling keys), audio, and replaceable-looking keys (name regex: avatar, head, portrait, photo, nick, name, user, text, label, slot, ...).
- **Automatic diagnosis** for any file above the threshold: it re-renders with each oracle quirk neutralised (alpha < 0.05 cutoff; whole-canvas matte; both) and reports the first that brings the file under 2 % as "proven"; otherwise it lists census-based hypotheses (rotated sprites, arcs, dashes, strokes, rounded rects) marked "heuristic", else "unexplained". Exercised on Pink-Heart-Rocket at step 5: correctly diagnosed "svgaplayerweb skips sprites with alpha < 0.05", proven.
- Output: `reports/corpus.json` + `reports/corpus.md` (failures; files above 2 % with diagnosis + confidence; all-files table; census totals). Dry runs on another directory write `reports/corpus-<dir>.{json,md}`.
- **The corpus is empty**: `reports/corpus.md` says it is waiting for files. Dry run on `samples/` (`reports/corpus-samples.md`): 8/8 parse, 0 over 2 %, 0 failures. Census of the 8 repo samples: **0** files with a == 0/d == 0 rotation, strokes, dashes, arcs or rounded rects; 2 files with vector shapes (7 unique shapes, all fills); 1 with clipPath; 3 with mattes (1 with dangling keys); 2 with audio; 5 files with b/c != 0 (315 sprites, 13,098 frames of ordinary rotation/skew); 0 replaceable-looking keys. These are exactly the features the real corpus needs to cover.

### Verification (`npm run verify:browser`, headless Chrome, native size, every 5th frame + last)
| Sample | mean % | max % | worst | with oracle quirks neutralised: mean / max |
|---|---|---|---|---|
| Fiery-Red-Dragon | 0 | 0.002 | 15 | 0 / 0.002 |
| Glossy-Pink-Lips | 0.052 | 0.224 | 30 | 0.027 / 0.083 |
| Pink-Heart-Rocket | 0.216 | 10.504 | 125 | 0.002 / 0.029 |
| Rocket (1.x) | 0.327 | 0.437 | 55 | 0.001 / 0.052 |
| angel | 0.011 | 0.062 | 35 | 0.011 / 0.062 |
| kingset | 0.002 | 0.007 | 30 | 0.002 / 0.007 |
| matteBitmap | 0 | 0 | 0 | 0 / 0 |
| matteRect | 0 | 0 | 0 | 0 / 0 |
Headline columns are unchanged from Phase 3 (no regression). Pink-Heart-Rocket frame 125 is still the only frame above 2 % (oracle alpha cutoff, proven in Phase 3). Synthetic checks 38/38. Perf (Pink-Heart-Rocket, software canvas, incl. raster): avg 4.5 ms, p95 8.2; GPU flags: avg 4.4, p95 8.0. Leaks: bitmaps 1550/1550 closed, rAF 0 outstanding, ResizeObservers 0 live.

### Other
- `playground/lib/samples.ts` now also globs `samples/corpus/*.svga`; names are relative to `samples/` and resolved by exact key (so `corpus/x.svga` cannot collide with `x.svga`).
- New diagnostic tasks in `playground/verify.ts`: `diffview` (ours | oracle | mismatch mask, optional zoom crop, edge scan, `hide=` keys), used to find the Rocket cause.
- 136 Vitest tests, unchanged (the new checks run in the browser harness).

---

## Phase 4 — GIF and animated WebP ✅ (awaiting review)

Reproduce: `npm run verify:images` (Chromium + WebKit + Firefox via Playwright; writes `reports/phase4-images.{json,md}`), `npm test`, `npm run gen:synthetic` (regenerates `samples/synthetic/`), interactive: `npm run playground` -> `/compare.html`.

### Contract change first (as asked): variable frame timing
- `src/core/frame-source.ts`: `FrameSource { frameCount, frameDuration(i), loopCount, drawFrame(i): boolean, ready(i), destroy() }`. `SvgaRenderer` implements it (`1000 / fps` for every frame, `loopCount` null). `resolveLoops(option, source)`: **player option wins, else the file's loop count, else play once; 0 / Infinity = forever.**
- `Ticker` now works on cumulative start times (prefix sums over `frameDuration(i)`, or `1000/fps` computed by multiplication so uniform boundaries have no drift), binary search for the frame, still skips instead of catching up. The 12 existing tests pass unchanged; +9 for variable delays (exact boundaries, skipping, a skipped 10 ms frame, per-loop totals, seek, pause inside a long frame, 15 fps drift).
- `src/core/viewport.ts`: the DPR / content-mode / ResizeObserver logic extracted from `SvgaRenderer` so images share it. SVGA behaviour verified unchanged (see regression below).

### Browser rules (what browsers actually do), and how well each was verified
- **Delay clamping: a delay <= 10 ms is shown as 100 ms** (0 and 10 ms -> 100; 20 ms stays 20; applies to GIF and WebP). Evidence: **verified in WebKit** through `ImageDecoder` (GIF delays 0/10 -> 100, 20/50/... unchanged; WebP 0/1/10 -> 100). **Chromium's `ImageDecoder` reports raw durations** (0, 10, ...) because Blink applies the clamp in its image layer (documented in its source: "use 100 ms for <= 10 ms"). **I could not observe native `<img>` playback timing in headless Chromium/WebKit by drawing it to a canvas** (the frame never advanced there), so for Chromium `<img>` and for Firefox this rests on the engines' documented behaviour, not on a measurement. We apply the rule ourselves on every path (`clampDelay`), so all paths agree.
- **Loop count -> total plays:** GIF NETSCAPE N -> **N+1 plays** (N = 0 forever; extension absent -> 1 play); WebP ANIM N -> **N plays** (0 forever). Verified: Chromium's `repetitionCount` is *repeats* for GIF (N) and *plays-1* for WebP (N-1); WebKit's is *plays* for both (and -1 for forever); the totals agree, the encodings do not, so **we read the file ourselves and never use `repetitionCount`**. Browser tests: observed play counts and end times match for loop 0/1/3/absent on both formats in Chromium and WebKit. Real file note: `rotating-earth.gif` declares 65535 repeats = 65,536 plays (about 72 hours at 3.96 s): effectively forever but not 0.
- **Still images** (static WebP, one-frame GIF/WebP): drawn with `createImageBitmap`, shown for `staticDurationMs` (default 2000), loop count 1, then `end`. Tested (300 ms in 4 files, within 60 ms) in both browsers.
- Background colour (GIF logical screen, WebP ANIM) is ignored: "dispose to background" clears to **transparent**, like browsers. GIF disposal values 4-7 are treated as "leave".

### Decoding paths (`src/formats/image/`)
1. **`imagedecoder`**: WebCodecs, VideoFrame ring (current + `lookAhead` = 3 ahead, wrapping for loops; frames behind are closed), durations from our own container parse.
2. **`gif-fallback`**: **own parser + LZW + compositor** (`gif.ts`). Decision (dependency): `gifuct-js` was not added. We need our own block parser regardless (frame count, delays, loop count and disposal must be known up front without decoding pixels, for the ImageDecoder path), so the missing part was only ~60 lines of LZW. 2.2 KB gzipped, no dependency, round-trip tested against my encoder (24 random images incl. >4096-code table resets). Handles disposal 1/2/3 (one saved rect for method 3), transparency (binary), local palettes, interlace, partial patches clipped to the canvas, truncated files. Keeps ONE RGBA buffer, publishes dirty rects.
3. **`webp-anmf`**: **feasible, so no `<img>` fallback exists.** `webp.ts` parses RIFF/VP8X/ANIM/ANMF, `wrapAnmfFrame` rebuilds each frame as a standalone WebP (`VP8L` alone; `VP8` alone; or `VP8X(alpha)+ALPH+VP8`), `createImageBitmap` decodes it (works everywhere WebP stills do, incl. Safari 14+), a working canvas composites with ANMF offsets, blend flag (do-not-blend = clear the rect first) and dispose-to-background. 1.2 KB gzipped. Look-ahead of patches; rewinds restart from the nearest full-canvas no-blend keyframe.
4. **`still`**: single `createImageBitmap`.
`path: 'auto'` (default): single frame -> still; else `ImageDecoder` if supported **and it passes a runtime self-test**, else our decoders. `path: 'imagedecoder' | 'fallback'` force a path (used by the tests). The renderer exposes `path` and `pathReason`.

### Browser findings that changed the design (Playwright WebKit 27.2)
- **WebKit's ImageDecoder composites GIF "restore to background" as OPAQUE BLACK** instead of transparent (all browsers' `<img>` use transparent; Chromium's ImageDecoder and ours agree). Affected synthetic GIFs: disposal-2, first-disposal3, transparency, mixed: every pixel in the cleared area is wrong (alpha 255).
- **WebKit's ImageDecoder returns animated/still WebP frames with partial transparency opaque, with wrong colours, and the colours drift further each time the same frame is decoded again** (probe: 128,68 -> 192,102 -> 224,119 -> 240,127...). Re-decoding is exactly what looping does, so loop 2 would not match loop 1. `createImageBitmap`/`<img>` are correct (match Chromium).
- A UA check would be fragile, so `auto` runs two tiny self-tests once per page (`selftest.ts`: a 74-byte GIF and a 140-byte WebP, embedded as base64 and checked byte-for-byte against `samples/synthetic/selftest-*` by a unit test) and skips `ImageDecoder` for a type whose test fails. In WebKit 27.2 both fail, so `auto` uses our GIF and ANMF decoders there; Chromium passes both and keeps `ImageDecoder`. **Real-world consequence:** a transparent GIF/WebP gift on a WebKit that ships this ImageDecoder would be corrupted without this routing.
- Chromium, forced `imagedecoder` on a single-frame lossy still shows a slight YUV->RGB difference (Δ up to 37/255 at equal alpha). `auto` never sends single frames through ImageDecoder, so this is documented as known and excluded from pass/fail.
- **Firefox: not verified.** The Playwright Firefox 157 build (installed with your approval, twice, fresh download) fails to start on this machine ("Could not find profile folder"; its bundle also fails `codesign -v`; same with a sandbox-free run and a project-local profile). It has no `ImageDecoder`, so it would take the fallback paths, which are browser-independent code (canvas + `createImageBitmap`), but that is an inference, not a measurement.
- Playwright's Chromium: `channel: 'chromium'` (full Chromium, new headless) is used; the default headless shell does not animate images.

### Verification results (`reports/phase4-images.md`)
Reference = Chromium's ImageDecoder. Synthetic files (28): every frame dumped to `samples/.golden/` (git-ignored); real + corpus files (17): 6 evenly spaced frames; Chromium also compares live against its own decoder. Every file is decoded through `auto`, `imagedecoder` and `fallback`, in sequential order, by backwards seeks and by skipping, on a canvas the size of the image at dpr 1.
- **Chromium 156 and WebKit 27.2: `auto` 45/45 and `fallback` 45/45 files correct.** GIF fallback is **bit-exact (Δ0)** on every GIF, including all disposal methods. WebP ANMF fallback: **Δ <= 2/255** (premultiplied rounding), tolerance 3. Real files: `rotating-earth.gif` (44 frames), `animated.webp` (100), `static.webp`, 10 corpus WebPs, 4 corpus GIFs.
- `imagedecoder` path: Chromium 44/45 (the one "known" row is the single-frame quirk); WebKit 26/45, all failures being the two documented WebKit bugs and flagged "known".
- **Timing** (Ticker + renderer, 2 plays, 6 files, both forced paths): every frame appears within **<= 18 ms** (one rAF tick) of its scheduled time in both browsers; total play time within 17 ms of the sum of the delays; 1-2 late draws per run (first frame of a loop while its decode lands).
- **Loops:** 14/14 per browser (file loop count 0/1/3/absent for both formats; option beats file; forever; plus the still-image `end`).
- **Leaks** (50 create -> play -> seek -> destroy cycles per path, 4 files x 2 paths): VideoFrames, ImageBitmaps and decoders created = closed in every row; 0 rAF outstanding; 0 ResizeObservers live. **Peak open per renderer:** ImageDecoder 4-8 VideoFrames, ANMF 3 bitmaps, GIF fallback 0 (one RGBA buffer), independent of the file's frame count (100-frame WebP: 8 / 3).
- **SVGA regression after the Viewport/Ticker refactor:** identical to Phase 3.1 (38/38 synthetic checks; all 8 diffs unchanged; perf avg 4.3 ms; 0 leaks).
- Bundle (minified+gzip): GIF decoder 2.2 KB, WebP parser 1.2 KB, Ticker 0.8 KB, whole image renderer **11 KB** (shares format detection + fflate with SVGA); SVGA parser+renderer 11.5 KB; both together 18 KB.

### Tests
203 -> 218 Vitest tests: GIF container/LZW/compositor (disposal 1/2/3, first-frame disposal 3, transparency, interlace, random access = sequential, truncation), WebP container/wrapper, delay clamp, loop semantics, `resolveLoops`, self-test files, detection of every synthetic file.

### Synthetic files (`samples/synthetic/`, 28, committed, ~25 KB)
Generated by `npm run gen:synthetic` (dev-only; no new dependency): GIFs by `tools/synthetic/gif-encoder.ts` (own LZW encoder), WebPs muxed by `tools/synthetic/webp-muxer.ts` from stills that Chrome's canvas encoder produces (lossless `VP8L` at quality 1, lossy `VP8+ALPH` otherwise). Cover: disposal 1/2/3, disposal 3 on the first frame, transparency (several transparent indices), interlace, local/global palettes, delays 0/1/2/5/10/20/50 cs (GIF) and 0/1/10/20/50/100 ms (WebP), loop 0/1/3/absent, alpha blend vs no-blend, dispose-to-background, mixed lossy/lossless frames, odd frame sizes at even offsets, still lossy/lossless/alpha, one-frame files, plus the two self-test files. Dev dependency added: `playwright` (as requested).

### Known issues / limits
- Firefox unverified (cannot launch here). WebKit results are for Playwright's WebKit 27.2, not a real iOS device.
- Native `<img>` timing could not be measured headlessly (see above): clamp rule for Chromium `<img>`/Firefox is documented behaviour.
- GIF rewinds replay from frame 0 (loops are free: a wrap is a reset; scrubbing back on a 500-frame GIF replays up to 499 frames). WebP rewinds restart at the nearest full-canvas no-blend keyframe, else frame 0.
- `verify:corpus` (SVGA) ignores extensionless corpus files; see REVIEW.
- PNG/APNG are not handled (two corpus PNGs are "unsupported-format").

### Phase 4 addendum: the real SVGA corpus appeared (`npm run verify:corpus`, `reports/corpus.md`)
Run as requested when files showed up (16 `.svga`; the 10 WebP / 4 GIF corpus files are covered above; 2 PNGs and the extensionless files are skipped).
- **16/16 parse, 0 failures. 2 files are pixel-exact (0 %): the two `119040-*` files (720x1280). 14 files (`4000xxxx.svga`, all 204x156 or 240x165, 40-1800 small particle sprites) are above the 2 % threshold: mean 2.1-14.4 %, max 3.3-15.7 %.**
- Census: 0 frames with a == 0 / d == 0 (so the "rotated sprites" oracle bug is still not exercised); 82,130 rotated/skewed frames; 4 files with strokes (44 shapes), 0 dashes / arcs / rounded rects / clipPaths / mattes; 2 files with audio.
- **Cause, proven for all 14: image filtering, not geometry, not an oracle quirk.** Layout equals the PNG size everywhere, `layout.x/y` is 0, the PNGs are ordinary palette PNGs, and none of the oracle switches (alpha cut-off, matte isolation) change a digit. A 12x zoom shows our output with crisp single-pixel sparkles where the reference shows smoothly filtered particles. **Feeding our renderer `<img>` elements instead of `ImageBitmap`s makes the diff 0.000 % (40001144, 40001099, 40001427) and 0.003 % (40001578)**: in Chromium, shrunk `<img>` sources are filtered with a higher-quality (mipmapped) path than `ImageBitmap` sources, so heavily downscaled particle sprites alias in our output. (The tiny canvases also make the metric large: one edge pixel is a big share of 204x156.) `verify:corpus` now tries this switch automatically and reports it as "proven" for each file.
- Costs measured: `<img>` sources on Pink-Heart-Rocket: avg 5.2 ms (vs 4.4 ms), small files unchanged or faster. The alternative `imageSmoothingQuality = 'medium'` (new opt-in `imageSmoothing` option on `SvgaRenderer`, default unchanged = 'low') halves the mismatch (14.4 -> 6.7 %, 9.5 -> 4.9 %) but leaves 13 of 16 files over 2 %, adds 0.02-0.35 % to previously exact files, and **doubles the draw time (4.5 -> 10.6 ms, 'high' 19 ms)**, so it is not the fix.
- **Not changed, decision left to the reviewer** (it alters how decoded images are held: `<img>` elements have no `close()`, the browser manages their decode cache, they are DOM-bound): switch `decodeSvgaImages` to return decoded `<img>` elements (or a hybrid), at least on Chrome. Reproduce: `/verify.html?task=diff&sample=corpus/40001144.svga&srcimg=1` vs without `srcimg`. Not checked in Safari/Firefox (their filtering of the two source types may differ).

---

## Phase 4.1 — SVGA downscale quality decision + Firefox ✅ (awaiting review)

### Task 1: `<img>` sources (A) won, under decision rule 2
**Prototype commit `99afaf0`** holds both candidates and the measurements (Option B's code is in that commit only); the following commit removes B and the experimental `imageSmoothing` option. Data: `reports/phase4.1-image-strategy.json`; harness: `scripts/measure-image-strategy.mjs` (now baseline vs A), `playground/verify.ts` tasks `diffall`, `loadtime`, `memory`.

**Measured on all 24 SVGA files (8 repo + 16 corpus), every 10th frame, in Chromium 156 and WebKit 27.2** (RSS = summed resident memory of all the browser's processes, sampled from Node at phase markers; Chromium has a forced `gc()`, WebKit has none so large allocate-and-drop passes stand in for it):

| browser | variant | worst corpus file max % | corpus files > 2 % | mean diff over corpus % | repo samples worst % | load Pink-Heart-Rocket / 40001576 (ms) | drawFrame avg / p95 (ms) | RSS after load vs baseline (MB) | RSS after 20 cycles vs baseline (MB) |
|---|---|---|---|---|---|---|---|---|---|
| chromium | ImageBitmap (before) | 15.721 | 14/16 | 3.799 | 0.434 | 8.8 / 12.2 | 4.21 / 7.6 | +39.4 | -316.7 |
| chromium | **A: `<img>`** | **0.236** | **0/16** | **0.003** | 0.434 | 14.2 / 22.3 | 4.22 / 7.6 | +45.3 | -576.8 |
| chromium | B: mip chain | 9.380 | 8/16 | 1.252 | 0.434 | 10.1 / 18.2 | 4.88 / 9.1 | -37.8 | -365.2 |
| webkit | ImageBitmap (before) | 1.188 | 0/16 | 0.152 | 0.434 | 31 / 33 | 0.44 / 1 | +8.2 | -91 |
| webkit | **A: `<img>`** | **0.201** | **0/16** | **0.013** | 0.434 | 20 / 28 | 0.48 / 1 | -9.3 | -92.7 |
| webkit | B: mip chain | 18.429 | 14/16 | 5.004 | 0.434 | 65 / 135 | n/a | +22.3 | -90.6 |
(Repo samples worst 0.434 % is Rocket.svga's oracle matte bug at step 10, identical for every variant. WebKit drawFrame times are not raster-synchronous, so they only show that nothing got slower. Chromium drawFrame for baseline/A is a clean re-run; B's comes from the matrix run.)

**Rule 1 (choose B) fails in both browsers on the very first criterion** (every file < 2 %): B leaves 8 of 16 corpus files above 2 % in Chromium (worst 9.4 %) and, worse, **makes WebKit worse than doing nothing** (14 of 16 above 2 %, worst 18.4 %; WebKit already had 0 of 16 before). It was tuned first: the level-selection bias mattered enormously (0 was best; 0.5 -> 7-17 %, 1.5 -> 17-31 %), floor-sized levels were worse than ceil, and levels built by `createImageBitmap(resizeQuality 'high')` were better than canvas halving but still 1.2-9.4 % on the worst files. Chromium's `<img>` path (cc image-decode cache + Skia mip filter) cannot be reproduced closely enough from outside, and B's cost (load time +15-50 % in Chromium and +110-310 % in WebKit, plus the mip levels' memory) buys nothing.
**Rule 2 (choose A) passes:** A is under 2 % in both browsers (Chromium worst 0.24 %, WebKit 0.20 %; the final corpus run after the change: worst 0.176 %, 16/16, mean of means 0.001 %), and memory returns to baseline after load/destroy cycles with no upward trend (clean re-runs, RSS MB baseline -> after-cycles-settled: Chromium 20 cycles 903.7 -> 912.8 (+1 %), 60 cycles 1046.8 -> 795.7; WebKit 20 cycles 424.3 -> 376, 60 cycles 355.7 -> 320.5; the old ImageBitmap path behaves the same). Caveat: RSS is noisy and dominated by browser state; WebKit has no `gc()`, so its "after GC" is an allocate-and-drop approximation.
**Costs of A, reported not hidden:** load time in Chromium is +61-83 % (`img.decode()` is slower than `createImageBitmap`: 8.8 -> 14.2 ms on Pink-Heart-Rocket; it is faster in WebKit, 31 -> 20 ms); drawFrame time is unchanged; `<img>` elements cannot be used in a Worker (`decodeSvgaImages(movie, { source: 'bitmap' })` remains for that and for comparisons).

**What changed in the code**
- `decodeSvgaImages` now defaults to `source: 'img'`. `decodeImageElement(blob)`: `img.decode()` before first use, then `URL.revokeObjectURL`, width/height pinned to the natural size, and `close()` sets `src = ''` (deterministic release on destroy, which the gift queue needs). `SvgaBitmap` type = `ImageBitmap | <img>` with `close()`.
- `SvgaRenderer.setImage(Blob | URL)` also decodes through `<img>`: a 1000 px avatar shrunk into a 60 px slot has the same aliasing problem. A caller-supplied `ImageBitmap` is still used as is and never closed (documented).
- Evidence for release: the SVGA leak test decoded 1,450 `<img>` elements over 50 cycles; **0 still held a resource after `destroy()`** (plus 0 open bitmaps, 0 rAF, 0 ResizeObservers).
- Removed: `render/mips.ts` and all of B, the `imageSmoothing` option, the `srcimg`/`mips`/`smooth`/`bias` harness switches, and the "image filtering" step in `verify-corpus` (it is now the default behaviour).

**Verification after the change**
- `verify:browser`: **41/41 synthetic checks** (3 new: `setImage` from Blob and from URL through `<img>`, replacing a replacement), all 8 repo diffs, perf **4.21 ms avg / 7.5 p95**, leaks 0. **No Phase 3 regression, a small improvement:** with the oracle's two quirks neutralised every sample is now exactly 0.000 % (it was 0.002-0.083 %: those residuals were this same filtering difference); plain: Glossy-Pink-Lips max 0.224 -> 0.215, angel 0.062 -> 0, kingset 0.007 -> 0, Fiery-Red-Dragon 0.002 -> 0, Rocket 0.437 (oracle matte bug) and Pink-Heart-Rocket frame 125 (oracle alpha cut-off) unchanged.
- **`verify:corpus`: 16/16 under 2 % (was 2/16): worst 0.176 % (40001143), mean of means 0.001 %.** The two `119040-*` files stay exact.

### Task 2: Firefox: still not launchable (time-boxed, then stopped)
Playwright's Firefox 157 (build 1555) exits immediately with "Could not find profile folder". Tried this time, on top of the earlier attempts: `PLAYWRIGHT_BROWSERS_PATH` and `TMPDIR` on the internal disk (`~/Library/Caches/ms-playwright`, `/tmp`, `~/.ff-tmp`) with the working directory also off the external volume: **identical failure, so the external volume is not the cause**. Also: an ad-hoc `codesign --force --deep --sign -` of the downloaded bundle (`codesign -v` then passes; same failure); `--profile`, `-profile dir/`, `-foreground`, `MOZ_HEADLESS=1` without `-headless`; `-CreateProfile` + `-P` (it does not even create the profile directory); sandbox-free runs; the earlier forced re-download. No stock Firefox is installed to compare. The machine runs macOS 27.0.1; the failure looks like a Firefox 157 / macOS 27 incompatibility rather than anything in our setup. Left unverified; no Firefox column in the support table.

### Phase 5 housekeeping: Firefox (per reviewer)
Stopped trying Firefox locally (macOS 27.0.1 incompatibility with the Playwright Firefox 157 build is out of our hands). **Firefox coverage will come from a Linux CI job in Phase 7.** Until then there is no Firefox column in any support table.

## Phase 5 — PAG via libpag (lazy-loaded) ✅ (awaiting review)
Numbers: `reports/phase5-pag.json` (`npm run verify:pag`, Chromium 156 + WebKit 27.2); text screenshots: `reports/text/`.

### Dependency
`libpag` **4.5.85**, exact-pinned (devDependency; the SDK never bundles it). **License: Apache-2.0.** 4.5.85 rather than 4.4.x because the 4.4.x tarballs lack `lib/` (no prebuilt WASM). Engine URLs default to `cdn.jsdelivr.net/npm/libpag@4.5.85/lib/...`; options `pagModuleUrl`, `pagWasmUrl` (self-host), `pagModule` (inject).

### Design (`src/formats/pag/`)
- `engine.ts`: `loadPagEngine()` loads once per page via a variable-specifier dynamic `import()` (bundlers cannot inline it). `fetch-failed` errors mention CSP. One `PAG.globalCanvas.retain()` is held by the SDK.
- `renderer.ts`: `PagRenderer implements FrameSource`. `frameCount = round(duration*fps)`, `frameDuration = 1000/fps`, no file loop count (PAG has none; option > once). Our `Ticker` drives libpag (`setProgress` + `flush`), never libpag's own loop. Drawing is async; stale frames are skipped, never queued. Progress for frame i is `(i*1e6/fps + 1µs)/duration` (naive `i/n` lands on frame i-1 for some i because of float error: measured, `naiveBoundaryProgressLandsOnWrongFrame` in the JSON). Shares `Viewport`.
- **WebGL contexts:** libpag runs in Canvas2D mode, where ALL views share one WebGL context and the result is copied into our 2D canvas. Any number of gifts therefore need 1 context. `destroy()` waits for an in-flight flush, then destroys view, file, replacement images, clears the canvas.
- `core/{fonts,replacement,color}.ts`: `registerFont(family, bytes)` (FontFace; returns a disposer), `setPagFallbackFonts`, shared `TextStyle`/`ImageOptions`.
- Replacement: `getEditableKeys()` → `{key, type, index, name}` (key = layer name or `#<index>`) on PAG and now also SVGA (sprite image keys); `setText`, `setImage`, `setHidden`, `clearReplacement`. Unknown key: console warning, no throw.
- `scripts/check-bundle.mjs` (`npm run check:bundle`) fails if the core bundle contains libpag markers or exceeds a size cap. Core incl. PAG adapter: 34.3 KB min, 13.3 KB gzip.

### CSP
`script-src` (or `script-src-elem`) must allow the module host (jsDelivr by default) and `'wasm-unsafe-eval'` (WebAssembly compile); `connect-src` must allow the same host (WASM + module fetch). Self-hosting: allow `'self'` and pass `pagWasmUrl`/`pagModuleUrl`.

### Sizes and cold load (jsDelivr CDN, Chromium / WebKit)
JS 296.5 KB (62.1 KB br/gzip on the wire), WASM 1,575 KB (460.6 KB on the wire). First PAG, cold, engine + first frame: 598 ms / 523 ms (engine load alone 558 / 487 ms). Second renderer: 11 / 6 ms. Local dev server: 135 / 118 ms. WebKit Resource Timing reports 0 transfer sizes for cross-origin entries, so wire sizes are Chromium's.

### Verification (both browsers: all pass)
- **Frame accuracy:** our `drawFrame(i)` vs libpag driven directly at the same frame: 0 differing frames in both files (like.pag 28 frames, replacement.pag 60). Random-order seeks equal in-order playback except frame 0 in Chromium (≤1 level in ≤5 bytes: libpag's first render of frame 0 is not bit-stable there; flagged).
- **Timing/loops:** same method as Phase 4: max abs error 15 ms (Chromium) / 11 ms (WebKit); total 2348 vs 2333 ms. Plays: default 1, `loops:3` → 3, `0` → forever.
- **Leaks / contexts:** see REVIEW.md. 100 create→play→setImage→destroy cycles: 1 context created, 0 lost; 5 players random-order destroy ×6 rounds: 0 lost. Control (libpag default mode, 24 live views): 24 contexts, browser lost 9.
- **Replacement:** 7 checks (image swap, survives seek, second swap, Blob/URL, unknown keys). Fonts: 3 checks (registered font changes rendering in SVGA and PAG; disposer removes it).
- **Perf:** render+copy ≤1 ms avg; with GPU readback 2–7 ms avg (table in REVIEW.md). Our Ticker-driven path is fast enough; libpag's own loop was not needed.

### Text in other scripts (judgment call, flagged)
SVGA (browser canvas text) shapes Hindi, Gujarati and Arabic correctly, RTL included. **PAG fails**: libpag draws glyph by glyph on a canvas without a shaper, so Devanagari/Gujarati matras show as dotted circles and misplaced marks, and Arabic is drawn as isolated, left-to-right letters. Latin and emoji (colour) are fine. Fonts: system fonts are used; for guaranteed coverage register a font with `registerFont` (it makes glyphs exist, it cannot add shaping). Not fixed here; options for the reviewer: (1) document it, (2) SDK-side shape/rasterise text to an ImageBitmap and put it in the PAG image layer for complex scripts.

### Playground
`compare.html` takes `.pag`: "PAG engine loading…" state, libpag's own player as reference, editable-keys list (also for SVGA), live text/image/hide/clear demo. `verify-pag.html` hosts the verification tasks.

### Known issues / open
Firefox: none locally (Linux CI in Phase 7). Chromium frame-0 nondeterminism above. libpag declares its own runtime deps; only dev-installed here.

## Phase 6 — Public API, queue, cache (+ PAG text follow-up) ✅ (awaiting review)
Numbers: `reports/phase6-api.json` (`npm run verify:api`, Chromium 156 + WebKit 27.2). Unit tests: 256 (Vitest). Harness: `playground/verify-player.{html,ts}`; resource counters: `playground/lib/counters.ts`; simulator: `playground/stream.html`.

### Part A: PAG complex-script text
`PagRenderer.setText` logs ONE `console.warn` per player when the text contains Indic, Arabic, Hebrew, Thai, Khmer, Myanmar (etc.) characters (regex over U+0590–U+0DFF, U+0E00–U+109F, U+1780–U+17FF, U+FB1D–U+FEFF); Latin, CJK, emoji do not warn; SVGA never warns (browser text drawing shapes correctly). Verified in both browsers (`api` task).

### Known limitations
- **PAG text cannot shape complex scripts or do RTL** (libpag draws glyph by glyph, no shaper): Hindi/Gujarati marks misplaced, Arabic isolated and left-to-right. Use SVGA for personalised names in those scripts. Details and screenshots: Phase 5, `reports/text/`.
- A GIF/WebP whose file says "loop forever" would hold a queue forever: `GiftQueue` therefore plays each gift once unless the item (`loops`) or the queue (`defaultLoops`) says otherwise.
- `GiftPlayer` has no replaceable layers for GIF/WebP: `setText`/`setImage` warn and do nothing.
- Firefox: Linux CI in Phase 7.

### Deferred (per owner, for the future personalisation phase)
- `setTextImage`: SDK-side shaping/rasterising of complex-script text into an image fed to a PAG image layer.
- Checking upstream libpag for a shaping fix.

### Public API (all in `src/index.ts`, TSDoc on every export)
- `GiftPlayer` (`src/player/player.ts`): `new GiftPlayer(container, {contentMode, loops, pauseWhenHidden = true, devicePixelRatio, observeResize, cache, staticDurationMs, pagModuleUrl, pagWasmUrl, pagModule})`; `load(src, {replacements, signal, loops}) -> {format,width,height,frameCount,durationMs,editableKeys}`; `play()` (resolves at the end, rejects `aborted` on stop/new load/destroy); `pause() resume() stop() seek(frame)`; `setText setImage setHidden clearReplacement getEditableKeys`; `on/off('loaded'|'start'|'loop'|'end'|'error'|'frame')` (`frame` only emitted while someone listens); `destroy()` (idempotent); getters `playing`, `current`, `lastSwapMs`; statics `preload(srcs)`, `registerResolver(scheme, fn)`, `getCache()`, `setCacheBudget(bytes)`.
- **One canvas** per player, created in the container, reused for every `load()` and every format; PAG keeps its shared-WebGL-context path.
- **Load races:** a new `load()` (or `signal`, or `destroy()`) aborts the one in flight; loads are serialised through a tail promise so two never touch the canvas together. The previous gift stays on screen (and playing) while the new one downloads and is replaced at the moment the new one is ready: from then to the new first frame the canvas is blank (`lastSwapMs`, measured below).
- **Replacements in `load()`** are applied (text sync, images awaited) before frame 0 is drawn; a failing replacement image is reported through `error` and the gift still shows. Unknown keys warn, never throw.
- **Errors:** `GiftPlayerError.code`: `unsupported-format`, `invalid-input`, `network` (was `fetch-failed`), `parse-failed`, `decode-failed`, `engine-load-failed` (was a `fetch-failed` of the PAG engine; also for a blocked WASM), `aborted`. Every public rejection is a `GiftPlayerError`.
- **pauseWhenHidden:** `visibilitychange` pauses the ticker (position kept) and resumes it from the same frame: no catch-up burst (checked: ≤ 3 frames after 700 ms hidden).
- **SSR:** importing the package touches no browser global (test runs the built ESM and CJS with `window`/`document`/`navigator`/`self`/`location`/`requestAnimationFrame` made to throw on any access). The default cache is created lazily. `new GiftPlayer` on a server throws `invalid-input`.
- `GiftQueue` (`src/queue/queue.ts`): see below. `AssetCache` (`src/cache/asset-cache.ts`): see below. Resolvers in `src/player/asset.ts`.

### GiftQueue
`new GiftQueue(player, {maxLength = ∞, preloadAhead = 2, coalesce = false, defaultLoops = 1})`; `add(src, {priority = 0, replacements, loops}) -> {id, status, count, cancel(), done}`; `pause() resume() clear() skip() destroy()`; `length`, `isPlaying`, `stats`; events `item-begin`, `item-start`, `item-end`, `item-error`, `item-dropped` (`reason: overflow | cancelled | cleared`), `change`, `idle`.
- One at a time; higher priority first, FIFO within a priority; `add()` starts the loop in a microtask, so a burst added in one go is ordered as a whole.
- Full: the lowest priority goes, oldest first (the new item too, if it is the lowest), with `item-dropped`.
- Preload: the next `preloadAhead` waiting gifts are held in the cache (fetched, parsed, SVGA images decoded, PAG engine loaded and warmed); holds are released when an item leaves that window or starts.
- A failed gift (also a failed preload) is reported by `item-error` and skipped; stress run below shows no stall.
- `coalesce`: an `add()` identical (source identity, priority, loops, replacements) to the waiting item it would directly follow joins it; `count` is the combo number (`item-start.count`); cancelling one merged add lowers the count.
- `stats.gapsMs` / `blankMs`: for gifts that were already waiting: gift end → next first frame on screen, and the blank-canvas part of it.

### Cache and resolvers
- `AssetCache`: LRU by estimated decoded bytes (default 64 MB): SVGA = decoded `w*h*4` per image + encoded copies; GIF/WebP = file + one frame; PAG = 4 x file. Reference counted: a leased asset is never evicted (the cache may exceed the budget while it is in use and evicts as soon as it is released). Concurrent requests share one load; the load aborts only when every requester has aborted. `SvgaRenderer` got `sharedImages` (the cache owns the images; the renderer neither closes nor clears them). Replacement images stay owned by their renderer.
- Not cached: ArrayBuffer/Blob sources (loaded privately, disposed with the player). Browser HTTP cache is left to the browser.
- `registerResolver('gift', async (ref) => url | ArrayBuffer | Blob)`: hook only (a URL result becomes the cache key). Reserved: http, https, blob, data, file.
- `releasePagEngineContext()` now also calls `WEBGL_lose_context` when it released the last reference (libpag only dropped its references, the context stayed alive): the page's live WebGL contexts really go to 0.

### Verification (both browsers pass; details in REVIEW.md)
`api` 45 checks, `engine` 4, `cache` 13, `leaks` (100 cycles), `stress` (200 items + 120 items with maxLength 20). Fixes found by the verification: failed `<img>` decodes left a holder with `src` set (now cleared); the first queue item started before `add()` returned (now a microtask); `item-begin` event added.
