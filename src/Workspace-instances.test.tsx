import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch } from './test-fixtures';
import { WORKSPACE_KEY, type Tile } from './tile-grid';

// The computer stands in for a widget that may repeat: no real one exists yet, and the grid must already handle it.
vi.mock('./workspace-kinds', async importOriginal => {
  const real = await importOriginal<typeof import('./workspace-kinds')>();
  const multi = ['system'];
  return { ...real, MULTI_KINDS: multi, pickable: (cards: never, placed: string[], available: (kind: string) => boolean) => real.pickable(cards, placed, available, multi) };
});

const now = new Date('2026-10-14T10:00:00Z').getTime();
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const grid = () => document.querySelector('.wk-grid') as HTMLElement;
const arranged = (): Tile[] => JSON.parse(localStorage.getItem(WORKSPACE_KEY)!).tiles;

describe('several tiles of one widget', () => {
  it('stay on offer while placed, get ids of their own, and leave one at a time', async () => {
    const user = userEvent.setup();
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles: [
      { id: 'cezar', kind: 'cezar', c: 2, r: 0, w: 2, h: 2 }, { id: 'system#1', kind: 'system', c: 0, r: 0, w: 1, h: 1, config: { note: 'first' } },
    ] }));
    vi.stubGlobal('fetch', vi.fn(scenarioFetch('standard')));
    render(<App />);
    await screen.findByRole('region', { name: 'Cezar' });

    // The computer is already on the grid, and still offered in the next empty cell.
    const empty = grid().querySelector('.wk-empty') as HTMLElement;
    await user.click(within(empty).getByRole('button', { name: 'Dodaj kafelek: Komputer' }));
    expect(grid().querySelectorAll('[data-kind="system"]')).toHaveLength(2);
    expect(arranged().map(x => x.id)).toEqual(['cezar', 'system#1', 'system#2']);
    expect([...grid().querySelectorAll('[data-kind="system"]')].map(x => x.getAttribute('data-tile'))).toEqual(['system#1', 'system#2']);

    // Each one leaves on its own; the settings of the other stay.
    await user.click(screen.getAllByRole('button', { name: 'Wyłącz kafelek: Komputer' })[1]);
    expect(arranged().map(x => x.id)).toEqual(['cezar', 'system#1']);
    expect(arranged().find(x => x.id === 'system#1')).toMatchObject({ config: { note: 'first' } });
    expect(grid().querySelectorAll('[data-kind="system"]')).toHaveLength(1);
  });
});
