/**
 * Public API of the package (the semver contract). Low-level building blocks live in the `/advanced` subpath, React bindings in `/react`.
 */
export const VERSION = '0.0.0';

// Players
export { GiftPlayer, getDefaultCache } from './player';
export type { GiftInfo, GiftPlayerEvents, GiftPlayerOptions, LoadOptions, LoadedGift, PreloadOptions, PreloadResult, Replacement, ReplacementImage, Replacements, ResolvedSource, SourceResolver } from './player';
export { GiftQueue } from './queue';
export type { DropReason, GiftQueueEvents, GiftQueueOptions, QueueAddOptions, QueueHandle, QueueItemInfo, QueueItemStatus, QueueStats } from './queue';

// Cache and sources
export { AssetCache, DEFAULT_CACHE_BYTES } from './cache/asset-cache';
export type { AssetCacheOptions, CacheLoaded, CacheStats, Lease } from './cache/asset-cache';
export { registerResolver } from './player/asset';
export type { GiftSource } from './core/source';

// Errors, detection, fonts, PAG engine housekeeping
export { GiftPlayerError, type GiftErrorCode } from './core/errors';
export { detectFormat, type FormatInfo, type GiftFormat } from './core/detect';
export { registerFont, type FontData } from './core/fonts';
export { setPagFallbackFonts, releasePagEngineContext, type PagEngineOptions } from './formats/pag/engine';

// Shared types
export type { EditableKey } from './core/frame-source';
export type { TextStyle, ImageOptions } from './core/replacement';
export type { ContentMode } from './core/viewport';
