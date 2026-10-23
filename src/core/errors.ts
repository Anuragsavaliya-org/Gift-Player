export type GiftErrorCode = 'unsupported-format' | 'invalid-input' | 'fetch-failed' | 'parse-failed';

export class GiftPlayerError extends Error {
  readonly code: GiftErrorCode;

  constructor(code: GiftErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'GiftPlayerError';
    this.code = code;
  }
}
