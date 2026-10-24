import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Nominal heights (px) of the sizes of a zone, smallest first; the biggest may depend on the frame. */
export type SizeHeights = (frame: HTMLElement | null) => number[];
/** Moving less than this is a tap, not a drag. */
export const DRAG_START_PX = 6;

/** The size whose height is nearest to `raw`. */
export function nearestSize(heights: number[], raw: number): number {
  return heights.reduce((best, height, index) => Math.abs(height - raw) < Math.abs(heights[best] - raw) ? index : best, 0);
}

interface Drag { id: number; y: number; frame: HTMLElement | null; heights: number[]; start: number; moved: boolean }

/**
 * The grip on the edge of a zone. Drag it and the edge follows the finger, then settles on the nearest size; a tap steps
 * to the next size. `edge` says which edge of the zone it is: dragging the bottom edge down, or the top edge up,
 * makes the zone bigger. While dragging, the zone's height is overridden through `cssVar` on the frame, and `onPreview`
 * tells which size it would settle on, so the content can already be drawn for it. The frame carries `data-dragging`
 * meanwhile, so the zones follow the pointer without easing; once let go they glide to the size. The drag is
 * followed on the window, so it ends wherever the pointer is let go, even when the zone has moved from under it.
 */
export function SizeGrip<T extends string>({ label, edge, order, current, heights, cssVar, onChange, onPreview, onTap }: {
  label: string; edge: 'top' | 'bottom'; order: readonly T[]; current: T; heights: SizeHeights; cssVar: '--p3-top' | '--p3-bottom';
  onChange: (size: T) => void; onTap: () => void;
  /** The size the drag would settle on right now, each time it changes; null when the drag is over. */
  onPreview?: (size: T | null) => void;
}) {
  const drag = useRef<Drag | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const suppressTap = useRef(false);
  const latest = useRef({ onChange, onPreview, order });
  latest.current = { onChange, onPreview, order };
  useEffect(() => () => stop.current?.(), []);
  const target = (d: Drag, clientY: number) => {
    const dy = clientY - d.y;
    return Math.min(d.heights.at(-1)!, Math.max(d.heights[0], d.start + (edge === 'bottom' ? dy : -dy)));
  };
  function begin(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!event.isPrimary || event.button !== 0) return;
    suppressTap.current = false;
    const frame = event.currentTarget.closest('.p3-frame') as HTMLElement | null;
    const all = heights(frame);
    const d: Drag = { id: event.pointerId, y: event.clientY, frame, heights: all, start: all[order.indexOf(current)], moved: false };
    drag.current = d;
    let previewed = order.indexOf(current);
    const move = (e: PointerEvent) => {
      if (e.pointerId !== d.id) return;
      if (!d.moved && Math.abs(e.clientY - d.y) < DRAG_START_PX) return;
      if (!d.moved) d.frame?.setAttribute('data-dragging', '');
      d.moved = true;
      const height = target(d, e.clientY);
      d.frame?.style.setProperty(cssVar, `${height}px`);
      const nearest = nearestSize(d.heights, height);
      if (nearest !== previewed) { previewed = nearest; latest.current.onPreview?.(latest.current.order[nearest]); }
    };
    const end = (e: PointerEvent) => {
      if (e.pointerId !== d.id) return;
      finish();
      // A pointer that jumps (no moves in between) still counts by where it ended.
      if (!d.moved && Math.abs(e.clientY - d.y) < DRAG_START_PX) return;
      suppressTap.current = true;
      latest.current.onChange(latest.current.order[nearestSize(d.heights, target(d, e.clientY))]);
    };
    const finish = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', cancel);
      d.frame?.style.removeProperty(cssVar);
      d.frame?.removeAttribute('data-dragging');
      if (d.moved) latest.current.onPreview?.(null);
      drag.current = null;
      stop.current = null;
    };
    const cancel = () => finish();
    stop.current = finish;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', cancel);
  }
  return <button className={`p3-grip ${edge}`} aria-label={label} title="Przeciągnij, aby zmienić rozmiar; dotknięcie wybiera kolejny"
    onPointerDown={begin} onClick={() => { if (suppressTap.current) { suppressTap.current = false; return; } onTap(); }}>
    <i aria-hidden="true" />
  </button>;
}
