import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from './model';
import { countdown, dayRibbon } from './day-ribbon';

/** Local wall-clock times, like the dashboard reads them, so the tests hold in any time zone. */
const at = (h: number, m = 0, day = 24) => new Date(2026, 9, day, h, m).getTime();
const meeting = (id: string, from: number, to: number, title = id): CalendarEvent => ({ id, title, startAt: from, endAt: to, description: '', allDay: false });

describe('day ribbon', () => {
  it('is an empty working day without meetings', () => {
    const ribbon = dayRibbon([], at(11, 20));
    expect(ribbon).toMatchObject({ fromHour: 6, toHour: 22, blocks: [], summary: 'bez spotkań', focus: null });
    expect(ribbon.nowPct).toBeCloseTo(((11 + 20 / 60 - 6) / 16) * 100);
    expect(ribbon.hours.map(h => h.label)).toEqual(['06', '08', '10', '12', '14', '16', '18', '20', '22']);
  });
  it('places a meeting on the day and keeps it out of the focus until it is near', () => {
    const early = dayRibbon([meeting('r', at(14, 45), at(15, 45))], at(11, 20));
    expect(early.blocks).toHaveLength(1);
    expect(early.blocks[0].left).toBeCloseTo(((14.75 - 6) / 16) * 100);
    expect(early.blocks[0].width).toBeCloseTo((1 / 16) * 100);
    expect(early.focus).toBeNull();
    expect(early.summary).toMatch(/1 spotkanie/);
  });
  it('takes the focus 15 minutes before and while it is on, with the time left to the start', () => {
    const events = [meeting('r', at(14, 45), at(15, 45))];
    expect(dayRibbon(events, at(14, 29)).focus).toBeNull();
    const near = dayRibbon(events, at(14, 32));
    expect(near.focus).toMatchObject({ startsIn: 13 * 60_000 });
    expect(near.focus?.block.ongoing).toBe(false);
    const on = dayRibbon(events, at(15, 0));
    expect(on.focus?.block.ongoing).toBe(true);
    expect(on.focus?.startsIn).toBe(0);
    expect(dayRibbon(events, at(15, 46)).focus).toBeNull();
  });
  it('marks finished meetings as past and says so when nothing is left', () => {
    const ribbon = dayRibbon([meeting('a', at(9), at(10))], at(11, 20));
    expect(ribbon.blocks[0].past).toBe(true);
    expect(ribbon.summary).toBe('to już wszystko na dziś');
  });
  it('stacks overlapping meetings in lanes', () => {
    const ribbon = dayRibbon([meeting('a', at(10), at(12)), meeting('b', at(11), at(13)), meeting('c', at(13), at(14))], at(9));
    expect(ribbon.blocks.map(b => [b.event.id, b.lane, b.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 1]]);
  });
  it('widens for an early or late meeting but never past the day', () => {
    const wide = dayRibbon([meeting('a', at(5, 30), at(6, 30)), meeting('b', at(21), at(23, 30))], at(12));
    expect(wide).toMatchObject({ fromHour: 5, toHour: 24 });
    expect(wide.hours.at(-1)?.label).toBe('00');
  });
  it('lists today\'s all-day events and ignores other days', () => {
    const allDay = { ...meeting('d', at(0), at(0, 0, 25), 'Urlop'), allDay: true, startDate: '2026-10-24', endDate: '2026-10-25' };
    const ribbon = dayRibbon([allDay, meeting('tomorrow', at(10, 0, 25), at(11, 0, 25))], at(11));
    expect(ribbon.allDay.map(e => e.id)).toEqual(['d']);
    expect(ribbon.blocks).toEqual([]);
    expect(ribbon.summary).toBe('cały dzień');
  });
  it('counts down in minutes and hours', () => {
    expect([countdown(13 * 60_000), countdown(30_000), countdown(65 * 60_000)]).toEqual(['13 min', '1 min', '1 h 05']);
  });
});
