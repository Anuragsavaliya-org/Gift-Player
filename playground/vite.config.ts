import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const samples = resolve(__dirname, '../samples');
const TYPES: Record<string, string> = {
  '.gif': 'image/gif', '.webp': 'image/webp', '.png': 'image/png', '.json': 'application/json', '.bin': 'application/octet-stream',
};

/** Serves the repo's samples/ folder at /samples/* and lists a folder at /__list/<dir> (dev server only). */
export default defineConfig({
  plugins: [
    {
      name: 'serve-samples',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const url = decodeURIComponent((req.url ?? '').split('?')[0]!);
          const inside = (p: string) => p === samples || p.startsWith(samples + sep);
          if (url.startsWith('/samples/')) {
            const file = resolve(samples, '.' + url.slice('/samples'.length));
            if (!inside(file) || !existsSync(file) || !statSync(file).isFile()) return next();
            res.setHeader('Content-Type', TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('Cache-Control', 'no-store');
            createReadStream(file).pipe(res);
            return;
          }
          if (url.startsWith('/__list/')) {
            const dir = resolve(samples, '.' + url.slice('/__list'.length));
            const names = inside(dir) && existsSync(dir) ? readdirSync(dir).filter((f) => !f.startsWith('.') && statSync(join(dir, f)).isFile()).sort() : [];
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(names));
            return;
          }
          next();
        });
      },
    },
  ],
});
