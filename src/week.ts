import type { CalendarEvent } from './model';
import type { TrainingActivity, TrainingWorkout } from './training-contract';
import { addDays, localDate, workoutProgress, type WorkoutState } from './training-progress';
import { formatDuration } from './training-view';

export interface WeekItem {
  kind: 'allDay' | 'event' | 'workout';
  /** Calendar event id or workout id, for opening the detail. */
  id: string;
  title: string;
  /** Start time of a timed event, "11:00". */
  at?: string;
  startAt?: number;
  endAt?: number;
  workout?: TrainingWorkout;
  state?: WorkoutState;
}
export interface WeekDay {
  date: string;
  /** "Sob", "Nd". */
  label: string;
  dayOfMonth: number;
  today: boolean;
  /** Before today: shown, but the sources are read from today on. */
  past: boolean;
  items: WeekItem[];
}

/** "Śr 14, dziś": the day as the panel names it. */
export function dayTitle(day: WeekDay): string {
  return `${day.label} ${day.dayOfMonth}${day.today ? ', dziś' : ''}`;
}

/** One day for the agent: its date and weekday, then a line per planned item (a free day has none). */
export function dayText(day: WeekDay): string {
  const lines = day.items.map(i => `- ${i.workout ? 'Trening: ' : ''}${i.title}${i.at ? `, ${i.at}` : i.workout ? '' : ', cały dzień'}${i.workout?.durationSec ? `, ${formatDuration(i.workout.durationSec)}` : ''}`);
  return [`Dzień: ${day.date} (${dayTitle(day)})`, ...lines].join('\n');
}

const clock = (at: number, timeZone: string) => new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
export const SHORT_DAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];

/** The Garmin plan used to reach the calendar as all-day events of a subscribed calendar; once the plan comes from Garmin itself those are the same workouts twice. */
export function withoutPlanDuplicates(events: CalendarEvent[], workouts: TrainingWorkout[]): CalendarEvent[] {
  return events.filter(e => !(e.allDay && e.startDate && workouts.some(w => w.date === e.startDate && w.name.toLowerCase() === e.title.trim().toLowerCase())));
}

interface DayContext { now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[] }

function buildDay(date: string, today: string, context: DayContext): WeekDay {
  const { now, timeZone, events, workouts, activities } = context;
  const noon = Date.parse(`${date}T12:00:00Z`);
  const items: WeekItem[] = [
    ...events.filter(e => e.allDay && e.startDate && e.endDate && e.startDate <= date && date < e.endDate)
      .map((e): WeekItem => ({ kind: 'allDay', id: e.id, title: e.title })),
    ...workouts.filter(w => w.date === date && !w.restDay)
      .map((w): WeekItem => ({ kind: 'workout', id: w.id, title: w.name, workout: w, state: workoutProgress(w, activities, now, timeZone).state })),
    ...events.filter(e => !e.allDay && localDate(e.startAt, timeZone) === date).sort((a, b) => a.startAt - b.startAt)
      .map((e): WeekItem => ({ kind: 'event', id: e.id, title: e.title, at: clock(e.startAt, timeZone), endAt: e.endAt, startAt: e.startAt })),
  ];
  return { date, label: SHORT_DAYS[new Date(noon).getUTCDay()], dayOfMonth: Number(date.slice(8)), today: date === today, past: date < today, items };
}

/** One day, whatever its distance from today. */
export function dayOf(date: string, options: { now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[] }): WeekDay {
  return buildDay(date, localDate(options.now, options.timeZone), { ...options, events: withoutPlanDuplicates(options.events, options.workouts) });
}

/**
 * `days` calendar days from today with what each holds: all-day events, the workouts, then timed events by start.
 * Days are cut in the given time zone, so a ride at 00:30 belongs to the day it was ridden.
 */
export function weekDays(options: { now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[]; days?: number }): WeekDay[] {
  const today = localDate(options.now, options.timeZone);
  const context = { ...options, events: withoutPlanDuplicates(options.events, options.workouts) };
  return Array.from({ length: options.days ?? 7 }, (_, index) => buildDay(addDays(today, index), today, context));
}

/** Monday on or before `day`. */
export function mondayOf(day: string): string {
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  return addDays(day, -((weekday + 6) % 7));
}

/**
 * Five weeks from this week's Monday, for the month view. The days of this week that have passed are in the grid
 * (so each week has seven cells) but empty: the calendar is read from today on.
 */
export function monthDays(options: { now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[]; weeks?: number }): WeekDay[] {
  const today = localDate(options.now, options.timeZone);
  const context = { ...options, events: withoutPlanDuplicates(options.events, options.workouts) };
  const first = mondayOf(today);
  return Array.from({ length: (options.weeks ?? 5) * 7 }, (_, index) => buildDay(addDays(first, index), today, context));
}
