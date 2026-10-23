import { useCallback, useEffect, useRef, useState } from 'react';
import { countdown } from './day-ribbon';
import { time } from './format';
import type { CalendarEvent, Task } from './model';
import type { TrainingActivity, TrainingWorkout } from './training-contract';
import { addDays, localDate, workoutProgress } from './training-progress';
import { formatDuration } from './training-view';

const MINUTE = 60_000;
/** The panel falls back to a quiet clock after this long without a touch; at night sooner. */
export const AMBIENT_AFTER_MS = 10 * MINUTE;
export const AMBIENT_AFTER_NIGHT_MS = 2 * MINUTE;
/** Between these hours (local) the clock is dimmer still. */
export const NIGHT_FROM = 23, NIGHT_TO = 6;
/** The picture drifts a few pixels each minute, so a clock left on for weeks does not burn into the panel. */
const SHIFT_STEPS = 5, SHIFT_PX = 7;

export const isNight = (at: number) => { const h = new Date(at).getHours(); return h >= NIGHT_FROM || h < NIGHT_TO; };

/** `?ambient=day|night` shows the quiet clock at once (to look at it, or to screenshot it). */
export function forcedAmbient(search = typeof location === 'undefined' ? '' : location.search): 'day' | 'night' | null {
  const value = new URLSearchParams(search).get('ambient');
  return value === 'day' || value === 'night' ? value : null;
}

/** Deterministic drift for the minute: a walk over a small grid rather than random jumps. */
export function pixelShift(at: number) {
  const step = Math.floor(at / MINUTE);
  return { x: ((step * 2) % SHIFT_STEPS - 2) * SHIFT_PX, y: ((step * 3) % SHIFT_STEPS - 2) * SHIFT_PX };
}

export interface AmbientState { ambient: boolean; night: boolean; wake: () => void }
/**
 * Idle detection. While the clock shows, only `wake` (the tap on the clock itself) ends it, so the tap that wakes the
 * panel never lands on a button underneath. Polling and the data underneath keep running.
 */
export function useAmbient(enabled: boolean, now: number): AmbientState {
  const forced = forcedAmbient();
  const lastTouch = useRef(Date.now());
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (!enabled) { setAsleep(false); return; }
    const touched = () => { lastTouch.current = Date.now(); };
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const name of events) window.addEventListener(name, touched, { passive: true });
    const timer = window.setInterval(() => {
      const after = isNight(Date.now()) ? AMBIENT_AFTER_NIGHT_MS : AMBIENT_AFTER_MS;
      if (Date.now() - lastTouch.current >= after) setAsleep(true);
    }, 5000);
    return () => { for (const name of events) window.removeEventListener(name, touched); window.clearInterval(timer); };
  }, [enabled]);
  const wake = useCallback(() => { lastTouch.current = Date.now(); setAsleep(false); }, []);
  return { ambient: enabled && (forced !== null || asleep), night: forced ? forced === 'night' : isNight(now), wake };
}

export interface AmbientLine { kind: 'meeting' | 'training' | 'cezar' | 'mail'; text: string; strong?: string }

/**
 * What is still worth a glance at night or from across the room: the next meeting, today's workout when it is not done,
 * what waits for you in Cezar, unread mail. Nothing else, and nothing at all when nothing applies.
 */
export function ambientLines(input: {
  now: number; timeZone: string; events: CalendarEvent[]; workouts: TrainingWorkout[]; activities: TrainingActivity[];
  tasks: Task[] | null; unreadMail: number | null;
}): AmbientLine[] {
  const { now, timeZone, events, workouts, activities, tasks, unreadMail } = input;
  const lines: AmbientLine[] = [];
  const next = events.filter(e => !e.allDay && e.endAt > now).sort((a, b) => a.startAt - b.startAt)[0];
  if (next && next.startAt - now < 24 * 60 * MINUTE) {
    const on = next.startAt <= now;
    lines.push({ kind: 'meeting', strong: next.title, text: on ? `trwa do ${time(next.endAt)}` : `${time(next.startAt)} · za ${countdown(next.startAt - now)}` });
  }
  const today = localDate(now, timeZone);
  const workout = workouts.find(w => w.date === today && !w.restDay);
  if (workout) {
    const state = workoutProgress(workout, activities, now, timeZone).state;
    if (state === 'planned' || state === 'partial') lines.push({ kind: 'training', strong: workout.name, text: `trening dziś${workout.durationSec ? ` · ${formatDuration(workout.durationSec)}` : ''}` });
  } else if (workouts.some(w => w.date === addDays(today, 1) && !w.restDay)) {
    const tomorrow = workouts.find(w => w.date === addDays(today, 1) && !w.restDay)!;
    lines.push({ kind: 'training', strong: tomorrow.name, text: 'trening jutro' });
  }
  const waiting = (tasks ?? []).filter(t => t.status === 'needs-input' || t.status === 'review').length;
  if (waiting) lines.push({ kind: 'cezar', strong: 'Cezar', text: `${waiting} czeka na Ciebie` });
  if (unreadMail) lines.push({ kind: 'mail', strong: 'Poczta', text: unreadMail === 1 ? '1 nieprzeczytana' : `${unreadMail} nieprzeczytane` });
  return lines;
}
