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
