# PROGRESS

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
