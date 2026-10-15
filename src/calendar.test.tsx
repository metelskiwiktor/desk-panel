import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from './App';
import { createCalendarReader, projectEvents } from '../server/calendar';
import { useCalendar } from './useCalendar';
import { allDayDate } from './format';
import { deriveInsights } from './insights';
import { createFixture } from './test-fixtures';

const timed = { id: 'timed', summary: 'Spotkanie', start: { dateTime: '2026-03-29T10:00:00+02:00' }, end: { dateTime: '2026-03-29T11:00:00+02:00' }, htmlLink: 'https://calendar.google.com/event?eid=real' };
const allDay = { id: 'day', summary: 'Dzień', start: { date: '2026-03-29' }, end: { date: '2026-03-30' } };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
describe('Google Calendar', () => {
  it('maps timezone offsets, DST all-day boundaries, source URLs and excludes cancelled/declined events', () => {
    const result = projectEvents({ items: [timed, allDay, { id: 'cancelled', status: 'cancelled' }, { ...timed, id: 'declined', attendees: [{ self: true, responseStatus: 'declined' }] }] }, 'Europe/Warsaw');
    expect(result.events).toHaveLength(2);
    expect(result.events[0].startAt).toBe(Date.parse('2026-03-29T08:00:00Z'));
    expect(result.events[0].sourceUrl).toBe(timed.htmlLink);
    expect(result.events[1].endAt - result.events[1].startAt).toBe(23 * 3600_000);
    expect(allDayDate('2026-03-29', '2026-03-30')).toBe('29 marca');
  });
  it('fetches recurrence instances over seven calendar days, paginates and caches successful reads', async () => {
    const request = vi.fn(async (path: string, params?: Record<string, string>) => path === '' ? { timeZone: 'Europe/Warsaw' } : params?.pageToken ? { items: [timed] } : { items: [allDay], nextPageToken: 'next' });
    const now = () => Date.parse('2026-03-29T09:00:00Z');
    const read = createCalendarReader('owner@gmail.com', request, now);
    const value = await read();
    expect(value.status).toBe('connected');
    expect(value.data).toHaveLength(2);
    expect(request.mock.calls[1][1]).toMatchObject({ singleEvents: 'true', orderBy: 'startTime', timeMin: '2026-03-28T23:00:00.000Z', timeMax: '2026-04-04T22:00:00.000Z' });
    await read();
    expect(request).toHaveBeenCalledTimes(3);
  });
  it('distinguishes missing permission from empty success and keeps old data on network failure without leaking secrets', async () => {
    let at = Date.now();
    const request = vi.fn().mockResolvedValueOnce({ timeZone: 'Europe/Warsaw' }).mockResolvedValueOnce({ items: [timed] })
      .mockRejectedValue({ message: 'SECRET', config: { headers: { Authorization: 'SECRET' } } });
    const read = createCalendarReader('owner@gmail.com', request, () => at);
    const old = await read();
    at += 60_001;
    const offline = await read();
    expect(offline.status).toBe('offline');
    expect(offline.data).toEqual(old.data);
    expect(offline.observedAt).toBe(old.observedAt);
    expect(JSON.stringify(offline)).not.toContain('SECRET');
    const denied = createCalendarReader('owner@gmail.com', async () => { throw { response: { status: 404 } }; });
    expect(await denied()).toMatchObject({ status: 'unavailable', data: null, observedAt: null });
    const empty = createCalendarReader('owner@gmail.com', async path => path ? { items: [] } : { timeZone: 'UTC' });
    expect(await empty()).toMatchObject({ status: 'connected', data: [] });
  });
  it('rejects malformed event boundaries and avoids all-day meeting reminders', () => {
    expect(() => projectEvents({ items: [{ ...timed, start: { dateTime: 'invalid' } }] }, 'UTC')).toThrow();
    const now = Date.now();
    const data = createFixture(now, 'empty');
    data.calendar = { status: 'connected', observedAt: now, data: [{ id: 'day', title: 'Cały dzień', startAt: now, endAt: now + 86400_000, allDay: true, description: '' }] };
    expect(deriveInsights(data, now).some(i => i.target.kind === 'event' && i.target.id === 'day')).toBe(false);
  });
  it('polls independently, retains data on local-server failure and cancels future reads', async () => {
    vi.useFakeTimers();
    const source = { status: 'connected', live: true, name: 'Google Calendar', calendarId: 'owner@gmail.com', observedAt: Date.now(), data: [] };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json(source)).mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const view = renderHook(() => useCalendar());
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(view.result.current.status).toBe('connected');
    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });
    expect(view.result.current).toMatchObject({ status: 'offline', data: [], observedAt: source.observedAt });
    view.unmount();
    await vi.advanceTimersByTimeAsync(60000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('renders calendar rows and their source detail', async () => {
    const at = Date.now();
    const source = { status: 'connected', live: true, name: 'Google Calendar', calendarId: 'owner@gmail.com', observedAt: at,
      data: [{ id: 'real', title: 'Rzeczywiste wydarzenie', description: 'Opis z Google', startAt: at + 3600_000, endAt: at + 7200_000, allDay: false, sourceUrl: 'https://calendar.google.com/event?eid=real' }] };
    vi.stubGlobal('fetch', vi.fn(async path => Response.json(path === '/api/calendar' ? source : {
      tasks: [], observedAt: at, counts: { running: 0, queue: 0, 'needs-input': 0, review: 0 }, partial: false, scheduled: 0,
    })));
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Rzeczywiste wydarzenie/ })).toBeTruthy());
    await user.click(screen.getByRole('button', { name: /Rzeczywiste wydarzenie/ }));
    expect(screen.getByText('Opis z Google')).toBeTruthy();
    expect(screen.getByRole('link', { name: /Otwórz źródło/ }).getAttribute('href')).toBe(source.data[0].sourceUrl);
  });
});
