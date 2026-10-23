import { GiftPlayerError } from '../../core/errors';

export const WIRE_VARINT = 0;
export const WIRE_FIXED64 = 1;
export const WIRE_LEN = 2;
export const WIRE_START_GROUP = 3;
export const WIRE_END_GROUP = 4;
export const WIRE_FIXED32 = 5;

const MAX_GROUP_DEPTH = 32;
const utf8 = new TextDecoder('utf-8');

export function parseFail(message: string, cause?: unknown): never {
  throw new GiftPlayerError('parse-failed', message, cause === undefined ? undefined : { cause });
}

/**
 * Bounds-checked protobuf wire reader. Every failure is a `GiftPlayerError('parse-failed')`
 * (never a RangeError from a typed array or DataView).
 */
export class WireReader {
  pos: number;
  private readonly view: DataView;

  constructor(
    readonly buf: Uint8Array,
    start = 0,
    readonly end = buf.length,
    view?: DataView,
  ) {
    this.pos = start;
    this.view = view ?? new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  get done(): boolean {
    return this.pos >= this.end;
  }

  /**
   * Reads a varint of up to 10 bytes and returns its low 32 bits as an unsigned number.
   * Negative int32 values are sign-extended to 10 bytes on the wire; callers wanting int32 use `| 0`.
   * (The schema has no 64-bit fields, so the high word is validated for length but dropped.)
   */
  varint(): number {
    let lo = 0;
    for (let i = 0; i < 10; i++) {
      if (this.pos >= this.end) parseFail(`Truncated varint at byte ${this.pos}`);
      const b = this.buf[this.pos++]!;
      if (i < 5) lo |= (b & 0x7f) << (7 * i);
      if (!(b & 0x80)) return lo >>> 0;
    }
    return parseFail(`Varint longer than 10 bytes ending at byte ${this.pos}`);
  }

  int32(): number {
    return this.varint() | 0;
  }

  /** Reads a field key; returns [fieldNumber, wireType]. */
  tag(): [number, number] {
    const at = this.pos;
    const key = this.varint();
    const field = key >>> 3;
    if (field === 0) parseFail(`Invalid field number 0 at byte ${at}`);
    return [field, key & 7];
  }

  /** fixed32 little-endian IEEE float. */
  float(): number {
    if (this.pos + 4 > this.end) parseFail(`Truncated float at byte ${this.pos}`);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  /** Length-delimited payload as a view (no copy). */
  bytes(): Uint8Array {
    const len = this.varint();
    if (len > this.end - this.pos) {
      parseFail(`Length ${len} at byte ${this.pos} runs past the end of the message (${this.end - this.pos} bytes left)`);
    }
    const out = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return out;
  }

  string(): string {
    return utf8.decode(this.bytes());
  }

  /** Reader over the next length-delimited payload, sharing the same buffer. */
  message(): WireReader {
    const len = this.varint();
    if (len > this.end - this.pos) {
      parseFail(`Length ${len} at byte ${this.pos} runs past the end of the message (${this.end - this.pos} bytes left)`);
    }
    const sub = new WireReader(this.buf, this.pos, this.pos + len, this.view);
    this.pos += len;
    return sub;
  }

  /** Skips an unknown/mismatched field with the given wire type (including legacy groups). */
  skip(wireType: number, depth = 0): void {
    switch (wireType) {
      case WIRE_VARINT:
        this.varint();
        return;
      case WIRE_FIXED64:
        this.advance(8);
        return;
      case WIRE_LEN:
        this.bytes();
        return;
      case WIRE_FIXED32:
        this.advance(4);
        return;
      case WIRE_START_GROUP: {
        if (depth >= MAX_GROUP_DEPTH) parseFail('Groups nested too deeply');
        for (;;) {
          if (this.done) parseFail('Unterminated group');
          const [, wt] = this.tag();
          if (wt === WIRE_END_GROUP) return;
          this.skip(wt, depth + 1);
        }
      }
      default:
        parseFail(`Unsupported wire type ${wireType} at byte ${this.pos}`);
    }
  }

  private advance(n: number): void {
    if (this.pos + n > this.end) parseFail(`Truncated field at byte ${this.pos}`);
    this.pos += n;
  }
}
