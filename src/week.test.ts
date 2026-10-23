import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './model';
import type { TrainingActivity, TrainingWorkout } from './training-contract';
import { weekDays, withoutPlanDuplicates } from './week';

const zone = 'Europe/Warsaw';
const now = Date.parse('2026-10-24T09:20:00Z'); // Saturday 11:20 in Warsaw
const workout = (over: Partial<TrainingWorkout>): TrainingWorkout => ({
  id: 'w', name: 'Długa jazda', sport: 'cycling', date: '2026-10-24', durationSec: 5400, phrase: 'LONG_WORKOUT', trainingEffect: null, trainingEffectLabel: null,
  keyWorkout: false, restDay: false, race: false, steps: null, ...over,
});
const event = (over: Partial<CalendarEvent>): CalendarEvent => ({ id: 'e', title: 'Spotkanie', startAt: Date.parse('2026-10-24T12:45:00Z'), endAt: Date.parse('2026-10-24T13:45:00Z'), description: '', allDay: false, ...over } as CalendarEvent);
const allDay = (id: string, title: string, startDate: string, endDate: string) => event({ id, title, allDay: true, startDate, endDate, startAt: Date.parse(`${startDate}T00:00:00+02:00`), endAt: Date.parse(`${endDate}T00:00:00+02:00`) });
const ride: TrainingActivity = { startAt: Date.parse('2026-10-24T07:00:00Z'), durationSec: 5500, sport: 'indoor_cycling', avgPower: null, avgHeartRate: null, trainingStress: null };

describe('week', () => {
  it('lists seven days from today with labels', () => {
    const days = weekDays({ now, timeZone: zone, events: [], workouts: [], activities: [] });
    expect(days.map(d => d.date)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']);
    expect(days[0]).toMatchObject({ label: 'Sob', dayOfMonth: 24, today: true });
    expect(days[1]).toMatchObject({ label: 'Nd', today: false });
  });
  it('puts all-day events first, then workouts, then timed events by start, with the workout state', () => {
    const [today, sunday] = weekDays({ now, timeZone: zone,
      events: [event({ id: 'late', title: 'Wieczorem', startAt: Date.parse('2026-10-24T17:00:00Z'), endAt: Date.parse('2026-10-24T18:00:00Z') }), event({ id: 'early' }), allDay('urlop', 'Urlop', '2026-10-24', '2026-10-26')],
      workouts: [workout({ id: 'long' }), workout({ id: 'base', name: 'Baza', date: '2026-10-25', durationSec: 4380 })], activities: [ride] });
    expect(today.items.map(i => [i.kind, i.title, i.at])).toEqual([['allDay', 'Urlop', undefined], ['workout', 'Długa jazda', undefined], ['event', 'Spotkanie', '14:45'], ['event', 'Wieczorem', '19:00']]);
    expect(today.items[1]).toMatchObject({ id: 'long', state: 'done' });
    // A two-day all-day event shows on both days; Garmin's Sunday workout is only planned.
    expect(sunday.items.map(i => i.title)).toEqual(['Urlop', 'Baza']);
    expect(sunday.items.at(-1)).toMatchObject({ state: 'planned' });
  });
  it('cuts days in the account time zone', () => {
    const lateRide = event({ id: 'night', title: 'Nocna', startAt: Date.parse('2026-10-24T22:30:00Z'), endAt: Date.parse('2026-10-24T23:30:00Z') });
    const days = weekDays({ now, timeZone: zone, events: [lateRide], workouts: [], activities: [] });
    expect(days[0].items).toEqual([]); // 00:30 on the 25th in Warsaw
    expect(days[1].items.map(i => i.title)).toEqual(['Nocna']);
  });
  it('skips rest days', () => {
    const days = weekDays({ now, timeZone: zone, events: [], workouts: [workout({ restDay: true, name: 'Odpoczynek' })], activities: [] });
    expect(days[0].items).toEqual([]);
  });
  it('drops the old subscribed-calendar copies of Garmin workouts but keeps other all-day events', () => {
    const events = [allDay('copy', 'Długa jazda', '2026-10-24', '2026-10-25'), allDay('other', 'Urlop', '2026-10-24', '2026-10-25'), allDay('elsewhere', 'Długa jazda', '2026-10-30', '2026-10-31')];
    expect(withoutPlanDuplicates(events, [workout({})]).map(e => e.id)).toEqual(['other', 'elsewhere']);
    expect(withoutPlanDuplicates(events, []).map(e => e.id)).toEqual(['copy', 'other', 'elsewhere']);
  });
});
