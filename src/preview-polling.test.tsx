import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { TabletPreview } from './TabletPreview';
import { scenarioFetch } from './test-fixtures';

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const navigate = (name: string) => fireEvent.click(within(screen.getByRole('navigation')).getByRole('button', { name }));
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

it('keeps the settings page mounted, pauses all host reads, and refreshes immediately on close', async () => {
  const fetcher = vi.fn(scenarioFetch('standard'));
  vi.stubGlobal('fetch', fetcher);
  render(<TabletPreview />);
  await settle();
  navigate('Ustawienia');
  await settle();
  const initialPaths = fetcher.mock.calls.map(([url]) => String(url).split('?')[0]);
  for (const path of ['/api/cezar', '/api/calendar', '/api/system', '/api/quotas', '/api/quotas/warmup', '/api/usage-breakdown', '/api/mail', '/api/google/accounts']) expect(initialPaths).toContain(path);
  fireEvent.click(screen.getByRole('button', { name: 'Otwórz podgląd pionowy' }));
  const pausedCalls = fetcher.mock.calls.length;
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
  expect(fetcher).toHaveBeenCalledTimes(pausedCalls);
  fireEvent.click(screen.getByRole('button', { name: 'Zamknij podgląd' }));
  await settle();
  expect(screen.getByRole('heading', { name: 'Ustawienia', level: 1 })).toBeTruthy();
  const resumedPaths = fetcher.mock.calls.slice(pausedCalls).map(([url]) => String(url).split('?')[0]);
  expect(resumedPaths.sort()).toEqual([...new Set(initialPaths)].sort());
});

it('aborts in-flight reads when the host is hidden without starting new ones', async () => {
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((_url: string, init?: RequestInit) => {
    signals.push(init!.signal!);
    return new Promise<Response>((_resolve, reject) => init!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError'))));
  });
  vi.stubGlobal('fetch', fetcher);
  render(<TabletPreview />);
  navigate('Ustawienia');
  fireEvent.click(screen.getByRole('button', { name: 'Otwórz podgląd pionowy' }));
  expect(signals).toHaveLength(8);
  expect(signals.every(signal => signal.aborted)).toBe(true);
  await act(async () => { await vi.advanceTimersByTimeAsync(61_000); });
  expect(fetcher).toHaveBeenCalledTimes(8);
});

it('preserves a pending mail undo across a short preview visit', async () => {
  const fetcher = vi.fn(scenarioFetch('standard'));
  vi.stubGlobal('fetch', fetcher);
  render(<TabletPreview />);
  await settle();
  fireEvent.click(screen.getByRole('button', { name: 'Oznacz jako przeczytane: Spotkanie w czwartek' }));
  await settle();
  navigate('Ustawienia');
  fireEvent.click(screen.getByRole('button', { name: 'Otwórz podgląd pionowy' }));
  fireEvent.click(screen.getByRole('button', { name: 'Zamknij podgląd' }));
  await settle();
  navigate('Pulpit');
  fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }));
  await settle();
  const actions = fetcher.mock.calls.filter(([url]) => String(url) === '/api/mail/action').map(([, init]) => JSON.parse(String(init!.body)).action);
  expect(actions).toEqual(['read', 'unread']);
});
