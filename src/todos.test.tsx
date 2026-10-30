import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch, type ScenarioName } from './test-fixtures';
import { useState } from 'react';
import { TodoTile } from './TodoTile';
import { WORKSPACE_KEY, configure, type Tile } from './tile-grid';
import { FakeSource } from './chat.test-kit';
import { useTodos } from './useTodos';

// Preload the lazy chat bundle, as in chat-pointing.test.tsx, outside interaction timeouts.
beforeAll(() => import('./ChatWindow'), 60_000);
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
const tileOf = (id: string) => document.querySelector(`[data-tile="${id}"]`) as HTMLElement;

function stubServer(scenario: ScenarioName) {
  const fetcher = vi.fn(scenarioFetch(scenario));
  vi.stubGlobal('fetch', fetcher);
  /** What the screen asked the server to change, in order. */
  const posts = () => fetcher.mock.calls
    .filter(([url, init]) => init?.method === 'POST' && String(url).endsWith('/api/todos/action'))
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)) as Record<string, unknown>);
  return { fetcher, posts };
}
/** The whole panel, for how the tile stands on the grid. */
function renderApp(scenario: ScenarioName = 'standard') {
  const server = stubServer(scenario);
  render(<App />);
  return server;
}
/**
 * The tiles alone, with the hook and the scenario API the panel gives them and their settings kept as the grid keeps
 * them (`configure`): the panel around them costs a second a test and adds nothing to what the tile does.
 */
function renderTiles(tiles: Tile[], scenario: ScenarioName = 'standard') {
  const server = stubServer(scenario);
  let kept = tiles;
  function Tiles() {
    const todos = useTodos();
    const [shown, setShown] = useState(tiles);
    return <>{shown.map(tile => <div key={tile.id} data-tile={tile.id}>
      <TodoTile todos={todos} config={tile.config} wide={tile.w > 1} tall={tile.h > 1}
        setConfig={patch => setShown(now => (kept = configure(now, tile.id, patch)))} />
    </div>)}</>;
  }
  render(<Tiles />);
  return { ...server, config: (id: string) => kept.find(tile => tile.id === id)!.config };
}
const titles = (tile: HTMLElement) => [...tile.querySelectorAll('.todo-row .todo-text')].map(x => x.textContent);

describe('the Zadania tile', () => {
  it('shows its list: open tasks first, done ones struck through at the end, notes, and a count; nobody is marked as the author unless asked', async () => {
    renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(titles(tile)).toEqual(['Agent nie wie, ile ma limitu na dziś', 'Odpowiedź bez sformułowania „nie mam dostępu”', 'Komunikat o pustej odpowiedzi']);
    expect((within(tile).getByRole('checkbox', { name: 'Komunikat o pustej odpowiedzi' }) as HTMLInputElement).checked).toBe(true);
    expect((within(tile).getByRole('checkbox', { name: 'Odpowiedź bez sformułowania „nie mam dostępu”' }) as HTMLInputElement).checked).toBe(false);
    expect(within(tile).getByText('Dodać limity AI do widoku dla agenta.')).toBeTruthy(); // the note
    expect(within(tile).queryByRole('img', { name: 'Dodał agent czatu' })).toBeNull(); // the agent mark is off until the list asks for it
    expect(within(tile).getByTitle('Ukończone z wszystkich').textContent).toBe('1/3');
    const select = within(tile).getByRole('combobox', { name: 'Lista zadań' }) as HTMLSelectElement;
    expect([...select.options].map(o => o.textContent)).toEqual(['Do poprawy - Chat Agy', 'Dom', '＋ Nowa lista…']);
    expect(select.value).toBe(A);
  });

  it('follows the list set in its settings, falls back to the first when that list is gone, and switches by the drop-down', async () => {
    const user = userEvent.setup();
    const { config } = renderTiles([todo(1, 0, 0, 2, 2, { list: 'l-deadbeef' }), todo(2, 2, 0, 2, 2, { list: B })]);
    await within(tileOf('todo#2')).findByText('Kupić żarówki do przedpokoju');
    expect(titles(tileOf('todo#1')).at(0)).toBe('Agent nie wie, ile ma limitu na dziś'); // the first list
    await user.selectOptions(within(tileOf('todo#1')).getByRole('combobox', { name: 'Lista zadań' }), 'Dom');
    expect(titles(tileOf('todo#1'))).toEqual(['Kupić żarówki do przedpokoju']);
    expect(config('todo#1')).toEqual({ list: B });
    expect(config('todo#2')).toEqual({ list: B }); // the other tile did not move
  });

  it('hides what is done from the ⋯ menu: a setting of the list, so every tile showing it follows and another list is untouched', async () => {
    const user = userEvent.setup();
    const { posts, config } = renderTiles([todo(1, 0, 0, 2, 1, { list: A }), todo(2, 2, 0, 2, 1, { list: A }), todo(3, 0, 1, 2, 1, { list: B })]);
    const [first, second] = [tileOf('todo#1'), tileOf('todo#2')];
    await within(first).findByText('Komunikat o pustej odpowiedzi');
    expect(within(first).queryByRole('checkbox', { name: 'Ukryj ukończone' })).toBeNull(); // no checkbox on the tile any more
    await user.click(within(first).getByRole('button', { name: 'Zarządzaj listą' }));
    const item = within(first).getByRole('menuitemcheckbox', { name: 'Ukryj ukończone' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await user.click(item);
    expect(posts()).toEqual([{ action: 'setListOptions', list: A, hideDone: true }]);
    expect(titles(first)).not.toContain('Komunikat o pustej odpowiedzi');
    expect(titles(tileOf('todo#3'))).toEqual(['Kupić żarówki do przedpokoju']);
    await waitFor(() => expect(titles(second)).not.toContain('Komunikat o pustej odpowiedzi')); // the other tile of the same list
    expect(config('todo#1')).toEqual({ list: A }); // nothing about it in the tile
    await user.click(within(first).getByRole('button', { name: 'Zarządzaj listą' }));
    expect(within(first).getByRole('menuitemcheckbox', { name: 'Ukryj ukończone' }).getAttribute('aria-checked')).toBe('true');
    await user.click(within(first).getByRole('menuitemcheckbox', { name: 'Ukryj ukończone' }));
    expect(posts().at(-1)).toEqual({ action: 'setListOptions', list: A, hideDone: false });
    expect(titles(first)).toContain('Komunikat o pustej odpowiedzi');
  });

  it('marks what the agent added only when the list asks for it in the menu, for every tile that shows the list', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 1, { list: A }), todo(2, 2, 0, 2, 1, { list: A })]);
    const [first, second] = [tileOf('todo#1'), tileOf('todo#2')];
    await within(first).findByText('Komunikat o pustej odpowiedzi');
    await user.click(within(first).getByRole('button', { name: 'Zarządzaj listą' }));
    const item = within(first).getByRole('menuitemcheckbox', { name: 'Pokaż, co dodał agent' });
    expect(item.getAttribute('aria-checked')).toBe('false');
    await user.click(item);
    expect(posts()).toEqual([{ action: 'setListOptions', list: A, showAgent: true }]);
    expect(within(first).getAllByRole('img', { name: 'Dodał agent czatu' })).toHaveLength(1); // only what the agent added
    await waitFor(() => expect(within(second).getAllByRole('img', { name: 'Dodał agent czatu' })).toHaveLength(1));
    await user.click(within(first).getByRole('button', { name: 'Zarządzaj listą' }));
    await user.click(within(first).getByRole('menuitemcheckbox', { name: 'Pokaż, co dodał agent' }));
    expect(posts().at(-1)).toEqual({ action: 'setListOptions', list: A, showAgent: false });
    expect(within(first).queryByRole('img', { name: 'Dodał agent czatu' })).toBeNull();
  });

  it('names tiles after their list and opens a linked conversation without a turn or extra Cezar reads', async () => {
    const user = userEvent.setup();
    vi.stubGlobal('EventSource', FakeSource);
    FakeSource.instances = [];
    arrange(todo(1, 0, 0, 2, 2, { list: A }), todo(2, 2, 0, 2, 2, { list: B }));
    const { fetcher } = renderApp();
    await within(tileOf('todo#2')).findByText('Kupić żarówki do przedpokoju');
    expect(screen.getByRole('button', { name: 'Wyłącz kafelek: Zadania · Do poprawy - Chat Agy' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Wyłącz kafelek: Zadania · Dom' })).toBeTruthy();
    const reads = () => fetcher.mock.calls.filter(([url]) => String(url).includes('/api/cezar')).length;
    const before = reads();
    await user.click(within(tileOf('todo#1')).getByRole('button', { name: 'Edytuj zadanie: Agent nie wie, ile ma limitu na dziś' }));
    const dialog = screen.getByRole('dialog', { name: 'Zadanie' });
    expect(within(dialog).getByRole('link', { name: 'Widok notatki gotowy do przeglądu' })).toBeTruthy();
    expect(within(dialog).getByText('Do przeglądu')).toBeTruthy();
    expect(reads()).toBe(before);
    await user.click(within(dialog).getByRole('button', { name: 'Ustalenia' }));
    await waitFor(() => expect(FakeSource.instances.some(s => s.url === '/api/chats/scenario-todo-chat/events')).toBe(true));
    expect(screen.queryByRole('dialog', { name: 'Zadanie' })).toBeNull();
    expect(fetcher.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false);
  });

  it('adds a task with Enter (the user is the author), clears the field, and refuses an empty one', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull(); // the field is not there until the + asks for it
    await user.click(within(tile).getByRole('button', { name: 'Dodawanie zadań' }));
    const field = within(tile).getByRole('textbox', { name: 'Nowe zadanie' }) as HTMLInputElement;
    expect(document.activeElement).toBe(field);
    expect((within(tile).getByRole('button', { name: 'Dodaj zadanie' }) as HTMLButtonElement).disabled).toBe(true);
    await user.type(field, '   {Enter}');
    expect(posts()).toEqual([]);
    await user.type(field, 'Zadzwonić do mamy{Enter}');
    expect(posts()).toEqual([{ action: 'addTask', list: A, title: 'Zadzwonić do mamy' }]);
    expect(field.value).toBe('');
    await user.type(field, 'I jeszcze jedno{Enter}'); // the field stays open for the next one
    expect(posts().map(p => p.title)).toEqual(['Zadzwonić do mamy', 'I jeszcze jedno']);
    expect(await within(tile).findByText('Zadzwonić do mamy')).toBeTruthy();
    expect(titles(tile).indexOf('Zadzwonić do mamy')).toBe(2); // after the other open ones, before the done one
    await user.click(within(tile).getByRole('button', { name: 'Dodawanie zadań' })); // only the + closes it
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull();
  });

  it('ticks a task at once and writes it, and unticks a done one', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
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

  it('opens a task in a dialog over the panel: saves only what changed, Escape and Anuluj drop the edit, and focus goes back to the task', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 1, 1, { list: A })]); // even the smallest tile edits in the same dialog
    const tile = tileOf('todo#1');
    const row = await within(tile).findByRole('button', { name: 'Edytuj zadanie: Odpowiedź bez sformułowania „nie mam dostępu”' });
    await user.click(row);
    const dialog = screen.getByRole('dialog', { name: 'Zadanie' });
    expect(dialog.parentElement!.parentElement).toBe(document.body); // not inside the tile
    expect(within(dialog).getByRole('heading', { level: 2 }).textContent).toBe('Zadanie · Do poprawy - Chat Agy');
    const title = within(dialog).getByRole('textbox', { name: 'Tytuł' }) as HTMLInputElement;
    expect(document.activeElement).toBe(title);
    expect(title.value).toBe('Odpowiedź bez sformułowania „nie mam dostępu”');
    expect((within(dialog).getByRole('textbox', { name: 'Notatka' }) as HTMLTextAreaElement).value).toBe('');
    await user.clear(title);
    await user.type(title, 'Odpowiedź bez „nie mam dostępu”{Escape}');
    expect(posts()).toEqual([]);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(row);
    expect(titles(tile)).toContain('Odpowiedź bez sformułowania „nie mam dostępu”'); // nothing was saved
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Anuluj' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.click(row);
    const again = screen.getByRole('dialog', { name: 'Zadanie' });
    await user.clear(within(again).getByRole('textbox', { name: 'Tytuł' }));
    expect((within(again).getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled).toBe(true); // a title is needed
    await user.type(within(again).getByRole('textbox', { name: 'Tytuł' }), 'Krótszy tytuł');
    await user.type(within(again).getByRole('textbox', { name: 'Notatka' }), 'Jeszcze to.');
    await user.click(within(again).getByRole('button', { name: 'Zapisz' }));
    expect(posts()).toEqual([{ action: 'updateTask', task: 't-a0000002', title: 'Krótszy tytuł', note: 'Jeszcze to.' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(titles(tile)).toContain('Krótszy tytuł'));
  });

  it('writes workflow actions immediately, preserves the title draft, and shows links and authored history', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 1, 1, { list: A })]);
    await user.click(await screen.findByRole('button', { name: 'Edytuj zadanie: Agent nie wie, ile ma limitu na dziś' }));
    const dialog = screen.getByRole('dialog');
    await user.type(screen.getByRole('textbox', { name: 'Tytuł' }), '!');
    expect(within(dialog).getByRole('button', { name: 'Ustalenia' })).toBeTruthy();
    expect(within(dialog).getByText('Najpierw ustalmy zakres zmian.')).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Stan' }), 'realizacja');
    await waitFor(() => expect((screen.getByRole('combobox', { name: 'Stan' }) as HTMLSelectElement).value).toBe('realizacja'));
    expect(posts().at(-1)).toEqual({ action: 'setStatus', task: 't-a0000001', status: 'realizacja' });
    await user.click(screen.getByRole('button', { name: 'Zdejmij blokadę' }));
    await screen.findByRole('textbox', { name: 'Powód blokady' });
    expect(posts().at(-1)).toEqual({ action: 'setBlocked', task: 't-a0000001', reason: null });
    await user.type(screen.getByRole('textbox', { name: 'Powód blokady' }), 'Brak danych');
    await user.click(screen.getByRole('button', { name: 'Zablokuj' }));
    await screen.findByRole('button', { name: 'Zdejmij blokadę' });
    expect(posts().at(-1)).toEqual({ action: 'setBlocked', task: 't-a0000001', reason: 'Brak danych' });
    await user.type(screen.getByRole('textbox', { name: 'Dodaj komentarz' }), 'Pierwsza linia{Enter}Druga{Control>}{Enter}{/Control}');
    await waitFor(() => expect(within(dialog).getByText('Pierwsza linia Druga')).toBeTruthy());
    expect(posts().at(-1)).toEqual({ action: 'addComment', task: 't-a0000001', text: 'Pierwsza linia\nDruga' });
    expect((screen.getByRole('textbox', { name: 'Dodaj komentarz' }) as HTMLTextAreaElement).value).toBe('');
    await user.type(screen.getByRole('textbox', { name: 'URL pull requesta' }), 'https://example.com/no');
    await user.click(screen.getByRole('button', { name: 'Dodaj PR' }));
    expect(posts()).toHaveLength(4);
    expect(within(dialog).getByRole('alert').textContent).toContain('Podaj adres PR-a');
    await user.clear(screen.getByRole('textbox', { name: 'URL pull requesta' }));
    await user.type(screen.getByRole('textbox', { name: 'URL pull requesta' }), 'https://github.com/example/panel/pull/43');
    await user.click(screen.getByRole('button', { name: 'Dodaj PR' }));
    const link = await within(dialog).findByRole('link', { name: 'https://github.com/example/panel/pull/43' });
    expect(link.getAttribute('href')).toBe('https://github.com/example/panel/pull/43');
    expect(posts().at(-1)).toEqual({ action: 'link', task: 't-a0000001', kind: 'pr', id: 'https://github.com/example/panel/pull/43' });
    await user.click(screen.getByRole('button', { name: 'Usuń powiązanie: https://github.com/example/panel/pull/43' }));
    await waitFor(() => expect(within(dialog).queryByRole('link', { name: 'https://github.com/example/panel/pull/43' })).toBeNull());
    expect(posts().at(-1)).toEqual({ action: 'unlink', task: 't-a0000001', kind: 'pr', id: 'https://github.com/example/panel/pull/43' });
    expect((screen.getByRole('textbox', { name: 'Tytuł' }) as HTMLInputElement).value).toBe('Agent nie wie, ile ma limitu na dziś!');
    expect(posts().some(p => p.action === 'updateTask')).toBe(false);
  });

  it('saves with Enter in the title and sends only the title when only that changed', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    await user.click(await within(tileOf('todo#1')).findByRole('button', { name: 'Edytuj zadanie: Komunikat o pustej odpowiedzi' }));
    await user.type(screen.getByRole('textbox', { name: 'Tytuł' }), '!{Enter}');
    expect(posts()).toEqual([{ action: 'updateTask', task: 't-a0000003', title: 'Komunikat o pustej odpowiedzi!' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closes on a tap on the dimmed panel only while nothing was typed, and keeps focus inside with Tab', async () => {
    const user = userEvent.setup();
    renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const open = async () => user.click(await within(tileOf('todo#1')).findByRole('button', { name: 'Edytuj zadanie: Komunikat o pustej odpowiedzi' }));
    await open();
    const scrim = screen.getByRole('dialog').parentElement!;
    await user.type(screen.getByRole('textbox', { name: 'Tytuł' }), 'x');
    await user.click(scrim);
    expect(screen.queryByRole('dialog')).not.toBeNull(); // there is something typed: not lost by a stray tap
    await user.type(screen.getByRole('textbox', { name: 'Tytuł' }), '{Backspace}');
    await user.click(scrim);
    expect(screen.queryByRole('dialog')).toBeNull();
    await open();
    const dialog = screen.getByRole('dialog');
    const save = within(dialog).getByRole('button', { name: 'Zapisz' });
    save.focus();
    await user.tab(); // from the last control to the first
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Zamknij' }));
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(save);
  });

  it('deletes a task from its dialog, and only on the second tap', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const tile = tileOf('todo#1');
    expect(within(tile).queryByRole('button', { name: /^Usuń zadanie/ })).toBeNull(); // no X on every row
    await user.click(await within(tile).findByRole('button', { name: 'Edytuj zadanie: Komunikat o pustej odpowiedzi' }));
    await user.click(screen.getByRole('button', { name: 'Usuń zadanie: Komunikat o pustej odpowiedzi' }));
    expect(posts()).toEqual([]);
    await user.click(screen.getByRole('button', { name: 'Usunąć?' }));
    expect(posts()).toEqual([{ action: 'deleteTask', task: 't-a0000003' }]);
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(titles(tile)).not.toContain('Komunikat o pustej odpowiedzi'));
  });

  it('stays open and keeps what was typed when the list is read again, even if the task is hidden meanwhile; closes if the task is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { fetcher } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const tile = tileOf('todo#1');
    await user.click(await within(tile).findByRole('button', { name: 'Edytuj zadanie: Agent nie wie, ile ma limitu na dziś' }));
    await user.type(screen.getByRole('textbox', { name: 'Notatka' }), 'Wpisane w trakcie');
    await user.type(screen.getByRole('textbox', { name: 'Dodaj komentarz' }), 'Szkic komentarza');
    // Meanwhile somebody else ticks this task and the list hides what is done: its row leaves the tile.
    const post = (body: object) => fetcher('/api/todos/action', { method: 'POST', body: JSON.stringify(body) });
    await post({ action: 'updateTask', task: 't-a0000001', done: true });
    await post({ action: 'setListOptions', list: A, hideDone: true });
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    await waitFor(() => expect(titles(tile)).not.toContain('Agent nie wie, ile ma limitu na dziś'));
    expect((screen.getByRole('textbox', { name: 'Notatka' }) as HTMLTextAreaElement).value).toBe('Dodać limity AI do widoku dla agenta.Wpisane w trakcie');
    expect((screen.getByRole('textbox', { name: 'Dodaj komentarz' }) as HTMLTextAreaElement).value).toBe('Szkic komentarza');
    await post({ action: 'deleteTask', task: 't-a0000001' });
    await act(async () => { await vi.advanceTimersByTimeAsync(5500); });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('manages lists from the menu: new, rename, clear done, delete (after a second tap)', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
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
    const { posts, config } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
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
    expect(config('todo#1')!.list).toMatch(/^l-[0-9a-f]{8}$/);
  });

  it('says why the server refused a change, and the message can be closed', async () => {
    const user = userEvent.setup();
    renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
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
    renderTiles([todo(1, 0, 0, 2, 2)], 'empty');
    const tile = tileOf('todo#1');
    expect(await within(tile).findByText('Nie ma jeszcze żadnej listy.')).toBeTruthy();
    await user.click(within(tile).getByRole('button', { name: 'Utwórz listę' }));
    await user.type(within(tile).getByRole('textbox', { name: 'Nazwa nowej listy' }), 'Pierwsza{Enter}');
    expect(await within(tile).findByText('Brak zadań na tej liście.')).toBeTruthy();
    cleanup();
    renderTiles([todo(1, 0, 0, 2, 2)], 'offline');
    expect(await within(tileOf('todo#1')).findByText(/Zadania są niedostępne|Nie można połączyć się z lokalnym serwerem|Ładowanie zadań/)).toBeTruthy();
  });

  it('shows what is left when everything is done and hidden', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
    const tile = tileOf('todo#1');
    await user.click(await within(tile).findByRole('checkbox', { name: 'Agent nie wie, ile ma limitu na dziś' }));
    await user.click(within(tile).getByRole('checkbox', { name: 'Odpowiedź bez sformułowania „nie mam dostępu”' }));
    await user.click(within(tile).getByRole('button', { name: 'Zarządzaj listą' }));
    await user.click(within(tile).getByRole('menuitemcheckbox', { name: 'Ukryj ukończone' }));
    expect(posts()).toHaveLength(3);
    expect(await within(tile).findByText('Wszystkie zadania są ukończone.')).toBeTruthy();
  });

  it('in a tile of one cell leaves out notes but keeps everything else: the + for adding and the count', async () => {
    const user = userEvent.setup();
    const { posts } = renderTiles([todo(1, 0, 0, 1, 1, { list: A })]);
    const tile = tileOf('todo#1');
    await within(tile).findByText('Agent nie wie, ile ma limitu na dziś');
    expect(within(tile).queryByText('Dodać limity AI do widoku dla agenta.')).toBeNull();
    expect(within(tile).getByTitle('Ukończone z wszystkich').textContent).toBe('1/3');
    await user.click(within(tile).getByRole('button', { name: 'Dodawanie zadań' }));
    await user.type(within(tile).getByRole('textbox', { name: 'Nowe zadanie' }), 'Mały kafelek{Enter}');
    expect(posts()).toEqual([{ action: 'addTask', list: A, title: 'Mały kafelek' }]);
    await user.keyboard('{Escape}');
    expect(within(tile).queryByRole('textbox', { name: 'Nowe zadanie' })).toBeNull();
  });

  it('shows notes only when the tile is wide and tall, and marks its size on the card for the layout', async () => {
    renderTiles([todo(1, 0, 0, 2, 1, { list: A }), todo(2, 2, 0, 1, 2, { list: A }), todo(3, 3, 0, 1, 1, { list: A })]);
    const [wide, tall, one] = [tileOf('todo#1'), tileOf('todo#2'), tileOf('todo#3')];
    await within(wide).findByText('Komunikat o pustej odpowiedzi');
    expect(within(wide).queryByText('Dodać limity AI do widoku dla agenta.')).toBeNull();
    expect(within(tall).queryByText('Dodać limity AI do widoku dla agenta.')).toBeNull();
    const classes = (t: HTMLElement) => (t.querySelector('.todo') as HTMLElement).className;
    expect(classes(wide)).toMatch(/\bwide\b/);
    expect(classes(wide)).not.toMatch(/\btall\b/);
    expect(classes(tall)).toMatch(/\btall\b/);
    expect(classes(tall)).not.toMatch(/\bwide\b/);
    expect(classes(one)).not.toMatch(/\b(wide|tall)\b/);
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
    const { fetcher } = renderTiles([todo(1, 0, 0, 2, 2, { list: A })]);
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
