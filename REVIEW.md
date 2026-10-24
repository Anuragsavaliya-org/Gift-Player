# REVIEW — Phase 7: Hardening, packaging, React wrapper, CI

## Status
Done. Nothing published; `license` and the package name untouched. `npm run ci:local` (every step of the workflow, Chromium + WebKit) passes: typecheck, 273 tests (14 files, incl. SSR and React), build, `check:bundle`, `npm pack --dry-run`, and `verify:browser`, `verify:corpus`, `verify:images`, `verify:pag`, `verify:api` in both browsers. **Firefox has not run anywhere yet: its first results come from the first CI run** (no git remote). Commit: `8a8f6f6` (a tiny follow-up commit only records this line).

## Part A: `clearOnEnd` test results (Chromium and WebKit, 23 checks each, all pass)
| check | SVGA | GIF | WebP | PAG |
|---|---|---|---|---|
| `end` event still sees the last frame; afterwards the canvas has 0 visible pixels (default) | pass | pass | pass | pass |
| `clearOnEnd:false` keeps the last frame | pass | pass | pass | pass |
| `player.clear()` blanks it; `load({clearOnEnd:true})` overrides the player option | pass | pass | pass | pass |
| `play()` after a clear shows the gift again | pass | pass | pass | pass |
Queue: next gift still downloading (400 ms delay): blank in every sampled frame between the two gifts (pass); next gift prepared: hand-over blank = the swap only (< 60 ms, pass); blank after the last gift (pass). Unit test of the queue's rule (blank unless the next one is prepared; also after a failure). Decision 4 is documented precisely in the `load()` TSDoc and README: a gift still PLAYING when `load()` is called stays until the new one is ready; an ENDED gift is already gone.

## Export lists (the SSR test asserts these exactly, ESM and CJS)
- **`@incodes/gift-player`**: `AssetCache`, `DEFAULT_CACHE_BYTES`, `GiftPlayer`, `GiftPlayerError`, `GiftQueue`, `VERSION`, `detectFormat`, `getDefaultCache`, `registerFont`, `registerResolver`, `releasePagEngineContext`, `setPagFallbackFonts`. Types: `AssetCacheOptions`, `CacheLoaded`, `CacheStats`, `ContentMode`, `DropReason`, `EditableKey`, `FontData`, `FormatInfo`, `GiftErrorCode`, `GiftFormat`, `GiftInfo`, `GiftPlayerEvents`, `GiftPlayerOptions`, `GiftQueueEvents`, `GiftQueueOptions`, `GiftSource`, `ImageOptions`, `Lease`, `LoadOptions`, `LoadedGift`, `PagEngineOptions`, `PreloadOptions`, `PreloadResult`, `QueueAddOptions`, `QueueHandle`, `QueueItemInfo`, `QueueItemStatus`, `QueueStats`, `Replacement`, `ReplacementImage`, `Replacements`, `ResolvedSource`, `SourceResolver`, `TextStyle`. Flagged: `LoadedGift`, `PagEngineOptions`, `CacheLoaded`, `Lease`, `GiftSource` are types only; they stay at the root because public signatures mention them.
- **`/advanced`** (unstable, not semver): `DEFAULT_PAG_MODULE_URL`, `DEFAULT_PAG_WASM_URL`, `PAG_VERSION`, `PagRenderer`, `decodeSvgaImages`, `detectSource`, `loadPagEngine`, `parseSvga`, `readSource`, `releaseSvgaImages`; types `DecodedSvgaImages`, `PagRendererOptions`, `SvgaMovie` and the other SVGA model types.
- **`/react`**: `GiftPlayerView`, `useGiftQueue`; types `GiftPlayerViewProps`, `GiftQueueState`, `UseGiftQueueResult`.

## Bundle sizes and caps (what a consumer's bundler produces, minified; cap = measured + 10 %)
| entry | measured | gzip | cap |
|---|---|---|---|
| root | 83,488 B | 29,210 B | 91,837 B |
| `/advanced` | 35,786 B | 13,848 B | 39,365 B |
| `/react` (includes the root; React external) | 85,084 B | 29,735 B | 93,593 B |
libpag is searched in all three bundles and in every dist file; React must not be in root or `/advanced`. Negative tests (all fail the check as they should): libpag string in `/advanced`, libpag string in a shared chunk, `import "react"` in the root, +16 KB padding in the root.

## Tarball (`npm pack`): 26 files, 280 kB packed, 1.0 MB unpacked
`README.md`, `package.json`; `dist/`: `index`, `advanced`, `react` each as `.js` + `.cjs` + `.d.ts` + `.d.cts` + source maps, shared chunks `chunk-5SLTWGUA.js` (52.8 kB) and `chunk-QFXKZKO5.cjs` (57.5 kB), and `source-DUNPmnfN.d.ts/.d.cts` (shared types). No tests, samples, reports, scripts or playground. `exports` (import + require + types for each entry), `typesVersions`, `files`, `sideEffects:false`, `engines` (node >= 18), optional peer `react >= 18`.

## Fresh-project results (tarball installed into new projects outside the repo; Chromium and WebKit)
| project | code needed | result |
|---|---|---|
| **Vite 8 vanilla-ts** (TypeScript 6) | `main.ts`: 4 lines (import, `new GiftPlayer(el)`, `await player.load('/rocket.svga')`, `await player.play()`) + `style="width:360px;height:360px"` on the `#app` div | `tsc && vite build` passes (bundle 76.8 kB, 26.9 kB gzip, no libpag); `vite dev` and `vite preview` play it; one canvas, blank after the end |
| **Next.js 16.4, App Router, React 19.3** | client component `gift.tsx`: 6 lines (`'use client'`, import `GiftPlayerView`, a function returning `<GiftPlayerView src=... style={{width:360,height:360}} />`); server component imports `VERSION`, `detectFormat`, a type; route handler calls `detectFormat` | `next build` passes; `next start` and `next dev` (StrictMode) play an SVGA and a PAG gift (engine from the jsDelivr default); one canvas each; blank after the end; no console problems; route handler returned `{"format":"pag"}` |
Friction: only that the box needs a size (a zero-height element shows nothing; README says so). No bundler config, `transpilePackages` or `ssr:false` was needed.

## React wrapper tests
11 Vitest + jsdom tests with a scripted player/queue (mount/unmount, `src` change aborts the load in flight and discards its result, StrictMode leaves 1 live player and plays once, `replacements` diff applies in place incl. when they change mid-load, `contentMode` re-fit, errors vs aborts, `useGiftQueue` lifecycle and stats) + a real-browser page (`verify-react`, 24 checks, both browsers): StrictMode for GIF, WebP, PAG and SVGA (one canvas, loaded once, ended once, blank after), `src` change mid-load, replacements changed and removed without a reload, 40 mount/unmount cycles incl. mid-load, `useGiftQueue` with three gifts; every Phase 6 counter (bitmaps, `<img>`, blob URLs, rAF, ResizeObservers) back at baseline, 0 WebGL contexts after `releasePagEngineContext()`, no double closes.

## CI steps run locally (`npm run ci:local --browsers=chromium,webkit`)
typecheck 2 s · tests incl. SSR 4 s · build 2 s · `check:bundle` · `npm pack --dry-run` · then per browser: `verify:browser` (40 / 31 s) · `verify:corpus` (14 / 16 s; the real corpus exists on this machine, so it ran for real; in CI it reports "waiting for files" and passes) · `verify:images` (108 / 120 s) · `verify:pag` (43 / 42 s) · `verify:api` (106 / 110 s). All ok. Workflow: `.github/workflows/ci.yml` (job `checks`; matrix job `browsers` for chromium, firefox, webkit; reports uploaded as artifacts). Not runnable here: the YAML itself on GitHub, Firefox, `npx playwright install --with-deps` on Ubuntu.
Changes to make the suites CI-ready (flag if you disagree): every verify script takes `--browser`; `verify-all` / `verify-corpus` moved from a local Chrome to Playwright and now exit non-zero on failure; `verify:browser` passes on the diff with svgaplayerweb's known quirks neutralised (the raw 10.5 % on Pink-Heart-Rocket is the documented oracle quirk); its determinism check reads a software canvas; the font-registration check skips when the git-ignored `samples/.fonts/` is missing; the PAG timing check retries up to 3 times with unchanged thresholds (a single scheduler stall failed one WebKit run; `attempts` is reported). A run with an explicit `--browser` writes git-ignored `<report>-<browser>.*` and never overwrites the committed reports.

## Open owner decisions
1. **Package name** (`@incodes/gift-player` is a placeholder; the README says so).
2. **License** (`UNLICENSED` now; libpag, loaded at runtime, is Apache-2.0).
3. **GitHub repo** (none yet: CI has never run, and Firefox only runs there).
4. **Real iPhone testing** (Safari is covered only through Playwright's WebKit on macOS).
