import { DateTime } from 'luxon';
import type { CalendarSource } from '../calendar-contract';

export const visitDay = (at: number, zone: string) => DateTime.fromMillis(at, { zone }).toISODate()!;
export const visitTime = (at: number, zone: string) => DateTime.fromMillis(at, { zone }).toFormat('HH:mm');
/** The autumn clock hour occurs twice; give the human the offset, too. */
export function visitSlotTime(at: number, zone: string) {
  const d = DateTime.fromMillis(at, { zone }), start = d.startOf('day');
  return d.toFormat(start.plus({ days: 1 }).toMillis() - start.toMillis() > 86_400_000 ? "HH:mm 'UTC'ZZ" : 'HH:mm');
}
export function dayBounds(day: string, zone: string) {
  const start = DateTime.fromISO(day, { zone }).startOf('day');
  return { startAt: start.toMillis(), endAt: start.plus({ days: 1 }).toMillis() };
}
export const overlaps = (a: { startAt: number; endAt: number }, b: { startAt: number; endAt: number }) => a.startAt < b.endAt && b.startAt < a.endAt;
export function calendarDay(source: CalendarSource | null, day: string, zone: string, now: number) {
  const bounds = dayBounds(day, zone);
  const events = (source?.data ?? []).filter(e => overlaps(e, bounds));
  const reliable = !!source && source.status === 'connected' && !source.partial && source.data !== null && source.observedAt !== null
    && now - source.observedAt < 120_000 && !!source.coverage && source.coverage.startAt <= bounds.startAt && source.coverage.endAt >= bounds.endAt;
  const reason = !source ? 'Wczytuję kalendarz…' : source.status !== 'connected' ? 'Kalendarz jest niedostępny. Pokazuję ostatni odczyt, jeśli istnieje.'
    : source.partial ? 'Odczyt kalendarza jest niepełny.' : !source.coverage || source.coverage.startAt > bounds.startAt || source.coverage.endAt < bounds.endAt ? 'Ten dzień jest poza odczytanym zakresem kalendarza.'
    : source.observedAt === null || now - source.observedAt >= 120_000 ? 'Odczyt kalendarza jest nieaktualny.' : '';
  return { ...bounds, events, reliable, reason };
}
export function slotConflicts(startAt: number, duration: number | null, events: CalendarSource['data']) {
  return (events ?? []).filter(e => e.busy !== false && (duration === null ? e.startAt <= startAt && startAt < e.endAt : overlaps({ startAt, endAt: startAt + duration * 60_000 }, e)));
}
export interface TimeRange { startAt: number; endAt: number }
/** One shared, piecewise time scale for both columns. Only empty intervals may collapse. */
export function timeAxis(ranges: TimeRange[], bounds: TimeRange, starts: number[] = []) {
  const clipped = ranges.map(r => ({ startAt: Math.max(bounds.startAt, r.startAt), endAt: Math.min(bounds.endAt, r.endAt) })).filter(r => r.endAt > r.startAt);
  const points = [...new Set([bounds.startAt, bounds.endAt, ...clipped.flatMap(r => [r.startAt, r.endAt]), ...starts.filter(t => t >= bounds.startAt && t < bounds.endAt)])].sort((a, b) => a - b);
  let height = 0;
  const segments = points.slice(0, -1).map((startAt, i) => {
    const endAt = points[i + 1], minutes = (endAt - startAt) / 60_000;
    const empty = !clipped.some(r => overlaps(r, { startAt, endAt }));
    const collapsed = empty && minutes >= 45;
    const size = collapsed ? 32 : Math.max(starts.includes(startAt) ? 46 : 20, minutes * 1.8);
    const segment = { startAt, endAt, top: height, height: size, collapsed };
    height += size;
    return segment;
  });
  const y = (at: number) => {
    if (at >= bounds.endAt) return height;
    const s = segments.find(s => at >= s.startAt && at < s.endAt);
    return s ? s.top + (at - s.startAt) / (s.endAt - s.startAt) * s.height : 0;
  };
  return { segments, y, height };
}
/** Interval partitioning: dense, overlapping starts stay separate clickable buttons. */
export function lanes<T extends TimeRange>(ranges: T[]) {
  const ends: number[] = [];
  const items: { range: T; lane: number; count: number }[] = [];
  let group: typeof items = [], groupEnd = -Infinity, maxCount = 1;
  const finish = () => { for (const item of group) item.count = ends.length; maxCount = Math.max(maxCount, ends.length); group = []; ends.length = 0; };
  for (const range of [...ranges].sort((a, b) => a.startAt - b.startAt)) {
    if (range.startAt >= groupEnd) finish();
    let lane = ends.findIndex(end => end <= range.startAt);
    if (lane < 0) lane = ends.length;
    ends[lane] = range.endAt;
    const item = { range, lane, count: 1 };
    items.push(item); group.push(item); groupEnd = Math.max(groupEnd, range.endAt);
  }
  finish();
  return { items, count: maxCount };
}
