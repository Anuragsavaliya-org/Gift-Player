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
| `@types/pako` | dev | types (v2 types against pako 3 — typechecks fine). |
| `@types/node` | dev | tests use `node:fs`. |
| `svgaplayerweb` | dev | reference oracle for `expected.json`. |

### Decisions
- **No protobufjs in detection.** SVGA 2.x is recognised by inflating and walking protobuf wire format with a ~40-line reader, checking `MovieEntity` shape (field 1 version string, field 2 `params` with float/float/int/int fields, fields 3-5 length-delimited, nothing else). Keeps detection light; protobufjs choice stays open for Phase 2. Note: svga.proto numbering is `version=1, params=2` (my first draft had this wrong; caught by real samples).
- SVGA 1.x is identified by the ZIP signature alone (per roadmap). Any ZIP is reported as svga 1.x; the Phase 2 parser must validate `movie.spec`. Flagging: a non-SVGA zip will pass detection and fail later.
- Static WebP is detected as `{format:'webp', animated:false}`, not an error (still a valid image; player can decide).
- Whole file is read before detection (no range requests) — simple, and files are small.

### Known issues / gaps
- **`/samples` contains only 3 SVGA 2.x files.** No GIF, WebP (animated/static), PAG, or SVGA 1.x. GIF/WebP/PAG/zip detection is verified only on **synthetic headers**, not real files. **Please add real samples**, esp. an animated WebP and a PAG (PAG header assumption `PAG` at byte 0 is unverified against a real libpag file). Phase 4 and 5 cannot be called done without them.
