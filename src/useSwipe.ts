import { useRef, useState, type PointerEvent } from 'react';

export type SwipeDirection = 'left' | 'right';
/**
 * Horizontal swipe on a row button. A vertical drag scrolls (touch-action: pan-y on the row);
 * any drag suppresses the click, so only a tap or keyboard activation opens the row.
 */
export function useSwipe(onSwipe: (direction: SwipeDirection) => void) {
  const gesture = useRef<{ id: number; x: number; y: number; axis?: 'x' | 'y' } | null>(null);
  const suppressClick = useRef(false);
  const [offset, setOffset] = useState(0);
  const handlers = {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick.current = false;
      gesture.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.axis && Math.max(Math.abs(dx), Math.abs(dy)) > 10) drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.axis === 'x') { suppressClick.current = true; setOffset(dx); }
      else if (drag.axis === 'y') suppressClick.current = true;
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const drag = gesture.current;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const threshold = Math.max(64, Math.min(110, event.currentTarget.clientWidth * 0.25));
      gesture.current = null;
      setOffset(0);
      if (drag.axis === 'x' && Math.abs(dx) >= threshold) onSwipe(dx < 0 ? 'left' : 'right');
    },
    onPointerCancel() { gesture.current = null; setOffset(0); },
  };
  /** Click handler guard: keyboard (detail 0) always opens, pointer only without a drag. */
  const isTap = (event: { detail: number }) => event.detail === 0 || !suppressClick.current;
  return { offset, handlers, isTap };
}
