import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readCezar } from '../server/cezar';
import { App } from './App';
import { useCezar } from './useCezar';

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
    const counts = screen.getAllByRole('button').filter(b => b.textContent?.includes('Wymaga odpowiedzi'));
    expect(counts[0].textContent).toContain('21');
    await user.click(screen.getAllByRole('button', { name: /Real 0/ })[0]);
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(data.tasks[0].sourceUrl);
  });
  it('shows connection failure without fake zero counts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 502 })));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    render(<App />);
    await waitFor(() => expect(screen.getAllByText(/Cezar niedostępny/).length).toBeGreaterThan(0));
    const card = screen.getByRole('heading', { name: 'Cezar' }).closest('section')!;
    expect(within(card).getByRole('button', { name: /W toku/ }).textContent).toContain('—');
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
