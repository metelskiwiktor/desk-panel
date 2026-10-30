import { createHash } from 'node:crypto';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { calendarDraftSchema, calendarSavedSchema, isGoogleCalendarEventUrl, type CalendarDraft, type CalendarSaved } from '../src/appointment-contract';
import { GoogleAuthError } from './google-oauth';
import { AppointmentError } from './znanylekarz';

type Request = (path: string, init: { method?: 'GET' | 'POST'; params?: Record<string, string>; data?: unknown }) => Promise<unknown>;
const responseSchema = z.object({ id: z.string().min(1), status: z.string().optional(), htmlLink: z.url(), summary: z.string(), start: z.object({ dateTime: z.string() }), end: z.object({ dateTime: z.string() }), location: z.string().default(''), description: z.string().default(''), extendedProperties: z.object({ private: z.record(z.string(), z.string()).optional() }).optional() });
export const calendarEventId = (key: string) => 'desk' + createHash('sha256').update(key).digest('hex');
export const calendarDraftHash = (draft: CalendarDraft) => createHash('sha256').update(JSON.stringify(calendarDraftSchema.parse(draft))).digest('hex');

/** Insert only, no guests, no invites, deterministic id. A lost response/restart is recovered by reading that same id. */
export function createCalendarWriter(request: Request, now = Date.now) {
  return async (key: string, raw: CalendarDraft): Promise<CalendarSaved> => {
    const draft = calendarDraftSchema.parse(raw);
    const start = DateTime.fromMillis(draft.startAt, { zone: draft.timeZone });
    const end = DateTime.fromMillis(draft.endAt, { zone: draft.timeZone });
    if (!start.isValid || !end.isValid) throw new AppointmentError(400, 'Nieprawidłowa strefa lub godziny wydarzenia.');
    const id = calendarEventId(key), hash = calendarDraftHash(draft);
    const payload = { id, summary: draft.title, start: { dateTime: start.toISO(), timeZone: draft.timeZone }, end: { dateTime: end.toISO(), timeZone: draft.timeZone },
      location: draft.location, description: draft.description, extendedProperties: { private: { deskPanelPlan: hash } } };
    try {
      let response;
      try { response = await request('/events', { method: 'POST', params: { sendUpdates: 'none' }, data: payload }); }
      catch (error) {
        if ((error as { response?: { status?: number } }).response?.status !== 409) throw error;
        response = await request(`/events/${id}`, { method: 'GET' });
      }
      const event = responseSchema.parse(response);
      if (event.id !== id || event.status === 'cancelled' || event.extendedProperties?.private?.deskPanelPlan !== hash || !isGoogleCalendarEventUrl(event.htmlLink)
        || event.summary !== draft.title || Date.parse(event.start.dateTime) !== draft.startAt || Date.parse(event.end.dateTime) !== draft.endAt || event.location !== draft.location || event.description !== draft.description) throw new AppointmentError(409, 'Nie można bezpiecznie potwierdzić zapisanego wydarzenia. Sprawdź Google Calendar.');
      return calendarSavedSchema.parse({ id, url: event.htmlLink, at: now(), draft });
    } catch (error) {
      if (error instanceof AppointmentError) throw error;
      if (error instanceof GoogleAuthError) throw new AppointmentError(409, error.reason === 'scopes_missing' ? 'Połącz ponownie konto Google w Ustawieniach i zezwól na tworzenie wydarzeń.' : 'Połącz ponownie konto Google w Ustawieniach.');
      throw new AppointmentError(502, 'Nie udało się potwierdzić zapisu w Google Calendar. Możesz ponowić ten sam zapis; nie utworzy duplikatu.');
    }
  };
}
