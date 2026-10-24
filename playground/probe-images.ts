/**
 * Measures what browsers actually do with GIF/WebP, so our rules can copy them:
 *  - per-frame display time of a native <img> (delay clamping)
 *  - how many times a native <img> plays for loop counts 0 / 1 / 3 / absent
 *  - what ImageDecoder reports (frameCount, repetitionCount, durations)
 */
const q = new URLSearchParams(location.search);
const observeMs = Number(q.get('ms') ?? 6000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REF: Record<string, [number, number, number][]> = {
  gif: [[230, 30, 30], [30, 200, 60], [40, 80, 240], [240, 220, 30], [220, 40, 200], [30, 210, 220], [255, 255, 255]],
  webp: [[238, 34, 34], [34, 238, 34], [34, 34, 238], [238, 238, 34], [238, 34, 238], [34, 238, 238]],
};
const nearest = (rgb: number[], refs: [number, number, number][]) => {
  let best = 0, bd = Infinity;
  refs.forEach((r, i) => { const d = (r[0] - rgb[0]!) ** 2 + (r[1] - rgb[1]!) ** 2 + (r[2] - rgb[2]!) ** 2; if (d < bd) { bd = d; best = i; } });
  return bd < 60 * 60 * 3 ? best : -1;
};
const BASE = '/samples/synthetic/';

interface Obs { img: HTMLImageElement; canvas: HTMLCanvasElement; kind: 'gif' | 'webp'; seq: { t: number; f: number }[] }

async function native(files: string[]): Promise<Record<string, { t: number; f: number }[]>> {
  const host = document.getElementById('host')!;
  const obs: Record<string, Obs> = {};
  for (const name of files) {
    const img = new Image();
    img.src = BASE + name;
    img.style.cssText = 'width:40px;height:30px';
    host.append(img);
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
    obs[name] = { img, canvas, kind: name.endsWith('.gif') ? 'gif' : 'webp', seq: [] };
  }
  const t0 = performance.now();
  await new Promise<void>((resolve) => {
    const tick = (ts: number) => {
      for (const o of Object.values(obs)) {
        const g = o.canvas.getContext('2d', { willReadFrequently: true })!;
        g.clearRect(0, 0, o.canvas.width, o.canvas.height);
        g.drawImage(o.img, 0, 0);
        const p = g.getImageData(o.canvas.width >> 1, o.canvas.height >> 1, 1, 1).data;
        const f = p[3]! < 128 ? -2 : nearest([p[0]!, p[1]!, p[2]!], REF[o.kind]!);
        const last = o.seq[o.seq.length - 1];
        if (!last || last.f !== f) o.seq.push({ t: ts - t0, f });
      }
      if (ts - t0 < observeMs) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  for (const o of Object.values(obs)) o.img.remove();
  return Object.fromEntries(Object.entries(obs).map(([k, o]) => [k, o.seq]));
}

/** Mean on-screen duration per frame index over complete plays (skips the first partial frame). */
function perFrameMs(seq: { t: number; f: number }[], frames: number) {
  const sums = new Array(frames).fill(0), counts = new Array(frames).fill(0);
  for (let i = 1; i < seq.length - 1; i++) {
    const f = seq[i]!.f;
    if (f < 0 || f >= frames) continue;
    sums[f] += seq[i + 1]!.t - seq[i]!.t;
    counts[f]++;
  }
  return sums.map((s, i) => (counts[i] ? Math.round(s / counts[i]) : null));
}

async function decoderInfo(file: string) {
  if (typeof ImageDecoder === 'undefined') return { supported: false };
  const type = file.endsWith('.gif') ? 'image/gif' : 'image/webp';
  const data = new Uint8Array(await (await fetch(BASE + file)).arrayBuffer());
  if (!(await ImageDecoder.isTypeSupported(type))) return { supported: false, typeUnsupported: true };
  const d = new ImageDecoder({ data, type });
  try {
    await d.tracks.ready;
    const t = d.tracks.selectedTrack!;
    const durations: (number | null)[] = [];
    for (let i = 0; i < Math.min(t.frameCount, 12); i++) {
      const { image } = await d.decode({ frameIndex: i });
      durations.push(image.duration === null ? null : Math.round(image.duration / 1000));
      image.close();
    }
    return { supported: true, frameCount: t.frameCount, animated: t.animated, repetitionCount: t.repetitionCount, durationsMs: durations };
  } finally {
    d.close();
  }
}

(async () => {
  const out: Record<string, unknown> = { ua: navigator.userAgent, imageDecoder: typeof ImageDecoder !== 'undefined' };
  const delayFiles = ['gif-delays.gif', 'webp-delays.webp'];
  const loopFiles = ['gif-loop-0.gif', 'gif-loop-1.gif', 'gif-loop-3.gif', 'gif-loop-none.gif', 'webp-loop-0.webp', 'webp-loop-1.webp', 'webp-loop-3.webp'];
  const seqs = await native([...delayFiles, ...loopFiles]);
  out.delaysMs = { 'gif-delays.gif': perFrameMs(seqs['gif-delays.gif']!, 7), 'webp-delays.webp': perFrameMs(seqs['webp-delays.webp']!, 6) };
  const loops: Record<string, unknown> = {};
  for (const f of loopFiles) {
    const s = seqs[f]!;
    // A "play" starts each time frame 0 appears. The last transition time shows when the animation stopped.
    const starts = s.filter((x, i) => x.f === 0 && (i === 0 || s[i - 1]!.f !== 0)).length;
    const last = s[s.length - 1]!;
    loops[f] = { transitions: s.length, playsStartedObserved: starts, lastFrame: last.f, lastChangeAtMs: Math.round(last.t), seq: s.slice(0, 14).map((x) => `${x.f}@${Math.round(x.t)}`).join(' ') };
  }
  out.loops = loops;
  const info: Record<string, unknown> = {};
  for (const f of [...delayFiles, ...loopFiles, 'gif-disposal-3.gif', 'webp-alpha-blend.webp', 'webp-single.webp', 'webp-static-lossy.webp']) info[f] = await decoderInfo(f).catch((e) => ({ error: String(e) }));
  out.decoder = info;
  (window as unknown as { __result: unknown }).__result = out;
})();

export {};
