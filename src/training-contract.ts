import { z } from 'zod';

/** What the panel needs of the Garmin Connect training plan: no names of places, ids of people, weights or health series. */
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const numberOrNull = z.number().finite().nullable();

export const stepKinds = ['warmup', 'interval', 'recovery', 'cooldown', 'rest', 'repeat', 'other'] as const;
export type StepKind = typeof stepKinds[number];
export const stepTargetSchema = z.object({
  type: z.enum(['power', 'heartRate', 'cadence', 'speed', 'other']),
  /** Watts, bpm, rpm or m/s, depending on `type`; null when Garmin gives only a zone number. */
  low: numberOrNull, high: numberOrNull,
});
export type StepTarget = z.infer<typeof stepTargetSchema>;
/** One step of a structured workout; a `repeat` holds its steps in `children`. */
export interface TrainingStep {
  kind: StepKind;
  /** Seconds, for steps that end on time; null for lap-button, distance and other end conditions. */
  durationSec: number | null;
  target: StepTarget | null;
  iterations?: number;
  /** A repeat whose last recovery is left out (Garmin's `skipLastRestStep`). */
  skipLastRest?: boolean;
  children?: TrainingStep[];
}
export const trainingStepSchema: z.ZodType<TrainingStep> = z.lazy(() => z.object({
  kind: z.enum(stepKinds),
  durationSec: z.number().finite().nonnegative().nullable(),
  target: stepTargetSchema.nullable(),
  iterations: z.number().int().positive().optional(),
  skipLastRest: z.boolean().optional(),
  children: z.array(trainingStepSchema).max(20).optional(),
}));

export const trainingWorkoutSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  /** Garmin sport key, e.g. `cycling`. */
  sport: z.string().min(1),
  /** Scheduled calendar day in the account's time zone. */
  date,
  /** Garmin's estimate; null when it gives none. No distance: Garmin leaves it out for cycling plans. */
  durationSec: z.number().finite().positive().nullable(),
  /** Garmin's `workoutPhrase`, e.g. `LONG_WORKOUT`; see `trainingLevel`. */
  phrase: z.string().nullable(),
  trainingEffect: z.number().finite().nullable(),
  trainingEffectLabel: z.string().nullable(),
  keyWorkout: z.boolean(),
  restDay: z.boolean(),
  race: z.boolean(),
  /** Null when the structure was not fetched (past workouts) or could not be read. */
  steps: z.array(trainingStepSchema).max(60).nullable(),
});
export type TrainingWorkout = z.infer<typeof trainingWorkoutSchema>;

/** A finished recording, reduced to what judging a workout as done needs. */
export const trainingActivitySchema = z.object({
  startAt: z.number().finite(),
  durationSec: z.number().finite().nonnegative(),
  /** Garmin activity type key, e.g. `indoor_cycling`. */
  sport: z.string().min(1),
  avgPower: numberOrNull, avgHeartRate: numberOrNull, trainingStress: numberOrNull,
});
export type TrainingActivity = z.infer<typeof trainingActivitySchema>;

export const trainingPlanSchema = z.object({
  name: z.string().nullable(),
  workoutsPerWeek: z.number().int().positive().nullable(),
  /** End date of the plan (not necessarily a race). */
  targetDate: date.nullable(),
});
export type TrainingPlan = z.infer<typeof trainingPlanSchema>;

export const trainingSourceSchema = z.object({
  live: z.literal(true), name: z.literal('Garmin Connect'),
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(),
  message: z.string().optional(),
  /** Some workouts or their steps could not be read. */
  partial: z.boolean().optional(),
  timeZone: z.string().optional(),
  data: z.object({
    plan: trainingPlanSchema.nullable(),
    workouts: z.array(trainingWorkoutSchema).max(80),
    activities: z.array(trainingActivitySchema).max(80),
  }).nullable(),
});
export type TrainingSource = z.infer<typeof trainingSourceSchema>;

/** 1 easy (aerobic base), 2 threshold, 3 hard (anaerobic). Unknown phrases have no level. */
export type TrainingLevel = 1 | 2 | 3;
const LEVELS: Record<string, TrainingLevel> = {
  BASE: 1, LONG_WORKOUT: 1, LACTATE_THRESHOLD: 2, ANAEROBIC_CAPACITY: 3, ANAEROBIC_SPEED: 3,
};
export const trainingLevel = (phrase: string | null | undefined): TrainingLevel | null => (phrase && LEVELS[phrase]) || null;
export const trainingLevelNames: Record<TrainingLevel, string> = { 1: 'łatwy', 2: 'próg', 3: 'mocny' };
