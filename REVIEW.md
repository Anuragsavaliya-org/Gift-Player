# REVIEW — Prepare release 0.1.0 (publish from CI with provenance)

## Status
Done and pushed (normal push). **No tag created, nothing published.** Commit: `9f5a999`. **CI: green**, all four jobs (checks, chromium, firefox, webkit), and the Node 20 deprecation warning is gone.

## Version and changelog
- `package.json` and the exported `VERSION` are `0.1.0`. `VERSION` is hard-coded, so `tests/smoke.test.ts` now fails if it differs from `package.json`, or if `CHANGELOG.md` has no `## [0.1.0]` section (274 tests pass).
- `CHANGELOG.md` (Keep a Changelog; `[Unreleased]` + `[0.1.0]`): formats (SVGA 1.x/2.x, GIF, WebP, PAG), `GiftPlayer`, replacements, `GiftQueue`, `AssetCache`/preload, resolvers, PAG via libpag 4.5.85, React wrapper, entry points, browser support (Chromium and WebKit verified; Firefox in CI only; iPhone untested), and the known limitations copied from the README. It is in the tarball (`files` lists it).

## Release workflow (`.github/workflows/release.yml`), step by step
Trigger: a pushed tag `v*`. Top-level permissions `contents: read`.
1. `verify-tag`: fails unless the tag is exactly `v` + `package.json` version, and `CHANGELOG.md` has a `## [version]` section.
2. `ci`: reuses `ci.yml` (now also `workflow_call`): typecheck, sample generation, tests incl. SSR, build, `check:bundle`, `npm pack --dry-run`, and the five browser suites in chromium, firefox and webkit. Nothing publishes unless all pass.
3. `publish` (permissions `contents: write` for the Release, `id-token: write` for provenance/OIDC): Node LTS with the npm registry; fails if Node < 22.14.0 and upgrades npm if it is < 11.5.1; `npm ci`; build; `npm pack --dry-run`; picks the dist-tag (a hyphenated version such as `0.2.0-rc.1` goes to `next` and is marked pre-release); then **one of two publish steps**, both `npm publish --access public --provenance`:
   - no `NPM_TOKEN` secret: **trusted publishing (OIDC)**, no secret;
   - `NPM_TOKEN` secret present: **token fallback** (`NODE_AUTH_TOKEN`);
4. Release notes: the matching CHANGELOG section (tested locally with the same `awk`: 33 lines for 0.1.0; fails if empty), then `gh release create <tag> --verify-tag --notes-file notes.md`.
Actions bumped to the current majors in `ci.yml` and `release.yml`: `checkout@v7`, `setup-node@v7`, `upload-artifact@v7` (I checked their latest releases; they run on Node 24). `ci.yml` push trigger limited to branches so a tag push runs only the release. `RELEASING.md` (not in the tarball) documents both modes, the release steps and failure handling.

## What npm's docs say about trusted publishing (https://docs.npmjs.com/trusted-publishers)
- Needs npm CLI ≥ 11.5.1 and Node ≥ 22.14.0; `id-token: write`; GitHub-hosted runners only; configured on the package's settings page (organization/user, repository, workflow filename with `.yml`, no path, case-sensitive; optional environment). npm does **not** validate the entry when saved: mistakes show only at publish time. `repository.url` in `package.json` must match the GitHub repository exactly (it does). Provenance is automatic for public repos and public packages. A new trusted-publisher entry must complete its first publish within 2 days or it expires.
- **Brand-new package:** the official page describes setup only via an existing package's settings and does not say it works before the first publish; community guides say the package must exist first. So I planned for the token fallback: **the first publish probably needs `NPM_TOKEN`**; afterwards switch to OIDC and delete the token. (`npm view @incodes/gift-player` currently returns 404: the name is free. Whether the `@incodes` scope exists on npm could not be checked from here.)

## Dry run (`npm publish --dry-run --access public`, local)
Succeeds: `@incodes/gift-player@0.1.0`, tag `latest`, public. **28 files, 282.6 kB packed, 1.0 MB unpacked**: `CHANGELOG.md`, `LICENSE`, `README.md`, `package.json`, and `dist/` (`index`, `advanced`, `react` as ESM + CJS + `.d.ts`/`.d.cts` + maps, two shared chunks, one shared types file). `RELEASING.md`, tests, samples, scripts and the playground are not in it. `actionlint` 1.7.12 (installed into a temp virtualenv) reports nothing on both workflows.

## Exact owner steps, in order
1. **npmjs.com:** sign in (2FA on). Make sure you control the scope `@incodes`: create a free organization named `incodes` (public packages), or confirm it exists and you can publish to it.
2. **npmjs.com, first publish only:** Access Tokens > Generate New Token > Granular: permission *Read and write*, packages/scope `@incodes`, short expiry. Copy it.
3. **GitHub** (Anuragsavaliya-org/Gift-Player) > Settings > Secrets and variables > Actions > New repository secret: name `NPM_TOKEN`, value the token.
4. Check `main` is green on the commit you want to release (it is on `9f5a999`).
5. Push the tag: `git tag v0.1.0 9f5a999 && git push origin v0.1.0` (or tag the current `main` HEAD if you add commits). Watch the **Release** run in the Actions tab; on success the package and the GitHub Release `v0.1.0` exist and the npm page shows the provenance badge.
6. **After the first publish:** on npmjs.com open the package > Settings > Trusted Publisher > GitHub Actions: organization `Anuragsavaliya-org`, repository `Gift-Player`, workflow filename `release.yml`, environment empty. Then **delete the `NPM_TOKEN` secret on GitHub and revoke the token on npm**; later releases use OIDC (the workflow picks the OIDC step automatically when no secret exists).
7. For later releases: follow "Cutting a release" in `RELEASING.md`.
