# REVIEW — Public package contact email

## Status
Done and pushed (no force, history untouched, git user config untouched). Commit: `bb7cfcd`. **CI: green**, all four jobs (checks, chromium, firefox, webkit).

## Changed fields (`package.json`)
- `"author": "Incodes Lab <svgagifts@gmail.com>"` (new)
- `"bugs": { "url": "https://github.com/Anuragsavaliya-org/Gift-Player/issues", "email": "svgagifts@gmail.com" }` (email added)

README: no contact or support line exists, so nothing to change.

## Tarball grep (`npm pack`, extracted to a temp folder, 27 files)
- `anurag.xitijinfo@gmail.com` / `xitijinfo`: **no hits**.
- Only gmail address in the tarball: `svgagifts@gmail.com`, twice, both in `package.json` (`author`, `bugs.email`).

## Checks
Build, 273 tests and `check:bundle` pass.

## Note
The old address remains in the git commit metadata (author of every commit), as decided; it is not in the npm package.
