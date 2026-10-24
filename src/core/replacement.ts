/** Shared by every renderer that supports dynamic replacement (SVGA, PAG). */
export interface TextStyle {
  /** CSS font family. Default 'sans-serif'. */
  font?: string;
  /** Pixels in viewBox units. Default 14. */
  size?: number;
  /** CSS font weight, e.g. 'bold' or 700. */
  weight?: string | number;
  /** Default '#000'. */
  color?: string;
  /** Alignment inside the sprite's layout rect. Default 'center'. */
  align?: 'left' | 'center' | 'right';
  stroke?: { color: string; width: number };
}

export interface ImageOptions {
  /** How the image fills the layout rect. Default 'fill' (stretch), like the original bitmap. */
  fit?: 'fill' | 'cover' | 'contain';
}
