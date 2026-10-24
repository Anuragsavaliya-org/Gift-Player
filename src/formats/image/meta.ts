/**
 * Timing/size metadata for GIF and WebP, read from the container without decoding any pixels.
 *
 * Rules (documented in PROGRESS.md, "Phase 4 - browser behaviour"):
 *  - Delay clamping: a delay of 10 ms or less is shown as 100 ms (browsers do this because 0-delay GIFs from
 *    ad networks were meant to be "as fast as possible"). Verified in WebKit through ImageDecoder for GIF
 *    and WebP (0, 10 ms -> 100 ms; 20 ms stays 20 ms). Chromium applies it in its image layer and its
 *    ImageDecoder reports raw values, so we always apply it ourselves for every decoding path.
 *  - Loop count is normalised to the TOTAL number of plays (0 = forever):
 *      GIF  NETSCAPE loop N  -> N + 1 plays (N = 0 forever); no extension -> 1 play
 *      WebP ANIM loop N      -> N plays (N = 0 forever)
 *    (Chromium's ImageDecoder reports repeats for GIF and plays - 1 for WebP; WebKit reports plays. Same
 *    totals, different encodings; we read the file ourselves and ignore `repetitionCount`.)
 */
import { parseGif, type GifInfo } from './gif';
import { parseWebp, type WebpInfo } from './webp';

export const MIN_DELAY_MS = 10;
export const CLAMPED_DELAY_MS = 100;

/** Browser behaviour: <= 10 ms is shown as 100 ms. */
export const clampDelay = (ms: number): number => (ms <= MIN_DELAY_MS ? CLAMPED_DELAY_MS : ms);

export interface ImageMeta {
  format: 'gif' | 'webp';
  /** Intrinsic canvas size; 0 for a still WebP (the decoder reports it). */
  width: number;
  height: number;
  /** false for a still WebP. */
  animated: boolean;
  frameCount: number;
  /** Clamped durations in ms, one per frame. */
  durations: number[];
  /** Total plays from the file (0 = forever), or null for stills. */
  loopCount: number | null;
  /** Parsed containers (one of them is set) for the fallback decoders. */
  gif?: GifInfo;
  webp?: WebpInfo;
}

export function readGifMeta(bytes: Uint8Array): ImageMeta {
  const gif = parseGif(bytes);
  return {
    format: 'gif',
    width: gif.width,
    height: gif.height,
    animated: gif.frames.length > 1,
    frameCount: gif.frames.length,
    durations: gif.frames.map((f) => clampDelay(f.delayCs * 10)),
    loopCount: gif.netscapeLoops === null ? 1 : gif.netscapeLoops === 0 ? 0 : gif.netscapeLoops + 1,
    gif,
  };
}

export function readWebpMeta(bytes: Uint8Array): ImageMeta {
  const webp = parseWebp(bytes);
  if (!webp.animated) {
    return { format: 'webp', width: webp.width, height: webp.height, animated: false, frameCount: 1, durations: [CLAMPED_DELAY_MS], loopCount: null, webp };
  }
  return {
    format: 'webp',
    width: webp.width,
    height: webp.height,
    animated: true,
    frameCount: webp.frames.length,
    durations: webp.frames.map((f) => clampDelay(f.durationMs)),
    loopCount: webp.animLoops === null || webp.animLoops === 0 ? 0 : webp.animLoops,
    webp,
  };
}
