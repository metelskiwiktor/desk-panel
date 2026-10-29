import { describe, expect, it } from 'vitest';
import { calendarSourceSchema } from './calendar-contract';
import { calendarDay, dayBounds, lanes, overlaps, slotConflicts, timeAxis, visitSlotTime } from './cockpit/appointment-timeline';

const zone = 'Europe/Warsaw', day = '2026-11-09';
const at = (hour: string) => Date.parse(`${day}T${hour}:00+01:00`);
const now = at('07:00');
const event = (start: string, end: string, busy = true) => ({ id: start, title: 'Spotkanie', startAt: at(start), endAt: at(end), allDay: false, description: '', busy });
const source = () => calendarSourceSchema.parse({ name: 'Google Calendar', live: true, calendarId: 'test', status: 'connected', observedAt: now, data: [], coverage: dayBounds(day, zone) });

describe('calendar coverage and collisions', () => {
  it('only calls a day known when the complete, recent read covers the whole day', () => {
    expect(calendarDay(source(), day, zone, now).reliable).toBe(true);
    for (const change of [{ partial: true }, { status: 'offline' }, { data: null }, { observedAt: now - 120_000 }, { coverage: undefined }, { coverage: { startAt: at('08:00'), endAt: at('23:59') } }]) {
      expect(calendarDay({ ...source(), ...change } as ReturnType<typeof source>, day, zone, now).reliable).toBe(false);
    }
    expect(calendarDay(source(), '2026-11-10', zone, now).reliable).toBe(false);
    expect(calendarDay(null, day, zone, now).reliable).toBe(false);
  });
  it('uses half-open boundaries, ignores transparent events, and reports real intersections', () => {
    const events = [event('08:00', '08:20'), event('08:20', '08:40', false), event('08:40', '09:00')];
    expect(slotConflicts(at('08:20'), 20, events)).toEqual([]);
    expect(slotConflicts(at('08:20'), 30, events).map(e => e.id)).toEqual(['08:40']);
    expect(slotConflicts(at('08:00'), null, events).map(e => e.id)).toEqual(['08:00']);
    expect(slotConflicts(at('08:20'), null, events)).toEqual([]);
  });
  it('clips overnight events and respects an all-day event exclusive end', () => {
    const bounds = dayBounds(day, zone);
    const busy = { ...event('08:00', '09:00'), ...bounds, allDay: true };
    const next = { ...busy, startAt: bounds.endAt, endAt: bounds.endAt + 86_400_000 };
    const overnight = { ...event('08:00', '09:00'), startAt: bounds.startAt - 3_600_000, endAt: at('01:00') };
    const calendar = calendarDay({ ...source(), data: [busy, next, overnight] }, day, zone, now);
    expect(calendar.events).toEqual([busy, overnight]);
    expect(slotConflicts(at('23:00'), 30, calendar.events)).toEqual([busy]);
  });
  it('keeps real 23-hour and 25-hour days around Warsaw DST transitions', () => {
    const spring = dayBounds('2027-03-28', zone), autumn = dayBounds('2026-10-25', zone);
    expect(spring.endAt - spring.startAt).toBe(23 * 3_600_000);
    expect(autumn.endAt - autumn.startAt).toBe(25 * 3_600_000);
    expect(visitSlotTime(Date.parse('2026-10-25T02:30:00+02:00'), zone)).toBe('02:30 UTC+02:00');
    expect(visitSlotTime(Date.parse('2026-10-25T02:30:00+01:00'), zone)).toBe('02:30 UTC+01:00');
    expect(overlaps({ startAt: 0, endAt: 10 }, { startAt: 10, endAt: 20 })).toBe(false);
  });
});

describe('shared timeline geometry', () => {
  it('compresses only long empty intervals and maps both columns to the same scale', () => {
    const ranges = [event('08:00', '08:20'), event('13:00', '14:00')];
    const axis = timeAxis(ranges, dayBounds(day, zone), [at('08:00')]);
    expect(axis.segments.some(s => s.collapsed)).toBe(true);
    for (const segment of axis.segments.filter(s => s.collapsed)) {
      expect(ranges.some(r => overlaps(r, segment))).toBe(false);
      expect(segment.height).toBe(32);
    }
    expect(axis.y(at('08:20')) - axis.y(at('08:00'))).toBeGreaterThanOrEqual(44);
    expect(axis.y(at('13:00'))).toBeGreaterThan(axis.y(at('08:20')));
    expect(axis.y(at('14:00')) - axis.y(at('13:00'))).toBe(108);
  });
  it('places overlapping slots in separate lanes and reuses ended lanes', () => {
    const a = event('08:00', '08:30'), b = event('08:10', '08:40'), c = event('08:30', '09:00');
    const result = lanes([c, b, a]);
    expect(result.count).toBe(2);
    expect(result.items.map(i => i.lane)).toEqual([0, 1, 0]);
  });
  it('clips overnight ranges to the actual day before drawing', () => {
    const bounds = dayBounds(day, zone);
    const axis = timeAxis([{ startAt: bounds.startAt - 60_000, endAt: at('01:00') }], bounds);
    expect(axis.y(bounds.startAt)).toBe(0);
    expect(axis.segments[0].startAt).toBe(bounds.startAt);
    expect(axis.segments.at(-1)?.endAt).toBe(bounds.endAt);
  });
});
