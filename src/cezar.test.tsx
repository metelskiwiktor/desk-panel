import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCezar } from '../server/cezar';
import { App } from './App';
import { useCezar } from './useCezar';
import { scenarioFetch } from './test-fixtures';

const asOf = new Date().toISOString();
const coverage = { projects: [{ state: 'complete' }] };
const base = { snapshotId: 's', asOf, coverage, counts: { running: 0, queued: 0, questions: 21, reviews: 0, scheduled: 2 } };
const row = (id: string) => ({ projectId: 'p', id, title: `Real ${id}`, status: 'failed' });
function request(overrides: { bad?: boolean; expired?: boolean; partial?: boolean } = {}) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (!url.search) return Response.json({ ...base, ...(overrides.bad ? { asOf: 'broken' } : {}) });
    if (overrides.expired) return new Response('', { status: 409 });
    const questions = url.searchParams.get('group') === 'questions';
    const offset = Number(url.searchParams.get('offset'));
    return Response.json({ snapshotId: 's', asOf,
      coverage: overrides.partial ? { projects: [{ state: 'unavailable' }] } : coverage,
      page: { rows: questions ? (offset === 0 ? Array.from({ length: 20 }, (_, i) => row(String(i))) : [row('20')]) : [], total: questions ? 21 : 0, nextOffset: questions && offset === 0 ? 20 : null },
    });
  }) as unknown as typeof fetch;
}
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('Cezar integration', () => {
  it('paginates one snapshot, uses authoritative counts and question group for failed waiting runs', async () => {
    const result = await readCezar('http://127.0.0.1:4321', request());
    expect(result.tasks).toHaveLength(21);
    expect(result.counts['needs-input']).toBe(21);
    expect(result.scheduled).toBe(2);
    expect(result.tasks[20].status).toBe('needs-input');
    expect(result.tasks[20].sourceUrl).toBe('http://127.0.0.1:4321/p/p/tasks/20');
    expect(result.partial).toBe(false);
  });
  it('marks incomplete coverage without substituting empty success for invalid/expired responses', async () => {
    expect((await readCezar('http://localhost:4321', request({ partial: true }))).partial).toBe(true);
    await expect(readCezar('http://localhost:4321', request({ bad: true }))).rejects.toThrow();
    await expect(readCezar('http://localhost:4321', request({ expired: true }))).rejects.toThrow();
  });
  it('shows Cezar tasks with authoritative counts and opens the matching source', async () => {
    const data = await readCezar('http://127.0.0.1:4321', request());
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(data)));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /Real 0/ })[0]).toBeTruthy());
    expect(within(screen.getByRole('region', { name: 'Cezar' })).getByText(/21 wymaga odpowiedzi/)).toBeTruthy();
    await user.click(screen.getAllByRole('button', { name: /Real 0/ })[0]);
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(data.tasks[0].sourceUrl);
  });
  it('shows connection failure without fake zero counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/Cezar niedostępny/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/\b0 w toku/)).toBeNull();
  });
  it('preserves the last snapshot after failure and stops polling on unmount', async () => {
    const data = await readCezar('http://127.0.0.1:4321', request());
    vi.useFakeTimers();
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(data)).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const view = renderHook(() => useCezar());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.source.status).toBe('connected');
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(view.result.current.source.status).toBe('offline');
    expect(view.result.current.source.data).toEqual(data.tasks);
    expect(view.result.current.source.observedAt).toBe(data.observedAt);
    view.unmount();
    await vi.advanceTimersByTimeAsync(15000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe('finished tasks on the dashboard', () => {
  const setup = () => { vi.spyOn(window, 'scrollTo').mockImplementation(() => {}); const fetchMock = vi.fn(scenarioFetch('standard')); vi.stubGlobal('fetch', fetchMock); render(<App />); return fetchMock; };
  const posts = (fetchMock: ReturnType<typeof vi.fn>) => fetchMock.mock.calls
    .filter(([url, init]) => String(url) === '/api/cezar/action' && (init as RequestInit | undefined)?.method === 'POST')
    .map(([, init]) => JSON.parse(String((init as RequestInit).body)));
  const REVIEW = 'tabnote-poc-rn/7c1d9a02-aaaa-4bbb-8ccc-000000000001', CAPTURE = 'tabnote-poc-rn/7c1d9a02-aaaa-4bbb-8ccc-000000000002';

  it('lists what is done or failed and not archived, with the unread ones marked', async () => {
    setup();
    const list = await screen.findByRole('list', { name: 'Zakończone zadania' });
    expect(within(list).getAllByRole('button', { name: /^(Zakończone|Nieudane):/ }).map(b => b.getAttribute('aria-label'))).toEqual([
      'Zakończone: Widok notatki: zrzut ekranu i testy, nieprzeczytane', 'Nieudane: tabnote-capture:v1, nieprzeczytane',
      'Zakończone: Przegląd PR #41: dokumentacja workflow zrzutów', 'Zakończone: Etykiety w wyszukiwarce',
    ]);
    // Every task says what it was; the unread ones carry a bar and no label.
    expect(within(list).getAllByRole('button', { name: /nieprzeczytane$/ })).toHaveLength(2);
    expect(within(list).getAllByText('implement-review')).toHaveLength(2);
    expect(within(list).getByText('review')).toBeTruthy();
    expect(within(list).queryByText('nowe')).toBeNull();
  });
  it('archives a task in Cezar, hides it at once and brings it back with Cofnij', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    const list = await screen.findByRole('list', { name: 'Zakończone zadania' });
    await user.click(within(list).getByRole('button', { name: 'Archiwizuj: tabnote-capture:v1' }));
    expect(posts(fetchMock)).toEqual([{ id: CAPTURE, action: 'archive' }]);
    expect(within(list).queryByRole('button', { name: /^Nieudane:/ })).toBeNull();
    expect(screen.getByText('Zarchiwizowano w Cezarze.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Cofnij' }));
    expect(posts(fetchMock).at(-1)).toEqual({ id: CAPTURE, action: 'unarchive' });
    expect(within(list).getByRole('button', { name: /^Nieudane: tabnote-capture:v1/ })).toBeTruthy();
  });
  it('marks an unread task read in Cezar when it is opened, and leaves a read one alone', async () => {
    const user = userEvent.setup();
    const fetchMock = setup();
    await user.click(await screen.findByRole('button', { name: 'Zakończone: Widok notatki: zrzut ekranu i testy, nieprzeczytane' }));
    expect(posts(fetchMock)).toEqual([{ id: REVIEW, action: 'read' }]);
    expect(screen.getByRole('heading', { name: 'Widok notatki: zrzut ekranu i testy' })).toBeTruthy();
    cleanup();
    const again = setup();
    await user.click(await screen.findByRole('button', { name: 'Zakończone: Etykiety w wyszukiwarce' }));
    expect(posts(again)).toEqual([]);
  });
  it('says so when Cezar refuses to archive and puts the task back', async () => {
    const user = userEvent.setup();
    const real = scenarioFetch('standard');
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => String(input) === '/api/cezar/action' ? new Response('', { status: 502 }) : real(input, init)));
    render(<App />);
    const list = await screen.findByRole('list', { name: 'Zakończone zadania' });
    await user.click(within(list).getByRole('button', { name: 'Archiwizuj: Etykiety w wyszukiwarce' }));
    expect(await screen.findByText('Cezar nie zarchiwizował zadania.')).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Zakończone: Etykiety w wyszukiwarce' })).toBeTruthy();
  });
});
