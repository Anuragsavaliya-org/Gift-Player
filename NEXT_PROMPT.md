# NEXT PROMPT — Phase 7: Hardening, packaging, React wrapper, CI

Phase 6 is approved (8e8ef5b). The queue, cache and leak results are strong. Your decisions 1, 2, 3 and 5 are accepted. Decision 4 needs a fix (Part A). **Do not publish anything to npm, and do not change `license` or the package name.** The owner decides both.

## Part A — Gift must disappear after it ends

Gifts are overlays on top of a live video. A finished gift whose last frame stays frozen on screen is a visible bug.

- Add the option `clearOnEnd` (default `true`). After `end`, the canvas is cleared to transparent. `clearOnEnd: false` keeps the last frame.
- Queue: when the next item is not ready yet, the canvas must be **blank**, not the previous gift's last frame. When it is ready, keep the current fast hand-over.
- Your decision 4 (keep the old gift on screen while a new one downloads) still applies to a manual `load()` called **during playback** only. Document that precisely.
- Tests in both browsers:
  - after `end` with an empty queue, the canvas is fully transparent;
  - with `clearOnEnd: false`, the last frame stays;
  - a queue with a slow (delayed) next item shows a blank canvas in between.

## Part B — Trim the public API (semver contract)

Every root export becomes a promise we must keep. Keep these at the root:

`GiftPlayer`, `GiftQueue`, `AssetCache`, `GiftPlayerError`, `registerResolver`, `registerFont`, `detectFormat`, `setPagFallbackFonts`, `releasePagEngineContext`, `getDefaultCache`, `DEFAULT_CACHE_BYTES`, `VERSION`, and the public types.

Move everything low-level (`parseSvga`, `decodeSvgaImages`, `releaseSvgaImages`, `PagRenderer`, `loadPagEngine`, `readSource`, `detectSource`, the PAG URL constants, the SVGA model types) to a subpath export, `<pkg>/advanced`. Mark it in TSDoc as unstable and not covered by semver.

Update the SSR test so it covers both entry points. If something must stay at the root, flag it and give the reason.

## Part C — Bundle cap

The caps were raised to 190 KB / 120 KB. That is too loose, and loose caps are how bloat creeps in. Set `check:bundle` to the **measured size + 10%** for each entry point (root, `/advanced`, `/react`), and still fail if libpag is included anywhere.

## Part D — React wrapper (`<pkg>/react`)

svgagifts.com is Next.js, and most adopting developers use React.

- Add a `<GiftPlayerView src replacements loops contentMode onLoad onEnd onError className style />` component, plus a `useGiftQueue(options)` hook that returns `{ queue, containerRef, stats }`.
- Put `'use client'` at the top. React ≥ 18 is a **peerDependency**. React must never end up in the root bundle.
- Lifecycle:
  - unmount destroys the player;
  - changing `src` reloads, with the abort race handled;
  - **React StrictMode double mount/unmount must not leak** or double-play;
  - changing `replacements` updates without a reload.
- Tests: Vitest + jsdom for the lifecycle logic, using a mocked player, plus one real browser test that mounts in StrictMode and checks the Phase 6 counters return to 0.

## Part E — README and docs

Discuss nothing here with the owner; just write it, concise and accurate. Cover:
- install;
- a 10-line quick start for vanilla, for the queue, and for React/Next.js (both client component and server-component import);
- supported formats and the browser support table;
- PAG setup (CDN default, self-hosting the WASM, CSP lines);
- replacements and `getEditableKeys`;
- the cache and preload;
- error codes;
- **known limitations**, stated honestly: PAG complex-script text; Firefox verified in CI only; iOS real devices not yet tested; `<img>` sources not usable in Workers.

Also generate an API reference from TSDoc (`npm run docs`, typedoc). Do not commit the generated output.

## Part F — CI (GitHub Actions)

Add `.github/workflows/ci.yml`, running on `ubuntu-latest` with Node LTS:
- `npm ci`, typecheck, unit tests, build, `check:bundle`, the SSR test;
- every Playwright verify suite in **chromium, firefox and webkit**, using repo samples and synthetic files only. The corpus is private and git-ignored, so CI must skip it cleanly.

Make every verify script accept `--browser`.

There is no git remote yet. Run all CI steps locally for chromium and webkit to prove the workflow is correct, and state that Firefox results will come from the first CI run.

## Part G — Packaging and the real-world install test

- `package.json`:
  - an `exports` map covering root, `/advanced` and `/react` (each with import, require and types);
  - `sideEffects: false`, unless a file really has side effects; if so, list it;
  - a `files` whitelist;
  - `engines`;
  - `peerDependencies` plus `peerDependenciesMeta` (React optional).
- `npm pack --dry-run`: list the tarball contents and size. No tests, samples, reports or playground may be in it.
- **Fresh-project test**, the real developer experience. Install the packed tarball into:
  1. a new Vite vanilla app, which plays an SVGA in ≤ 10 lines;
  2. a new **Next.js (App Router)** app, where a server component imports a type or constant, a client component renders `<GiftPlayerView>`, and `next build` succeeds.

  Run both in Chromium. Report the exact lines of code each needed, and any friction you hit (this goes into the README).

## End of task

The usual: all checks pass; commit; update PROGRESS.md; overwrite REVIEW.md. Include:
- the final export lists per entry point;
- the bundle sizes and caps;
- the tarball contents;
- the fresh-project results (Vite and Next.js);
- the CI steps run locally;
- the `clearOnEnd` test results.

List the open owner decisions: package name, license, GitHub repo, and real-iPhone testing. Then stop.
