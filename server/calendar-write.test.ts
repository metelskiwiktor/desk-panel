// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { calendarDraftSchema } from '../src/appointment-contract';
import { calendarDraftHash, calendarEventId, createCalendarWriter } from './calendar-write';
import { GoogleAuthError } from './google-oauth';
const draft = calendarDraftSchema.parse({ title: 'Przegląd roweru', startAt: Date.parse('2027-03-28T10:00:00+02:00'), endAt: Date.parse('2027-03-28T11:00:00+02:00'), location: 'Serwis', description: 'Regulacja' });
const answer = (key = 'card') => ({ id: calendarEventId(key), htmlLink: 'https://calendar.google.com/calendar/event?eid=fixture', summary: draft.title, start: { dateTime: new Date(draft.startAt).toISOString() }, end: { dateTime: new Date(draft.endAt).toISOString() }, location: draft.location, description: draft.description, extendedProperties: { private: { deskPanelPlan: calendarDraftHash(draft) } } });
describe('consented Calendar insert', () => {
  it('sets a deterministic valid Google id, real DST offset, correct boundaries and no attendees', async () => {
    const send = vi.fn().mockResolvedValue(answer());
    await createCalendarWriter(send)('card', draft);
    const [, init] = send.mock.calls[0];
    expect(init.data.id).toMatch(/^[a-v0-9]{5,1024}$/);
    expect(init.data.start).toEqual({ dateTime: '2027-03-28T10:00:00.000+02:00', timeZone: 'Europe/Warsaw' });
    expect(init.data.end.dateTime).toBe('2027-03-28T11:00:00.000+02:00');
    expect(init.data.attendees).toBeUndefined(); expect(init.params).toEqual({ sendUpdates: 'none' });
    expect(init.method).toBe('POST');
  });
  it('recovers the identical event on 409; rejects a collision, cancellation or unsafe link', async () => {
    const duplicate = () => Object.assign(new Error('duplicate'), { response: { status: 409 } });
    const send = vi.fn().mockRejectedValueOnce(duplicate()).mockResolvedValueOnce(answer());
    expect((await createCalendarWriter(send)('card', draft)).draft).toEqual(draft);
    expect(send.mock.calls[1]).toEqual([`/events/${calendarEventId('card')}`, { method: 'GET' }]);
    expect((await createCalendarWriter(vi.fn().mockResolvedValue({ ...answer(), htmlLink: 'https://www.google.com/calendar/event?eid=fixture' }))('card', draft)).url).toContain('https://www.google.com/calendar/event');
    for (const result of [{ ...answer(), id: 'other' }, { ...answer(), status: 'cancelled' }, { ...answer(), htmlLink: 'https://evil.test/' }, { ...answer(), extendedProperties: {} }, { ...answer(), summary: 'Zmienione przez użytkownika' }]) {
      await expect(createCalendarWriter(vi.fn().mockRejectedValueOnce(duplicate()).mockResolvedValueOnce(result))('card', draft)).rejects.toMatchObject({ status: 409 });
    }
  });
  it('does not surface raw auth/network errors and never calls the provider for invalid boundaries', async () => {
    await expect(createCalendarWriter(vi.fn().mockRejectedValue(new GoogleAuthError('scopes_missing')))('card', draft)).rejects.toThrow('Połącz ponownie');
    await expect(createCalendarWriter(vi.fn().mockRejectedValue(new Error('secret-test-token')))('card', draft)).rejects.not.toThrow('secret-test-token');
    const send = vi.fn(); await expect(createCalendarWriter(send)('card', { ...draft, endAt: draft.startAt })).rejects.toThrow(); expect(send).not.toHaveBeenCalled();
  });
});
