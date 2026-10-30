import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch } from './test-fixtures';
import { clearChatDraft } from './chat-draft';

// The chat window is a lazy chunk of App: loaded once here, so opening it in a test does not wait for its first transform.
beforeAll(() => import('./ChatWindow'), 60_000);

// The whole panel with the chat on top of it; the chat service itself is not there (503), which pointing does not need.
beforeEach(() => {
  clearChatDraft();
  localStorage.clear();
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-14T10:00:00Z').getTime());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const panel = scenarioFetch('standard');
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith('/api/chats') ? Promise.resolve(new Response('{}', { status: 503 })) : panel(input, init)));
});
afterEach(() => {
  cleanup();
  clearChatDraft();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.removeAttribute('data-picking');
  document.body.removeAttribute('data-chat-dock');
});

const root = () => document.querySelector('.chat-root') as HTMLElement;
const openChat = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole('region', { name: 'Poczta' });
  await user.click(screen.getByRole('button', { name: 'Otwórz czat z agentem' }));
  await screen.findByRole('dialog', { name: 'Czat z agentem' });
};
const startPointing = (user: ReturnType<typeof userEvent.setup>) => user.click(screen.getByRole('button', { name: /Wskaż element/ }));

describe('the chat window', () => {
  it('opens fullscreen with the idle cockpit hidden, and docks to the edge while pointing', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    expect(root().dataset.mode).toBe('window');
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' }).getAttribute('aria-modal')).toBe('true');
    expect(screen.queryByRole('complementary', { name: 'Kokpit taska' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Pokaż szczegóły rozmowy' })).toBeTruthy();
    expect(screen.getByRole('log', { name: 'Rozmowa' })).toBeTruthy();
    expect(document.body.hasAttribute('data-chat-dock')).toBe(false);
    await startPointing(user);
    expect(root().dataset.mode).toBe('dock');
    expect(document.body.hasAttribute('data-chat-dock')).toBe(true);
    expect(screen.queryByRole('complementary', { name: 'Kokpit taska' })).toBeNull(); // only the conversation beside the dashboard
    await user.click(screen.getByRole('button', { name: 'Gotowe' }));
    expect(root().dataset.mode).toBe('window');
    expect(document.body.hasAttribute('data-chat-dock')).toBe(false);
  });
  it('Escape ends pointing first, then closes the window', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    await startPointing(user);
    await user.keyboard('{Escape}');
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' })).toBeTruthy();
    (document.activeElement as HTMLElement | null)?.blur();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
  });
  it('the chat toggle button in the bottom-right corner opens and closes it', async () => {
    const user = userEvent.setup();
    render(<App />);
    const toggleBtn = screen.getByRole('button', { name: 'Otwórz czat z agentem' });
    expect(toggleBtn.classList.contains('chat-toggle-fab')).toBe(true);
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');

    await user.click(toggleBtn);
    await screen.findByRole('dialog', { name: 'Czat z agentem' });
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('true');

    await user.click(toggleBtn);
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
    expect(toggleBtn.getAttribute('aria-expanded')).toBe('false');
  });
  it('toggles pointing immediately with left Ctrl+Alt, preserves paste and AltGr, and shares state with the buttons', async () => {
    const panel = scenarioFetch('standard');
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => String(input) === '/api/chats'
      ? Promise.resolve(new Response(JSON.stringify({ chats: [], engines: [{ engine: 'hermes', available: true }] }))) : panel(input, init)));
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('region', { name: 'Poczta' });
    const cycle = () => { fireEvent.keyDown(document, { code: 'KeyW', key: 'w', altKey: true }); fireEvent.keyUp(document, { code: 'AltLeft', key: 'Alt' }); };
    const toggle = (altFirst = false) => {
      const first = altFirst ? 'AltLeft' : 'ControlLeft', second = altFirst ? 'ControlLeft' : 'AltLeft';
      fireEvent.keyDown(document, { code: first, key: altFirst ? 'Alt' : 'Control', ctrlKey: !altFirst, altKey: altFirst });
      fireEvent.keyDown(document, { code: second, key: altFirst ? 'Control' : 'Alt', ctrlKey: true, altKey: true });
      fireEvent.keyDown(document, { code: second, key: altFirst ? 'Control' : 'Alt', ctrlKey: true, altKey: true, repeat: true });
      fireEvent.keyUp(document, { code: second });
      fireEvent.keyUp(document, { code: first });
    };
    cycle();
    await screen.findByRole('complementary', { name: 'Czat z agentem' });
    await user.type(screen.getByLabelText('Wiadomość do agenta'), 'Szkic');
    cycle();
    expect(root().dataset.mode).toBe('window');
    cycle();
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
    fireEvent.keyDown(document, { code: 'AltLeft', key: 'Alt', altKey: true });
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    fireEvent.keyUp(document, { code: 'AltLeft', key: 'Alt' });
    fireEvent.keyDown(document, { code: 'ControlLeft', key: 'Control', ctrlKey: true });
    fireEvent.keyDown(document, { code: 'KeyV', key: 'v', ctrlKey: true });
    fireEvent.keyUp(document, { code: 'ControlLeft', key: 'Control' });
    expect(screen.queryByRole('complementary', { name: 'Czat z agentem' })).toBeNull();
    toggle();
    expect(document.body.hasAttribute('data-picking')).toBe(true);
    await user.click(screen.getByRole('region', { name: 'Poczta' }));
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Poczta' })).toBeTruthy();
    toggle(true);
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    expect(root().dataset.mode).toBe('compact');
    await user.click(screen.getByRole('button', { name: 'Wskaż element' }));
    toggle();
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    toggle();
    await user.keyboard('{Escape}');
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    toggle();
    await user.click(screen.getByRole('button', { name: 'Gotowe' }));
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Zamknij czat' }));
    toggle();
    expect(document.body.hasAttribute('data-picking')).toBe(true);
    fireEvent.blur(window);
    expect(document.body.hasAttribute('data-picking')).toBe(true);
    toggle();
    expect(root().dataset.mode).toBe('compact');
    expect((screen.getByLabelText('Wiadomość do agenta') as HTMLTextAreaElement).value).toBe('Szkic');
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Poczta' })).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls.filter(([url, init]) => String(url).startsWith('/api/chats') && init?.method === 'POST')).toHaveLength(0);
    fireEvent.keyDown(document, { code: 'ControlLeft', key: 'Control', ctrlKey: true });
    fireEvent.keyDown(document, { code: 'AltRight', key: 'Alt', ctrlKey: true, altKey: true });
    fireEvent.keyDown(document, { code: 'KeyE', key: 'ę', ctrlKey: true, altKey: true });
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    fireEvent.keyUp(document, { code: 'AltRight', key: 'Alt' });
    fireEvent.keyUp(document, { code: 'ControlLeft', key: 'Control' });
    fireEvent.keyDown(document, { code: 'ControlRight', key: 'Control', ctrlKey: true });
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    fireEvent.keyUp(document, { code: 'ControlRight', key: 'Control' });
    cycle();
    expect(root().dataset.mode).toBe('window');
    toggle();
    expect(document.body.hasAttribute('data-picking')).toBe(true);
    cycle();
    expect(document.body.hasAttribute('data-picking')).toBe(false);
    expect(root().dataset.mode).toBe('window');
  });
});

describe('pointing at the panel', () => {
  it('picks the whole zone of days, and a day on its own without selecting it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    await startPointing(user);
    const zone = screen.getByRole('region', { name: 'Najbliższe dni' });
    await user.click(within(zone).getByRole('heading', { name: 'Najbliższe dni' }));
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Najbliższe dni' })).toBeTruthy();
    const days = within(zone).getAllByRole('button', { name: /^Pokaż dzień:/ });
    const dayTitle = days[1].closest<HTMLElement>('[data-ctx-title]')?.dataset.ctxTitle
      ?? `Dzień: ${days[1].getAttribute('aria-label')!.replace('Pokaż dzień: ', '').replace(/, \d+ pozycj.*$/, '')}`;
    await user.click(days[1]);
    expect(screen.getByRole('button', { name: `Usuń z kontekstu: ${dayTitle}` })).toBeTruthy();
    expect(days[1].getAttribute('aria-pressed')).toBe('false'); // pointing is not selecting
    expect(days[0].getAttribute('aria-pressed')).toBe('true');
  });
  it('lets the menu of virtual desktops work, so tiles of any desktop can be pointed at', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    await startPointing(user);
    await user.click(screen.getByRole('button', { name: /^Pulpity:/ }));
    expect(screen.getByRole('dialog', { name: 'Pulpity' })).toBeTruthy(); // the click was not taken for a pick
    await user.click(screen.getByRole('button', { name: /Nowy pulpit/ }));
    expect(document.querySelectorAll('.wk-cell')).toHaveLength(0);
    expect(document.body.hasAttribute('data-picking')).toBe(true); // still pointing
    await user.click(screen.getByRole('button', { name: /^Pulpity:/ }));
    await user.click(screen.getByRole('button', { name: 'Główny' }));
    await user.click(await screen.findByRole('region', { name: 'Poczta' }));
    expect(screen.getByRole('button', { name: 'Usuń z kontekstu: Poczta' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Usuń z kontekstu: Pulpit/ })).toBeNull();
  });
});

describe('pointing at to-do lists and tasks', () => {
  const arrange = () => localStorage.setItem('desk-panel.workspace', JSON.stringify({ version: 1, tiles: [
    { id: 'todo#1', kind: 'todo', c: 0, r: 0, w: 2, h: 2, config: { list: 'l-1a2b3c4d' } },
    { id: 'todo#2', kind: 'todo', c: 2, r: 0, w: 1, h: 1, config: { list: 'l-5e6f7a8b' } },
  ] }));
  const chips = () => [...document.querySelectorAll<HTMLElement>('.chat-chip')];

  it('points at a list tile as the list it shows, with its id and its open tasks with their ids', async () => {
    arrange();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Agent nie wie, ile ma limitu na dziś');
    await user.click(screen.getByRole('button', { name: 'Otwórz czat z agentem' }));
    await screen.findByRole('dialog', { name: 'Czat z agentem' });
    await startPointing(user);
    await user.click(document.querySelector('[data-tile="todo#1"] .todo-head')!);
    const [chip] = chips();
    expect(chip.classList.contains('todoList')).toBe(true);
    expect(within(chip).getByText('Lista')).toBeTruthy();
    expect(within(chip).getByText('Do poprawy - Chat Agy')).toBeTruthy();
    const told = chip.getAttribute('title')!;
    expect(told).toContain('Lista zadań: Do poprawy - Chat Agy');
    expect(told).toContain('id listy: l-1a2b3c4d');
    expect(told).toContain('Do zrobienia: 2, ukończonych: 1');
    expect(told).toContain('t-a0000001 Agent nie wie, ile ma limitu na dziś');
    expect(told).not.toContain('Komunikat o pustej odpowiedzi'); // what is done is only counted
    // The other tile is another list, and pointing again at the first one takes it back out.
    await user.click(document.querySelector('[data-tile="todo#2"] .todo-head')!);
    expect(chips().map(c => c.getAttribute('title')!.split('\n')[0])).toEqual(['Lista zadań: Do poprawy - Chat Agy', 'Lista zadań: Dom']);
    await user.click(document.querySelector('[data-tile="todo#1"] .todo-head')!);
    expect(chips()).toHaveLength(1);
  });

  it('points at one task, which wins over the list it stands in, with the ids of the task and its list', async () => {
    arrange();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Agent nie wie, ile ma limitu na dziś');
    await user.click(screen.getByRole('button', { name: 'Otwórz czat z agentem' }));
    await screen.findByRole('dialog', { name: 'Czat z agentem' });
    await startPointing(user);
    await user.click(screen.getByText('Odpowiedź bez sformułowania „nie mam dostępu”')); // the title: in this mode it does not open the editor
    expect(document.querySelector('[data-tile="todo#1"] .todo-text + input, .todo-edit')).toBeNull();
    const [chip] = chips();
    expect(chip.classList.contains('todo')).toBe(true);
    expect(within(chip).getByText('Zadanie')).toBeTruthy();
    expect(chip.getAttribute('title')).toBe([
      'Zadanie z listy „Do poprawy - Chat Agy” (id listy: l-1a2b3c4d)', 'id zadania: t-a0000002', 'Tytuł: Odpowiedź bez sformułowania „nie mam dostępu”',
      'Stan: do zrobienia', 'Dodał: użytkownik',
    ].join('\n'));
    expect(chips()).toHaveLength(1); // not the list as well
  });

  it('does not change anything while pointing: a tick, an add field and a menu stay still', async () => {
    arrange();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Agent nie wie, ile ma limitu na dziś');
    await user.click(screen.getByRole('button', { name: 'Otwórz czat z agentem' }));
    await screen.findByRole('dialog', { name: 'Czat z agentem' });
    await startPointing(user);
    const box = within(document.querySelector('[data-tile="todo#1"]') as HTMLElement).getByRole('checkbox', { name: 'Agent nie wie, ile ma limitu na dziś' }) as HTMLInputElement;
    await user.click(box);
    expect(box.checked).toBe(false);
    expect(chips().map(c => c.classList.contains('todo'))).toEqual([true]); // it was a pick of that task
  });
});
