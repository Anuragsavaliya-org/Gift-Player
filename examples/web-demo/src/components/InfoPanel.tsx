import type { GiftInfo } from '@incodes/gift-player';
import type { Gift } from '../types';

/** What `load()` told us about the gift that is (or was last) on the stage. */
export function InfoPanel({ current }: { current: { gift: Gift; info: GiftInfo; loadMs: number } | null }) {
  return (
    <section>
      <h2>Current gift</h2>
      {!current ? (
        <p className="note">Play a gift from the grid to see its details.</p>
      ) : (
        <dl className="info">
          <dt>Name</dt><dd>{current.gift.name}</dd>
          <dt>Format</dt><dd>{current.info.format}</dd>
          <dt>Size</dt><dd>{current.info.width} × {current.info.height}</dd>
          <dt>Frames</dt><dd>{current.info.frameCount}</dd>
          <dt>Duration</dt><dd>{Math.round(current.info.durationMs)} ms</dd>
          <dt>Load time</dt><dd>{Math.round(current.loadMs)} ms (click to first frame)</dd>
          <dt>Editable keys</dt>
          <dd>{current.info.editableKeys.length === 0 ? 'none' : current.info.editableKeys.slice(0, 12).map((k) => `${k.key} (${k.type})`).join(', ') + (current.info.editableKeys.length > 12 ? ` … +${current.info.editableKeys.length - 12}` : '')}</dd>
        </dl>
      )}
    </section>
  );
}
