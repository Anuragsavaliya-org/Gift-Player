/**
 * Every error the SDK throws or emits carries one of these codes.
 * - `unsupported-format`: the bytes are not SVGA / GIF / WebP / PAG, or the browser cannot run that format.
 * - `invalid-input`: the argument has the wrong type, or the canvas has no 2D context.
 * - `network`: the file could not be fetched (offline, CORS, HTTP error) or a registered resolver failed.
 * - `parse-failed`: the container is corrupt or newer than the parser supports.
 * - `decode-failed`: the file parsed but its pixels could not be decoded.
 * - `engine-load-failed`: the lazily loaded PAG engine (JS or WASM) could not be loaded or started, e.g. blocked by CSP.
 * - `aborted`: the operation was cancelled (`AbortSignal`, a newer `load()`, `stop()`, `destroy()`).
 */
export type GiftErrorCode = 'unsupported-format' | 'invalid-input' | 'network' | 'parse-failed' | 'decode-failed' | 'engine-load-failed' | 'aborted';

/** The error type of the whole SDK; `code` says what went wrong (see `GiftErrorCode`). */
export class GiftPlayerError extends Error {
  readonly code: GiftErrorCode;

  constructor(code: GiftErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GiftPlayerError';
    this.code = code;
  }
}
