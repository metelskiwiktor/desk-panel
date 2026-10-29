import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { loadScenario } from '../server/scenario';
import { createAppointments } from '../server/appointments';
import { appointmentPreviewSchema } from './appointment-contract';
import { CardActions } from './cockpit/cards';
import { AppointmentCard, endFromTime, safeBookingUrl } from './cockpit/appointment-card';
const NOW = Date.parse('2026-10-29T12:00:00+01:00');
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function setup(canWrite = true, duration: number | null = 30) {
  const p = { ...appointmentPreviewSchema.parse(loadScenario('scenarios/wizyty.json', NOW).appointment), durationMinutes: duration };
  const writeCalendar = vi.fn(async (key, draft) => ({ id: key, draft, url: 'https://calendar.google.com/calendar/event?eid=scenario', at: NOW }));
  const service = createAppointments({ read: async () => p, writeCalendar, canWriteCalendar: async () => canWrite, now: () => NOW });
  await service.propose(p.query);
  const respond = vi.fn(async (_id, response) => { await service.act('chat:card', p.id, response.action); });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json(await service.view('chat:card', p.id))));
  const props = { toolCallId: 'm:v-1111111111111111', toolName: 'appointment', args: {}, argsText: '{}', result: undefined, status: { type: 'complete' } } as ComponentProps<typeof AppointmentCard>;
  render(<CardActions.Provider value={{ chatId: 'chat', respond, running: false }}><AppointmentCard {...props} /></CardActions.Provider>);
  await screen.findByRole('button', { name: 'Wybieram termin' });
  return { user: userEvent.setup(), respond, writeCalendar, service, p };
}
describe('the days and times card', () => {
  it('keeps the day and time separate, fills fields, opens an isolated link, writes only on explicit confirmation', async () => {
    const x = await setup();
    expect(x.respond).not.toHaveBeenCalled(); expect(x.writeCalendar).not.toHaveBeenCalled();
    await x.user.click(screen.getByRole('button', { name: '08:00' }));
    await x.user.click(screen.getByRole('button', { name: 'Wybieram 08:00' }));
    const link = await screen.findByRole('link', { name: /Otwórz ZnanyLekarz/ });
    expect(link.getAttribute('target')).toBe('_blank'); expect(link.getAttribute('rel')).toContain('noopener');
    expect((await screen.findByLabelText('Nazwa wydarzenia') as HTMLInputElement).value).toBe('Wizyta — lek. Anna Maj');
    expect((screen.getByLabelText('Godzina zakończenia') as HTMLInputElement).value).toBe('08:30');
    expect(x.writeCalendar).not.toHaveBeenCalled();
    await x.user.click(screen.getByRole('button', { name: 'Zarezerwowałem ten termin — zapisz' }));
    await screen.findByText('Zapisano w Google Calendar'); expect(x.writeCalendar).toHaveBeenCalledTimes(1);
  });
  it('keeps the selected visit but blocks calendar writes while consent is missing', async () => {
    const x = await setup(false); await x.user.click(screen.getByRole('button', { name: '08:00' }));
    await x.user.click(screen.getByRole('button', { name: 'Wybieram 08:00' }));
    await screen.findByRole('link', { name: /Otwórz ZnanyLekarz/ });
    expect(screen.getByRole('button', { name: 'Zarezerwowałem ten termin — zapisz' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/Połącz ponownie konto Google/)).toBeTruthy(); expect(x.writeCalendar).not.toHaveBeenCalled();
  });
  it('requires an explicit end only if the service really did not provide duration', async () => {
    const x = await setup(true, null); await x.user.click(screen.getByRole('button', { name: '08:00' }));
    await x.user.click(screen.getByRole('button', { name: 'Wybieram 08:00' }));
    await screen.findByRole('link', { name: /Otwórz ZnanyLekarz/ });
    expect((screen.getByLabelText('Godzina zakończenia') as HTMLInputElement).value).toBe('');
    expect(screen.getByRole('button', { name: 'Zarezerwowałem ten termin — zapisz' }).hasAttribute('disabled')).toBe(true);
    expect(x.writeCalendar).not.toHaveBeenCalled();
  });
});
it('rejects unsafe booking URLs and resolves end-time corrections across DST without inventing a nonexistent hour', () => {
  expect(safeBookingUrl('https://evil.test/booking/wybierz-wizyte/1/2/time')).toBeNull();
  expect(safeBookingUrl('javascript:alert(1)')).toBeNull();
  expect(endFromTime('02:30', Date.parse('2027-03-28T01:30:00+01:00'), 'Europe/Warsaw')).toBeNull();
  const repeated = Date.parse('2026-10-25T02:30:00+01:00');
  expect(endFromTime('02:40', repeated, 'Europe/Warsaw')).toBe(repeated + 10 * 60_000);
  expect(endFromTime('25:10', repeated, 'Europe/Warsaw')).toBeNull();
});
