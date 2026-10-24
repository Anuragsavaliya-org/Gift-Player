/** One entry of public/gifts/manifest.json (written by `npm run gifts:copy`). */
export interface Gift {
  name: string;
  /** File name inside public/gifts/. */
  file: string;
  format: 'svga' | 'gif' | 'webp' | 'pag';
  /** A deliberately corrupt file, to show error handling. */
  broken?: boolean;
}

export const giftUrl = (g: Gift): string => `/gifts/${g.file}`;

export type ContentMode = 'aspectFit' | 'aspectFill' | 'fill';
