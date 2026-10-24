# NEXT PROMPT — Example app using the published package

Goal: the owner wants to **see** the SDK working the way an outside developer would use it. Build a small demo app in `examples/web-demo/` that installs **the published npm package** and plays 5–7 real gifts.

## Rules

- Install `@incodes/gift-player@0.1.0` **from the npm registry**. Do not use a workspace link, `file:` or a path import into `src/`. This test is meant to catch problems in the real published package.
- The example **code** is committed to git. The **gift files are not committed**, because the owner rule says no svga/webp in git. Add `examples/web-demo/public/gifts/` to `.gitignore`.
- The example must not affect the root package: it stays outside the `files` whitelist, outside the root build and tests, and outside CI. Check with `npm pack --dry-run` that nothing from `examples/` is in the tarball.

## Stack

Vite + React + TypeScript, using the package's `/react` entry (`GiftPlayerView`, `useGiftQueue`), because that is what most adopting developers will use. Keep it to one page and minimal dependencies. Plain CSS, no UI library.

## Gifts (5–7)

Add a script `npm run gifts:copy` (inside `examples/web-demo/`). It copies a selection into `public/gifts/` and writes `public/gifts/manifest.json` (name, file, format).

- Take files from the repo's local `samples/` and `samples/corpus/`, which are on this machine even though they are git-ignored. Pick a varied set:
  - 4–5 SVGA, including Fiery-Red-Dragon, Pink-Heart-Rocket and 2–3 of the visually best corpus files;
  - 1 GIF (`rotating-earth.gif`);
  - 1 animated WebP;
  - 1 PAG (`like.pag`).
- If a source file is missing, skip it with a warning. Never fail.
- Also add one deliberately broken file (for example a truncated copy) to demonstrate error handling. Label it as broken in the UI.

## Page layout

1. **Stage:** a large area with a dark, animated "fake live video" background (a CSS gradient or a moving pattern), so it is visible that gifts render with **transparency over video**. The gift plays on top via `GiftPlayerView` with `contentMode="aspectFit"`.
2. **Gift grid:** one tile per gift showing the name and format badge. Clicking a tile plays that gift once on the stage, and the stage clears when it ends.
3. **Queue panel (live-stream simulation), using `useGiftQueue`:**
   - a "Send" button on each tile, which adds the gift to the queue;
   - a "Burst ×20" button that sends 20 random gifts;
   - a "Combo ×10" button that sends the same gift 10 times, with a `coalesce` toggle showing "×10" when it's on;
   - a priority selector (normal or high);
   - live stats: queue length, playing, played, errors, dropped.
4. **Info panel** for the current gift: format, size, frame count, duration, `editableKeys`, and load time in ms.
5. **Controls:** play / pause / stop, loops (1, 3, infinite), content mode, and a "Clear cache" button. Show the cache usage in MB.
6. **Error display:** a small toast when a gift fails, such as the broken file. The error code comes from `GiftPlayerError`.

Keep the code clean and commented, because developers will read it as a reference. `App.tsx` should show the minimal integration clearly. Split extra UI into small components.

## README

Write `examples/web-demo/README.md` covering:
- how to run it: `npm install`, `npm run gifts:copy`, `npm run dev`;
- that gift files are not in git, and how to add your own (drop files into `public/gifts/` and re-run the manifest script);
- the PAG note (engine loads from the CDN on first PAG gift).

## Verify

- `npm run build` inside the example succeeds.
- Run it in Chromium with Playwright and check:
  - every gift in the manifest loads and plays (the broken one shows its error toast);
  - Burst ×20 drains to 0 with 0 stalls;
  - combo coalesce shows ×10.
- Save screenshots to `examples/web-demo/screenshots/` (git-ignored): the grid, a gift mid-play over the background, the queue during a burst, and the error toast.
- Report any friction in using the published package: missing exports, typing issues, awkward API, or README gaps. **This is the most valuable output.** List the problems, but do not fix the library in this task.

## End of task

Commit the example code (no gifts, no screenshots) and push normally. CI must stay green.

Overwrite REVIEW.md with:
- what was built;
- the gift list with formats;
- the verify results;
- the screenshot paths;
- the **developer-friction list**;
- the exact commands the owner runs to open the demo.

Leave the dev server **running** at the end, and print its local URL in REVIEW.md so the owner can open it directly. Then stop.
