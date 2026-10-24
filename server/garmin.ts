import { Garmin, GarminAuthError, GarminClient, GarminRateLimitError } from 'garminconnect-js';
import { z } from 'zod';
import { stepKinds, trainingSourceSchema, type StepKind, type StepTarget, type TrainingActivity, type TrainingPlan, type TrainingSource, type TrainingStep, type TrainingWorkout } from '../src/training-contract';
import { addDays, localDate } from '../src/training-progress';
import { createGarminTokenStore, GarminStorageError } from './garmin-tokens';

/** The few read-only calls of garminconnect-js the panel uses; tests replace it. */
export interface GarminApi {
  summaries(from: string, to: string): Promise<unknown[]>;
  plans(date: string): Promise<unknown[]>;
  adaptiveWorkout(uuid: string): Promise<unknown>;
  activities(limit: number): Promise<unknown[]>;
}
/** No saved Garmin sign-in yet (or it was removed). */
export class GarminLoginRequired extends Error {}

/** Opens the client once from the saved tokens; a missing sign-in is not cached, so `just garmin-login` takes effect without a restart. */
export function createGarminApi(tokenFile: string): () => Promise<GarminApi> {
  let opened: Promise<GarminApi> | undefined;
  return () => opened ??= (async (): Promise<GarminApi> => {
    const client = new GarminClient({ tokenStore: createGarminTokenStore(tokenFile) });
    if (!(await client.loadTokens())) throw new GarminLoginRequired();
    const garmin = new Garmin(client);
    return {
      summaries: (from, to) => garmin.getScheduledWorkoutSummaries(from, to),
      plans: date => garmin.getTrainingPlanWorkouts(date),
      adaptiveWorkout: uuid => garmin.getAdaptiveWorkout(uuid),
      activities: limit => garmin.getActivities(0, limit),
    };
  })().catch(error => { opened = undefined; throw error; });
}

const rec = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown) => typeof value === 'string' ? value : undefined;
const num = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null;

const summarySchema = z.object({
  workoutUuid: z.string().nullish(), workoutName: z.string().min(1), workoutType: z.string().nullish(),
  scheduleDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), estimatedDurationInSecs: z.number().nullish(),
  workoutPhrase: z.string().nullish(), isRestDay: z.boolean().nullish(), race: z.boolean().nullish(),
});

/** Garmin's step tree to ours; unknown kinds stay `other` and unreadable steps are dropped. */
export function mapStep(raw: unknown, depth = 0): TrainingStep | null {
  if (depth > 3) return null;
  const step = rec(raw);
  const key = str(rec(step.stepType).stepTypeKey);
  const kind: StepKind = (stepKinds as readonly string[]).includes(key ?? '') ? key as StepKind : 'other';
  const targetKey = str(rec(step.targetType).workoutTargetTypeKey);
  const targetType: StepTarget['type'] | null = !targetKey || targetKey.startsWith('no.') ? null
    : /^power/.test(targetKey) ? 'power' : /heart/.test(targetKey) ? 'heartRate' : /cadence/.test(targetKey) ? 'cadence' : /speed|pace/.test(targetKey) ? 'speed' : 'other';
  const mapped: TrainingStep = {
    kind,
    durationSec: str(rec(step.endCondition).conditionTypeKey) === 'time' ? num(step.endConditionValue) : null,
    target: targetType ? { type: targetType, low: num(step.targetValueOne), high: num(step.targetValueTwo) } : null,
  };
  if (kind === 'repeat') {
    const iterations = num(step.numberOfIterations);
    if (iterations && Number.isInteger(iterations) && iterations > 0) mapped.iterations = iterations;
    if (step.skipLastRestStep === true) mapped.skipLastRest = true;
    mapped.children = (Array.isArray(step.workoutSteps) ? step.workoutSteps : []).map(child => mapStep(child, depth + 1)).filter((s): s is TrainingStep => !!s);
  }
  return mapped;
}
export function mapWorkoutSteps(raw: unknown): TrainingStep[] | null {
  const segments = rec(raw).workoutSegments;
  if (!Array.isArray(segments)) return null;
  const steps = segments.flatMap(segment => Array.isArray(rec(segment).workoutSteps) ? rec(segment).workoutSteps as unknown[] : [])
    .map(step => mapStep(step)).filter((s): s is TrainingStep => !!s);
  return steps.length ? steps : null;
}

export function mapActivity(raw: unknown): TrainingActivity | null {
  const a = rec(raw);
  const sport = str(rec(a.activityType).typeKey);
  const started = num(a.beginTimestamp) ?? Date.parse(`${(str(a.startTimeGMT) ?? '').replace(' ', 'T')}Z`);
  const duration = num(a.duration);
  if (!sport || duration === null || duration < 0 || !Number.isFinite(started)) return null;
  return { startAt: started, durationSec: duration, sport, avgPower: num(a.avgPower), avgHeartRate: num(a.averageHR), trainingStress: num(a.trainingStressScore) };
}

export function mapPlan(raw: unknown[]): TrainingPlan | null {
  const plan = rec(raw[0]);
  if (!Object.keys(plan).length) return null;
  const details = rec(plan.trainingPlanDetailsDTO);
  const perWeek = num(details.workoutsPerWeek);
  const target = str(rec(details.athleteRace).raceDay);
  return { name: str(plan.planName) ?? null, workoutsPerWeek: perWeek && Number.isInteger(perWeek) && perWeek > 0 ? perWeek : null,
    targetDate: target && /^\d{4}-\d{2}-\d{2}$/.test(target) ? target : null };
}

const OK_AFTER_MS = 15 * 60_000;
const RETRY_AFTER_MS = 5 * 60_000;
const RATE_LIMITED_RETRY_MS = 30 * 60_000;
const STEPS_TTL_MS = 6 * 60 * 60_000;
/** Plan entries read: a week back (to judge what was done) to two weeks ahead; steps only for the coming week. */
const PAST_DAYS = 7, AHEAD_DAYS = 35, STEPS_AHEAD_DAYS = 7;
const LOGIN = 'Uruchom „just garmin-login".';

interface WorkoutDetail { at: number; steps: TrainingStep[] | null; trainingEffect: number | null; label: string | null; key: boolean }
const stop = (error: unknown) => error instanceof GarminAuthError || error instanceof GarminRateLimitError;

/**
 * Reads the Garmin Connect plan, the coming workouts' steps and recent recordings. Read-only and gentle:
 * Garmin is polled at most every 15 minutes, a workout's steps are cached for hours, a failure keeps the last data
 * with its original observation time. Garmin's endpoints are undocumented, so every response is validated and reduced.
 */
export function createGarminReader(options: { api: () => Promise<GarminApi>; timeZone: string; now?: () => number }) {
  const now = options.now ?? Date.now;
  const { timeZone } = options;
  let cache: TrainingSource | undefined;
  let nextAttempt = -Infinity;
  let pending: Promise<TrainingSource> | undefined;
  const details = new Map<string, WorkoutDetail>();

  async function load(): Promise<TrainingSource> {
    const api = await options.api();
    const today = localDate(now(), timeZone);
    const from = addDays(today, -PAST_DAYS), lastStepsDay = addDays(today, STEPS_AHEAD_DAYS);
    let partial = false;
    const workouts: TrainingWorkout[] = [];
    const uuidOf = new Map<TrainingWorkout, string>();
    for (const raw of await api.summaries(from, addDays(today, AHEAD_DAYS))) {
      const parsed = summarySchema.safeParse(raw);
      if (!parsed.success) { partial = true; continue; }
      const s = parsed.data;
      const workout: TrainingWorkout = {
        id: s.workoutUuid || `${s.scheduleDate}:${s.workoutName}`, name: s.workoutName, sport: s.workoutType || 'unknown', date: s.scheduleDate,
        durationSec: s.estimatedDurationInSecs && s.estimatedDurationInSecs > 0 ? s.estimatedDurationInSecs : null,
        phrase: s.workoutPhrase ?? null, trainingEffect: null, trainingEffectLabel: null, keyWorkout: false,
        restDay: !!s.isRestDay, race: !!s.race, steps: null,
      };
      workouts.push(workout);
      if (s.workoutUuid) uuidOf.set(workout, s.workoutUuid);
    }
    let plan: TrainingPlan | null = null;
    try { plan = mapPlan(await api.plans(today)); } catch (error) { if (stop(error)) throw error; /* The plan header is optional. */ }
    for (const workout of workouts) {
      const uuid = uuidOf.get(workout);
      if (!uuid || workout.restDay || workout.date < today || workout.date > lastStepsDay) continue;
      let detail = details.get(uuid);
      if (!detail || now() - detail.at >= STEPS_TTL_MS) {
        try {
          const raw = rec(await api.adaptiveWorkout(uuid));
          detail = { at: now(), steps: mapWorkoutSteps(raw), trainingEffect: num(raw.estimatedTrainingEffect), label: str(raw.trainingEffectLabel) ?? null, key: raw.keyWorkout === true };
          details.set(uuid, detail);
        } catch (error) { if (stop(error)) throw error; partial = true; detail = undefined; }
      }
      if (detail) Object.assign(workout, { steps: detail.steps, trainingEffect: detail.trainingEffect, trainingEffectLabel: detail.label, keyWorkout: detail.key });
    }
    let activities: TrainingActivity[] = [];
    try {
      activities = (await api.activities(50)).map(mapActivity).filter((a): a is TrainingActivity => !!a)
        .filter(a => localDate(a.startAt, timeZone) >= from).sort((a, b) => a.startAt - b.startAt).slice(-80);
    } catch (error) { if (stop(error)) throw error; partial = true; }
    workouts.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    const at = now();
    nextAttempt = at + OK_AFTER_MS;
    return trainingSourceSchema.parse({ live: true, name: 'Garmin Connect', status: 'connected', observedAt: at, timeZone, ...(partial ? { partial } : {}),
      data: { plan, workouts: workouts.slice(0, 80), activities } });
  }

  function failure(error: unknown): TrainingSource {
    const [status, message, delay] = error instanceof GarminLoginRequired ? ['unavailable', `Połącz Garmin Connect. ${LOGIN}`, OK_AFTER_MS] as const
      : error instanceof GarminAuthError ? ['unavailable', `Garmin odrzucił zapisane logowanie. ${LOGIN}`, OK_AFTER_MS] as const
      : error instanceof GarminStorageError ? ['unavailable', `Nie udało się odczytać zapisanego logowania Garmin z dysku. ${LOGIN}`, OK_AFTER_MS] as const
      : error instanceof GarminRateLimitError ? ['offline', 'Garmin ograniczył liczbę zapytań. Ponowię później.', RATE_LIMITED_RETRY_MS] as const
      : ['offline', 'Nie udało się odczytać Garmin Connect. Ponowię połączenie.', RETRY_AFTER_MS] as const;
    nextAttempt = now() + delay;
    // The last good data and its observation time stay; only the state says it is no longer current.
    return { ...(cache ?? { data: null, observedAt: null }), live: true, name: 'Garmin Connect', status, message, timeZone };
  }

  return async function read(): Promise<TrainingSource> {
    if (pending) return pending;
    if (cache && now() < nextAttempt) return cache;
    pending = load().catch(failure).then(value => { cache = value; return value; }).finally(() => { pending = undefined; });
    return pending;
  };
}
