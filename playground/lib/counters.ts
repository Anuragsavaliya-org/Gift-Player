/**
 * Resource counters for leak checks. Install BEFORE the SDK creates anything. Counts what the SDK can leak:
 * ImageBitmaps, `<img>` holders (an element with a non-empty src), blob URLs, WebGL contexts (alive = not lost), outstanding
 * requestAnimationFrame callbacks and live ResizeObservers.
 */
export interface Counters {
  snapshot(): Snapshot;
  /** Highest value seen for each counter since installation. */
  peak: Snapshot;
  resetPeak(): void;
  glContextsCreated(): number;
  glContextsLostEvents(): number;
  doubleCloses: { bitmaps: number; imgs: number };
}

export interface Snapshot {
  bitmaps: number;
  imgs: number;
  blobUrls: number;
  glAlive: number;
  raf: number;
  resizeObservers: number;
  jsHeapMB: number | null;
}

type Ctx = { getContext: (this: object, type: string, ...a: unknown[]) => unknown };

export function installCounters(): Counters {
  const bitmapsOpen = new Set<ImageBitmap>();
  const doubleCloses = { bitmaps: 0, imgs: 0 };
  const oCib = window.createImageBitmap.bind(window);
  window.createImageBitmap = (async (...a: Parameters<typeof createImageBitmap>) => {
    const b = await oCib(...a);
    bitmapsOpen.add(b);
    bump();
    return b;
  }) as typeof createImageBitmap;
  const oClose = ImageBitmap.prototype.close;
  ImageBitmap.prototype.close = function (this: ImageBitmap) {
    if (!bitmapsOpen.delete(this)) { if ((this as { __c?: boolean }).__c) doubleCloses.bitmaps++; }
    (this as { __c?: boolean }).__c = true;
    oClose.call(this);
  };

  // <img> holders: an element whose src was set to a non-empty value and has not been reset to '' since.
  const imgsOpen = new Set<HTMLImageElement>();
  const srcDesc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    enumerable: srcDesc.enumerable,
    get: srcDesc.get,
    set(this: HTMLImageElement, v: string) {
      if (v === '' || v == null) {
        if (!imgsOpen.delete(this) && (this as { __closed?: boolean }).__closed) doubleCloses.imgs++;
        (this as { __closed?: boolean }).__closed = true;
      } else imgsOpen.add(this);
      srcDesc.set!.call(this, v);
      bump();
    },
  });

  let blobUrls = 0;
  const oCreate = URL.createObjectURL.bind(URL), oRevoke = URL.revokeObjectURL.bind(URL);
  const urls = new Set<string>();
  URL.createObjectURL = (o: Blob | MediaSource) => { const u = oCreate(o); urls.add(u); blobUrls = urls.size; bump(); return u; };
  URL.revokeObjectURL = (u: string) => { urls.delete(u); blobUrls = urls.size; oRevoke(u); };

  const gls: WebGLRenderingContext[] = [];
  let lostEvents = 0;
  const seen = new WeakSet<object>();
  for (const proto of [HTMLCanvasElement.prototype, OffscreenCanvas.prototype] as unknown as Ctx[]) {
    const orig = proto.getContext;
    proto.getContext = function (this: object, type: string, ...a: unknown[]) {
      const ctx = orig.call(this, type, ...a);
      if (ctx && /webgl/.test(type) && !seen.has(this)) {
        seen.add(this);
        gls.push(ctx as WebGLRenderingContext);
        (this as EventTarget).addEventListener('webglcontextlost', () => lostEvents++);
        bump();
      }
      return ctx;
    };
  }

  const rafs = new Set<number>();
  const oRaf = window.requestAnimationFrame.bind(window), oCaf = window.cancelAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => { const h = oRaf((t) => { rafs.delete(h); cb(t); }); rafs.add(h); bump(); return h; };
  window.cancelAnimationFrame = (h) => { rafs.delete(h); oCaf(h); };

  let roLive = 0;
  const OrigRO = window.ResizeObserver;
  window.ResizeObserver = class extends OrigRO {
    private on = false;
    override observe(t: Element, o?: ResizeObserverOptions) { if (!this.on) { this.on = true; roLive++; bump(); } super.observe(t, o); }
    override disconnect() { if (this.on) { this.on = false; roLive--; } super.disconnect(); }
  } as typeof ResizeObserver;

  const snapshot = (): Snapshot => ({
    bitmaps: bitmapsOpen.size,
    imgs: imgsOpen.size,
    blobUrls,
    glAlive: gls.filter((g) => !g.isContextLost()).length,
    raf: rafs.size,
    resizeObservers: roLive,
    jsHeapMB: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory ? Math.round((performance as unknown as { memory: { usedJSHeapSize: number } }).memory.usedJSHeapSize / 1048576) : null,
  });
  const zero = (): Snapshot => ({ bitmaps: 0, imgs: 0, blobUrls: 0, glAlive: 0, raf: 0, resizeObservers: 0, jsHeapMB: null });
  const peak = zero();
  function bump(): void {
    const s = snapshot();
    for (const k of Object.keys(peak) as (keyof Snapshot)[]) {
      const v = s[k];
      if (v !== null && v > ((peak[k] as number | null) ?? 0)) (peak as unknown as Record<string, number>)[k] = v;
    }
  }
  return {
    snapshot,
    peak,
    resetPeak: () => Object.assign(peak, zero()),
    glContextsCreated: () => gls.length,
    glContextsLostEvents: () => lostEvents,
    doubleCloses,
  };
}
