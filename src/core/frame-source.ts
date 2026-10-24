/**
 * What every renderer exposes to the clock (`Ticker`): a number of frames with a duration each,
 * an optional loop count from the file, and a way to put frame `i` on the canvas.
 *
 * SVGA has a fixed fps, so every frame lasts `1000 / fps`. GIF and WebP carry a delay per frame.
 */
/** A layer / sprite whose content can be replaced with `setText` / `setImage` (the same shape for every format). */
export interface EditableKey {
  /** Pass this to `setText` / `setImage` / `setHidden`. For PAG it is the layer name, or `#<index>` when the name is empty or ambiguous. */
  key: string;
  type: 'text' | 'image' | 'vector';
  /** PAG: the editable index. SVGA: undefined. */
  index?: number;
  /** PAG: the layer name (may be empty). SVGA: same as `key`. */
  name?: string;
}

export interface FrameSource {
  readonly frameCount: number;
  /** Duration of frame `i` in milliseconds (already clamped the way browsers do; always > 0). */
  frameDuration(i: number): number;
  /**
   * Loop count stored in the file, normalised to the TOTAL number of plays (0 = forever).
   * null when the format has no such field (SVGA) or the file does not specify one.
   */
  readonly loopCount: number | null;
  /**
   * Puts frame `i` on the canvas. Returns true if it is on screen now. Returns false when the frame is
   * still being decoded: it is then drawn as soon as it is ready (if it is still the wanted frame).
   */
  drawFrame(i: number): boolean;
  /** Resolves once frame `i` can be drawn synchronously. */
  ready(i: number): Promise<void>;
  destroy(): void;
  /** Replaceable layers (renderers that support dynamic replacement implement this). */
  getEditableKeys?(): EditableKey[];
}

/**
 * Loop-count precedence: an explicit player option wins; otherwise the file's own loop count;
 * otherwise play once. 0 / Infinity both mean "forever".
 */
export function resolveLoops(option: number | undefined, source: Pick<FrameSource, 'loopCount'>): number {
  const n = option ?? source.loopCount ?? 1;
  return n <= 0 || n === Infinity ? 0 : n;
}
