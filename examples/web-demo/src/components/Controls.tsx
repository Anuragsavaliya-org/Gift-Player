import type { ContentMode } from '../types';

/**
 * Playback options for the stage, and the cache. Note: <GiftPlayerView> has no imperative handle, so the stage can be replayed and
 * stopped (by remounting / unmounting it) but not paused; Pause / Resume act on the live queue (see QueueDemo).
 */
export function Controls(props: {
  loops: number;
  mode: ContentMode;
  onLoops: (n: number) => void;
  onMode: (m: ContentMode) => void;
  onReplay: () => void;
  onStop: () => void;
  paused: boolean;
  onTogglePause: () => void;
  cacheMb: number;
  onClearCache: () => void;
}) {
  return (
    <section className="panel">
      <h2>Controls</h2>
      <div className="row">
        <button onClick={props.onReplay}>▶ Play / replay</button>
        <button onClick={props.onTogglePause} title="Pauses the live queue (the stage player has no pause: see README)">{props.paused ? '⏵ Resume queue' : '⏸ Pause queue'}</button>
        <button onClick={props.onStop}>■ Stop</button>
      </div>
      <div className="row">
        <label>Loops{' '}
          <select value={props.loops} onChange={(e) => props.onLoops(Number(e.target.value))}>
            <option value={1}>1</option>
            <option value={3}>3</option>
            <option value={0}>infinite</option>
          </select>
        </label>
        <label>Content mode{' '}
          <select value={props.mode} onChange={(e) => props.onMode(e.target.value as ContentMode)}>
            <option value="aspectFit">aspectFit</option>
            <option value="aspectFill">aspectFill</option>
            <option value="fill">fill</option>
          </select>
        </label>
      </div>
      <div className="row">
        <span>Cache: <strong>{props.cacheMb.toFixed(1)} MB</strong></span>
        <button onClick={props.onClearCache}>Clear cache</button>
      </div>
    </section>
  );
}
