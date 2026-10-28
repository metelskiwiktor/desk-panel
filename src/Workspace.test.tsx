import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch, type ScenarioName } from './test-fixtures';
import { WORKSPACE_KEY, type Tile } from './tile-grid';
import { WIDGET_KINDS } from './Workspace';
import { pickable } from './workspace-kinds';

const now = new Date('2026-10-14T10:00:00Z').getTime();
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  // jsdom has no pointer events; a mouse event with a pointer id carries the coordinates the gestures read.
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const t = (kind: string, c: number, r: number, w = 1, h = 1): Tile => ({ id: kind, kind, c, r, w, h });
const arrange = (...tiles: Tile[]) => localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles }));
const arranged = (): Tile[] => JSON.parse(localStorage.getItem(WORKSPACE_KEY)!).tiles;
const at = (kind: string) => arranged().find(x => x.kind === kind)!;
function renderWith(scenario: ScenarioName = 'standard') {
  vi.stubGlobal('fetch', vi.fn(scenarioFetch(scenario)));
  return render(<App />);
}
const grid = () => document.querySelector('.wk-grid') as HTMLElement;
/** jsdom has no layout: the grid is 1228 × 300 px with no gaps, so a cell is 307 × 150. */
const measureGrid = () => {
  const original = HTMLElement.prototype.getBoundingClientRect;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('wk-grid') ? { left: 0, top: 0, width: 1228, height: 300, right: 1228, bottom: 300, x: 0, y: 0, toJSON() {} } : original.call(this);
  });
};
const cell = (kind: string) => grid().querySelector(`[data-kind="${kind}"]`) as HTMLElement;

describe('widget kinds', () => {
  it('offers in an empty cell every kind the grid can show (PR #36 shipped a GitHub PR tile nobody could pick)', () => {
    const offered = pickable([], [], () => true);
    expect(WIDGET_KINDS.filter(kind => !offered.includes(kind))).toEqual([]);
  });
});

describe('the work area', () => {
  it('shows a tile per limit, Cezar and mail, each with its own grip, X and edges: nothing to switch on first', async () => {
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(screen.queryByRole('button', { name: 'Edytuj układ pulpitu' })).toBeNull();
    expect(grid().querySelectorAll('.wk-cell')).toHaveLength(5);
    for (const tile of grid().querySelectorAll<HTMLElement>('.wk-cell')) {
      expect(tile.querySelector('.wk-grip')).toBeTruthy();
      expect(tile.querySelector('.wk-x')).toBeTruthy();
      expect(tile.querySelectorAll('.wk-rz')).toHaveLength(3);
    }
    expect(screen.getByRole('button', { name: 'Wyłącz kafelek: Cezar' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Przesuń kafelek: Poczta' })).toBeTruthy();
  });
  it('the content of a tile stays usable while it can be arranged', async () => {
    const user = userEvent.setup();
    renderWith();
    await user.click(await screen.findByRole('button', { name: /^Claude: 5h/ }));
    expect(screen.getByRole('heading', { name: 'Claude · limity konta' })).toBeTruthy();
  });
  it('removes a tile with its X, leaving an empty cell that offers what is missing, and a pick fills it', async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(screen.getByRole('button', { name: 'Wyłącz kafelek: Poczta' }));
    expect(cell('mail')).toBeNull();
    expect(at('cezar')).toMatchObject({ w: 2, h: 2 }); // the first change keeps the arrangement as it was
    const empty = grid().querySelector('.wk-empty') as HTMLElement;
    expect(empty).toBeTruthy();
    const offer = within(empty).getAllByRole('button').map(b => b.getAttribute('aria-label'));
    expect(offer).toEqual(['Dodaj kafelek: Poczta', 'Dodaj kafelek: Komputer', 'Dodaj kafelek: Konto', 'Dodaj kafelek: Smart Actions', 'Dodaj kafelek: GitHub PR', 'Dodaj kafelek: OpenRouter', 'Dodaj kafelek: Zadania']); // not what already stands on the grid, except what may repeat
    await user.click(within(empty).getByRole('button', { name: 'Dodaj kafelek: Komputer' }));
    expect(await screen.findByRole('region', { name: 'Komputer' })).toBeTruthy();
    expect(at('system')).toMatchObject({ w: 1, h: 1 });
    expect(grid().querySelector('.wk-empty')).toBeNull();
  });
  it('keeps the arrangement across a reload', async () => {
    arrange(t('mail', 0, 0, 1, 2), t('cezar', 1, 0, 3, 2));
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(grid().querySelectorAll('.wk-cell')).toHaveLength(2);
    expect(cell('mail').getAttribute('style')).toContain('--h: 2');
    expect(cell('cezar').getAttribute('style')).toContain('--w: 3');
    expect(screen.queryByRole('region', { name: 'Claude' })).toBeNull();
  });
  it('an empty grid offers everything, as a row of icons whose name shows under them', async () => {
    arrange();
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('group', { name: 'Obszar roboczy' });
    expect(grid().querySelectorAll('.wk-empty')).toHaveLength(8);
    const first = grid().querySelector('.wk-empty') as HTMLElement;
    expect(within(first).getAllByRole('button').map(b => b.getAttribute('aria-label'))).toEqual([
      'Dodaj kafelek: Claude', 'Dodaj kafelek: Codex', 'Dodaj kafelek: Gemini', 'Dodaj kafelek: Cezar', 'Dodaj kafelek: Poczta', 'Dodaj kafelek: Komputer', 'Dodaj kafelek: Konto', 'Dodaj kafelek: Smart Actions', 'Dodaj kafelek: GitHub PR', 'Dodaj kafelek: OpenRouter', 'Dodaj kafelek: Zadania']);
    expect(within(first).getByText('Wybierz kafelek')).toBeTruthy();
    await user.hover(within(first).getByRole('button', { name: 'Dodaj kafelek: Cezar' }));
    expect(within(first).getByText('Cezar')).toBeTruthy();
  });
  it('does not offer a limit that the settings switched off, and drops its tile', async () => {
    const user = userEvent.setup();
    renderWith();
    await screen.findByRole('button', { name: /^Codex: 5h/ });
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    await user.click(screen.getByRole('checkbox', { name: 'ChatGPT / Codex' }));
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    await screen.findByRole('region', { name: 'Poczta' });
    expect(screen.queryByRole('region', { name: 'Codex' })).toBeNull();
    // Four cells hold Claude, Gemini and mail beside Cezar; the one the Codex tile left is empty and does not offer it.
    const empty = grid().querySelector('.wk-empty') as HTMLElement;
    expect(empty).toBeTruthy();
    expect(within(empty).queryByRole('button', { name: 'Dodaj kafelek: Codex' })).toBeNull();
    expect(within(empty).getByRole('button', { name: 'Dodaj kafelek: Komputer' })).toBeTruthy();
  });
  it('the settings can forget the arrangement', async () => {
    const user = userEvent.setup();
    arrange(t('mail', 0, 0));
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    await user.click(screen.getByRole('button', { name: 'Przywróć domyślny układ kafelków' }));
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
    expect(screen.getByText(/wróci do domyślnego/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Przejdź do pulpitu' }));
    expect(await screen.findByRole('region', { name: 'Cezar' })).toBeTruthy();
  });
});

describe('arranging with the pointer', () => {
  it('stretching a tile over another asks it to move to a free cell', async () => {
    arrange(t('quota:Claude', 0, 0), t('quota:Codex', 1, 0));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Claude' });
    fireEvent.pointerDown(cell('quota:Claude').querySelector('.wk-rz.r')!, { button: 0, clientX: 300, clientY: 70 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 70 }); // the right edge is now two cells from the left
    expect(within(cell('quota:Claude')).getByText('2×1')).toBeTruthy(); // the size is shown while the edge is held
    fireEvent.pointerUp(window, { clientX: 600, clientY: 70 });
    expect(within(cell('quota:Claude')).queryByText('2×1')).toBeNull();
    expect(at('quota:Claude')).toMatchObject({ c: 0, r: 0, w: 2, h: 1 });
    expect(at('quota:Codex')).toMatchObject({ c: 2, r: 0 });
  });
  it('stretching down takes the row below; a tile there steps aside', async () => {
    arrange(t('mail', 0, 0), t('quota:Codex', 0, 1));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    fireEvent.pointerDown(cell('mail').querySelector('.wk-rz.b')!, { button: 0, clientX: 150, clientY: 140 });
    fireEvent.pointerMove(window, { clientX: 150, clientY: 290 });
    fireEvent.pointerUp(window, { clientX: 150, clientY: 290 });
    expect(at('mail')).toMatchObject({ w: 1, h: 2 });
    expect(at('quota:Codex')).toMatchObject({ c: 1, r: 1 }); // the nearest free cell: right beside where it stood
  });
  it('says so when a tile cannot grow because nothing else has anywhere to go', async () => {
    arrange(t('quota:Claude', 0, 0), t('quota:Codex', 1, 0), t('cezar', 2, 0, 2, 2), t('mail', 0, 1), t('system', 1, 1));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Cezar' });
    fireEvent.pointerDown(cell('quota:Claude').querySelector('.wk-rz.r')!, { button: 0, clientX: 300, clientY: 70 });
    fireEvent.pointerMove(window, { clientX: 600, clientY: 70 });
    fireEvent.pointerUp(window, { clientX: 600, clientY: 70 });
    expect(await screen.findByText(/Nie ma miejsca: sąsiednie kafelki/)).toBeTruthy();
    expect(at('quota:Claude')).toMatchObject({ w: 1, h: 1 });
  });
  it('dropping a tile on another swaps them', async () => {
    arrange(t('mail', 0, 0), t('quota:Codex', 1, 0));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    fireEvent.pointerDown(cell('mail').querySelector('.wk-grip')!, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 50 });
    expect(grid().querySelector('.wk-hl.ok')).toBeTruthy(); // where it would land, before it is let go
    fireEvent.pointerUp(window, { clientX: 400, clientY: 50 });
    expect(at('mail')).toMatchObject({ c: 1, r: 0 });
    expect(at('quota:Codex')).toMatchObject({ c: 0, r: 0 });
    expect(grid().querySelector('.wk-hl')).toBeNull();
  });
  it('dropping into an empty cell moves the tile and leaves its old cell empty', async () => {
    arrange(t('mail', 0, 0));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    fireEvent.pointerDown(cell('mail').querySelector('.wk-grip')!, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 1000, clientY: 200 });
    fireEvent.pointerUp(window, { clientX: 1000, clientY: 200 });
    expect(at('mail')).toMatchObject({ c: 3, r: 1 });
    expect(grid().querySelectorAll('.wk-empty')).toHaveLength(7);
  });
  it('says so, and changes nothing, when a drop leaves a tile without a place', async () => {
    arrange(t('quota:Claude', 0, 0, 1, 2), t('cezar', 1, 0, 3, 2));
    measureGrid();
    renderWith();
    await screen.findByRole('region', { name: 'Cezar' });
    fireEvent.pointerDown(cell('quota:Claude').querySelector('.wk-grip')!, { button: 0, clientX: 100, clientY: 50 });
    fireEvent.pointerMove(window, { clientX: 400, clientY: 50 });
    expect(grid().querySelector('.wk-hl.bad')).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: 400, clientY: 50 });
    expect(await screen.findByRole('status', { name: '' })).toBeTruthy();
    expect(screen.getByText(/Nie ma tam miejsca/)).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(WORKSPACE_KEY)!).tiles).toEqual([t('quota:Claude', 0, 0, 1, 2), t('cezar', 1, 0, 3, 2)]);
  });
});

describe('a layout saved before tiles had ids', () => {
  it('is drawn as it was and gets an id per tile (the kind) with the first change', async () => {
    const user = userEvent.setup();
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles: [{ kind: 'cezar', c: 2, r: 0, w: 2, h: 2 }, { kind: 'mail', c: 0, r: 0, w: 1, h: 1 }, { kind: 'system', c: 1, r: 0, w: 1, h: 1 }] }));
    renderWith();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(grid().querySelectorAll('.wk-cell')).toHaveLength(3);
    expect(cell('mail').getAttribute('data-tile')).toBe('mail');
    await user.click(screen.getByRole('button', { name: 'Wyłącz kafelek: Komputer' }));
    expect(arranged()).toEqual([
      { id: 'cezar', kind: 'cezar', c: 2, r: 0, w: 2, h: 2 }, { id: 'mail', kind: 'mail', c: 0, r: 0, w: 1, h: 1 },
    ]);
  });
});
