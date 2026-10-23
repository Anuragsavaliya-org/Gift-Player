# NEXT PROMPT — Phase 2: SVGA parser

Phase 1 fixes are approved (6f68e9f). Start Phase 2 from ROADMAP.md, with the decisions and constraints below.

## Step 0 — Standing workflow (do this first, once)

Create `CLAUDE.md` at the repo root (or add to it if it exists) with this standing rule, so it applies to every future prompt:

> **Workflow:** Each task is given in `NEXT_PROMPT.md`. When a task ends (done, or stopped on a blocker), overwrite `REVIEW.md` at the repo root using the format in the "End of task" section of NEXT_PROMPT.md. `REVIEW.md` is read by the reviewer (Claude Desktop), so keep it factual and short, and never paste raw terminal output into it. `PROGRESS.md` remains the long-running log; `REVIEW.md` holds only the latest task.

Commit `CLAUDE.md` together with the Phase 2 work.

## Decisions for this phase

1. **jszip: yes, as a devDependency only.** Use it in `scripts/gen-expected.cjs` so that `svgaplayerweb` can parse `Rocket.svga` (1.x). Regenerate `expected.json`. If the oracle's values differ from the ones you read directly from `movie.spec` (1080×630, 60 fps, 480 frames, 20 sprites), flag the difference. Do not adjust either set to make them match.

2. **Runtime decompression: evaluate `fflate` as a replacement for `pako`.** 1.x parsing needs unzip at runtime, and `fflate` provides both zlib inflate (`unzlibSync`) and unzip (`unzipSync`), is tree-shakeable, and would replace two dependencies with one. Measure the bundle size of each option and record the numbers in PROGRESS.md:
   - pako + a zip library
   - fflate alone

   If fflate is smaller and passes all tests, switch detection and the parser to it and remove pako. Keep native `DecompressionStream` out of scope for now: it is async, and keeping the parse path sync makes things simpler.

3. **Protobuf: extend the existing hand-written wire reader into a full decoder.** Do not add protobufjs. The schema is small and stable. Fetch the official `svga.proto` from the SVGA GitHub organisation (the SVGA-Format or SVGAPlayer-Web repo) and use it as the source of truth. Do not write the schema from memory. Record in PROGRESS.md which URL and commit the schema came from.

## Phase 2 requirements

### Separate parsing from image decoding

- `parseSvga(bytes)` must be **pure and synchronous**, and must run in Node/Vitest. It returns a typed `SvgaMovie` model in which images are kept as raw bytes.
- Converting images to `ImageBitmap` is a separate function, `decodeSvgaImages(movie)`, which runs only in the browser. Write it now, but test it only in the playground. `createImageBitmap` does not exist in Node, so the parser must never call it.

### One internal model for both versions

- 2.x (protobuf) and 1.x (`movie.spec` JSON, plus PNG files in the zip) must normalise into **the same `SvgaMovie` type**. The Phase 3 renderer must never need to know which version a file came from.
- 1.x can also contain `movie.binary`, which is protobuf inside a zip. Handle it with the 2.x decoder.

### Correctness rules to implement and test

- **proto3 defaults:** a missing scalar means 0 or an empty string. A missing `transform` means identity. A missing `layout` means zero. A frame with alpha 0 means the sprite is hidden in that frame.
- **Floats** are fixed32 little-endian. Use a `DataView` and read with `getFloat32(…, true)`.
- **`KEEP` shape type:** resolve it at parse time by copying the previous frame's shapes into the frame. The renderer must never see `KEEP`.
- **Images map can contain audio:** in 2.x, audio bytes (mp3) also sit in the `images` map. Classify each entry by its magic bytes (PNG, JPEG, WebP, MP3/ID3) into `images` and `audios`. Never pass audio bytes to `createImageBitmap`. Playing audio is still out of scope.
- **matteKey:** parse it and keep it on the sprite. Rendering it is Phase 3's job.
- **Varints:** must handle 10-byte values. Errors must be `GiftPlayerError('parse-failed')` with a useful message. Add `parse-failed` to the error codes.

### Tests (Vitest)

- Every SVGA sample matches `expected.json` on fps, frames, sprite count and viewBox.
- Invariants for every sample: each sprite has exactly `frames` frame entries; every `imageKey` resolves to an image or a known matte or vector-only case; and no `KEEP` shapes remain after parsing.
- `matteBitmap.svga` and `matteRect.svga` parse with their matte keys preserved.
- Corrupt input (truncated or random bytes after a valid header) throws `parse-failed`. It must not throw an uncaught `RangeError`.
- Log the parse time of the largest sample in PROGRESS.md. This is information only, not a test.

### Playground

Add an "inspect" view: drop a file, and the page shows the parsed model summary (version, fps, frames, sprites, image count, audio count, matte sprites) and a grid of the decoded images, using `decodeSvgaImages`. Rendering is **not** part of this phase.

## Out of scope

Rendering, the animation loop, the public `GiftPlayer` API, and audio playback.

## End of task

1. Build, typecheck and tests must all pass. Commit, and update PROGRESS.md.
2. Overwrite `REVIEW.md` with exactly these sections:
   - **Status:** done / blocked, plus the commit hash.
   - **What was built:** 3–6 lines.
   - **Decisions taken:** each decision with a one-line reason, including the fflate result with its bundle-size numbers.
   - **Flags / questions for reviewer:** anything you skipped or were unsure about, including any oracle mismatch.
   - **Test summary:** the test count and anything notable.
   - **Files changed:** paths only.
3. Stop. Do not start Phase 3.
