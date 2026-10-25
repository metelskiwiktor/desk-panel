/**
 * The work area is a grid of COLS × ROWS cells. A tile covers a rectangle of them; the cells no tile covers are empty.
 * Everything here is plain data in, plain data out: the component only asks what a drag or a resize would do.
 */
export const COLS = 4;
export const ROWS = 2;
export const WORKSPACE_KEY = 'desk-panel.workspace';

export interface Rect { c: number; r: number; w: number; h: number }
export interface Tile extends Rect { kind: string }
/** The tiles after a change, and the kinds of the other tiles that had to make room (they moved to free cells). */
export interface Plan { tiles: Tile[]; moved: string[] }

const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));
export const rectOf = ({ c, r, w, h }: Rect): Rect => ({ c, r, w, h });
export const overlaps = (a: Rect, b: Rect) => a.c < b.c + b.w && b.c < a.c + a.w && a.r < b.r + b.h && b.r < a.r + a.h;
export const inGrid = (q: Rect) => q.w >= 1 && q.h >= 1 && q.c >= 0 && q.r >= 0 && q.c + q.w <= COLS && q.r + q.h <= ROWS;
export const tileAt = (tiles: Tile[], c: number, r: number) => tiles.find(t => c >= t.c && c < t.c + t.w && r >= t.r && r < t.r + t.h);

export function emptyCells(tiles: Tile[]): { c: number; r: number }[] {
  const cells: { c: number; r: number }[] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (!tileAt(tiles, c, r)) cells.push({ c, r });
  return cells;
}

/** Tiles in reading order (top to bottom, left to right), which is also the order a narrow screen stacks them in. */
export const readingOrder = (tiles: Tile[]) => [...tiles].sort((a, b) => a.r - b.r || a.c - b.c);

/**
 * Finds a free spot for each of `movers` (they keep their size), away from `fixed`, so that together they travel the
 * least: the sum of the distances from where each stood. Null when they do not all fit. The grid is tiny, so every
 * arrangement is tried, which also means two tiles can swap places when that is the cheapest way.
 */
function relocate(movers: Tile[], fixed: Rect[]): Tile[] | null {
  const best: { cost: number; tiles: Tile[] | null } = { cost: Infinity, tiles: null };
  const search = (index: number, obstacles: Rect[], placed: Tile[], cost: number) => {
    if (cost >= best.cost) return;
    if (index === movers.length) { best.cost = cost; best.tiles = placed; return; }
    const mover = movers[index];
    for (let r = 0; r + mover.h <= ROWS; r++) for (let c = 0; c + mover.w <= COLS; c++) {
      const spot = { c, r, w: mover.w, h: mover.h };
      if (obstacles.some(o => overlaps(o, spot))) continue;
      search(index + 1, [...obstacles, spot], [...placed, { ...mover, c, r }], cost + Math.abs(c - mover.c) + Math.abs(r - mover.r));
    }
  };
  search(0, fixed, [], 0);
  return best.tiles;
}

/**
 * Puts the tile `kind` on `to`. Whatever stood there is moved to the nearest free cells; if it has nowhere to go,
 * nothing happens (null). This one rule is the whole of "smart" growing and of dropping a tile onto another.
 */
export function place(tiles: Tile[], kind: string, to: Rect): Plan | null {
  const subject = tiles.find(t => t.kind === kind);
  if (!subject || !inGrid(to)) return null;
  const others = tiles.filter(t => t !== subject);
  const blocking = others.filter(t => overlaps(t, to));
  const relocated = relocate(blocking, [to, ...others.filter(t => !blocking.includes(t))]);
  if (!relocated) return null;
  return {
    tiles: tiles.map(t => t === subject ? { ...t, ...rectOf(to) } : relocated.find(m => m.kind === t.kind) ?? t),
    moved: blocking.map(t => t.kind),
  };
}

/**
 * The size closest to `want` that the tile can have. It grows into free cells first, then asks the tiles in the way to
 * move out; when they cannot, it stops at the last size that works instead of refusing the whole step.
 */
export function resize(tiles: Tile[], kind: string, want: { w: number; h: number }): Plan {
  const tile = tiles.find(t => t.kind === kind);
  if (!tile) return { tiles, moved: [] };
  const w = clamp(want.w, 1, COLS - tile.c), h = clamp(want.h, 1, ROWS - tile.r);
  const between = (from: number, to: number) => Array.from({ length: Math.abs(to - from) + 1 }, (_, i) => from + Math.sign(to - from) * i);
  const sizes = between(tile.w, w).flatMap(cw => between(tile.h, h).map(ch => ({ w: cw, h: ch })))
    .sort((a, b) => Math.abs(a.w - w) + Math.abs(a.h - h) - Math.abs(b.w - w) - Math.abs(b.h - h));
  for (const size of sizes) {
    const plan = place(tiles, kind, { c: tile.c, r: tile.r, ...size });
    if (plan) return plan;
  }
  return { tiles, moved: [] };
}

/** Where the tile would stand with its top-left corner at `at`, kept inside the grid. */
export function targetRect(tiles: Tile[], kind: string, at: { c: number; r: number }): Rect | null {
  const tile = tiles.find(t => t.kind === kind);
  return tile ? { c: clamp(at.c, 0, COLS - tile.w), r: clamp(at.r, 0, ROWS - tile.h), w: tile.w, h: tile.h } : null;
}

/** Moves the tile to `at`; the tile it lands on goes to the nearest free cells (a swap when that is nearest). */
export function move(tiles: Tile[], kind: string, at: { c: number; r: number }): Plan | null {
  const to = targetRect(tiles, kind, at);
  return to ? place(tiles, kind, to) : null;
}

export const add = (tiles: Tile[], kind: string, c: number, r: number): Tile[] =>
  tiles.some(t => t.kind === kind) || tileAt(tiles, c, r) ? tiles : [...tiles, { kind, c, r, w: 1, h: 1 }];
export const remove = (tiles: Tile[], kind: string): Tile[] => tiles.filter(t => t.kind !== kind);

/**
 * What a panel nobody has arranged shows: the limits and mail on the left, in reading order, and Cezar on the right,
 * over both rows while the left has room for the rest in four cells, over the top row when it does not (then the
 * limits and mail take the six cells under and beside it). `kinds` is what may be shown, in the order it is wanted.
 */
export function autoTiles(kinds: string[]): Tile[] {
  const side = kinds.filter(k => k !== 'cezar' && k !== 'system');
  if (!kinds.includes('cezar')) return side.slice(0, COLS * ROWS).map((kind, i) => ({ kind, c: i % COLS, r: Math.floor(i / COLS), w: 1, h: 1 }));
  const tall = side.length <= 4;
  const cells = tall ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0], [1, 0], [0, 1], [1, 1], [2, 1], [3, 1]];
  return [
    ...side.slice(0, cells.length).map((kind, i) => ({ kind, c: cells[i][0], r: cells[i][1], w: 1, h: 1 })),
    { kind: 'cezar', c: 2, r: 0, w: 2, h: tall ? 2 : 1 },
  ];
}

/**
 * A saved layout that is not a clean arrangement (outside the grid, overlapping, a kind twice) is not trusted at all.
 * Null means nobody has arranged the panel (or the arrangement is unusable), so the automatic layout applies.
 */
export function parseWorkspace(raw: string | null): Tile[] | null {
  try {
    if (!raw) return null;
    const saved = JSON.parse(raw);
    if (saved?.version !== 1 || !Array.isArray(saved.tiles)) return null;
    const tiles: Tile[] = saved.tiles.map((t: Record<string, unknown>) => ({ kind: t?.kind, c: t?.c, r: t?.r, w: t?.w, h: t?.h }));
    const valid = tiles.every((t, i) =>
      typeof t.kind === 'string' && t.kind.length > 0 && t.kind.length <= 200 &&
      [t.c, t.r, t.w, t.h].every(Number.isInteger) && inGrid(t) &&
      tiles.every((other, j) => j <= i || (other.kind !== t.kind && !overlaps(t, other))));
    return valid ? tiles : null;
  } catch {
    return null;
  }
}
/** `key` is the storage key of one virtual desktop (see pulpits.ts); the first one keeps the original key. */
export function readWorkspace(key = WORKSPACE_KEY): Tile[] | null {
  try { return parseWorkspace(localStorage.getItem(key)); } catch { return null; }
}
export function saveWorkspace(tiles: Tile[], key = WORKSPACE_KEY): boolean {
  try { localStorage.setItem(key, JSON.stringify({ version: 1, tiles })); return true; } catch { return false; }
}
/** Forgets the arrangement: the next time the work area is drawn it is the automatic one again. */
export function resetWorkspace(key = WORKSPACE_KEY): boolean {
  try { localStorage.removeItem(key); return true; } catch { return false; }
}
