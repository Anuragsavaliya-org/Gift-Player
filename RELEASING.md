# Releasing

Releases are published **only by GitHub Actions** (`.github/workflows/release.yml`), with npm provenance, when a `v*` tag is pushed. Nobody publishes from a laptop. This file is not part of the npm package.

## What a release does

1. `verify-tag`: the tag must equal `v` + the `version` in `package.json`, and `CHANGELOG.md` must have a `## [x.y.z]` section.
2. `ci`: the whole CI workflow (typecheck, tests including the SSR test, build, `check:bundle`, `npm pack --dry-run`, and the browser suites in chromium, firefox and webkit). If anything fails, nothing is published.
3. `publish`: Node LTS, npm >= 11.5.1 (upgraded if the runner's is older), `npm ci`, build, `npm publish --access public --provenance` (a version with a hyphen, like `0.2.0-rc.1`, is published under the `next` dist-tag), then a GitHub Release whose notes are the matching CHANGELOG section (marked pre-release for hyphenated versions).

## Cutting a release

1. Update `CHANGELOG.md` (move `[Unreleased]` entries under a new `## [x.y.z]` heading and fix the compare links at the bottom).
2. Set `version` in `package.json` **and** `VERSION` in `src/index.ts` (a test fails if they differ, or if the changelog has no entry for the version).
3. Merge to `main`, wait for CI to be green.
4. `git tag vX.Y.Z && git push origin vX.Y.Z` (from the commit that is green).

## Authentication: two modes

**Mode 1, trusted publishing (OIDC), preferred.** No secret is stored. On npmjs.com, open the package > Settings > Trusted Publisher > GitHub Actions and enter: organization/user `Anuragsavaliya-org`, repository `Gift-Player`, workflow filename `release.yml` (with `.yml`, no path; case-sensitive), environment empty. npm does not check the entry when it is saved: a typo only shows at publish time. Requirements (https://docs.npmjs.com/trusted-publishers): npm CLI >= 11.5.1, Node >= 22.14.0, GitHub-hosted runners, `id-token: write` (the workflow has it), and `repository.url` in `package.json` must match the GitHub repository exactly (it does). Provenance is then automatic (public repo, public package); the workflow also passes `--provenance`, which is harmless.

**Mode 2, fallback: an `NPM_TOKEN` repository secret.** Used only if the secret exists (the workflow has two publish steps, one for each case). The first publish of a brand-new package may need it: npm's documentation describes configuring a trusted publisher on a package's settings page and does not say it can be done before the package exists; community guides report that the package must exist first. So: create a granular access token on npmjs.com (Access Tokens > Generate New Token > Granular: permission "Read and write", packages: the package or the `@incodes` scope, short expiry) and save it as the repository secret `NPM_TOKEN` (GitHub > Settings > Secrets and variables > Actions). After the first successful publish, configure the trusted publisher (Mode 1), then **delete the `NPM_TOKEN` secret and revoke the token**: from then on releases use OIDC. (A newly added trusted publisher must complete its first successful publish within 2 days or it expires.)

## One-time setup checklist

npmjs.com: an account with 2FA; the `@incodes` scope must exist as an organization or user name you control (create the organization `incodes` for free, public packages only); a granular token for the first publish (Mode 2).
GitHub: repository secret `NPM_TOKEN` (first publish only); Actions enabled (they are); optionally protect tags `v*`.

## If a release fails

The workflow stops at the first failing job; nothing is published unless the `publish` job's `npm publish` step succeeded. A failed run before that can be fixed and re-run, or the tag deleted (`git push origin :refs/tags/vX.Y.Z`) and pushed again on the fixed commit. A published version can never be re-used: bump the version.
