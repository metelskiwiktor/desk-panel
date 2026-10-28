import { useCallback, useEffect, useState } from 'react';

/** The dashboard is three zones one above the other: today (top), the work area (the rest), the days (bottom). */
export type TopSize = 'cmp' | 'std';
export type BottomSize = 'short' | 'mid' | 'month';
export interface Zones { top: TopSize; bottom: BottomSize }

export const TOP_SIZES: readonly TopSize[] = ['cmp', 'std'];
/** The order a tap on the grip goes through: from the standard strip to the line, and back. */
export const TOP_CYCLE: readonly TopSize[] = ['std', 'cmp'];
export const BOTTOM_SIZES: readonly BottomSize[] = ['short', 'mid', 'month'];
export const DEFAULT_ZONES: Zones = { top: 'cmp', bottom: 'short' };
export const ZONES_KEY = 'desk-panel.zones';

/** Heights (px) the sizes of the top zone are drawn at, in the order of TOP_SIZES. */
export const TOP_HEIGHTS = [44, 124];
/** Heights of the bottom zone in the order of BOTTOM_SIZES; the month takes what the top leaves of the frame. */
export const bottomHeights = (frame: HTMLElement | null): number[] => {
  const top = TOP_HEIGHTS[TOP_SIZES.indexOf((frame?.getAttribute('data-top') as TopSize | null) ?? 'cmp')] ?? 44;
  const month = frame && frame.clientHeight > 0 ? frame.clientHeight - top - 8 : 480;
  return [64, 224, Math.max(month, 300)];
};

/** The next size, and from the last one round to the first. */
export function cycleSize<T>(order: readonly T[], current: T): T {
  return order[(order.indexOf(current) + 1) % order.length];
}

/** One step along `order`, stopping at the ends. */
export function stepSize<T>(order: readonly T[], current: T, direction: 1 | -1): T {
  const next = order.indexOf(current) + direction;
  return order[Math.min(order.length - 1, Math.max(0, next))];
}

export function parseZones(raw: string | null): Zones {
  try {
    const value = JSON.parse(raw ?? 'null');
    if (value?.top === 'off') value.top = 'cmp'; // the hidden strip is gone; the line is the smallest now
    if (value && TOP_SIZES.includes(value.top) && BOTTOM_SIZES.includes(value.bottom)) return { top: value.top, bottom: value.bottom };
  } catch { /* fall through to the default */ }
  return DEFAULT_ZONES;
}
const read = () => { try { return parseZones(localStorage.getItem(ZONES_KEY)); } catch { return DEFAULT_ZONES; } };
const save = (zones: Zones) => { try { localStorage.setItem(ZONES_KEY, JSON.stringify(zones)); } catch { /* the sizes then last until reload */ } };

/**
 * Sizes of the top and bottom zones (the middle takes what is left). Remembered in the browser; the screen goes back to
 * the default sizes and today whenever `resetSignal` turns true (the idle clock), as a panel nobody touches should.
 * `view` is what to draw: the saved sizes, except the one a grip is being dragged to (see `previewTop`/`previewBottom`),
 * so the zone already looks the way it will once the grip is let go.
 */
export function useZones(resetSignal: boolean) {
  const [zones, setZones] = useState<Zones>(read);
  const [preview, setPreview] = useState<Partial<Zones>>({});
  const update = useCallback((change: (zones: Zones) => Zones) => setZones(previous => { const next = change(previous); save(next); return next; }), []);
  useEffect(() => { if (resetSignal) update(() => DEFAULT_ZONES); }, [resetSignal, update]);
  return {
    zones,
    view: { top: preview.top ?? zones.top, bottom: preview.bottom ?? zones.bottom } as Zones,
    previewTop: useCallback((top: TopSize | null) => setPreview(p => ({ ...p, top: top ?? undefined })), []),
    previewBottom: useCallback((bottom: BottomSize | null) => setPreview(p => ({ ...p, bottom: bottom ?? undefined })), []),
    setTop: useCallback((top: TopSize) => update(z => ({ ...z, top })), [update]),
    setBottom: useCallback((bottom: BottomSize) => update(z => ({ ...z, bottom })), [update]),
  };
}

/**
 * Returns whether work content is present for PR data.
 * Must be false when PR data is empty or absent, keeping zones tests green.
 */
export function hasWorkContent(prData?: { pullRequests?: unknown[] } | unknown[] | null): boolean {
  if (!prData) return false;
  if (Array.isArray(prData)) return prData.length > 0;
  if (Array.isArray(prData.pullRequests)) return prData.pullRequests.length > 0;
  return false;
}
