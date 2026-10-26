import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch } from './test-fixtures';
import { WORKSPACE_KEY } from './tile-grid';
import { PULPITS_KEY, workspaceKey } from './pulpits';

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

describe('virtual desktops in the panel', () => {
  it('has one desktop to begin with: the button shows no name and the tiles are the automatic ones', async () => {
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Główny');
    expect(menu().textContent).toBe('');
    expect(tiles()).toBe(5);
  });
  it('a new desktop is empty, the first keeps its tiles, and the choice survives a reload', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    expect(screen.queryByRole('dialog', { name: 'Pulpity' })).toBeNull(); // picking closes the menu
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Pulpit 2');
    expect(tiles()).toBe(0);
    expect(grid().querySelectorAll('.wk-empty').length).toBeGreaterThan(0);
    const id = saved().active;
    expect(JSON.parse(localStorage.getItem(workspaceKey(id))!).tiles).toEqual([]);
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Główny' }));
    expect(tiles()).toBe(5);
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull(); // the first desktop is still automatic, nothing was written to it
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Pulpit 2' }));
    unmount();
    render(<App />);
    await screen.findByRole('button', { name: 'Pulpity: Pulpit 2' });
    expect(tiles()).toBe(0);
  });
  it('arranging one desktop does not touch another', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    await user.click(grid().querySelector('.wk-empty button') as HTMLElement); // the first offer fills the empty cell
    expect(tiles()).toBe(1);
    const id = saved().active;
    expect(JSON.parse(localStorage.getItem(workspaceKey(id))!).tiles).toHaveLength(1);
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Główny' }));
    expect(tiles()).toBe(5);
  });
  it('renames a desktop with Enter, drops the change on Escape and shows the name on the button', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę: Pulpit 2' }));
    await user.clear(screen.getByLabelText('Nazwa pulpitu'));
    await user.type(screen.getByLabelText('Nazwa pulpitu'), 'AI{Enter}');
    expect(screen.getByRole('button', { name: 'AI' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Zmień nazwę: AI' }));
    await user.type(screen.getByLabelText('Nazwa pulpitu'), 'xyz{Escape}');
    expect(screen.getByRole('button', { name: 'AI' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Pulpity' })).toBeTruthy(); // Escape ended the editing only
    expect(menu().textContent).toBe('AI');
    expect(saved().items.map((p: { name: string }) => p.name)).toEqual(['Główny', 'AI']);
  });
  it('deleting takes a second tap, forgets the layout and cannot remove the last desktop', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(menu());
    expect(screen.queryByRole('button', { name: /^Usuń:/ })).toBeNull(); // a single desktop cannot go
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    const id = saved().active;
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: 'Usuń: Pulpit 2' }));
    expect(saved().items).toHaveLength(2); // first tap only asks
    await user.click(screen.getByRole('button', { name: 'Usunąć?' }));
    expect(saved().items).toHaveLength(1);
    expect(localStorage.getItem(workspaceKey(id))).toBeNull();
    expect(menu().getAttribute('aria-label')).toBe('Pulpity: Główny');
    expect(tiles()).toBe(5);
  });
  it('stops offering new desktops at the limit', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    for (let i = 0; i < 7; i++) {
      await user.click(menu());
      await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    }
    await user.click(menu());
    expect(saved().items).toHaveLength(8);
    expect((screen.getByRole('button', { name: /Nowy pulpit/ }) as HTMLButtonElement).disabled).toBe(true);
  }, 15000);
  it('the menu is only on the home page', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    expect(screen.queryByRole('button', { name: /^Pulpity:/ })).toBeNull();
  });
  it('Settings resets the open desktop only: the first one to automatic, a new one to empty', async () => {
    const user = userEvent.setup();
    localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles: [{ kind: 'mail', c: 0, r: 0, w: 1, h: 1 }] }));
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    await user.click(menu());
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    await user.click(grid().querySelector('.wk-empty button') as HTMLElement);
    const id = saved().active;
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' }));
    await user.click(screen.getByRole('button', { name: 'Przywróć domyślny układ kafelków' }));
    expect(JSON.parse(localStorage.getItem(workspaceKey(id))!).tiles).toEqual([]);
    expect(localStorage.getItem(WORKSPACE_KEY)).not.toBeNull(); // the other desktop was left alone
  });
});
