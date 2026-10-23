export const VERSION = '0.0.0';

export { detectFormat, type FormatInfo, type GiftFormat } from './core/detect';
export { detectSource } from './core/inspect';
export { readSource, type GiftSource } from './core/source';
export { GiftPlayerError, type GiftErrorCode } from './core/errors';
