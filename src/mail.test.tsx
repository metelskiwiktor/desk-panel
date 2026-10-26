import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { scenarioFetch, type ScenarioName } from './test-fixtures';

beforeEach(() => { localStorage.clear(); vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/** The app on a scenario; returns the fetch spy to inspect Gmail actions. */
function renderWith(scenario: ScenarioName, override?: (input: string, init?: RequestInit) => Response | undefined) {
  const base = scenarioFetch(scenario);
  const fetcher = vi.fn(async (input: string, init?: RequestInit) => override?.(String(input), init) ?? base(input, init));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  return fetcher;
}
const mailCard = () => screen.getByRole('heading', { name: 'Poczta' }).closest('section')!;
const actions = (fetcher: ReturnType<typeof vi.fn>) => fetcher.mock.calls
  .filter(([url, init]) => url === '/api/mail/action' && init?.method === 'POST')
  .map(([, init]) => JSON.parse(String(init!.body)).action);

describe('Poczta', () => {
  it('lists unread conversations of both accounts newest first with their unread counts', async () => {
    renderWith('standard');
    const list = await screen.findByRole('list', { name: 'Nieprzeczytane wiadomości' });
    const rows = within(list).getAllByRole('button', { name: /^(Anna|GitHub|Bank|Jira|Allegro)/ });
    expect(rows.map(r => r.getAttribute('aria-label'))).toEqual(['Anna Nowak: Spotkanie w czwartek', 'GitHub: [desk-panel] PR #3: Gmail w panelu',
      'Bank Millennium: Potwierdzenie przelewu', 'Jira: Nowe zadanie przypisane do Ciebie', 'Allegro: Twoja paczka jest w drodze']);
    expect(within(mailCard()).getByText('owner 3')).toBeTruthy();
    expect(within(mailCard()).getByText('praca 2')).toBeTruthy();
    expect(within(rows[1]).getByText('praca')).toBeTruthy();
  });
  it('swipes left to mark read and right to move to Trash, each undoable in Gmail', async () => {
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
    const fetcher = renderWith('standard');
    const row = await screen.findByRole('button', { name: /^Anna Nowak/ });
    const swipe = (button: HTMLElement, dx: number) => {
      fireEvent.pointerDown(button, { clientX: 200, clientY: 100, button: 0 });
      fireEvent.pointerMove(button, { clientX: 200 + dx, clientY: 100 });
      fireEvent.pointerUp(button, { clientX: 200 + dx, clientY: 100 });
    };
    swipe(row, -140);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Anna Nowak/ })).toBeNull());
    expect(screen.getByText('Oznaczono jako przeczytane.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(await screen.findByRole('button', { name: /^Anna Nowak/ })).toBeTruthy();
    swipe(screen.getByRole('button', { name: /^GitHub/ }), 140);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^GitHub/ })).toBeNull());
    expect(screen.getByText('Przeniesiono do kosza.')).toBeTruthy();
    expect(actions(fetcher)).toEqual(['read', 'unread', 'trash']);
  });
  it('brings a conversation back with a warning when Gmail refuses the change', async () => {
    renderWith('standard', (url, init) => url === '/api/mail/action' && init?.method === 'POST' ? new Response('', { status: 502 }) : undefined);
    await userEvent.click(await screen.findByRole('button', { name: 'Przenieś do kosza: Potwierdzenie przelewu' }));
    expect(await screen.findByText('Gmail nie przeniósł wiadomości do kosza.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Bank Millennium/ })).toBeTruthy();
  });
  it('opens a conversation with its source link and actions', async () => {
    const fetcher = renderWith('standard');
    await userEvent.click(await screen.findByRole('button', { name: /^Jira/ }));
    expect(screen.getByRole('heading', { name: 'Nowe zadanie przypisane do Ciebie' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe('https://mail.google.com/mail/u/praca@gmail.com/#inbox/18c2f0a1b2c3d404');
    expect(screen.getByText(/Sprawdź zachowanie kafelków/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /Oznacz jako przeczytane/ }));
    await waitFor(() => expect(actions(fetcher)).toEqual(['read']));
  });
  it('renders the full email body in the detail modal and falls back to snippet when absent', async () => {
    renderWith('standard');
    await userEvent.click(await screen.findByRole('button', { name: /^Anna Nowak/ }));
    expect(screen.getByText(/Mam konflikt w kalendarzu o 14:00/)).toBeTruthy();
  });
  it('falls back to snippet in detail modal when body is absent', async () => {
    renderWith('standard', (url) => {
      if (url.startsWith('/api/mail')) {
        return new Response(JSON.stringify({
          live: true, name: 'Gmail', status: 'connected', observedAt: Date.now(), total: 1, accounts: [{ email: 'a@x.pl', status: 'connected', observedAt: Date.now(), unread: 1 }],
          data: [{ id: 'a@x.pl:1', account: 'a@x.pl', threadId: '1', from: 'Nadawca', subject: 'Temat', snippet: 'Tylko snippet tutaj', receivedAt: Date.now(), messages: 1, sourceUrl: 'https://mail.google.com' }],
        }), { headers: { 'content-type': 'application/json' } });
      }
    });
    await userEvent.click(await screen.findByRole('button', { name: /^Nadawca/ }));
    expect(screen.getByText('Tylko snippet tutaj')).toBeTruthy();
  });
  it('loads further pages as the list scrolls', async () => {
    const fetcher = renderWith('mail-many');
    const list = await screen.findByRole('list', { name: 'Nieprzeczytane wiadomości' });
    expect(within(list).getAllByRole('button', { name: /^Wiadomość|^(Anna|GitHub|Jira|Allegro|Bank|LinkedIn|Google|Notion|Slack|Figma)/ }).length).toBe(30);
    await userEvent.click(within(list).getByRole('button', { name: 'Wczytaj więcej' }));
    await waitFor(() => expect(within(list).getAllByRole('button', { name: /^Przenieś do kosza/ })).toHaveLength(60));
    await userEvent.click(within(list).getByRole('button', { name: 'Wczytaj więcej' }));
    await waitFor(() => expect(within(list).getAllByRole('button', { name: /^Przenieś do kosza/ })).toHaveLength(64));
    expect(within(list).queryByRole('button', { name: 'Wczytaj więcej' })).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('/api/mail?limit=90', expect.anything());
  });
  it('explains an account that still needs consent', async () => {
    renderWith('unavailable');
    expect((await within(await waitFor(mailCard)).findAllByText(/Zaloguj się przez Google w Ustawieniach/)).length).toBeGreaterThan(0);
  });
});
