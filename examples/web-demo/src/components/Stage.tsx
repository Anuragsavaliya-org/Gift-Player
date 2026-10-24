import type { ReactNode, RefObject } from 'react';

/**
 * A fake live video: an animated gradient with moving stripes, so it is obvious that gifts are drawn with transparency over it.
 * Two layers sit on top: the single-gift player (children) and the queue's container (`overlayRef`).
 */
export function Stage({ children, overlayRef, badge }: { children: ReactNode; overlayRef: RefObject<HTMLDivElement | null>; badge: string }) {
  return (
    <div className="stage" aria-label="stage">
      <div className="video" />
      <span className="live">● LIVE</span>
      {/* the queue draws here: useGiftQueue puts its canvas inside the element that gets this ref */}
      <div className="layer" ref={overlayRef} />
      {children}
      {badge && <span className="badge">{badge}</span>}
    </div>
  );
}
