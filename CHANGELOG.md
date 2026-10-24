# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows [Semantic Versioning](https://semver.org/). Before 1.0.0 the API may still change between minor versions.

## [Unreleased]

## [0.1.0]

First release.

### Added

- **Formats, one API:** SVGA 1.x and 2.x, GIF, animated and static WebP, and PAG. The format is detected from the file's bytes.
- **`GiftPlayer`:** `load()` / `play()` / `pause()` / `resume()` / `stop()` / `seek()` / `clear()` / `destroy()`, events (`loaded`, `start`, `loop`, `end`, `error`, opt-in `frame`), `clearOnEnd` (a finished gift disappears), `pauseWhenHidden`, load races handled (a newer `load()`, an `AbortSignal` or `destroy()` aborts the one in flight), typed `GiftPlayerError` codes (`unsupported-format`, `invalid-input`, `network`, `parse-failed`, `decode-failed`, `engine-load-failed`, `aborted`). One canvas per player, reused for every gift.
- **Replacements:** `setText`, `setImage`, `setHidden`, `clearReplacement`, `getEditableKeys()` for SVGA and PAG; replacements passed to `load()` are applied before the first frame.
- **`GiftQueue`:** one gift at a time with priorities, `maxLength` dropping, preloading of the next gifts, optional merging of identical consecutive gifts (`count`), failed gifts skipped, blank canvas when the next gift is not ready.
- **`AssetCache` and preload:** LRU cache of loaded gifts with a budget in estimated decoded bytes (default 64 MB), reference counting (a gift in use is never evicted, two players share decoded images), `GiftPlayer.preload()`.
- **Sources:** URL, `ArrayBuffer`, `Blob`/`File`, and custom schemes through `registerResolver` (for example `gift:12345`).
- **PAG through libpag 4.5.85 (Apache-2.0)**, loaded lazily at runtime from a pinned CDN URL (or your own server) and never bundled; all PAG players share one WebGL context. CSP guidance in the README.
- **React wrapper** (`@incodes/gift-player/react`): `<GiftPlayerView>` and `useGiftQueue()`; StrictMode-safe. React 18+ is an optional peer dependency.
- **Entry points:** root (the supported API), `/react`, and `/advanced` (low-level parts; unstable, not covered by semver). ESM and CommonJS builds with type declarations; importing the package on a server (Next.js server components, route handlers) touches no browser global.
- Fonts: `registerFont()` for SVGA and PAG text.

### Browser support

- Chromium (verified with Chromium 156) and WebKit (Playwright WebKit 27.2 on macOS): verified in local runs and in CI.
- Firefox (157): verified in CI only, on Linux with software WebGL.
- Real iPhones: not yet tested.

### Known limitations

- **PAG text cannot shape complex scripts.** libpag draws text glyph by glyph: Hindi / Gujarati marks come out misplaced, Arabic is drawn as isolated letters in left-to-right order. Latin, CJK and emoji are fine. `setText` on a PAG gift logs one warning per player when the text needs shaping. SVGA renders these scripts correctly.
- **Firefox is verified in CI only.** It has not been run on a developer machine; CI runs the PAG suites in a headed Firefox with software WebGL because headless Firefox without a GPU has no WebGL.
- **iOS on real devices is not yet tested.** Safari is covered through Playwright's WebKit build on macOS.
- **SVGA images are decoded through `<img>` elements**, so SVGA playback needs a DOM: it cannot run in a Web Worker / `OffscreenCanvas`.
- A GIF or WebP that loops forever never ends: `play()` stays pending (the queue plays each gift once by default).
- A gift still playing when `load()` is called keeps playing until the new one is ready; a gift that has ended is already gone. Between two queue items the canvas is blank for about one frame while the next gift is created.

[Unreleased]: https://github.com/Anuragsavaliya-org/Gift-Player/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Anuragsavaliya-org/Gift-Player/releases/tag/v0.1.0
