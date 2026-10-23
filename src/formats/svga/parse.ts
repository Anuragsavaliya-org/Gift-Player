import { strFromU8, unzipSync, unzlibSync } from 'fflate';
import { GiftPlayerError } from '../../core/errors';
import type { Detected } from '../../core/detect';
import { classifyMedia } from './media';
import { decodeMovieEntity, isEmptyRawFrame, type RawFrame, type RawMovie, type RawSprite } from './proto';
import { fromSpecJson } from './spec-json';
import type { SvgaFrame, SvgaMovie, SvgaShape, SvgaSprite } from './types';
import { parseFail } from './wire';

const DEFAULT_FPS = 20;
/** Sanity limits so corrupt headers cannot trigger huge allocations. */
const MAX_FRAMES = 100_000;
const MAX_FRAME_ENTRIES = 20_000_000;

const isZip = (b: Uint8Array) => b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b && b[2] === 3 && b[3] === 4;
const isReal = (s: { type: string }): s is SvgaShape => s.type !== 'keep';

/**
 * Parses an SVGA file (2.x protobuf, 1.x zip+JSON, or 1.5 zip+protobuf) into the version-independent
 * {@link SvgaMovie}. Pure and synchronous: no DOM, no `createImageBitmap`; images stay raw bytes
 * (see `decodeSvgaImages` for the browser-only step).
 *
 * @param detected Result of `detectInternal` for the same bytes; lets the parser reuse the inflated
 *   SVGA 2.x buffer instead of inflating twice.
 * @throws GiftPlayerError('parse-failed') for any corrupt or invalid input.
 */
export function parseSvga(bytes: Uint8Array, detected?: Detected): SvgaMovie {
  try {
    if (detected?.inflated) return buildFromProto(detected.inflated);
    if (isZip(bytes)) return parseZip(bytes);
    let inflated: Uint8Array;
    try {
      inflated = unzlibSync(bytes);
    } catch (cause) {
      return parseFail('Not a valid SVGA file: zlib inflate failed (file is corrupt, truncated, or not SVGA).', cause);
    }
    return buildFromProto(inflated);
  } catch (e) {
    if (e instanceof GiftPlayerError) throw e;
    // Anything else (RangeError, TypeError from malformed data, ...) is still a parse failure.
    return parseFail(`SVGA parse failed: ${e instanceof Error ? e.message : String(e)}`, e);
  }
}

function buildFromProto(inflated: Uint8Array): SvgaMovie {
  const raw = decodeMovieEntity(inflated);
  const warnings: string[] = [];
  const images: SvgaMovie['images'] = new Map();
  const audios: SvgaMovie['audios'] = new Map();
  for (const [key, data] of raw.images) {
    const media = classifyMedia(data);
    if (media?.kind === 'image') images.set(key, { data, mime: media.mime });
    else if (media?.kind === 'audio') audios.set(key, { data, mime: media.mime });
    else warnings.push(`images["${key}"]: ${data.length} bytes of unrecognised data dropped (not PNG/JPEG/WebP/audio).`);
  }
  return assemble(raw, 'protobuf', images, audios, warnings);
}

function parseZip(bytes: Uint8Array): SvgaMovie {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch (cause) {
    return parseFail('Not a valid SVGA file: could not read the zip archive.', cause);
  }
  const warnings: string[] = [];
  const binary = files['movie.binary'];
  const spec = files['movie.spec'];
  if (!binary && !spec) return parseFail('Zip archive has neither movie.binary nor movie.spec.');

  if (binary) {
    try {
      return buildFromZipProtobuf(binary, files, warnings);
    } catch (e) {
      if (!spec) throw e;
      warnings.push(`movie.binary could not be decoded (${e instanceof Error ? e.message : String(e)}); fell back to movie.spec.`);
    }
  }
  return buildFromSpec(spec!, files, warnings);
}

/** 1.5: `movie.binary` is a MovieEntity (plain, or zlib-compressed) whose `images` values are file names. */
function buildFromZipProtobuf(binary: Uint8Array, files: Record<string, Uint8Array>, warnings: string[]): SvgaMovie {
  let raw: RawMovie;
  try {
    raw = decodeMovieEntity(binary);
  } catch {
    raw = decodeMovieEntity(unzlibSync(binary));
  }
  const images: SvgaMovie['images'] = new Map();
  const audios: SvgaMovie['audios'] = new Map();
  for (const [key, value] of raw.images) {
    const media = classifyMedia(value);
    if (media?.kind === 'image') images.set(key, { data: value, mime: media.mime });
    else if (media?.kind === 'audio') audios.set(key, { data: value, mime: media.mime });
    else addFromZip(key, strFromU8(value), files, images, audios, warnings);
  }
  return assemble(raw, 'zip-protobuf', images, audios, warnings);
}

function buildFromSpec(specBytes: Uint8Array, files: Record<string, Uint8Array>, warnings: string[]): SvgaMovie {
  let json: unknown;
  try {
    json = JSON.parse(strFromU8(specBytes));
  } catch (cause) {
    return parseFail('movie.spec is not valid JSON.', cause);
  }
  const { raw, imageNames } = fromSpecJson(json);
  const images: SvgaMovie['images'] = new Map();
  const audios: SvgaMovie['audios'] = new Map();
  for (const [key, name] of imageNames) addFromZip(key, name, files, images, audios, warnings);
  for (const track of raw.audios) {
    if (audios.has(track.audioKey)) continue;
    const data = files[`${track.audioKey}.mp3`] ?? files[track.audioKey];
    const media = data && classifyMedia(data);
    if (data && media?.kind === 'audio') audios.set(track.audioKey, { data, mime: media.mime });
    else warnings.push(`audio "${track.audioKey}" referenced by the spec was not found in the archive.`);
  }
  return assemble(raw, 'zip-json', images, audios, warnings);
}

/** Looks up an image by its file-name stem inside a 1.x zip (`<name>.png`, then bare name, then key). */
function addFromZip(
  key: string,
  name: string,
  files: Record<string, Uint8Array>,
  images: SvgaMovie['images'],
  audios: SvgaMovie['audios'],
  warnings: string[],
): void {
  const data = files[`${name}.png`] ?? files[name] ?? files[`${key}.png`] ?? files[key];
  const media = data && classifyMedia(data);
  if (data && media?.kind === 'image') images.set(key, { data, mime: media.mime });
  else if (data && media?.kind === 'audio') audios.set(key, { data, mime: media.mime });
  else warnings.push(`images["${key}"]: file "${name}" not found (or not an image) in the archive.`);
}

const HIDDEN_FRAME: SvgaFrame = Object.freeze({
  alpha: 0,
  layout: Object.freeze({ x: 0, y: 0, width: 0, height: 0 }),
  transform: Object.freeze({ a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 }),
  clipPath: '',
  shapes: Object.freeze([]) as readonly SvgaShape[],
});

const isDefaultFrame = (f: RawFrame) =>
  isEmptyRawFrame(f) &&
  f.layout.x === 0 && f.layout.y === 0 && f.layout.width === 0 && f.layout.height === 0 &&
  f.transform.a === 1 && f.transform.b === 0 && f.transform.c === 0 && f.transform.d === 1 &&
  f.transform.tx === 0 && f.transform.ty === 0;

function assemble(
  raw: RawMovie,
  container: SvgaMovie['container'],
  images: SvgaMovie['images'],
  audios: SvgaMovie['audios'],
  warnings: string[],
): SvgaMovie {
  const { viewBoxWidth: width, viewBoxHeight: height } = raw;
  if (!(width > 0) || !(height > 0)) parseFail(`Invalid viewBox ${width}x${height}: missing or non-positive size.`);
  if (raw.frames <= 0) parseFail(`Movie has ${raw.frames} frames; nothing to play.`);
  if (raw.frames > MAX_FRAMES) parseFail(`Implausible frame count ${raw.frames} (limit ${MAX_FRAMES}); file is likely corrupt.`);
  if (raw.frames * raw.sprites.length > MAX_FRAME_ENTRIES) {
    parseFail(`Implausible size: ${raw.sprites.length} sprites x ${raw.frames} frames.`);
  }
  let fps = raw.fps;
  if (fps <= 0) {
    warnings.push(`fps is ${fps}; defaulting to ${DEFAULT_FPS}.`);
    fps = DEFAULT_FPS;
  }

  let padded = 0;
  let truncated = 0;
  const sprites = raw.sprites.map((s) => {
    if (s.frames.length < raw.frames) padded++;
    else if (s.frames.length > raw.frames) truncated++;
    return buildSprite(s, raw.frames);
  });
  if (padded) warnings.push(`${padded} sprite(s) had fewer than ${raw.frames} frames; padded with hidden frames.`);
  if (truncated) warnings.push(`${truncated} sprite(s) had more than ${raw.frames} frames; extra frames dropped.`);

  const missing = new Set<string>();
  for (const s of sprites) {
    if (s.imageKey && !s.isMatte && !s.imageKey.endsWith('.vector') && !images.has(s.imageKey)) missing.add(s.imageKey);
  }
  if (missing.size) warnings.push(`No image data for imageKey(s): ${[...missing].join(', ')}.`);

  // A matteKey whose mask sprite does not exist is kept as-is (renderers must ignore it); Rocket.svga has some.
  const keys = new Set(sprites.map((s) => s.imageKey));
  const dangling = [...new Set(sprites.filter((s) => s.matteKey !== null && !keys.has(s.matteKey)).map((s) => s.matteKey!))];
  if (dangling.length) warnings.push(`matteKey(s) with no matching mask sprite (ignore when rendering): ${dangling.join(', ')}.`);

  return {
    container,
    version: raw.version,
    viewBox: { width, height },
    fps,
    frames: raw.frames,
    images,
    audios,
    audioTracks: raw.audios,
    sprites,
    warnings,
  };
}

function buildSprite(s: RawSprite, frameCount: number): SvgaSprite {
  const frames: SvgaFrame[] = new Array<SvgaFrame>(frameCount);
  // KEEP = "same shapes as the previous frame" (per sprite). Resolved here; never exposed.
  let prev: readonly SvgaShape[] = [];
  for (let i = 0; i < frameCount; i++) {
    const rf = s.frames[i];
    if (!rf) {
      frames[i] = HIDDEN_FRAME;
      prev = [];
      continue;
    }
    let shapes: readonly SvgaShape[];
    if (rf.shapes[0]?.type === 'keep') shapes = prev;
    else if (rf.shapes.some((sh) => sh.type === 'keep')) shapes = rf.shapes.filter(isReal);
    else shapes = rf.shapes as SvgaShape[];
    prev = shapes;
    frames[i] = isDefaultFrame(rf)
      ? HIDDEN_FRAME
      : { alpha: rf.alpha, layout: rf.layout, transform: rf.transform, clipPath: rf.clipPath, shapes };
  }
  return {
    imageKey: s.imageKey,
    matteKey: s.matteKey || null,
    isMatte: s.imageKey.endsWith('.matte'),
    frames,
  };
}
