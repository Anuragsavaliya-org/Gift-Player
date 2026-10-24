# Gift Player web demo

A small Vite + React + TypeScript app that uses [`@incodes/gift-player`](../../README.md) **from the npm registry** (exact version `0.1.0` in `package.json`, no workspace link, no path into `src/`), the way an outside developer would. It uses the package's `/react` entry: `<GiftPlayerView>` and `useGiftQueue`.

What is on the page: a stage with a fake animated "live video" (so you can see gifts drawn with transparency over it), a tile per gift (**Play** shows it once on the stage, **Send** queues it), a live-stream panel (priority, **Burst ×20**, **Combo ×10**, a coalesce switch that shows "×10", live queue stats), an info panel for the gift on the stage (format, size, frames, duration, editable keys, load time), controls (loops, content mode, replay / stop, pause queue, cache size and **Clear cache**), and error toasts (one gift is deliberately broken).

## Run it

```sh
cd examples/web-demo
npm install
npm run gifts:copy   # copies a selection of gifts into public/gifts/ and writes manifest.json
npm run dev          # http://localhost:5300
```

`npm run build` type-checks and builds a production bundle.

## The gift files are not in git

No `.svga` or `.webp` file is ever committed to this repository, so `public/gifts/` is git-ignored. `npm run gifts:copy` fills it from the repository's own git-ignored `samples/` and `samples/corpus/` folders (it skips, with a warning, anything that is missing) and makes one deliberately broken file (the first 40 % of a real SVGA).

To use **your own gifts**: drop `.svga`, `.gif`, `.webp` or `.pag` files into `public/gifts/` and list them in `public/gifts/manifest.json` (`[{ "name": "My gift", "file": "my-gift.svga", "format": "svga" }]`), or edit the `GIFTS` list in `scripts/copy-gifts.mjs` and run `npm run gifts:copy` again.

## Notes

- **PAG:** the PAG gift ("Like") needs the libpag engine (about 1.8 MB), which the package downloads from jsDelivr the first time a PAG file is opened (visible as a slower first load), and never for other formats. Self-hosting and the CSP lines are in the package README.
- **Where to read the code:** `src/App.tsx` is the minimal integration (`<GiftPlayerView src=… onEnd onError />`); `src/components/QueueDemo.tsx` is the `useGiftQueue` part.
- **Checking it automatically:** `node scripts/verify-demo.mjs` drives the running dev server in Chromium (every gift plays, the broken one shows its error, Burst ×20 drains, Combo ×10 is merged) and saves screenshots to `screenshots/` (git-ignored). It needs `playwright`, which it finds in the repository root's `node_modules`.
