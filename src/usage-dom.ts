import type { AreaView } from './usage-meter';
import type { AreaSlice } from './usage-contract';
import { USAGE_AREAS } from './usage-contract';

/**
 * Where the areas are in the page. An element marks itself with `data-usage-area` (and, for a tile, `data-usage-kind` and
 * `data-usage-tile`; for details `data-usage-source`; for the chat `data-usage-chat`); the page and the desktop it stands on
 * come from the app. Nothing the user typed is ever read from the page.
 */
export const AREA_ATTRIBUTE = 'data-usage-area';
/** A layer that only dims what is below: the area under it is still seen, so it is looked through. */
export const DIM_ATTRIBUTE = 'data-usage-dim';
export interface AreaContext { page: AreaSlice['page']; pulpit?: string }

const KNOWN = new Set<string>(USAGE_AREAS);
const SLUG = /^[a-z0-9-]{1,30}$/;
const TILE = /^[a-z0-9#-]{1,40}$/;
const CHAT = new Set(['full', 'compact', 'pointing']);

export function areaViewOf(element: Element, context: AreaContext): AreaView | null {
  const area = element.getAttribute(AREA_ATTRIBUTE);
  if (!area || !KNOWN.has(area)) return null;
  const read = (name: string, pattern: RegExp) => { const value = element.getAttribute(name); return value && pattern.test(value) ? value : undefined; };
  const chat = element.getAttribute('data-usage-chat');
  return {
    area: area as AreaView['area'], page: context.page, ...(context.page === 'home' && context.pulpit ? { pulpit: context.pulpit } : {}),
    ...(area === 'tile' ? { kind: read('data-usage-kind', SLUG), tile: read('data-usage-tile', TILE) } : {}),
    ...(area.startsWith('detail-') ? { source: read('data-usage-source', SLUG) } : {}),
    ...(area === 'wektor' && chat && CHAT.has(chat) ? { chat: chat as AreaView['chat'] } : {}),
  };
}

/** Where the visible part of the page is: the window, or in a preview frame the part of it the host's scroll box shows. */
let previewViewport: { left: number; top: number; right: number; bottom: number } | null = null;
export function setPreviewViewport(rect: { left: number; top: number; right: number; bottom: number } | null) { previewViewport = rect; }
function viewport() {
  const own = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  if (!previewViewport) return own;
  return { left: Math.max(own.left, previewViewport.left), top: Math.max(own.top, previewViewport.top), right: Math.min(own.right, previewViewport.right), bottom: Math.min(own.bottom, previewViewport.bottom) };
}

const GRID = 5;
const dimmed = (element: Element) => element.closest(`[${DIM_ATTRIBUTE}]`) !== null;

/**
 * Whether any part of the area is visible: inside the visible window (and the visible part of a preview frame), not clipped
 * away and not wholly covered by another layer. The visible part is probed at a grid of points; the first point whose topmost
 * non-dimming element belongs to the area is enough (a dimming layer is looked through, a partly covered area still counts).
 */
export function isExposed(element: Element): boolean {
  if (!element.isConnected) return false;
  const box = element.getBoundingClientRect(), view = viewport();
  const left = Math.max(box.left, view.left), right = Math.min(box.right, view.right), top = Math.max(box.top, view.top), bottom = Math.min(box.bottom, view.bottom);
  if (!(right - left > 1) || !(bottom - top > 1)) return false;
  for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) {
    const x = left + (right - left) * (i + 0.5) / GRID, y = top + (bottom - top) * (j + 0.5) / GRID;
    const top_ = document.elementsFromPoint(x, y).find(hit => !dimmed(hit));
    if (top_ && element.contains(top_)) return true;
  }
  return false;
}

/** The area an event landed in: the nearest ancestor (or the element itself) that is marked. */
export const areaOf = (target: EventTarget | null): Element | null => target instanceof Element ? target.closest(`[${AREA_ATTRIBUTE}]`) : null;

/** The tile the last trusted pointer or key landed in: what a detail opened a moment later was opened from. */
let lastTile: { kind: string; at: number } | null = null;
const OPEN_WITHIN_MS = 1500;
export function rememberInteraction(target: Element | null, now: number) {
  const tile = target?.closest('[data-usage-area="tile"]');
  const kind = tile?.getAttribute('data-usage-kind');
  lastTile = kind && SLUG.test(kind) ? { kind, at: now } : null;
}
/** The kind of the tile whose click has just opened something; nothing when it came from elsewhere (a chip, the bell, the chat). */
export const sourceOfOpening = (now: number): string | undefined => lastTile && now - lastTile.at <= OPEN_WITHIN_MS ? lastTile.kind : undefined;
