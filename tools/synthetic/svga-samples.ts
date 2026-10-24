/**
 * Synthetic SVGA files that stand in for real gift files in tests and CI (the real ones belong to other people and are not in the
 * repository). They use the same names and cover the same features as the originals the tests were first written against:
 * SVGA 1.x (zip + JSON) and 2.x (protobuf), bitmap and vector sprites, bitmap and vector mattes, dangling matte keys, audio in the
 * images map, many sprites. Everything is drawn by code, so the files are ours (MIT).
 *
 * Pictures are encoded by the browser (`png`), everything else is plain bytes. Deterministic: a seeded random generator, no clocks.
 */
import { strToU8, zipSync, zlibSync } from 'fflate';
import * as pb from './pb';

export type Draw = (g: CanvasRenderingContext2D, w: number, h: number) => void;
export type Png = (w: number, h: number, draw: Draw) => Promise<Uint8Array>;

/** Seeded generator (mulberry32): the same files every run. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- pictures
const orb = (inner: string, outer: string): Draw => (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, inner);
  gr.addColorStop(1, outer);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(w / 2, h / 2, w / 2 - 1, 0, Math.PI * 2);
  g.fill();
};
const heart = (color: string): Draw => (g, w, h) => {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(w / 2, h * 0.9);
  g.bezierCurveTo(-w * 0.2, h * 0.45, w * 0.2, -h * 0.1, w / 2, h * 0.3);
  g.bezierCurveTo(w * 0.8, -h * 0.1, w * 1.2, h * 0.45, w / 2, h * 0.9);
  g.fill();
};
const star = (color: string): Draw => (g, w, h) => {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? w * 0.2 : w * 0.48;
    const a = (i * Math.PI) / 5 - Math.PI / 2;
    g.lineTo(w / 2 + r * Math.cos(a), h / 2 + r * Math.sin(a));
  }
  g.closePath();
  g.fill();
};
const roundRect = (fill: string, stroke: string): Draw => (g, w, h) => {
  g.fillStyle = fill;
  g.strokeStyle = stroke;
  g.lineWidth = 4;
  g.beginPath();
  g.roundRect(3, 3, w - 6, h - 6, h / 4);
  g.fill();
  g.stroke();
};
/** Busy texture: blobs from a seeded generator (compresses poorly, like photographic art). */
const texture = (seed: number): Draw => (g, w, h) => {
  const r = rng(seed);
  g.fillStyle = `hsl(${Math.floor(r() * 360)} 60% 40%)`;
  g.fillRect(0, 0, w, h);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `hsla(${Math.floor(r() * 360)} 70% ${30 + r() * 50}% / ${0.3 + r() * 0.7})`;
    g.fillRect(r() * w, r() * h, 2 + r() * 12, 2 + r() * 12);
  }
};

// ---------------------------------------------------------------- geometry
/** Matrix that draws a w x h bitmap centred on (cx, cy), scaled and rotated about its centre. */
function place(cx: number, cy: number, w: number, h: number, sx = 1, sy = sx, rot = 0): Uint8Array | number[] {
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
  return pb.transform(a, b, cc, d, cx - (a * w) / 2 - (cc * h) / 2, cy - (b * w) / 2 - (d * h) / 2);
}

interface Pose {
  cx: number;
  cy: number;
  sx?: number;
  sy?: number;
  rot?: number;
  alpha?: number;
}
/** A bitmap sprite whose pose is a function of the frame index. */
function bitmapSprite(key: string, w: number, h: number, frames: number, pose: (i: number) => Pose, matteKey = ''): pb.Bytes {
  return pb.sprite(
    key,
    Array.from({ length: frames }, (_, i) => {
      const p = pose(i);
      return pb.frame({ alpha: p.alpha ?? 1, layout: pb.layout(0, 0, w, h), transform: [...place(p.cx, p.cy, w, h, p.sx ?? 1, p.sy ?? p.sx ?? 1, p.rot ?? 0)] });
    }),
    matteKey,
  );
}

/** A vector sprite: shapes are drawn in canvas coordinates; `shapes(i)` returns the shapes of frame i. */
function vectorSprite(key: string, frames: number, shapes: (i: number) => pb.Bytes[], matteKey = ''): pb.Bytes {
  return pb.sprite(
    key,
    Array.from({ length: frames }, (_, i) => pb.frame({ alpha: 1, layout: pb.layout(0, 0, 0, 0), transform: pb.transform(1, 0, 0, 1, 0, 0), shapes: shapes(i) })),
    matteKey,
  );
}

const white = pb.rgba(1, 1, 1, 1);
const MP3 = [0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 0, 0xff, 0xfb, 0x90, 0x00, ...Array.from({ length: 200 }, (_, i) => (i * 37) & 255)];

interface Built {
  w: number;
  h: number;
  fps: number;
  frames: number;
  images: [string, Uint8Array | number[]][];
  sprites: pb.Bytes[];
  audios?: pb.Bytes[];
}
const svga2 = (b: Built): Uint8Array =>
  zlibSync(pb.movie({ params: pb.params(b.w, b.h, b.fps, b.frames), images: b.images.map(([k, v]) => pb.imageEntry(k, v)), sprites: b.sprites, audios: b.audios }));

// ---------------------------------------------------------------- the samples
export async function buildSvgaSamples(png: Png): Promise<Record<string, Uint8Array>> {
  const out: Record<string, Uint8Array> = {};
  const rnd = rng(20260101);

  // ---- matteRect.svga: a vector matte (no bitmaps) sliding over a masked vector bar
  out['matteRect.svga'] = svga2({
    w: 200, h: 200, fps: 20, frames: 40, images: [],
    sprites: [
      vectorSprite('bar.matte', 40, (i) => [pb.styled(pb.rectShape(-60 + i * 7, 0, 70, 200), { fill: white })]),
      vectorSprite('stripe.vector', 40, () => [pb.styled(pb.rectShape(0, 60, 200, 80), { fill: pb.rgba(1, 0.55, 0.1, 1) })], 'bar.matte'),
    ],
  });

  // ---- matteBitmap.svga: a bitmap matte (soft disc) over three vector layers
  {
    const disc = await png(120, 120, (g, w, h) => {
      const gr = g.createRadialGradient(w / 2, h / 2, 5, w / 2, h / 2, w / 2);
      gr.addColorStop(0, 'rgba(0,0,0,1)');
      gr.addColorStop(0.7, 'rgba(0,0,0,1)');
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    const colors = [pb.rgba(0.95, 0.2, 0.25, 1), pb.rgba(0.2, 0.8, 0.35, 1), pb.rgba(0.25, 0.4, 0.95, 1)];
    out['matteBitmap.svga'] = svga2({
      w: 300, h: 300, fps: 20, frames: 40, images: [['dengziqi', disc]],
      sprites: [
        bitmapSprite('dengziqi.matte', 120, 120, 40, (i) => ({ cx: 80 + i * 3.5, cy: 150, sx: 1.2 })),
        ...colors.map((c, k) => vectorSprite(`形状图层${k + 1}.vector`, 40, () => [pb.styled(pb.rectShape(20, 40 + k * 70, 260, 55), { fill: c })], 'dengziqi.matte')),
      ],
    });
  }

  // ---- kingset.svga: avatar + name banner (visible from frame 0, replaceable), a crown and sparks
  {
    const imgs: [string, Uint8Array][] = [
      ['avatar', await png(120, 120, orb('#ffd9b0', '#d46a3a'))],
      ['banner', await png(360, 64, roundRect('#6a3b12', '#f0a830'))],
      ['crown', await png(100, 80, star('#ffd34d'))],
      ...(await Promise.all(Array.from({ length: 6 }, async (_, k): Promise<[string, Uint8Array]> => [`spark${k}`, await png(32, 32, star(`hsl(${40 + k * 8} 95% 60%)`))]))),
    ];
    out['kingset.svga'] = svga2({
      w: 400, h: 400, fps: 20, frames: 60, images: imgs,
      sprites: [
        bitmapSprite('avatar', 120, 120, 60, () => ({ cx: 200, cy: 150 })),
        bitmapSprite('banner', 360, 64, 60, () => ({ cx: 200, cy: 300 })),
        bitmapSprite('crown', 100, 80, 60, (i) => ({ cx: 200, cy: 70 + Math.sin(i / 6) * 8, rot: Math.sin(i / 10) * 0.15, sx: 1 + Math.sin(i / 8) * 0.1 })),
        ...Array.from({ length: 6 }, (_, k) => bitmapSprite(`spark${k}`, 32, 32, 60, (i) => ({ cx: 90 + k * 44, cy: 360 - ((i * 4 + k * 20) % 140), rot: i / 5, alpha: 0.4 + 0.6 * Math.abs(Math.sin((i + k * 7) / 9)) }))),
      ],
    });
  }

  // ---- angel.svga: ten big textured bitmaps (inflates to far more than 100 KB), floating around
  {
    const imgs = await Promise.all(Array.from({ length: 10 }, async (_, k): Promise<[string, Uint8Array]> => [`wing${k}`, await png(180, 180, texture(100 + k))]));
    out['angel.svga'] = svga2({
      w: 480, h: 480, fps: 30, frames: 90, images: imgs,
      sprites: imgs.map(([key], k) => bitmapSprite(key, 180, 180, 90, (i) => ({ cx: 240 + Math.cos(i / 14 + k) * (60 + k * 12), cy: 240 + Math.sin(i / 11 + k * 1.3) * (50 + k * 10), rot: i / 20 + k, sx: 0.55 + 0.1 * Math.sin(i / 9 + k), alpha: 0.55 + 0.45 * Math.abs(Math.sin(i / 17 + k)) }))),
    });
  }

  // ---- Fiery-Red-Dragon.svga: audio (an MP3 in the images map), vector flames and bitmaps
  {
    const imgs = await Promise.all(Array.from({ length: 8 }, async (_, k): Promise<[string, Uint8Array]> => [`ember${k}`, await png(72, 72, orb(`hsl(${10 + k * 5} 100% 70%)`, `hsl(${5 + k * 3} 90% 35%)`))]));
    out['Fiery-Red-Dragon.svga'] = svga2({
      w: 720, h: 1280, fps: 15, frames: 97, images: [...imgs, ['sfx_roar', MP3]],
      audios: [pb.audioEntity('sfx_roar', 0, 60)],
      sprites: [
        vectorSprite('flame.vector', 97, (i) => [pb.styled(pb.ellipseShape(360, 900 - i * 3, 160 + 20 * Math.sin(i / 5), 240), { fill: pb.rgba(0.95, 0.25, 0.05, 0.9) }), pb.styled(pb.rectShape(160, 1000, 400, 60, 20), { fill: pb.rgba(0.4, 0.05, 0.02, 1), stroke: pb.rgba(1, 0.7, 0.1, 1), strokeWidth: 6 })]),
        ...Array.from({ length: 40 }, (_, s) => {
          const k = s % 8, x0 = 60 + rnd() * 600, speed = 4 + rnd() * 9, ph = Math.floor(rnd() * 40);
          return bitmapSprite(`ember${k}`, 72, 72, 97, (i) => ({ cx: x0 + Math.sin((i + s) / 6) * 30, cy: 1200 - ((i + ph) * speed) % 1100, sx: 0.6 + 0.4 * Math.abs(Math.sin((i + s) / 8)), alpha: i < ph / 2 ? 0 : 0.8 }));
        }),
      ],
    });
  }

  // ---- Glossy-Pink-Lips.svga
  {
    const imgs = await Promise.all(Array.from({ length: 7 }, async (_, k): Promise<[string, Uint8Array]> => [`gloss${k}`, await png(96, 96, k % 2 ? heart(`hsl(${330 + k * 4} 85% ${60 - k * 3}%)`) : orb('#ffe0f0', `hsl(${320 + k * 5} 80% 55%)`))]));
    out['Glossy-Pink-Lips.svga'] = svga2({
      w: 750, h: 1334, fps: 20, frames: 66, images: imgs,
      sprites: [
        vectorSprite('lips.vector', 66, (i) => [pb.styled(pb.ellipseShape(375, 667, 230 + 12 * Math.sin(i / 4), 95 + 8 * Math.sin(i / 4)), { fill: pb.rgba(0.92, 0.2, 0.5, 1), stroke: pb.rgba(1, 0.8, 0.9, 1), strokeWidth: 8 })]),
        ...Array.from({ length: 33 }, (_, s) => {
          const k = s % 7, a = (s / 33) * Math.PI * 2;
          return bitmapSprite(`gloss${k}`, 96, 96, 66, (i) => ({ cx: 375 + Math.cos(a + i / 12) * (260 + 40 * Math.sin(i / 7)), cy: 667 + Math.sin(a + i / 12) * (330 + 30 * Math.cos(i / 9)), rot: a + i / 15, sx: 0.5 + 0.3 * Math.abs(Math.sin(i / 10 + s)), alpha: 0.9 }));
        }),
      ],
    });
  }

  // ---- Pink-Heart-Rocket.svga: 170 sprites over 30 bitmaps, 240 frames (the heavy one used for performance)
  {
    const imgs = await Promise.all(Array.from({ length: 30 }, async (_, k): Promise<[string, Uint8Array]> => [`item${k}`, await png(64 + (k % 5) * 8, 64 + (k % 5) * 8, k % 3 === 0 ? heart(`hsl(${320 + (k % 6) * 6} 90% ${55 + (k % 4) * 5}%)`) : k % 3 === 1 ? star(`hsl(${300 + k * 3} 80% 70%)`) : orb('#fff0f8', `hsl(${330 + k} 85% 60%)`))]));
    out['Pink-Heart-Rocket.svga'] = svga2({
      w: 750, h: 1334, fps: 30, frames: 240, images: imgs,
      sprites: Array.from({ length: 170 }, (_, s) => {
        const k = s % 30, size = 64 + (k % 5) * 8;
        const x0 = 40 + rnd() * 670, v = 2 + rnd() * 6, start = Math.floor(rnd() * 120), sway = 10 + rnd() * 40, ph = rnd() * 6;
        return bitmapSprite(`item${k}`, size, size, 240, (i) => {
          const t = i - start;
          return { cx: x0 + Math.sin(t / 15 + ph) * sway, cy: 1334 - Math.max(t, 0) * v, rot: t / 25, sx: 0.5 + 0.4 * Math.abs(Math.sin(t / 20 + ph)), alpha: t < 0 || 1334 - t * v < -80 ? 0 : 0.85 };
        });
      }),
    });
  }

  // ---- Rocket.svga: SVGA 1.x (zip + JSON). movie.spec is the LAST zip entry; four bitmap mattes; three matteKeys that point at no sprite
  {
    const W = 540, H = 960, N = 200;
    const names = ['body', 'flame', 'window', ...Array.from({ length: 8 }, (_, k) => `smoke${k}`), ...Array.from({ length: 10 }, (_, k) => `star${k}`)];
    const draw: Record<string, Draw> = { body: roundRect('#d8dde6', '#566'), flame: orb('#fff2a0', '#ff5a1a'), window: orb('#bfe8ff', '#3a78c9') };
    const pics = new Map<string, Uint8Array>();
    const size = new Map<string, [number, number]>();
    for (const n of names) {
      const [w, h] = n === 'body' ? [120, 280] : n === 'flame' ? [70, 120] : n === 'window' ? [56, 56] : n.startsWith('smoke') ? [90, 90] : [36, 36];
      size.set(n, [w, h]);
      pics.set(n, await png(w, h, draw[n] ?? (n.startsWith('smoke') ? orb('rgba(255,255,255,0.9)', 'rgba(200,200,210,0)') : star('#ffe066'))));
    }
    const mattes = ['matte_A1b2C3d4.matte', 'matte_E5f6G7h8.matte', 'matte_I9j0K1l2.matte', 'matte_M3n4O5p6.matte'];
    for (const m of mattes) { pics.set(m.replace('.matte', ''), await png(160, 160, orb('rgba(0,0,0,1)', 'rgba(0,0,0,0)'))); size.set(m.replace('.matte', ''), [160, 160]); }
    const dangling = ['matte_bTTCW1wT.matte', 'matte_pUPP05aB.matte', 'matte_3UJxqavb.matte'];
    const frames = (w: number, h: number, pose: (i: number) => Pose) =>
      Array.from({ length: N }, (_, i) => {
        const p = pose(i);
        const c = Math.cos(p.rot ?? 0), s = Math.sin(p.rot ?? 0), sx = p.sx ?? 1, sy = p.sy ?? sx;
        const a = c * sx, b = s * sx, cc = -s * sy, d = c * sy;
        return { alpha: p.alpha ?? 1, layout: { x: 0, y: 0, width: w, height: h }, transform: { a, b, c: cc, d, tx: p.cx - (a * w) / 2 - (cc * h) / 2, ty: p.cy - (b * w) / 2 - (d * h) / 2 } };
      });
    const sprite = (key: string, pose: (i: number) => Pose, matteKey?: string) => {
      const [w, h] = size.get(key.replace('.matte', ''))!;
      return { imageKey: key, ...(matteKey ? { matteKey } : {}), frames: frames(w, h, pose) };
    };
    const rise = (i: number) => H - 140 - Math.min(i, 150) * 4.2;
    const sprites = [
      ...mattes.map((m, k) => sprite(m, (i) => ({ cx: 120 + k * 100, cy: rise(i) + 40, sx: 1 + 0.2 * Math.sin(i / 12 + k) }))),
      sprite('body', (i) => ({ cx: W / 2, cy: rise(i) })),
      sprite('window', (i) => ({ cx: W / 2, cy: rise(i) - 40 })),
      sprite('flame', (i) => ({ cx: W / 2, cy: rise(i) + 190, sy: 0.9 + 0.2 * Math.sin(i / 2) })),
      ...Array.from({ length: 10 }, (_, k) => sprite(`star${k}`, (i) => ({ cx: 40 + ((k * 53) % 460), cy: (i * (2 + (k % 4)) + k * 90) % H, rot: i / 15, alpha: 0.4 + 0.5 * Math.abs(Math.sin(i / 9 + k)) }))),
      // masked sprites last, so the reference player (which breaks on an unmasked sprite after a masked run) can draw the file
      ...Array.from({ length: 8 }, (_, k) => sprite(`smoke${k}`, (i) => ({ cx: W / 2 + Math.sin(i / 8 + k) * 40, cy: rise(i) + 230 + k * 24 + (i % 40), sx: 0.6 + k * 0.08, alpha: 0.5 }), k < 4 ? mattes[k] : dangling[k - 4] ?? dangling[0])),
    ];
    const spec = {
      ver: '1.1.0',
      movie: { viewBox: { width: W, height: H }, fps: 25, frames: N },
      images: Object.fromEntries([...pics.keys()].map((k, n) => [k, `img_${n}`])),
      sprites,
    };
    const entries: Record<string, Uint8Array> = {};
    [...pics.values()].forEach((bytes, n) => (entries[`img_${n}.png`] = bytes));
    entries['movie.spec'] = strToU8(JSON.stringify(spec)); // last on purpose
    out['Rocket.svga'] = zipSync(entries);
  }

  return out;
}
