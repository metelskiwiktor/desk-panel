import type { CalendarEvent } from './model';
import { todayAgenda } from './agenda';
import { time } from './format';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** The ribbon covers at least these hours; an early or late meeting widens it. */
const DEFAULT_FROM = 6, DEFAULT_TO = 22;
/** A meeting this close, or already on, takes the focus slot. */
export const FOCUS_WITHIN_MS = 15 * MINUTE;

export interface RibbonBlock {
  event: CalendarEvent;
  /** Position and size in percent of the ribbon width. */
  left: number;
  width: number;
  /** Overlapping meetings stack in lanes; `lanes` is how many share this block's time. */
  lane: number;
  lanes: number;
  past: boolean;
  ongoing: boolean;
}
export interface DayRibbon {
  fromHour: number;
  toHour: number;
  nowPct: number;
  blocks: RibbonBlock[];
  /** All-day events of today (the Garmin duplicates are removed by the caller). */
  allDay: CalendarEvent[];
  hours: { label: string; pct: number }[];
  /** "2 spotkania · najbliższe za 12 min", "bez spotkań". */
  summary: string;
  /** The meeting on now or about to start, when it should take the focus. */
  focus: { block: RibbonBlock; startsIn: number } | null;
}

const dayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };
const nextDayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + 1); return d.getTime(); };

/** Today's whole day as a horizontal ribbon: what is past, what is on, what is still to come. */
export function dayRibbon(events: CalendarEvent[], now: number): DayRibbon {
  const start = dayStart(now), end = nextDayStart(now);
  const timed = events.filter(e => !e.allDay && e.startAt < end && e.endAt > start).sort((a, b) => a.startAt - b.startAt);
  const hourOf = (at: number) => (Math.min(Math.max(at, start), end) - start) / HOUR;
  const first = timed.length ? Math.floor(hourOf(timed[0].startAt)) : DEFAULT_FROM;
  const last = timed.length ? Math.ceil(Math.max(...timed.map(e => hourOf(e.endAt)))) : DEFAULT_TO;
  const fromHour = Math.min(DEFAULT_FROM, first), toHour = Math.min(24, Math.max(DEFAULT_TO, last));
  const pct = (at: number) => Math.max(0, Math.min(100, ((hourOf(at) - fromHour) / (toHour - fromHour)) * 100));
  const laneEnds: number[] = [];
  const placed = timed.map(event => {
    let lane = laneEnds.findIndex(endAt => endAt <= event.startAt);
    if (lane < 0) lane = laneEnds.push(0) - 1;
    laneEnds[lane] = event.endAt;
    return { event, lane, left: pct(event.startAt), width: Math.max(0.6, pct(event.endAt) - pct(event.startAt)), past: event.endAt <= now, ongoing: event.startAt <= now && event.endAt > now };
  });
  const blocks = placed.map(b => ({ ...b, lanes: placed.some(o => o !== b && o.event.startAt < b.event.endAt && b.event.startAt < o.event.endAt) ? laneEnds.length : 1 }));
  const hours: DayRibbon['hours'] = [];
  for (let h = fromHour + (fromHour % 2); h <= toHour; h += 2) hours.push({ label: `${String(h % 24).padStart(2, '0')}`, pct: ((h - fromHour) / (toHour - fromHour)) * 100 });
  const upcoming = blocks.find(b => b.ongoing || (!b.past && b.event.startAt - now <= FOCUS_WITHIN_MS));
  const agenda = todayAgenda(events, now);
  return {
    fromHour, toHour, nowPct: pct(now), blocks, allDay: agenda.allDay, hours,
    summary: blocks.some(b => !b.past) || agenda.allDay.length ? agenda.summary : blocks.length ? 'to już wszystko na dziś' : 'bez spotkań',
    focus: upcoming ? { block: upcoming, startsIn: Math.max(0, upcoming.event.startAt - now) } : null,
  };
}

/** "13 min", "1 h 05". */
export function countdown(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / MINUTE));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}
export const meetingRange = (event: CalendarEvent) => `${time(event.startAt)}–${time(event.endAt)}`;
