import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch } from './test-fixtures';
import { WORKSPACE_KEY } from './tile-grid';
import { MAX_PULPITS, PULPITS_KEY, addPulpit, defaultPulpits, savePulpits, workspaceKey, type PulpitState } from './pulpits';

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-14T10:00:00Z').getTime());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(scenarioFetch('standard')));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const grid = () => document.querySelector('.wk-grid') as HTMLElement;
const tiles = () => grid().querySelectorAll('.wk-cell').length;
const menu = () => screen.getByRole('button', { name: /^Pulpity:/ });
const saved = () => JSON.parse(localStorage.getItem(PULPITS_KEY)!);
/** Desktops saved before the panel opens (the rules themselves are in pulpits.test.ts), `active` open; each new one is empty. */
function seed(count: number, active = 'p2'): PulpitState {
  let state = defaultPulpits();
  for (let i = 2; i <= count; i++) { state = addPulpit(state, `p${i}`); localStorage.setItem(workspaceKey(`p${i}`), JSON.stringify({ version: 1, tiles: [] })); }
  state = { ...state, active };
  savePulpits(state);
  return state;
}
async function panel() {
  const user = userEvent.setup();
  const view = render(<App />);
  await screen.findByRole('button', { name: /^Pulpity:/ });
  return { user, ...view };
}

// The panel wires the menu to the desktop rules and to each desktop's own arrangement; the rules (names, limit, which one
// opens after a removal) are tested on the functions in pulpits.test.ts.
describe('virtual desktops in the panel', () => {
  it('a new desktop starts empty, is arranged apart from the first, and stays open after a reload', async () => {
    const { user, unmount } = await panel();
    await screen.findByRole('region', { name: 'Poczta' });
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Główny');
    expect(menu().textContent).toBe(''); // the only desktop shows no name
    expect(tiles()).toBe(5);
    await user.click(menu());
    expect(screen.queryByRole('button', { name: /^Usuń:/ })).toBeNull(); // a single desktop cannot go
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    expect(screen.queryByRole('dialog', { name: 'Pulpity' })).toBeNull(); // picking closes the menu
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Pulpit 2');
    expect(tiles()).toBe(0);
    await user.click(grid().querySelector('.wk-empty button') as HTMLElement); // the first offer fills the empty cell
    expect(JSON.parse(localStorage.getItem(workspaceKey(saved().active))!).tiles).toHaveLength(1);
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull(); // the first desktop is still automatic, nothing was written to it
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Główny' }));
    expect(tiles()).toBe(5);
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Pulpit 2' }));
    unmount();
    render(<App />);
    await screen.findByRole('button', { name: 'Pulpity: Pulpit 2' });
    expect(tiles()).toBe(1);
  });
  it('renames with Enter and drops the change on Escape; deleting takes a second tap and forgets the layout', async () => {
    seed(2);
    const { user } = await panel();
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę: Pulpit 2' }));
    await user.clear(screen.getByLabelText('Nazwa pulpitu'));
    await user.type(screen.getByLabelText('Nazwa pulpitu'), 'AI{Enter}');
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę: AI' }));
    await user.type(screen.getByLabelText('Nazwa pulpitu'), 'x{Escape}');
    expect(screen.getByRole('dialog', { name: 'Pulpity' })).toBeTruthy(); // Escape ended the editing only
    expect(menu().textContent).toBe('AI');
    expect(saved().items.map((p: { name: string }) => p.name)).toEqual(['Główny', 'AI']);
    await user.click(screen.getByRole('button', { name: 'Usuń: AI' }));
    expect(saved().items).toHaveLength(2); // the first tap only asks
    await user.click(screen.getByRole('button', { name: 'Usunąć?' }));
    expect(saved().items).toHaveLength(1);
    expect(localStorage.getItem(workspaceKey('p2'))).toBeNull();
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Główny');
    expect(tiles()).toBe(5);
  });
  it('offers no new desktop at the limit', async () => {
    seed(MAX_PULPITS);
    const { user } = await panel();
    await user.click(menu());
    expect((screen.getByRole('button', { name: /Nowy pulpit/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it('the menu is only on the home page', async () => {
    const { user } = await panel();
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.queryByRole('button', { name: /^Pulpity:/ })).toBeNull();
  });
  it('Settings resets the open desktop only: a new one to empty, the first one untouched', async () => {
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles: [{ kind: 'mail', c: 0, r: 0, w: 1, h: 1 }] }));
    seed(2);
    localStorage.setItem(workspaceKey('p2'), JSON.stringify({ version: 1, tiles: [{ kind: 'mail', c: 0, r: 0, w: 1, h: 1 }] }));
    const { user } = await panel();
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    await user.click(screen.getByRole('button', { name: 'Przywróć domyślny układ kafelków' }));
    expect(JSON.parse(localStorage.getItem(workspaceKey('p2'))!).tiles).toEqual([]);
    expect(localStorage.getItem(WORKSPACE_KEY)).not.toBeNull(); // the other desktop was left alone
  });
});
