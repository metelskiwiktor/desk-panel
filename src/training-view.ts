import type { StepKind, TrainingStep, TrainingWorkout } from './training-contract';

/** "50 min", "1 h 30": the planned time of a workout. */
export function formatDuration(sec: number): string {
  const minutes = Math.round(sec / 60);
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}
/** Step lengths: "15′" under an hour, "1 h 30" above. */
const stepTime = (sec: number) => Math.round(sec / 60) < 60 ? `${Math.round(sec / 60)}′` : formatDuration(sec);

const kindNames: Record<StepKind, string> = { warmup: 'rozgrzewka', interval: 'mocno', recovery: 'przerwa', cooldown: 'schłodzenie', rest: 'odpoczynek', repeat: 'powtórzenia', other: 'krok' };
const targetText = (step: TrainingStep) => {
  const t = step.target;
  if (!t || (t.low === null && t.high === null)) return '';
  const unit = t.type === 'power' ? ' W' : t.type === 'heartRate' ? ' bpm' : t.type === 'cadence' ? ' rpm' : '';
  const range = t.low !== null && t.high !== null && t.low !== t.high ? `${t.low}–${t.high}` : `${t.low ?? t.high}`;
  return t.type === 'speed' || t.type === 'other' ? '' : `${range}${unit}`;
};

/** A step without time ends on a button press or a distance; it keeps its place with no length. */
function describe(step: TrainingStep, alone: boolean): string {
  if (step.kind === 'repeat') {
    const inner = (step.children ?? []).map(child => describe(child, false)).join(' + ');
    return `${step.iterations ?? 1} × ${inner}`.trim();
  }
  const time = step.durationSec ? stepTime(step.durationSec) : '';
  const target = targetText(step);
  const name = alone && step.kind === 'interval' && (time || target) ? '' : kindNames[step.kind];
  return [time, name, target].filter(Boolean).join(' ');
}
/** One short phrase per top-level step: "15′ rozgrzewka", "2 × 8′ mocno 242–282 W + 4′ przerwa", "15′ schłodzenie". */
export function stepLabels(steps: TrainingStep[]): string[] {
  return steps.map(step => describe(step, steps.length === 1));
}

export interface ProfileBlock {
  kind: Exclude<StepKind, 'repeat'>;
  sec: number;
  /** Target power (middle of the range) or null when the step has none. */
  watts: number | null;
}
/** The steps in the order they are ridden: repeats expanded, the last rest of a repeat dropped when Garmin skips it. */
export function flattenSteps(steps: TrainingStep[]): ProfileBlock[] {
  const out: ProfileBlock[] = [];
  for (const step of steps) {
    if (step.kind === 'repeat') {
      const children = step.children ?? [];
      const times = step.iterations ?? 1;
      for (let i = 0; i < times; i++) {
        const round = flattenSteps(children);
        if (step.skipLastRest && i === times - 1 && round.at(-1)?.kind === 'recovery') round.pop();
        out.push(...round);
      }
    } else if (step.durationSec) {
      const { low, high } = step.target?.type === 'power' ? step.target : { low: null, high: null };
      out.push({ kind: step.kind, sec: step.durationSec, watts: low !== null && high !== null ? (low + high) / 2 : low ?? high });
    }
  }
  return out;
}
/** Widths in percent of the whole and heights in percent of the hardest step; steps without power keep a low bar. */
export function profileBars(steps: TrainingStep[]): { kind: ProfileBlock['kind']; width: number; height: number }[] {
  const blocks = flattenSteps(steps);
  const total = blocks.reduce((sum, b) => sum + b.sec, 0);
  const peak = Math.max(0, ...blocks.map(b => b.watts ?? 0));
  return blocks.map(b => ({ kind: b.kind, width: (b.sec / total) * 100, height: peak && b.watts ? Math.max(26, (b.watts / peak) * 100) : 40 }));
}
/** Total ridden time of the steps, in seconds. */
export const stepsDuration = (steps: TrainingStep[]) => flattenSteps(steps).reduce((sum, b) => sum + b.sec, 0);

export const workoutsOn = (workouts: TrainingWorkout[], day: string) => workouts.filter(w => w.date === day);
/** The next workout after `day`, for a day without one. */
export const nextWorkoutAfter = (workouts: TrainingWorkout[], day: string) => workouts.find(w => w.date > day && !w.restDay);
