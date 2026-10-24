import { defineConfig, type Options } from 'tsup';

const common: Options = { format: ['esm', 'cjs'], sourcemap: true, target: 'es2022', clean: false };

export default defineConfig([
  // Root and /advanced share code through chunks. The one piece of global state (the PAG engine) lives on globalThis anyway, so even
  // duplicated copies of the package agree (see formats/pag/engine.ts).
  { ...common, entry: { index: 'src/index.ts', advanced: 'src/advanced.ts' }, dts: true, splitting: true },
  // /react must not contain a second copy of the player (one copy keeps one default cache, one resolver registry). Its imports of the
  // root entry use the tsconfig alias `@gift-player/root`, kept external here and pointed at the built root files by
  // scripts/fix-react-entry.mjs (JS and declarations).
  {
    ...common,
    entry: { react: 'src/react/index.ts' },
    dts: true,
    external: ['react', 'react/jsx-runtime', '@gift-player/root'],
    banner: { js: "'use client';" },
  },
]);
