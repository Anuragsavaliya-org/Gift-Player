export const VERSION = '0.0.0';

export { detectFormat, type FormatInfo, type GiftFormat } from './core/detect';
export { detectSource } from './core/inspect';
export { readSource, type GiftSource } from './core/source';
export { GiftPlayerError, type GiftErrorCode } from './core/errors';

export { parseSvga, decodeSvgaImages, releaseSvgaImages } from './formats/svga';
export type * from './formats/svga/types';
export type { DecodedSvgaImages } from './formats/svga/decode-images';

// PAG: only the thin adapter lives in this package; the engine (libpag, ~1.9 MB) is fetched lazily at runtime.
export { PagRenderer, loadPagEngine, releasePagEngineContext, setPagFallbackFonts, PAG_VERSION, DEFAULT_PAG_MODULE_URL, DEFAULT_PAG_WASM_URL } from './formats/pag';
export type { PagRendererOptions, PagEngineOptions } from './formats/pag';
export type { EditableKey } from './core/frame-source';
export { registerFont, type FontData } from './core/fonts';
