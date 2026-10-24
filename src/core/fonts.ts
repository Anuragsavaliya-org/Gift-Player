/**
 * Fonts for dynamic text. SVGA's `setText` draws with the canvas 2D API and PAG's text layers are rasterised through the
 * browser as well, so BOTH use ordinary browser fonts, looked up by family name: anything the page can already use works
 * (a system font, a CSS `@font-face`, or a font added with this helper). PAG needs no engine-specific registration;
 * libpag's own `PAGFont.registerFont` is a thin wrapper around the same `FontFace` API.
 */
export type FontData = ArrayBuffer | ArrayBufferView | Blob;

/**
 * Makes a font file available under `family` for `setText` (SVGA and PAG). Resolves once it is loaded and usable.
 * Returns a function that removes it again.
 */
export async function registerFont(family: string, data: FontData, descriptors?: FontFaceDescriptors): Promise<() => void> {
  if (typeof FontFace === 'undefined' || typeof document === 'undefined') throw new Error('registerFont needs a browser (FontFace API)');
  const source = data instanceof Blob ? await data.arrayBuffer() : data;
  const face = new FontFace(family, source as BufferSource, descriptors);
  await face.load();
  document.fonts.add(face);
  return () => {
    document.fonts.delete(face);
  };
}
