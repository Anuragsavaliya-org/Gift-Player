export const VERSION = '0.0.0';

export { detectFormat, type FormatInfo, type GiftFormat } from './core/detect';
export { detectSource } from './core/inspect';
export { readSource, type GiftSource } from './core/source';
export { GiftPlayerError, type GiftErrorCode } from './core/errors';

export { parseSvga, decodeSvgaImages, releaseSvgaImages } from './formats/svga';
export type * from './formats/svga/types';
export type { DecodedSvgaImages } from './formats/svga/decode-images';
