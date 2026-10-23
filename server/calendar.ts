import { DateTime } from 'luxon';
import { z } from 'zod';
import { calendarSourceSchema, type CalendarSource } from '../src/calendar-contract';
import { GoogleAuthError } from './google-oauth';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const moment = z.object({ date: date.optional(), dateTime: z.iso.datetime({ offset: true }).optional() })
  .refine(v => Boolean(v.date) !== Boolean(v.dateTime));
const event = z.object({
  id: z.string(), status: z.string().optional(), summary: z.string().optional(),
  start: moment.optional(), end: moment.optional(),
  description: z.string().optional(), location: z.string().optional(), htmlLink: z.url().optional(),
  attendees: z.array(z.object({ self: z.boolean().optional(), responseStatus: z.string().optional() })).optional(),
});
const page = z.object({ items: z.array(event).default([]), nextPageToken: z.string().optional() });
const metadata = z.object({ timeZone: z.string().min(1) });
export function projectEvents(payload: unknown, timeZone: string) {
  const parsed = page.parse(payload);
  return { nextPageToken: parsed.nextPageToken, events: parsed.items.filter(e =>
    e.status !== 'cancelled' && !e.attendees?.some(a => a.self && a.responseStatus === 'declined')
  ).map(e => {
    if (!e.start || !e.end) throw new Error('Missing event boundaries');
    const allDay = !!e.start.date;
    if (allDay !== !!e.end.date) throw new Error('Mixed event boundaries');
    const startAt = DateTime.fromISO(e.start.date || e.start.dateTime!, { zone: timeZone }).toMillis();
    const endAt = DateTime.fromISO(e.end.date || e.end.dateTime!, { zone: timeZone }).toMillis();
    return { id: e.id, title: e.summary || 'Bez tytułu', startAt, endAt, allDay,
      ...(allDay ? { startDate: e.start.date, endDate: e.end.date } : {}),
      description: (e.description || '').replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, ''),
      ...(e.location ? { location: e.location } : {}),
      ...(e.htmlLink && /^https:\/\//.test(e.htmlLink) ? { sourceUrl: e.htmlLink } : {}),
    };
  }) };
}
type Request = (path: string, params?: Record<string, string>) => Promise<unknown>;
export function createCalendarReader(calendarId: string, request: Request, now = Date.now) {
  let cache: CalendarSource | undefined;
  let lastAttempt = -Infinity;
  let pending: Promise<CalendarSource> | undefined;
  return async function read(): Promise<CalendarSource> {
    if (pending) return pending;
    if (cache && now() - lastAttempt < (cache.status === 'connected' ? 60_000 : 15_000)) return cache;
    pending = (async () => {
      lastAttempt = now();
      try {
        const { timeZone } = metadata.parse(await request(''));
        const start = DateTime.fromMillis(now(), { zone: timeZone }).startOf('day');
        const events = [];
        let pageToken: string | undefined;
        for (let i = 0; i < 10; i++) {
          const result = projectEvents(await request('/events', {
            timeMin: start.toUTC().toISO()!, timeMax: start.plus({ days: 7 }).toUTC().toISO()!,
            singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
            ...(pageToken ? { pageToken } : {}),
          }), timeZone);
          events.push(...result.events);
          if (result.nextPageToken && result.nextPageToken === pageToken) throw new Error('Invalid pagination');
          pageToken = result.nextPageToken;
          if (!pageToken) break;
        }
        cache = calendarSourceSchema.parse({ name: 'Google Calendar', live: true, status: 'connected',
          calendarId, observedAt: now(), data: [...new Map(events.map(e => [e.id, e])).values()].sort((a,b) => a.startAt - b.startAt),
          timeZone, partial: !!pageToken,
        });
      } catch (error) {
        // Never serialize GoogleAuth errors: request config can contain credentials.
        const failure = error as { code?: string; response?: { status?: number; data?: { error?: { errors?: { reason?: string }[] } } } };
        const status = failure.response?.status;
        const disabled = failure.response?.data?.error?.errors?.some(e => e.reason === 'accessNotConfigured');
        const unavailable = error instanceof GoogleAuthError || status === 401 || status === 403 || status === 404;
        const message = error instanceof GoogleAuthError ? (error.reason === 'client_missing' || error.reason === 'invalid_client'
          ? 'Dodaj klienta OAuth Google, a następnie zaloguj się w Ustawieniach.'
          : error.reason === 'token_expired' ? 'Google odrzucił zapisane logowanie (wygasło lub zostało cofnięte). Zaloguj się ponownie w Ustawieniach panelu.'
          : error.reason === 'storage_failed' ? 'Nie udało się odczytać zapisanego logowania z dysku. Zaloguj się ponownie w Ustawieniach panelu.'
          : 'Zaloguj się przez Google w Ustawieniach panelu.')
          : disabled ? 'Włącz Google Calendar API w projekcie klienta OAuth.'
          : status === 403 || status === 404 ? 'Sprawdź zgodę Google i identyfikator kalendarza.'
          : status === 401 ? 'Zaloguj się ponownie przez Google w Ustawieniach.'
          : 'Nie udało się odczytać kalendarza Google. Ponowię połączenie.';
        cache = { ...(cache || { data: null, observedAt: null }), calendarId, live: true, name: 'Google Calendar',
          status: unavailable ? 'unavailable' : 'offline', message };
      }
      return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
