import { describe, expect, it } from 'vitest';
import { plural, relative, todayAgenda } from './agenda';
import type { CalendarEvent } from './model';

// Local time, so the tests hold in any time zone.
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m).getTime();
const now = at(15, 14, 40); // czwartek 15 października, 14:40
let id = 0;
const event = (title: string, start: number, end: number, extra: Partial<CalendarEvent> = {}): CalendarEvent =>
  ({ id: String(++id), title, startAt: start, endAt: end, description: '', ...extra });

describe('agenda dnia', () => {
  it('formats Polish counts and relative times', () => {
    expect([1, 2, 5, 12, 22].map(n => plural(n, 'spotkanie', 'spotkania', 'spotkań'))).toEqual(['spotkanie', 'spotkania', 'spotkań', 'spotkań', 'spotkania']);
    expect(relative(12 * 60_000)).toBe('za 12 min');
    expect(relative(110 * 60_000)).toBe('za 1 h 50 min');
  });
  it('places today\'s remaining meetings on an axis from the current hour', () => {
    const agenda = todayAgenda([event('Rano', at(15, 9), at(15, 10)), event('Fryzjer', at(15, 16, 30), at(15, 17, 30)), event('Jutro', at(16, 9), at(16, 10))], now);
    expect(agenda.blocks.map(b => b.event.title)).toEqual(['Fryzjer']);
    expect(agenda.hours[0].label).toBe('14:00');
    expect(agenda.hours.at(-1)!.label).toBe('20:00'); // at least six hours
    expect(agenda.blocks[0]).toMatchObject({ rel: 'za 1 h 50 min', lanes: 1 });
    expect(agenda.blocks[0].top).toBeCloseTo(2.5 / 6 * 100);
    expect(agenda.nowTop).toBeCloseTo(40 / 360 * 100);
    expect(agenda.summary).toBe('1 spotkanie · za 1 h 50 min');
  });
  it('puts overlapping meetings side by side and marks one in progress', () => {
    const agenda = todayAgenda([event('A', at(15, 14), at(15, 15)), event('B', at(15, 14, 30), at(15, 16)), event('C', at(15, 18), at(15, 19))], now);
    expect(agenda.blocks.map(b => [b.event.title, b.lane, b.lanes])).toEqual([['A', 0, 2], ['B', 1, 2], ['C', 0, 1]]);
    expect(agenda.blocks[0]).toMatchObject({ ongoing: true, rel: 'trwa · do 15:00' });
    expect(agenda.summary).toBe('3 spotkania · jedno trwa');
  });
  it('has no axis without timed meetings and keeps all-day ones apart', () => {
    expect(todayAgenda([], now)).toMatchObject({ blocks: [], hours: [], summary: 'bez spotkań' });
    const allDay = event('Urlop', at(15, 0), at(16, 0), { allDay: true });
    expect(todayAgenda([allDay], now)).toMatchObject({ allDay: [allDay], summary: 'cały dzień' });
  });
});
