import { giftUrl, type Gift } from '../types';

/** One tile per gift: Play shows it once on the stage (the stage clears when it ends), Send adds it to the live queue. */
export function GiftGrid({ gifts, selected, onPlay, onSend }: { gifts: Gift[]; selected: Gift | null; onPlay: (g: Gift) => void; onSend: (g: Gift) => void }) {
  return (
    <section>
      <h2>Gifts</h2>
      <div className="grid">
        {gifts.map((g) => (
          <div key={g.file} className={`tile${selected === g ? ' selected' : ''}${g.broken ? ' broken' : ''}`} title={giftUrl(g)}>
            <span className={`fmt fmt-${g.format}`}>{g.format}</span>
            <strong>{g.name}</strong>
            {g.broken && <em>deliberately broken</em>}
            <span className="actions">
              <button onClick={() => onPlay(g)}>Play</button>
              <button onClick={() => onSend(g)}>Send</button>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
