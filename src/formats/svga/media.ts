/** Classifies raw bytes by magic number. Audio must never reach `createImageBitmap`. */
export type MediaKind =
  | { kind: 'image'; mime: 'image/png' | 'image/jpeg' | 'image/webp' }
  | { kind: 'audio'; mime: string };

const at = (b: Uint8Array, offset: number, text: string) =>
  b.length >= offset + text.length && [...text].every((c, i) => b[offset + i] === c.charCodeAt(0));

export function classifyMedia(b: Uint8Array): MediaKind | null {
  if (b.length >= 8 && b[0] === 0x89 && at(b, 1, 'PNG\r\n')) return { kind: 'image', mime: 'image/png' };
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { kind: 'image', mime: 'image/jpeg' };
  if (at(b, 0, 'RIFF') && at(b, 8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (at(b, 0, 'RIFF') && at(b, 8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (at(b, 0, 'ID3')) return { kind: 'audio', mime: 'audio/mpeg' };
  // MPEG audio frame sync: 11 set bits.
  if (b.length >= 2 && b[0] === 0xff && (b[1]! & 0xe0) === 0xe0) return { kind: 'audio', mime: 'audio/mpeg' };
  if (at(b, 0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (at(b, 0, 'fLaC')) return { kind: 'audio', mime: 'audio/flac' };
  if (at(b, 4, 'ftyp')) return { kind: 'audio', mime: 'audio/mp4' };
  return null;
}
