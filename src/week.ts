import type { CalendarEvent } from './model';
import type { TrainingActivity, TrainingWorkout } from './training-contract';
import { addDays, localDate, workoutProgress, type WorkoutState } from './training-progress';

export interface WeekItem {
  kind: 'allDay' | 'event' | 'workout';
  /** Calendar event id or workout id, for opening the detail. */
  id: string;
  title: string;
  /** Start time of a timed event, "11:00". */
  at?: string;
  workout?: TrainingWorkout;
  state?: WorkoutState;
}
export interface WeekDay {
  date: string;
  /** "Sob", "Nd". */
  label: string;
  dayOfMonth: number;
  today: boolean;
  items: WeekItem[];
}

const clock = (at: number, timeZone: string) => new Date(at).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone });
const SHORT_DAYS = ['Nd', 'Pn', 'Wt', 'Śr', 'Czw', 'Pt', 'Sob'];

/** The Garmin plan used to reach the calendar as all-day events of a subscribed calendar; once the plan comes from Garmin itself those are the same workouts twice. */
export function withoutPlanDuplicates(events: CalendarEvent[], workouts: TrainingWorkout[]): CalendarEvent[] {
  return events.filter(e => !(e.allDay && e.startDate && workouts.some(w => w.date === e.startDate && w.name.toLowerCase() === e.title.trim().toLowerCase())));
}

/**
 * `days` calendar days from today with what each holds: all-day events, the workouts, then timed events by start.
 * Days are cut in the given time zone, so a ride at 00:30 belongs to the day it was ridden.
 */
export function weekDays(options: { now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[]; days?: number }): WeekDay[] {
  const { now, timeZone, workouts, activities } = options;
  const today = localDate(now, timeZone);
  const events = withoutPlanDuplicates(options.events, workouts);
  return Array.from({ length: options.days ?? 7 }, (_, index) => {
    const date = addDays(today, index);
    const noon = Date.parse(`${date}T12:00:00Z`);
    const items: WeekItem[] = [
      ...events.filter(e => e.allDay && e.startDate && e.endDate && e.startDate <= date && date < e.endDate)
        .map((e): WeekItem => ({ kind: 'allDay', id: e.id, title: e.title })),
      ...workouts.filter(w => w.date === date && !w.restDay)
        .map((w): WeekItem => ({ kind: 'workout', id: w.id, title: w.name, workout: w, state: workoutProgress(w, activities, now, timeZone).state })),
      ...events.filter(e => !e.allDay && localDate(e.startAt, timeZone) === date).sort((a, b) => a.startAt - b.startAt)
        .map((e): WeekItem => ({ kind: 'event', id: e.id, title: e.title, at: clock(e.startAt, timeZone) })),
    ];
    return { date, label: SHORT_DAYS[new Date(noon).getUTCDay()],
      dayOfMonth: Number(date.slice(8)), today: index === 0, items };
  });
}
