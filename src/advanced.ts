/**
 * @packageDocumentation
 * Low-level building blocks: the SVGA parser and image decoder, the PAG renderer and engine loader, and source readers.
 *
 * **Unstable: not covered by semver.** These may change or disappear in any release. Use the root entry (`GiftPlayer`, `GiftQueue`) unless
 * you are building your own player on top of the parts.
 */
export { parseSvga, decodeSvgaImages, releaseSvgaImages } from './formats/svga';
export type * from './formats/svga/types';
export type { DecodedSvgaImages } from './formats/svga/decode-images';
export { PagRenderer, loadPagEngine, PAG_VERSION, DEFAULT_PAG_MODULE_URL, DEFAULT_PAG_WASM_URL } from './formats/pag';
export type { PagRendererOptions } from './formats/pag';
export { readSource } from './core/source';
export { detectSource } from './core/inspect';
