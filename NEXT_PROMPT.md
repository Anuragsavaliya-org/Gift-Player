# NEXT PROMPT — Prepare release 0.1.0 (publish from CI with provenance)

Owner decisions:
- The first version is **0.1.0**, not 1.0.0, so the API can still change before 1.0.
- Publishing happens **only from GitHub Actions, with npm provenance**, never from a laptop.
- **Do not create or push a git tag in this task, and do not publish.** The owner sets up npm first, then triggers the release.

## Task 1 — Version and changelog

- Set `package.json` `version` to `0.1.0`. Make sure the exported `VERSION` constant matches. If it is generated, check it; if it is hard-coded, add a test that it equals the package.json version.
- Create `CHANGELOG.md` in Keep a Changelog style. Add a `0.1.0` entry summarising what ships:
  - supported formats;
  - `GiftPlayer`, `GiftQueue`, `AssetCache`, the resolver and the React wrapper;
  - browser support;
  - known limitations (copy them from the README).
- Make sure `CHANGELOG.md` is in the tarball.

## Task 2 — Release workflow (`.github/workflows/release.yml`)

- **Trigger:** a pushed tag matching `v*`.
- **Permissions:** `contents: write` (for the GitHub Release) and `id-token: write` (for provenance and OIDC).
- **Steps:**
  1. Run the full checks job: typecheck, tests, build, `check:bundle`, `npm pack --dry-run`. Reuse the CI workflow if that is cleanly possible.
  2. **Fail if the tag does not equal `v${package.json version}`.**
  3. Use Node LTS and make sure npm is at least the version npm's docs require for trusted publishing (OIDC). Check the current npm docs; do not guess.
  4. Run `npm publish --access public --provenance`.
  5. Create a GitHub Release for the tag, with the notes taken from the matching CHANGELOG section.
- **Authentication must support two modes:**
  - **Trusted publishing (OIDC):** preferred, with no secret needed.
  - **Fallback:** an `NPM_TOKEN` repository secret, used only if it exists. The very first publish may need it if npm only lets you configure a trusted publisher on a package that already exists. Check npm's current docs and record what you found.

  Document both modes in a short `RELEASING.md`, which is not shipped in the tarball.
- Use current major versions of the actions you need, to avoid the Node 20 deprecation warning seen in CI. Bump `ci.yml` too.

## Task 3 — Verify without publishing

- `npm publish --dry-run --access public` must succeed locally. Report the file list and size.
- Validate the workflow YAML with `actionlint` if it is available. If not, say so.
- Commit and push to `main` (normal push). CI must be green.

## End of task

Overwrite REVIEW.md with:
- the version and changelog summary;
- a release workflow summary, step by step;
- what the npm docs say about trusted publishing for a brand-new package (with the doc URL);
- the dry-run output summary;
- the commit hash;
- the CI result;
- **the exact owner steps**, in order: what to set up on npmjs.com and on GitHub, and the exact command to push the tag when ready.

Then stop.
