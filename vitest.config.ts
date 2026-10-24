import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tests/**/*.test.ts'] },
  resolve: { alias: { '@gift-player/root': resolve(import.meta.dirname, 'src/index.ts') } }, // the alias src/react uses for the root entry
});
