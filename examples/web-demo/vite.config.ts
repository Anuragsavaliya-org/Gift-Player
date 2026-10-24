import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Nothing special is needed for @incodes/gift-player: no aliases, no transpilePackages, no optimizeDeps entries.
export default defineConfig({ plugins: [react()], server: { port: 5300, strictPort: true } });
