import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch, type ScenarioName } from './test-fixtures';
import { WORKSPACE_KEY, type Tile } from './tile-grid';

const now = new Date('2026-10-14T10:00:00Z').getTime();
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(now);
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const A = 'l-1a2b3c4d', B = 'l-5e6f7a8b'; // "Do poprawy - Chat Agy" and "Dom" in the standard scenario
const todo = (n: number, c: number, r: number, w: number, h: number, config?: Tile['config']): Tile => ({ id: `todo#${n}`, kind: 'todo', c, r, w, h, ...(config ? { config } : {}) });
const arrange = (...tiles: Tile[]) => localStorage.setItem(WORKSPACE_KEY, JSON.stringify({ version: 1, tiles }));
const arranged = (): Tile[] => JSON.parse(localStorage.getItem(WORKSPACE_KEY)!).tiles;
const grid = () => document.querySelector('.wk-grid') as HTMLElement;
const tileOf = (id: string) => grid().querySelector(`[data-tile="${id}"]`) as HTMLElement;

function renderApp(scenario: ScenarioName = 'standard') {
  const fetcher = vi.fn(scenarioFetch(scenario));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  /** What the screen asked the server to change, in order. */
  const posts = () => fetcher.mock.calls
    .filter(([url, init]) => init?.method === 'POST' && String(url).endsWith('/api/todos/action'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
  return { fetcher, posts };
}
const titles = (tile: HTMLElement) => [...tile.querySelectorAll('.todo-row .todo-text')].map(x => x.textContent);

describe('the Zadania tile', () => {
  it('shows its list: open tasks first, done ones struck through at the end, notes, who added what, and a count', async () => {
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(titles(tile)).toEqual(['Agent nie wie, ile ma limitu na dziś', 'Odpowiedź bez sformułowania „nie mam dostępu”', 'Komunikat o pustej odpowiedzi']);
    expect((within(tile).getByRole('checkbox', { name: 'Komunikat o pustej odpowiedzi' }) as HTMLInputElement).checked).toBe(true);
    expect((within(tile).getByRole('checkbox', { name: 'Odpowiedź bez sformułowania „nie mam dostępu”' }) as HTMLInputElement).checked).toBe(false);
    expect(within(tile).getByText('Dodać limity AI do widoku dla agenta.')).toBeTruthy(); // the note
    expect(within(tile).getAllByText('agent')).toHaveLength(1); // only what the agent added is marked
    expect(within(tile).getByTitle('Ukończone z wszystkich').textContent).toBe('1/3');
    const select = within(tile).getByRole('combobox', { name: 'Lista zadań' }) as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(['Do poprawy - Chat Agy', 'Dom', '＋ Nowa lista…']);
    expect(select.value).toBe(A);
  });

  it('follows the list set in its settings, falls back to the first when that list is gone, and switches by the drop-down', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: 'l-deadbeef' }), todo(2, 2, 0, 2, 2, { list: B }));
    renderApp();
    await within(tileOf('todo#2')).findByText('Kupić żarówki do przedpokoju');
    expect(titles(tileOf('todo#1')).at(0)).toBe('Agent nie wie, ile ma limitu na dziś'); // the first list
    await user.selectOptions(within(tileOf('todo#1')).getByRole('combobox', { name: 'Lista zadań' }), 'Dom');
    expect(titles(tileOf('todo#1'))).toEqual(['Kupić żarówki do przedpokoju']);
    expect(arranged().find(t => t.id === 'todo#1')!.config).toEqual({ list: B });
    expect(arranged().find(t => t.id === 'todo#2')!.config).toEqual({ list: B }); // the other tile did not move
  });

  it('hides what is done with "Ukryj ukończone", per tile, and remembers it in the layout', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }), todo(2, 2, 0, 2, 2, { list: A }));
    renderApp();
    const [first, second] = [tileOf('todo#1'), tileOf('todo#2')];
    await within(first).findByText('Komunikat o pustej odpowiedzi');
    await user.click(within(first).getByRole('checkbox', { name: 'Ukryj ukończone' }));
    expect(titles(first)).not.toContain('Komunikat o pustej odpowiedzi');
    expect(titles(second)).toContain('Komunikat o pustej odpowiedzi'); // each tile has its own
    expect(arranged().find(t => t.id === 'todo#1')!.config).toEqual({ list: A, hideDone: true });
    expect(arranged().find(t => t.id === 'todo#2')!.config).toEqual({ list: A });
    await user.click(within(first).getByRole('checkbox', { name: 'Ukryj ukończone' }));
    expect(titles(first)).toContain('Komunikat o pustej odpowiedzi');
    expect(arranged().find(t => t.id === 'todo#1')!.config).toEqual({ list: A });
  });

  it('is named after its list, so two tiles can be told apart', async () => {
    arrange(todo(1, 0, 0, 2, 2, { list: A }), todo(2, 2, 0, 2, 2, { list: B }));
    renderApp();
    await within(tileOf('todo#2')).findByText('Kupić żarówki do przedpokoju');
    expect(screen.getByRole('button', { name: 'Wyłącz kafelek: Zadania · Do poprawy - Chat Agy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyłącz kafelek: Zadania · Dom' })).toBeTruthy();
  });

  it('adds a task with Enter (the user is the author), clears the field, and refuses an empty one', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    const field = within(tile).getByRole('textbox', { name: 'Nowe zadanie' }) as HTMLInputElement;
    expect((within(tile).getByRole('button', { name: 'Dodaj zadanie' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(field, '   {Enter}');
    expect(posts()).toEqual([]);
    await user.type(field, 'Zadzwonić do mamy{Enter}');
    expect(posts()).toEqual([{ action: 'addTask', list: A, title: 'Zadzwonić do mamy' }]);
    expect(field.value).toBe('');
    expect(await within(tile).findByText('Zadzwonić do mamy')).toBeTruthy();
    expect(titles(tile).indexOf('Zadzwonić do mamy')).toBe(2); // after the other open ones, before the done one
  });

  it('ticks a task at once and writes it, and unticks a done one', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    const box = await within(tile).findByRole('checkbox', { name: 'Agent nie wie, ile ma limitu na dziś' }) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(true);
    expect(within(tile).getByTitle('Ukończone z wszystkich').textContent).toBe('2/3');
    expect(posts()).toEqual([{ action: 'updateTask', task: 't-a0000001', done: true }]);
    await user.click(within(tile).getByRole('checkbox', { name: 'Komunikat o pustej odpowiedzi' }));
    expect(posts().at(-1)).toEqual({ action: 'updateTask', task: 't-a0000003', done: false });
    await waitFor(() => expect(within(tile).getByTitle('Ukończone z wszystkich').textContent).toBe('1/3'));
    // The server's state is what stays: the first task is done there, so it moved below the open ones.
    expect(titles(tile)).toEqual(['Odpowiedź bez sformułowania „nie mam dostępu”', 'Komunikat o pustej odpowiedzi', 'Agent nie wie, ile ma limitu na dziś']);
  });

  it('edits the title and the note in place, saving only what changed, and Escape drops the edit', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await user.click(await within(tile).findByRole('button', { name: 'Edytuj zadanie: Odpowiedź bez sformułowania „nie mam dostępu”' }));
    const title = within(tile).getByRole('textbox', { name: 'Tytuł zadania' });
    await user.clear(title);
    await user.type(title, 'Odpowiedź bez „nie mam dostępu”{Escape}');
    expect(posts()).toEqual([]);
    expect(within(tile).queryByRole('textbox', { name: 'Tytuł zadania' })).toBeNull();
    expect(titles(tile)).toContain('Odpowiedź bez sformułowania „nie mam dostępu”');
    await user.click(within(tile).getByRole('button', { name: 'Edytuj zadanie: Odpowiedź bez sformułowania „nie mam dostępu”' }));
    await user.clear(within(tile).getByRole('textbox', { name: 'Tytuł zadania' }));
    await user.type(within(tile).getByRole('textbox', { name: 'Tytuł zadania' }), 'Krótszy tytuł');
    await user.type(within(tile).getByRole('textbox', { name: 'Notatka do zadania' }), 'z notatką');
    await user.click(within(tile).getByRole('button', { name: 'Zapisz' }));
    expect(posts()).toEqual([{ action: 'updateTask', task: 't-a0000002', title: 'Krótszy tytuł', note: 'z notatką' }]);
    expect(await within(tile).findByText('z notatką')).toBeTruthy();
    expect(titles(tile)).toContain('Krótszy tytuł');
  });

  it('deletes a task only on the second tap', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await user.click(await within(tile).findByRole('button', { name: 'Usuń zadanie: Komunikat o pustej odpowiedzi' }));
    expect(posts()).toEqual([]);
    await user.click(within(tile).getByRole('button', { name: 'Usunąć?' }));
    expect(posts()).toEqual([{ action: 'deleteTask', task: 't-a0000003' }]);
    await waitFor(() => expect(titles(tile)).not.toContain('Komunikat o pustej odpowiedzi'));
  });

  it('manages lists from the menu: new, rename, clear done, delete (after a second tap)', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Komunikat o pustej odpowiedzi');
    const menu = async () => { await user.click(within(tile).getByRole('button', { name: 'Zarządzaj listą' })); return within(tile).getByRole('menu', { name: 'Lista zadań' }); };

    // Rename: Enter saves, and Escape would not.
    await user.click(within(await menu()).getByRole('menuitem', { name: /Zmień nazwę/ }));
    const rename = within(tile).getByRole('textbox', { name: 'Nazwa listy' }) as HTMLInputElement;
    expect(rename.value).toBe('Do poprawy - Chat Agy');
    await user.clear(rename);
    await user.type(rename, 'Poprawki agenta{Enter}');
    expect(posts()).toEqual([{ action: 'renameList', list: A, name: 'Poprawki agenta' }]);
    await waitFor(() => expect((within(tile).getByRole('combobox', { name: 'Lista zadań' }) as HTMLSelectElement).selectedOptions[0].textContent).toBe('Poprawki agenta'));

    // Clear done: the item says how many, and removes them.
    await user.click(within(await menu()).getByRole('menuitem', { name: /Wyczyść ukończone \(1\)/ }));
    expect(posts().at(-1)).toEqual({ action: 'clearDone', list: A });
    await waitFor(() => expect(titles(tile)).not.toContain('Komunikat o pustej odpowiedzi'));
    expect((within(await menu()).getByRole('menuitem', { name: /Wyczyść ukończone \(0\)/ }) as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Escape}');

    // Delete: the first tap only asks, the second deletes; the tile moves on to the next list.
    await user.click(within(await menu()).getByRole('menuitem', { name: 'Usuń listę' }));
    expect(posts().filter(p => p.action === 'deleteList')).toEqual([]);
    await user.click(within(tile).getByRole('menuitem', { name: /Usunąć listę z 2 zad\.\?/ }));
    expect(posts().at(-1)).toEqual({ action: 'deleteList', list: A });
    await waitFor(() => expect(titles(tile)).toEqual(['Kupić żarówki do przedpokoju']));
  });

  it('creates a list from the drop-down and shows it at once; Escape cancels the name', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Komunikat o pustej odpowiedzi');
    const select = () => within(tile).getByRole('combobox', { name: 'Lista zadań' });
    await user.selectOptions(select(), '＋ Nowa lista…');
    await user.type(within(tile).getByRole('textbox', { name: 'Nazwa nowej listy' }), 'Odrzucona{Escape}');
    expect(posts()).toEqual([]);
    expect(within(tile).queryByRole('textbox', { name: 'Nazwa nowej listy' })).toBeNull();
    await user.selectOptions(select(), '＋ Nowa lista…');
    await user.type(within(tile).getByRole('textbox', { name: 'Nazwa nowej listy' }), 'Praca{Enter}');
    expect(posts()).toEqual([{ action: 'createList', name: 'Praca' }]);
    expect(await within(tile).findByText('Brak zadań na tej liście.')).toBeTruthy();
    expect((select() as HTMLSelectElement).selectedOptions[0].textContent).toBe('Praca');
    expect(arranged()[0].config!.list).toMatch(/^l-[0-9a-f]{8}$/);
  });

  it('says why the server refused a change, and the message can be closed', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Komunikat o pustej odpowiedzi');
    await user.click(within(tile).getByRole('button', { name: 'Zarządzaj listą' }));
    await user.click(within(tile).getByRole('menuitem', { name: /Zmień nazwę/ }));
    const rename = within(tile).getByRole('textbox', { name: 'Nazwa listy' });
    await user.clear(rename);
    await user.type(rename, 'dom{Enter}'); // the other list has this name (case does not matter)
    expect((await within(tile).findByRole('alert')).textContent).toContain('Lista o takiej nazwie już jest.');
    await user.click(within(tile).getByRole('button', { name: 'Zamknij komunikat' }));
    expect(within(tile).queryByRole('alert')).toBeNull();
  });

  it('with no list asks to create the first one, and is told so while loading and when the server is out', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 2, 2));
    renderApp('empty');
    const tile = tileOf('todo#1');
    expect(await within(tile).findByText('Nie ma jeszcze żadnej listy.')).toBeTruthy();
    await user.click(within(tile).getByRole('button', { name: 'Utwórz listę' }));
    await user.type(within(tile).getByRole('textbox', { name: 'Nazwa nowej listy' }), 'Pierwsza{Enter}');
    expect(await within(tile).findByText('Brak zadań na tej liście.')).toBeTruthy();
    cleanup();
    arrange(todo(1, 0, 0, 2, 2));
    renderApp('offline');
    expect(await within(tileOf('todo#1')).findByText(/Zadania są niedostępne|Nie można połączyć się z lokalnym serwerem|Ładowanie zadań/)).toBeTruthy();
  });

  it('shows what is left when everything is done and hidden', async () => {
    arrange(todo(1, 0, 0, 2, 2, { list: A, hideDone: true }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    const user = userEvent.setup();
    await user.click(await within(tile).findByRole('checkbox', { name: 'Agent nie wie, ile ma limitu na dziś' }));
    await user.click(within(tile).getByRole('checkbox', { name: 'Odpowiedź bez sformułowania „nie mam dostępu”' }));
    expect(posts()).toHaveLength(2);
    expect(await within(tile).findByText('Wszystkie zadania są ukończone.')).toBeTruthy();
  });

  it('in a tile of one cell leaves out notes and authors, and stays usable', async () => {
    const user = userEvent.setup();
    arrange(todo(1, 0, 0, 1, 1, { list: A }));
    const { posts } = renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(within(tile).queryByText('Dodać limity AI do widoku dla agenta.')).toBeNull();
    expect(within(tile).queryByText('agent')).toBeNull();
    // The field is not there until it is asked for, so the tasks have the room.
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull();
    await user.click(within(tile).getByRole('button', { name: 'Pokaż pole nowego zadania' }));
    await user.type(within(tile).getByRole('textbox', { name: 'Nowe zadanie' }), 'Mały kafelek{Enter}');
    expect(posts()).toEqual([{ action: 'addTask', list: A, title: 'Mały kafelek' }]);
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull(); // folded again after adding
    await user.click(within(tile).getByRole('button', { name: 'Pokaż pole nowego zadania' }));
    await user.keyboard('{Escape}');
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull();
  });
});

describe('putting Zadania on the grid', () => {
  it('is offered in every empty cell, again and again, and each tile gets its own id', async () => {
    const user = userEvent.setup();
    arrange();
    renderApp();
    await screen.findByRole('group', { name: 'Obszar roboczy' });
    const first = () => grid().querySelector('.wk-empty') as HTMLElement;
    await user.click(within(first()).getByRole('button', { name: 'Dodaj kafelek: Zadania' }));
    expect(arranged().map(t => t.id)).toEqual(['todo#1']);
    await user.click(within(first()).getByRole('button', { name: 'Dodaj kafelek: Zadania' })); // still on offer
    expect(arranged().map(t => [t.id, t.kind])).toEqual([['todo#1', 'todo'], ['todo#2', 'todo']]);
    expect(grid().querySelectorAll('[data-kind="todo"]')).toHaveLength(2);
    await user.click(screen.getAllByRole('button', { name: /^Wyłącz kafelek: Zadania/ })[0]);
    expect(arranged().map(t => t.id)).toEqual(['todo#2']);
  });

  it('is switched off with the section in the settings: the tile leaves and is not offered', async () => {
    arrange(todo(1, 0, 0, 2, 2));
    localStorage.setItem('desk-panel.layout', JSON.stringify({ version: 2, widgets: ['cezar', 'system', 'calendar', 'training', 'quotas', 'breakdown', 'insights', 'mail', 'todo'].map(id => ({ id, visible: id !== 'todo', displayMode: 'expanded', priority: 'normal' })) }));
    renderApp();
    await screen.findByRole('group', { name: 'Obszar roboczy' });
    expect(grid().querySelector('[data-kind="todo"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dodaj kafelek: Zadania' })).toBeNull();
  });
});

describe('changes made elsewhere', () => {
  it('appear on the screen within seconds: what the agent adds is read again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    arrange(todo(1, 0, 0, 2, 2, { list: A }));
    const { fetcher } = renderApp();
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(titles(tile)).toHaveLength(3);
    // Somebody else (the chat agent) adds a task through the same API.
    await fetcher('/api/todos/action', { method: 'POST', body: JSON.stringify({ action: 'addTask', list: A, title: 'Dodane przez agenta', by: 'agent' }) });
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    expect(await within(tile).findByText('Dodane przez agenta')).toBeTruthy();
    expect(titles(tile)).toHaveLength(4);
  });
});
