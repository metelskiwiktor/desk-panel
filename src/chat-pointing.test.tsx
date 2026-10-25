import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch } from './test-fixtures';

// The whole panel with the chat on top of it; the chat service itself is not there (503), which pointing does not need.
beforeEach(() => {
  localStorage.clear();
  vi.spyOn(Date, 'now').mockReturnValue(new Date('2026-10-14T10:00:00Z').getTime());
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const panel = scenarioFetch('standard');
  vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    String(input).startsWith('/api/chats') ? Promise.resolve(new Response('{}', { status: 503 })) : panel(input, init)));
});
afterEach(() => {
  cleanup();
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

describe('the floating chat', () => {
  it('floats over the dashboard without blocking it, and does not squeeze it until pointing starts', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    expect(root().dataset.mode).toBe('float');
    expect(document.querySelector('.chat-scrim')).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' }).getAttribute('aria-modal')).toBeNull();
    expect(document.body.hasAttribute('data-chat-dock')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Otwórz ustawienia' })); // the dashboard behind it is usable
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ustawienia' })).toBeTruthy();
    await startPointing(user);
    expect(root().dataset.mode).toBe('dock');
    expect(document.body.hasAttribute('data-chat-dock')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Gotowe' }));
    expect(root().dataset.mode).toBe('float');
    expect(document.body.hasAttribute('data-chat-dock')).toBe(false);
  });
  it('widens into the big window and back, and remembers the size', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<App />);
    await openChat(user);
    await user.click(screen.getByRole('button', { name: 'Powiększ okno czatu' }));
    expect(root().dataset.mode).toBe('window');
    expect(document.querySelector('.chat-scrim')).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' }).getAttribute('aria-modal')).toBe('true');
    unmount();
    render(<App />);
    await openChat(user);
    expect(root().dataset.mode).toBe('window');
    await user.click(screen.getByRole('button', { name: 'Zmniejsz okno czatu' }));
    expect(root().dataset.mode).toBe('float');
    expect(localStorage.getItem('desk-panel.chat-wide')).toBe('0');
  });
  it('Escape closes it from inside, but not while the user is elsewhere on the dashboard', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    (document.activeElement as HTMLElement).blur();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Czat z agentem' })).toBeTruthy();
    screen.getByRole('button', { name: 'Powiększ okno czatu' }).focus(); // inside the chat (the field itself is off here: no agent)
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
  });
  it('the chat button of the top bar opens and closes it', async () => {
    const user = userEvent.setup();
    render(<App />);
    await openChat(user);
    await user.click(screen.getByRole('button', { name: 'Otwórz czat z agentem' }));
    expect(screen.queryByRole('dialog', { name: 'Czat z agentem' })).toBeNull();
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
    const label = days[1].getAttribute('aria-label')!.replace('Pokaż dzień: ', '');
    await user.click(days[1]);
    expect(screen.getByRole('button', { name: `Usuń z kontekstu: Dzień: ${label}` })).toBeTruthy();
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
