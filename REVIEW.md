# REVIEW — Phase 2: SVGA parser

## Status
Done. Phase 2 work is commit `c90a455` (a second tiny commit on top only corrects this line).

## What was built
- `parseSvga(bytes, detected?)`: pure, synchronous, runs in Node. Hand-written protobuf decoder (full `MovieEntity`, 10-byte varints) plus a 1.x `movie.spec` normaliser; 2.x, 1.x and 1.5 (`movie.binary`) all produce one `SvgaMovie` model.
- Parse-time resolution of KEEP shapes, proto3 defaults, frame-count normalisation, magic-byte split of images vs audio; matte keys preserved on sprites.
- `decodeSvgaImages` / `releaseSvgaImages` (browser only), checked in real headless Chrome on all samples.
- Playground inspect view (drop file or pick sample; `?sample=` param).
- `CLAUDE.md` with the standing REVIEW.md rule; `fflate` replaces `pako`.

## Decisions taken
- **fflate replaces pako (+zip lib):** pako+jszip 129,222 B min / 39,779 B gzip vs fflate (`unzlibSync`+`unzipSync`) 5,818 B min / 2,891 B gzip; all tests pass. pako removed; jszip is devDependency only (oracle).
- **Schema** from svga/SVGA-Format `proto/svga.proto`, commit `c5c26c14fc2a1e104a067d0b58f237646d2e9de1`; reference copy kept in `src/formats/svga/`.
- **Present-but-partial transform follows proto3 (omitted = 0)**, unlike svgaplayerweb's `|| 1.0` for a/d; missing transform message = identity.
- **KEEP resolved per sprite** (svgaplayerweb leaks state across sprites via a global).
- **fps <= 0 -> 20 with a warning**; frames <= 0, non-positive viewBox, frames > 100k, or sprites x frames > 20M -> `parse-failed`.
- **Dangling matteKeys kept + warned** (Rocket.svga has 3 in its own data).
- **movie.binary preferred over movie.spec** in zips, spec as fallback; svgaplayerweb ignores movie.binary.
- `decodeSvgaImages` skips undecodable images (reported in `failed`) rather than failing the whole file.

## Flags / questions for reviewer
- **Oracle: no mismatch.** With jszip, svgaplayerweb parses Rocket.svga as 1080x630, 60 fps, 480 frames, 20 sprites: same as direct `movie.spec` reading. Neither set was adjusted.
- Oracle quirks handled in tests: its `imageCount` includes audio blobs; its `version` is its own label.
- **Untested against real files:** SVGA 1.5 (`movie.binary`), 1.x vector shapes, 1.x audio. Synthetic zips only. Please supply real samples if you have them.
- Renderer (Phase 3) must ignore a `matteKey` that matches no sprite, and treat `.vector`/`.matte` keys without a bitmap as valid.
- No zip-bomb / inflate-size cap yet.
- The Claude-in-Chrome extension was not connected (account mismatch), so browser checks used local headless Chrome; no interactive drag-and-drop test was done (file picking via `?sample=` and the dropdown path is the same `inspect()` function).

## Test summary
109 tests pass (3 files): 44 detection, 65 parser. Notable: fuzz (every-prefix truncation + 300 bit-flips + random bytes after zlib/zip headers) always yields `parse-failed`, never a raw RangeError. Build and typecheck (now incl. `/playground`) pass.

## Files changed
CLAUDE.md, REVIEW.md, PROGRESS.md, package.json, package-lock.json, tsconfig.json, scripts/gen-expected.cjs, scripts/measure-bundle.mjs, samples/expected.json, playground/index.html, playground/main.ts, src/index.ts, src/core/errors.ts, src/core/detect.ts, src/formats/svga/{wire,proto,spec-json,parse,media,decode-images,types,index}.ts, src/formats/svga/svga.proto, tests/detect.test.ts, tests/svga-parse.test.ts, tests/helpers/pb.ts
