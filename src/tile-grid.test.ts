import { describe, expect, it } from 'vitest';
import {
  COLS, ROWS, WORKSPACE_KEY, add, autoTiles, emptyCells, move, overlaps, parseWorkspace, place, readWorkspace, readingOrder, remove, resize,
  resetWorkspace, saveWorkspace, tileAt, type Tile,
} from './tile-grid';

const t = (kind: string, c: number, r: number, w = 1, h = 1): Tile => ({ kind, c, r, w, h });
const at = (tiles: Tile[], kind: string) => tiles.find(x => x.kind === kind)!;
/** No two tiles share a cell and all stay in the grid: what every result must keep true. */
const clean = (tiles: Tile[]) => tiles.every((a, i) => a.c >= 0 && a.r >= 0 && a.c + a.w <= COLS && a.r + a.h <= ROWS && tiles.every((b, j) => j <= i || !overlaps(a, b)));

describe('empty cells', () => {
  it('are the cells no tile covers', () => {
    expect(emptyCells([t('a', 0, 0, 2, 2), t('b', 2, 0, 2, 1)])).toEqual([{ c: 2, r: 1 }, { c: 3, r: 1 }]);
    expect(emptyCells([])).toHaveLength(COLS * ROWS);
  });
  it('are found by the tile that covers a cell', () => {
    const tiles = [t('a', 0, 0, 2, 2)];
    expect(tileAt(tiles, 1, 1)?.kind).toBe('a');
    expect(tileAt(tiles, 2, 1)).toBeUndefined();
  });
});

describe('resize', () => {
  it('grows into free cells without touching anyone', () => {
    const plan = resize([t('a', 0, 0), t('b', 3, 1)], 'a', { w: 3, h: 2 });
    expect(at(plan.tiles, 'a')).toMatchObject({ w: 3, h: 2 });
    expect(at(plan.tiles, 'b')).toMatchObject({ c: 3, r: 1 });
    expect(plan.moved).toEqual([]);
  });
  it('asks the tile in the way to move to a free cell', () => {
    // a grows to the right over b; the grid has room elsewhere, so b steps aside instead of blocking the growth.
    const plan = resize([t('a', 0, 0), t('b', 1, 0)], 'a', { w: 2, h: 1 });
    expect(at(plan.tiles, 'a')).toMatchObject({ c: 0, r: 0, w: 2, h: 1 });
    expect(plan.moved).toEqual(['b']);
    expect(clean(plan.tiles)).toBe(true);
    expect(at(plan.tiles, 'b')).toMatchObject({ c: 2, r: 0 }); // the nearest free cell (one step away)
  });
  it('moves several tiles when growing over them, each to the nearest place left', () => {
    const tiles = [t('a', 0, 0), t('b', 1, 0), t('c', 0, 1)];
    const plan = resize(tiles, 'a', { w: 2, h: 2 });
    expect(at(plan.tiles, 'a')).toMatchObject({ w: 2, h: 2 });
    expect(plan.moved.sort()).toEqual(['b', 'c']);
    expect(clean(plan.tiles)).toBe(true);
    expect(emptyCells(plan.tiles)).toHaveLength(COLS * ROWS - 4 - 2);
  });
  it('stops at the largest size that works when the others have nowhere to go', () => {
    // Five 1×1 tiles fill the right of a 2×2: growing a over all of them would leave three for four cells.
    const tiles = [t('a', 0, 0), t('b', 1, 0), t('c', 1, 1), t('d', 2, 0), t('e', 2, 1), t('f', 3, 0), t('g', 3, 1), t('h', 0, 1)];
    const plan = resize(tiles, 'a', { w: 2, h: 1 });
    expect(plan.tiles).toEqual(tiles);
    expect(plan.moved).toEqual([]);
  });
  it('shrinking always works and leaves the freed cells empty', () => {
    const plan = resize([t('a', 0, 0, 2, 2)], 'a', { w: 1, h: 1 });
    expect(at(plan.tiles, 'a')).toMatchObject({ w: 1, h: 1 });
    expect(emptyCells(plan.tiles)).toHaveLength(COLS * ROWS - 1);
  });
  it('is held by the edge of the grid', () => {
    const plan = resize([t('a', 3, 1)], 'a', { w: 4, h: 4 });
    expect(at(plan.tiles, 'a')).toMatchObject({ w: 1, h: 1 });
  });
  it('is partly granted: the width works even when the height cannot', () => {
    // A full-width tile under a cannot go anywhere, so a cannot grow down, but b can step aside for it to grow right.
    const tiles = [t('a', 0, 0), t('b', 1, 0), t('wide', 0, 1, 4, 1)];
    const plan = resize(tiles, 'a', { w: 2, h: 2 });
    expect(at(plan.tiles, 'a')).toMatchObject({ w: 2, h: 1 });
    expect(at(plan.tiles, 'wide')).toMatchObject({ c: 0, r: 1, w: 4 });
    expect(clean(plan.tiles)).toBe(true);
  });
});

describe('move', () => {
  it('drops a tile into free cells, keeping its size', () => {
    const plan = move([t('a', 0, 0, 2, 1), t('b', 3, 1)], 'a', { c: 1, r: 1 });
    expect(at(plan!.tiles, 'a')).toMatchObject({ c: 1, r: 1, w: 2, h: 1 });
    expect(plan!.moved).toEqual([]);
  });
  it('keeps the tile inside the grid when the drop lands at its edge', () => {
    const plan = move([t('a', 0, 0, 2, 1)], 'a', { c: 3, r: 1 });
    expect(at(plan!.tiles, 'a')).toMatchObject({ c: 2, r: 1 });
  });
  it('swaps with the tile it lands on when that is the closest place for it', () => {
    const plan = move([t('a', 0, 0), t('b', 1, 0)], 'a', { c: 1, r: 0 });
    expect(at(plan!.tiles, 'a')).toMatchObject({ c: 1, r: 0 });
    expect(at(plan!.tiles, 'b')).toMatchObject({ c: 0, r: 0 });
    expect(plan!.moved).toEqual(['b']);
  });
  it('swaps tiles of different sizes when each fits where the other was', () => {
    const plan = move([t('a', 0, 0, 2, 1), t('b', 2, 0), t('c', 3, 0)], 'a', { c: 2, r: 0 });
    expect(at(plan!.tiles, 'a')).toMatchObject({ c: 2, r: 0, w: 2 });
    expect(clean(plan!.tiles)).toBe(true);
    expect(plan!.moved.sort()).toEqual(['b', 'c']);
  });
  it('refuses a drop that would leave a tile without a place', () => {
    // The grid is full: a 2×2 cannot take the place of two tiles and leave the room for them.
    const full = [t('a', 0, 0, 2, 2), t('b', 2, 0), t('c', 3, 0), t('d', 2, 1), t('e', 3, 1)];
    expect(move(full, 'a', { c: 2, r: 0 })).not.toBeNull(); // four tiles go to the freed 2×2
    const crowded = [t('a', 0, 0, 2, 2), t('b', 2, 0, 2, 2)];
    expect(move(crowded, 'a', { c: 2, r: 0 })!.tiles.map(x => x.kind).sort()).toEqual(['a', 'b']);
    expect(move([t('a', 0, 0, 1, 2), t('b', 1, 0, 3, 2)], 'a', { c: 1, r: 0 })).toBeNull();
  });
  it('is a no-op when dropped where it already stands', () => {
    const tiles = [t('a', 1, 0, 2, 1)];
    expect(move(tiles, 'a', { c: 1, r: 0 })!.tiles).toEqual(tiles);
  });
  it('knows no tile it was not given', () => {
    expect(move([t('a', 0, 0)], 'nope', { c: 1, r: 0 })).toBeNull();
    expect(place([t('a', 0, 0)], 'a', { c: 3, r: 1, w: 2, h: 1 })).toBeNull();
  });
});

describe('add and remove', () => {
  it('add puts a 1×1 tile on an empty cell, once', () => {
    const one = add([], 'a', 2, 1);
    expect(one).toEqual([t('a', 2, 1)]);
    expect(add(one, 'a', 0, 0)).toBe(one);
    expect(add(one, 'b', 2, 1)).toBe(one);
  });
  it('remove leaves the cells empty', () => {
    expect(emptyCells(remove([t('a', 0, 0, 2, 2)], 'a'))).toHaveLength(COLS * ROWS);
  });
  it('reading order is top to bottom, left to right', () => {
    expect(readingOrder([t('c', 1, 1), t('a', 0, 0), t('b', 2, 0)]).map(x => x.kind)).toEqual(['a', 'b', 'c']);
  });
});

describe('automatic layout', () => {
  const limits = ['quota:Claude', 'quota:Codex', 'quota:agy:Gemini Models'];
  it('puts Cezar over the right half while the rest fits in the four cells beside it', () => {
    const tiles = autoTiles([...limits, 'mail', 'cezar']);
    expect(at(tiles, 'cezar')).toMatchObject({ c: 2, r: 0, w: 2, h: 2 });
    expect(tiles.filter(x => x.kind !== 'cezar').map(x => x.kind)).toEqual([...limits, 'mail']);
    expect(clean(tiles)).toBe(true);
    expect(emptyCells(tiles)).toEqual([]);
  });
  it('shrinks Cezar to the top row when five or six more things need the room', () => {
    const many = [...limits, 'quota:agy:Claude and GPT models', 'quota:agy:Gemini 4 Argon', 'mail', 'cezar'];
    const tiles = autoTiles(many);
    expect(at(tiles, 'cezar')).toMatchObject({ c: 2, r: 0, w: 2, h: 1 });
    expect(tiles).toHaveLength(7);
    expect(clean(tiles)).toBe(true);
    expect(emptyCells(tiles)).toEqual([]);
  });
  it('without Cezar the tiles just fill the grid in order, without the computer', () => {
    const tiles = autoTiles(['quota:Claude', 'system', 'mail']);
    expect(tiles.map(x => x.kind)).toEqual(['quota:Claude', 'mail']);
    expect(tiles.every(x => x.w === 1 && x.h === 1)).toBe(true);
  });
  it('is empty when nothing may be shown', () => {
    expect(autoTiles([])).toEqual([]);
  });
});

describe('saved layout', () => {
  it('is nothing until the panel is arranged, then round-trips', () => {
    localStorage.clear();
    expect(readWorkspace()).toBeNull();
    const mine = [t('cezar', 0, 0, 2, 2), t('mail', 3, 1)];
    expect(saveWorkspace(mine)).toBe(true);
    expect(readWorkspace()).toEqual(mine);
    expect(resetWorkspace()).toBe(true);
    expect(readWorkspace()).toBeNull();
  });
  it('keeps an empty arrangement: the user may clear everything', () => {
    expect(parseWorkspace(JSON.stringify({ version: 1, tiles: [] }))).toEqual([]);
  });
  it.each([
    ['not json', '{'],
    ['an unknown version', JSON.stringify({ version: 2, tiles: [] })],
    ['overlapping tiles', JSON.stringify({ version: 1, tiles: [t('a', 0, 0, 2, 1), t('b', 1, 0)] })],
    ['a tile outside the grid', JSON.stringify({ version: 1, tiles: [t('a', 3, 0, 2, 1)] })],
    ['a kind twice', JSON.stringify({ version: 1, tiles: [t('a', 0, 0), t('a', 1, 0)] })],
    ['a fraction', JSON.stringify({ version: 1, tiles: [t('a', 0.5, 0)] })],
    ['a missing kind', JSON.stringify({ version: 1, tiles: [{ c: 0, r: 0, w: 1, h: 1 }] })],
  ])('is not trusted with %s', (_, raw) => {
    expect(parseWorkspace(raw)).toBeNull();
  });
  it('survives storage that throws', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('blocked'); };
    try { expect(saveWorkspace([t('a', 0, 0)])).toBe(false); } finally { Storage.prototype.setItem = original; }
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });
});
