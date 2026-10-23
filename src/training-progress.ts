import type { TrainingActivity, TrainingWorkout } from './training-contract';

/** Garmin's own link between a plan entry and its recording (`associatedActivityId`) is often empty, so progress is judged from the day's recordings. */
export const DONE_RATIO = 0.8;
/** Shorter recordings (a bike computer started by accident) do not count. */
export const MIN_ACTIVITY_SEC = 120;

export type WorkoutState = 'rest' | 'planned' | 'done' | 'partial' | 'missed';
export interface WorkoutProgress {
  state: WorkoutState;
  /** Seconds recorded that day in the workout's sport. */
  doneSec: number;
  /** doneSec / planned duration; null without a planned duration. */
  ratio: number | null;
}

type Family = 'cycling' | 'running' | 'swimming' | string;
const family = (key: string): Family => {
  const k = key.toLowerCase();
  if (/cycl|bik|ride/.test(k)) return 'cycling';
  if (/run|trail/.test(k)) return 'running';
  if (/swim/.test(k)) return 'swimming';
  return k;
};
export const sameSport = (workoutSport: string, activitySport: string) => family(workoutSport) === family(activitySport);

/** Calendar day (YYYY-MM-DD) of an instant in the given time zone. */
export function localDate(at: number, timeZone: string): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function workoutProgress(workout: TrainingWorkout, activities: TrainingActivity[], now: number, timeZone: string): WorkoutProgress {
  if (workout.restDay) return { state: 'rest', doneSec: 0, ratio: null };
  const doneSec = Math.round(activities
    .filter(a => a.durationSec >= MIN_ACTIVITY_SEC && sameSport(workout.sport, a.sport) && localDate(a.startAt, timeZone) === workout.date)
    .reduce((sum, a) => sum + a.durationSec, 0));
  const ratio = workout.durationSec ? doneSec / workout.durationSec : null;
  if (doneSec > 0 && (ratio === null || ratio >= DONE_RATIO)) return { state: 'done', doneSec, ratio };
  if (doneSec > 0) return { state: 'partial', doneSec, ratio };
  return { state: workout.date < localDate(now, timeZone) ? 'missed' : 'planned', doneSec, ratio };
}
