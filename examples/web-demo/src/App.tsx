import { getDefaultCache, type GiftInfo } from '@incodes/gift-player';
import { GiftPlayerView } from '@incodes/gift-player/react';
import { useEffect, useRef, useState } from 'react';
import { Controls } from './components/Controls';
import { GiftGrid } from './components/GiftGrid';
import { InfoPanel } from './components/InfoPanel';
import { QueueDemo } from './components/QueueDemo';
import { Stage } from './components/Stage';
import { Toasts } from './components/Toasts';
import { giftUrl, type ContentMode, type Gift } from './types';
import { useToasts } from './useToasts';

/**
 * The minimal integration is the <GiftPlayerView> below: give it a `src` and a box with a size, and listen to `onEnd` / `onError`.
 * Everything else in this file is demo scaffolding around it.
 */
export function App() {
  const [gifts, setGifts] = useState<Gift[] | null>(null);
  const [selected, setSelected] = useState<Gift | null>(null);
  /** The gift playing on the stage right now (`run` makes a click on the same tile replay it). */
  const [stage, setStage] = useState<{ gift: Gift; run: number } | null>(null);
  const [info, setInfo] = useState<{ gift: Gift; info: GiftInfo; loadMs: number } | null>(null);
  const [loops, setLoops] = useState(1);
  const [mode, setMode] = useState<ContentMode>('aspectFit');
  const { toasts, push } = useToasts();
  const [cacheMb, setCacheMb] = useState(0);
  const clickedAt = useRef(0);
  const runs = useRef(0);

  useEffect(() => {
    fetch('/gifts/manifest.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`manifest.json: HTTP ${r.status}`))))
      .then((list: Gift[]) => {
        setGifts(list);
        setSelected(list.find((g) => !g.broken) ?? null);
      })
      .catch(() => setGifts([]));
  }, []);

  useEffect(() => {
    // The default cache is module-wide and shared by every player and queue; its `stats` are cheap to read.
    const t = setInterval(() => setCacheMb(getDefaultCache().stats.bytes / 1048576), 500);
    return () => clearInterval(t);
  }, []);

  const playOnStage = (gift: Gift) => {
    setSelected(gift);
    clickedAt.current = performance.now(); // the load time shown in the info panel starts here
    setStage({ gift, run: ++runs.current });
  };

  if (!gifts) return <p className="note">Loading…</p>;
  if (gifts.length === 0) {
    return (
      <p className="note">
        No gifts found. Run <code>npm run gifts:copy</code> (or put files in <code>public/gifts/</code> and list them in <code>manifest.json</code>).
      </p>
    );
  }

  return (
    // The queue lives in <QueueDemo>; it hands down what the page needs (the element the queue draws in, its panel, `send`).
    <QueueDemo gifts={gifts} selected={selected} toast={push}>
      {({ overlayRef, panel, badge, paused, togglePause, send }) => (
        <main className="app">
          <header>
            <h1>Gift Player demo</h1>
            <p>
              <code>@incodes/gift-player</code> from npm, used through its <code>/react</code> entry. <b>Play</b> a gift on the stage, or <b>Send</b> it to the live queue and simulate a busy chat.
            </p>
          </header>

          <div className="layout">
            <Stage overlayRef={overlayRef} badge={badge}>
              {stage && (
                // The whole SDK integration for "play this file over my video":
                <GiftPlayerView
                  key={stage.run}
                  src={giftUrl(stage.gift)}
                  loops={loops}
                  contentMode={mode}
                  style={{ position: 'absolute', inset: 0 }}
                  onLoad={(i) => setInfo({ gift: stage.gift, info: i, loadMs: performance.now() - clickedAt.current })}
                  onEnd={() => setStage(null)}
                  onError={(e) => {
                    push(`${stage.gift.name}: ${e.code}`);
                    setStage(null);
                  }}
                />
              )}
            </Stage>
            <div className="side">
              <Controls
                loops={loops}
                mode={mode}
                onLoops={setLoops}
                onMode={setMode}
                onReplay={() => selected && playOnStage(selected)}
                onStop={() => setStage(null)}
                paused={paused}
                onTogglePause={togglePause}
                cacheMb={cacheMb}
                onClearCache={() => getDefaultCache().clear()}
              />
              {panel}
            </div>
          </div>

          <GiftGrid gifts={gifts} selected={selected} onPlay={playOnStage} onSend={send} />
          <InfoPanel current={info} />
          <Toasts toasts={toasts} />
        </main>
      )}
    </QueueDemo>
  );
}
