/**
 * Reference rendering with svgaplayerweb (devDependency, playground only). It renders into its own
 * canvas inside a container of the given size, so at container >= viewBox it draws at 1:1 DPR.
 */
import JSZip from 'jszip';
import SVGA from 'svgaplayerweb';

// svgaplayerweb reads SVGA 1.x (zip) through these two globals.
Object.assign(window, {
  JSZip,
  JSZipUtils: {
    getBinaryContent(url: string, cb: (err: unknown, data?: ArrayBuffer) => void) {
      fetch(url).then((r) => r.arrayBuffer()).then((b) => cb(null, b), (e) => cb(e));
    },
  },
});

export type OracleMode = 'Fill' | 'AspectFit' | 'AspectFill';

export interface Oracle {
  canvas: HTMLCanvasElement;
  /** Renders frame `i` synchronously and returns the oracle's canvas. */
  draw(i: number): HTMLCanvasElement;
  destroy(): void;
}

interface OracleSprite { imageKey: string; matteKey?: string }
interface OracleRenderer {
  _prepared: boolean;
  _owner: { _drawingCanvas: HTMLCanvasElement; _videoItem: { sprites: OracleSprite[] } };
  drawSprite(sprite: OracleSprite, ctx: CanvasRenderingContext2D, frame: number): void;
  drawFrame(frame: number): void;
}

/**
 * svgaplayerweb's own `drawFrame`, with ONE fix. When a run of masked sprites ends at a sprite that
 * is not masked, the original looks the matte up with the *new* sprite's matteKey ('' -> undefined)
 * and crashes in drawSprite(undefined). The fix is `lastSprite.matteKey` (the run being closed).
 * It only works unfixed when the masked run is the last in the array (as in matteBitmap/matteRect).
 *
 * `isolateRuns` (diagnostic only) goes one step further: svgaplayerweb applies the matte with
 * `destination-in` directly on the main canvas, which also erases everything drawn BEFORE the run
 * (e.g. an unmasked background disc). With `isolateRuns` each run is drawn on its own layer first, as
 * the official Android (saveLayer) and iOS (mask layer) players do.
 */
function fixMatteGrouping(renderer: OracleRenderer, isolateRuns: boolean): void {
  renderer.drawFrame = function (this: OracleRenderer, frame: number) {
    if (!this._prepared) return;
    const canvas = this._owner._drawingCanvas;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const matteSprites = new Map<string, OracleSprite>();
    let isMatteing = false;
    let layer: HTMLCanvasElement | null = null;
    let target: CanvasRenderingContext2D = ctx;
    const beginRun = () => {
      if (!isolateRuns) {
        ctx.save();
        return;
      }
      layer = layer ?? document.createElement('canvas');
      layer.width = canvas.width; // also clears
      layer.height = canvas.height;
      target = layer.getContext('2d')!;
    };
    const closeRun = (key: string) => {
      target.globalCompositeOperation = 'destination-in';
      this.drawSprite(matteSprites.get(key)!, target, frame);
      target.globalCompositeOperation = 'source-over';
      if (isolateRuns) {
        ctx.drawImage(layer!, 0, 0);
        target = ctx;
      } else ctx.restore();
    };
    const sprites = this._owner._videoItem.sprites;
    sprites.forEach((sprite, index) => {
      if (sprites[0]!.imageKey.indexOf('.matte') === -1) {
        this.drawSprite(sprite, ctx, frame);
        return;
      }
      if (sprite.imageKey.indexOf('.matte') !== -1) {
        matteSprites.set(sprite.imageKey, sprite);
        return;
      }
      const lastSprite = sprites[index - 1]!;
      if (isMatteing && (!sprite.matteKey || sprite.matteKey !== lastSprite.matteKey)) {
        isMatteing = false;
        closeRun(lastSprite.matteKey!); // <- the fix (original: sprite.matteKey)
      }
      if (sprite.matteKey && (!lastSprite.matteKey || lastSprite.matteKey !== sprite.matteKey)) {
        isMatteing = true;
        beginRun();
      }
      this.drawSprite(sprite, target, frame);
      if (isMatteing && index === sprites.length - 1) closeRun(sprite.matteKey!);
    });
  };
}

export async function createOracle(container: HTMLDivElement, url: string, mode: OracleMode = 'AspectFit', opts: { isolateRuns?: boolean } = {}): Promise<Oracle> {
  const player = new SVGA.Player(container);
  player.setContentMode(mode);
  const item = await new Promise<InstanceType<typeof SVGA.VideoEntity>>((res, rej) => new SVGA.Parser().load(url, res, rej));
  // svgaplayerweb crashes (drawSprite(undefined)) when a matteKey matches no sprite, as in Rocket.svga.
  // For comparison only, apply the rule our renderer uses: such a matteKey is ignored.
  const sprites = (item as unknown as { sprites: { imageKey: string; matteKey?: string }[] }).sprites;
  const keys = new Set(sprites.map((s) => s.imageKey));
  for (const s of sprites) if (s.matteKey && !keys.has(s.matteKey)) s.matteKey = '';
  player.setVideoItem(item);
  // Its image <img> tags decode asynchronously; drawing before they are ready is deferred internally.
  const renderer = (player as unknown as { _renderer: OracleRenderer })._renderer;
  fixMatteGrouping(renderer, opts.isolateRuns ?? false);
  for (let i = 0; i < 400 && !renderer._prepared; i++) await new Promise((r) => setTimeout(r, 25));
  if (!renderer._prepared) throw new Error('oracle images did not finish loading');
  const canvas = (player as unknown as { _drawingCanvas: HTMLCanvasElement })._drawingCanvas;
  return {
    canvas,
    draw(i) {
      player.stepToFrame(i, false);
      return canvas;
    },
    destroy() {
      player.stopAnimation(true);
      canvas.remove();
    },
  };
}
