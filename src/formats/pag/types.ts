/**
 * The small part of libpag's API we use, described structurally so that neither these types nor any libpag code
 * is part of the core bundle (libpag is loaded at runtime, see engine.ts).
 */
export interface PagVec<T = PagLayerLike> {
  size(): number;
  get(i: number): T;
  delete?(): void;
}

export interface PagLayerLike {
  layerName(): string;
  layerType(): number; // 3 = text, 5 = image
  setVisible(visible: boolean): void;
  visible(): boolean;
  editableIndex(): number;
  asTypeLayer?(): PagLayerLike & Partial<PagTextLayerLike>;
}

export interface PagTextLayerLike {
  setText(text: string): void;
  text(): string;
  setFillColor(c: { red: number; green: number; blue: number }): void;
  setFontSize(n: number): void;
  setStrokeColor?(c: { red: number; green: number; blue: number }): void;
}

export interface PagTextDocument {
  applyFill: boolean;
  applyStroke: boolean;
  fillColor: { red: number; green: number; blue: number };
  strokeColor: { red: number; green: number; blue: number };
  strokeWidth: number;
  fontFamily: string;
  fontStyle: string;
  fontSize: number;
  text: string;
  justification: number;
  fauxBold: boolean;
  direction?: number;
  delete?(): void;
}

export interface PagFileLike {
  width(): number;
  height(): number;
  /** microseconds */
  duration(): number;
  frameRate(): number;
  numTexts(): number;
  numImages(): number;
  getEditableIndices(layerType: number): number[];
  getLayersByEditableIndex(index: number, layerType: number): PagVec;
  getLayersByName(name: string): PagVec;
  getTextData(index: number): PagTextDocument;
  replaceText(index: number, doc: PagTextDocument): void;
  replaceImage(index: number, image: PagImageLike): void;
  destroy(): void;
}

export interface PagImageLike {
  setScaleMode(mode: number): void;
  destroy(): void;
}

export interface PagViewLike {
  setProgress(p: number): number;
  currentFrame(): number;
  flush(): Promise<boolean>;
  updateSize(): void;
  setScaleMode(mode: number): void;
  destroy(): void;
}

export interface PagModuleLike {
  PAGFile: { load(data: ArrayBuffer | Blob | File): Promise<PagFileLike> };
  PAGView: { init(file: PagFileLike, canvas: HTMLCanvasElement | OffscreenCanvas, options?: { useScale?: boolean; useCanvas2D?: boolean; firstFrame?: boolean }): Promise<PagViewLike | undefined> };
  PAGImage: { fromSource(source: ImageBitmap | HTMLCanvasElement | HTMLImageElement): PagImageLike };
  PAGFont: { registerFont(family: string, data: File): Promise<void>; registerFallbackFontNames(names?: string[]): void };
  /** libpag's shared WebGL canvas (reference counted); `canvas` is null while no view holds it. */
  globalCanvas: { retain(): void; release(): void; readonly canvas: HTMLCanvasElement | OffscreenCanvas | null };
}

/** What `libpag.esm.js` exports. */
export interface PagModuleExports {
  PAGInit(options?: { locateFile?: (file: string) => string }): Promise<PagModuleLike>;
}

export const LAYER_TEXT = 3;
export const LAYER_IMAGE = 5;
/** PAGScaleMode */
export const SCALE_STRETCH = 1;
export const SCALE_LETTERBOX = 2;
export const SCALE_ZOOM = 3;
