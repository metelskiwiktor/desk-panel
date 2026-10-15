import type { CalendarEvent } from './model';
import { time } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const plural = (n: number, one: string, few: string, many: string) =>
  n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

/** "za 12 min", "za 1 h 50 min", "za 4 h". */
export function relative(ms: number) {
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  if (minutes < 60) return `za ${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `za ${h} h${m ? ` ${m} min` : ''}`;
}
/** "30 min", "1 h", "1 h 30 min". */
export function duration(ms: number) {
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return `${h} h${m ? ` ${m} min` : ''}`;
}
function startOfDay(at: number, plusDays = 0) {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + plusDays); // Calendar days, so DST changes keep midnight.
  return d.getTime();
}
const floorHour = (at: number) => { const d = new Date(at); d.setMinutes(0, 0, 0); return d.getTime(); };
const ceilHour = (at: number) => { const f = floorHour(at); return f === at ? at : f + HOUR; };
const dayLabel = (at: number) => {
  const d = new Date(at);
  return `${d.toLocaleDateString('pl-PL', { weekday: 'short' }).replace('.', '')} ${d.getDate()}`;
};

export interface AgendaBlock {
  event: CalendarEvent;
  /** Position and size within the axis, in percent of its height. */
  top: number;
  height: number;
  /** Overlapping meetings sit side by side. */
  lane: number;
  lanes: number;
  ongoing: boolean;
  rel: string;
}
export interface TodayAgenda {
  blocks: AgendaBlock[];
  allDay: CalendarEvent[];
  hours: { label: string; top: number }[];
  nowTop: number;
  summary: string;
}

/** Today's remaining meetings on an hour axis from now (or the meeting in progress) to at least six hours later. */
export function todayAgenda(events: CalendarEvent[], now: number): TodayAgenda {
  const end = startOfDay(now, 1);
  const timed = events.filter(e => !e.allDay && e.endAt > now && e.startAt < end).sort((a, b) => a.startAt - b.startAt);
  const allDay = events.filter(e => e.allDay && e.startAt < end && e.endAt > now);
  if (!timed.length) return { blocks: [], allDay, hours: [], nowTop: 0, summary: allDay.length ? 'cały dzień' : 'bez spotkań' };
  const from = floorHour(Math.min(now, timed[0].startAt));
  const to = Math.min(end, Math.max(ceilHour(Math.max(...timed.map(e => e.endAt))), from + 6 * HOUR));
  const pct = (at: number) => Math.max(0, Math.min(100, ((at - from) / (to - from)) * 100));
  const laneEnds: number[] = [];
  const placed = timed.map(event => {
    let lane = laneEnds.findIndex(endAt => endAt <= event.startAt);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = event.endAt;
    const ongoing = event.startAt <= now;
    return { event, lane, top: pct(event.startAt), height: pct(event.endAt) - pct(event.startAt), ongoing,
      rel: ongoing ? `trwa · do ${time(event.endAt)}` : relative(event.startAt - now) };
  });
  const blocks = placed.map(b => ({ ...b,
    lanes: placed.some(o => o !== b && o.event.startAt < b.event.endAt && b.event.startAt < o.event.endAt) ? laneEnds.length : 1 }));
  const hours = [];
  for (let at = from; at <= to; at += HOUR) hours.push({ label: time(at), top: pct(at) });
  const first = blocks[0];
  const count = `${blocks.length} ${plural(blocks.length, 'spotkanie', 'spotkania', 'spotkań')}`;
  return { blocks, allDay, hours, nowTop: pct(now),
    summary: first.ongoing ? `${count} · jedno trwa` : `${count} · ${blocks.length > 1 ? 'najbliższe ' : ''}${first.rel}` };
}

export type UpcomingDay =
  | { kind: 'day'; label: string; rel: string; items: { event: CalendarEvent; time: string; duration: string }[] }
  | { kind: 'free'; label: string; rel: string };

/** The next `days` days grouped by day; consecutive days without events fold into one line. */
export function upcomingDays(events: CalendarEvent[], now: number, days = 6): UpcomingDay[] {
  const result: UpcomingDay[] = [];
  let freeRun: number[] = [];
  const flush = () => {
    if (!freeRun.length) return;
    const n = freeRun.length;
    result.push({ kind: 'free', label: n === 1 ? dayLabel(freeRun[0]) : `${dayLabel(freeRun[0])} – ${dayLabel(freeRun[n - 1])}`,
      rel: `wolne · ${n} ${plural(n, 'dzień', 'dni', 'dni')}` });
    freeRun = [];
  };
  for (let i = 1; i <= days; i++) {
    const from = startOfDay(now, i), to = startOfDay(now, i + 1);
    const items = events.filter(e => e.startAt < to && e.endAt > from && (e.allDay || e.startAt >= from))
      .sort((a, b) => Number(!a.allDay) - Number(!b.allDay) || a.startAt - b.startAt)
      .map(event => ({ event, time: event.allDay ? 'cały dzień' : time(event.startAt), duration: event.allDay ? '' : duration(event.endAt - event.startAt) }));
    if (!items.length) { freeRun.push(from); continue; }
    flush();
    result.push({ kind: 'day', label: dayLabel(from), rel: i === 1 ? 'jutro' : `za ${i} ${plural(i, 'dzień', 'dni', 'dni')}`, items });
  }
  flush();
  return result;
}
