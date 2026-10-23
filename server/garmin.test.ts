// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { GarminAuthError, GarminHttpError, GarminRateLimitError } from 'garminconnect-js';
import { trainingSourceSchema } from '../src/training-contract';
import { createGarminReader, GarminLoginRequired, mapActivity, mapPlan, mapStep, mapWorkoutSteps, type GarminApi } from './garmin';
import { GarminStorageError } from './garmin-tokens';

const zone = 'Europe/Warsaw';
const now = Date.parse('2026-10-24T09:20:00Z'); // 11:20 on Saturday the 24th in Warsaw (CEST)

/** Garmin's adaptive "Próg" workout as the probe saw it: 15' warm-up, 2 × (8' hard + 4' easy, last rest skipped), 15' cool-down. */
const thresholdWorkout = {
  workoutName: 'Próg', estimatedTrainingEffect: 3.5, trainingEffectLabel: 'LACTATE_THRESHOLD', keyWorkout: true, ownerId: 111, description: 'free text',
  workoutSegments: [{ segmentOrder: 1, workoutSteps: [
    { stepOrder: 1, stepType: { stepTypeKey: 'warmup' }, endCondition: { conditionTypeKey: 'time' }, endConditionValue: 900, targetType: { workoutTargetTypeKey: 'power.zone' }, targetValueOne: 148, targetValueTwo: 201 },
    { stepOrder: 4, stepType: { stepTypeKey: 'repeat' }, numberOfIterations: 2, skipLastRestStep: true, workoutSteps: [
      { stepOrder: 2, stepType: { stepTypeKey: 'interval' }, endCondition: { conditionTypeKey: 'time' }, endConditionValue: 480, targetType: { workoutTargetTypeKey: 'power.zone' }, targetValueOne: 242, targetValueTwo: 282 },
      { stepOrder: 3, stepType: { stepTypeKey: 'recovery' }, endCondition: { conditionTypeKey: 'time' }, endConditionValue: 240, targetType: { workoutTargetTypeKey: 'power.zone' }, targetValueOne: 121, targetValueTwo: 175 },
    ] },
    { stepOrder: 5, stepType: { stepTypeKey: 'cooldown' }, endCondition: { conditionTypeKey: 'time' }, endConditionValue: 900, targetType: { workoutTargetTypeKey: 'power.zone' }, targetValueOne: 121, targetValueTwo: 175 },
  ] }],
};
const summary = (over: Record<string, unknown>) => ({
  workoutUuid: 'u-long', workoutName: 'Długa jazda', workoutType: 'cycling', scheduleDate: '2026-10-24', estimatedDurationInSecs: 5400,
  workoutPhrase: 'LONG_WORKOUT', isRestDay: false, race: false, associatedActivityId: null, ownerId: 109608854, tpPlanName: 'Plan', fbtAdaptivePlanId: 5, ...over,
});
const planEntry = { planName: 'Plan fitness: 2026', trainingPlanDetailsDTO: { workoutsPerWeek: 5, planKey: 'KEY-VALUE-123456789012345', athleteRace: { raceDay: '2026-12-18', raceName: null } } };
const recording = { activityId: 424242, activityName: 'Poznań Bieganie', activityType: { typeKey: 'indoor_cycling' }, beginTimestamp: Date.parse('2026-10-23T20:10:32Z'), duration: 601.08,
  averageHR: 134, avgPower: 132, trainingStressScore: 7.4, ownerDisplayName: 'Jan Kowalski', startLatitude: 52.1 };

function fakeApi(over: Partial<GarminApi> = {}): GarminApi & { calls: Record<string, number> } {
  const calls: Record<string, number> = {};
  const count = <T,>(name: string, fn: (...a: never[]) => T) => (...a: never[]) => { calls[name] = (calls[name] ?? 0) + 1; return fn(...a); };
  return { calls,
    summaries: count('summaries', async () => [summary({}), summary({ workoutUuid: 'u-thresh', workoutName: 'Próg', scheduleDate: '2026-10-26', estimatedDurationInSecs: 3000, workoutPhrase: 'LACTATE_THRESHOLD' }),
      summary({ workoutUuid: 'u-far', workoutName: 'Baza', scheduleDate: '2026-11-03', estimatedDurationInSecs: 4380, workoutPhrase: 'BASE' }),
      summary({ workoutUuid: 'u-past', workoutName: 'Sprint', scheduleDate: '2026-10-23', estimatedDurationInSecs: 3180, workoutPhrase: 'ANAEROBIC_SPEED' })]),
    plans: count('plans', async () => [planEntry]),
    adaptiveWorkout: count('adaptiveWorkout', async () => thresholdWorkout),
    activities: count('activities', async () => [recording]),
    ...over };
}
const reader = (api: GarminApi, clock = { at: now }) => ({ read: createGarminReader({ api: async () => api, timeZone: zone, now: () => clock.at }), clock });

describe('step mapping', () => {
  it('keeps the repeat tree with durations and power targets', () => {
    expect(mapWorkoutSteps(thresholdWorkout)).toEqual([
      { kind: 'warmup', durationSec: 900, target: { type: 'power', low: 148, high: 201 } },
      { kind: 'repeat', durationSec: null, target: null, iterations: 2, skipLastRest: true, children: [
        { kind: 'interval', durationSec: 480, target: { type: 'power', low: 242, high: 282 } },
        { kind: 'recovery', durationSec: 240, target: { type: 'power', low: 121, high: 175 } },
      ] },
      { kind: 'cooldown', durationSec: 900, target: { type: 'power', low: 121, high: 175 } },
    ]);
  });
  it('treats unknown kinds, non-time ends and missing targets without failing', () => {
    expect(mapStep({ stepType: { stepTypeKey: 'mystery' }, endCondition: { conditionTypeKey: 'lap.button' }, endConditionValue: 5, targetType: { workoutTargetTypeKey: 'no.target' } }))
      .toEqual({ kind: 'other', durationSec: null, target: null });
    expect(mapStep({ stepType: { stepTypeKey: 'interval' }, targetType: { workoutTargetTypeKey: 'heart.rate.zone' }, targetValueOne: 120, targetValueTwo: 140 }))
      .toMatchObject({ target: { type: 'heartRate', low: 120, high: 140 } });
    expect(mapWorkoutSteps({})).toBeNull();
    expect(mapWorkoutSteps({ workoutSegments: [] })).toBeNull();
  });
  it('stops at absurd nesting', () => {
    const deep = (n: number): unknown => ({ stepType: { stepTypeKey: 'repeat' }, workoutSteps: n ? [deep(n - 1)] : [] });
    expect(JSON.stringify(mapStep(deep(10)))).not.toContain('"depth"');
    expect(JSON.stringify(mapStep(deep(10))).match(/repeat/g)!.length).toBeLessThanOrEqual(4);
  });
  it('reads recordings and the plan, dropping everything else', () => {
    expect(mapActivity(recording)).toEqual({ startAt: recording.beginTimestamp, durationSec: 601.08, sport: 'indoor_cycling', avgPower: 132, avgHeartRate: 134, trainingStress: 7.4 });
    expect(mapActivity({ ...recording, beginTimestamp: undefined, startTimeGMT: '2026-10-23 20:10:32' })?.startAt).toBe(recording.beginTimestamp);
    expect(mapActivity({ activityType: {}, duration: 5 })).toBeNull();
    expect(mapPlan([planEntry])).toEqual({ name: 'Plan fitness: 2026', workoutsPerWeek: 5, targetDate: '2026-12-18' });
    expect(mapPlan([])).toBeNull();
  });
});

describe('Garmin reader', () => {
  it('serves the plan as the contract with steps only for the coming week', async () => {
    const api = fakeApi();
    const source = await reader(api).read();
    expect(trainingSourceSchema.parse(source)).toEqual(source);
    expect(source).toMatchObject({ status: 'connected', observedAt: now, name: 'Garmin Connect', timeZone: zone });
    const [past, today, thresh, far] = source.data!.workouts;
    expect(source.data!.workouts.map(w => w.name)).toEqual(['Sprint', 'Długa jazda', 'Próg', 'Baza']);
    expect(past.steps).toBeNull(); // Past workouts need no structure.
    expect(far.steps).toBeNull(); // Beyond the coming week it is not fetched either.
    expect(today).toMatchObject({ id: 'u-long', sport: 'cycling', date: '2026-10-24', durationSec: 5400, phrase: 'LONG_WORKOUT', restDay: false, race: false });
    expect(thresh).toMatchObject({ trainingEffect: 3.5, trainingEffectLabel: 'LACTATE_THRESHOLD', keyWorkout: true });
    expect(thresh.steps).toHaveLength(3);
    expect(source.data!.plan).toEqual({ name: 'Plan fitness: 2026', workoutsPerWeek: 5, targetDate: '2026-12-18' });
    expect(source.data!.activities).toEqual([{ startAt: recording.beginTimestamp, durationSec: 601.08, sport: 'indoor_cycling', avgPower: 132, avgHeartRate: 134, trainingStress: 7.4 }]);
    expect(api.calls.adaptiveWorkout).toBe(2); // Today and Monday only.
  });
  it('never passes personal fields through', async () => {
    const text = JSON.stringify(await reader(fakeApi()).read());
    for (const secret of ['109608854', 'Poznań', 'Jan Kowalski', 'KEY-VALUE', '424242', '52.1', 'free text', 'ownerId', 'activityName']) expect(text).not.toContain(secret);
  });
  it('asks Garmin at most every 15 minutes and keeps step details for hours', async () => {
    const api = fakeApi();
    const { read, clock } = reader(api);
    await read(); await read();
    clock.at += 14 * 60_000; await read();
    expect(api.calls.summaries).toBe(1);
    clock.at += 2 * 60_000; await read();
    expect(api.calls.summaries).toBe(2);
    expect(api.calls.adaptiveWorkout).toBe(2); // Still cached, not asked again.
    clock.at += 7 * 3_600_000; await read();
    expect(api.calls.adaptiveWorkout).toBe(4);
  });
  it('shares one read between parallel callers', async () => {
    const api = fakeApi();
    const { read } = reader(api);
    await Promise.all([read(), read(), read()]);
    expect(api.calls.summaries).toBe(1);
  });
  it('keeps the last plan and its observation time when Garmin fails', async () => {
    let fail = false;
    const api = fakeApi({ summaries: async () => { if (fail) throw new GarminHttpError('x', 500, 'https://connectapi.garmin.com/secret/path/9', 'body'); return [summary({})]; } });
    const { read, clock } = reader(api);
    const first = await read();
    fail = true;
    clock.at += 20 * 60_000;
    const failed = await read();
    expect(failed).toMatchObject({ status: 'offline', observedAt: first.observedAt, data: first.data });
    expect(failed.message).toBe('Nie udało się odczytać Garmin Connect. Ponowię połączenie.');
    expect(JSON.stringify(failed)).not.toContain('secret/path');
    fail = false;
    clock.at += 6 * 60_000; // Retried after 5 minutes, not 15.
    expect(await read()).toMatchObject({ status: 'connected', observedAt: clock.at });
  });
  it('says what to do when there is no sign-in or Garmin rejects it', async () => {
    const noLogin = createGarminReader({ api: async () => { throw new GarminLoginRequired(); }, timeZone: zone, now: () => now });
    expect(await noLogin()).toMatchObject({ status: 'unavailable', observedAt: null, data: null, message: expect.stringContaining('just garmin-login') });
    const expired = reader(fakeApi({ summaries: async () => { throw new GarminAuthError('expired'); } }));
    expect(await expired.read()).toMatchObject({ status: 'unavailable', message: expect.stringContaining('odrzucił') });
    const unreadable = createGarminReader({ api: async () => { throw new GarminStorageError('unreadable'); }, timeZone: zone, now: () => now });
    expect(await unreadable()).toMatchObject({ status: 'unavailable', message: expect.stringContaining('z dysku') });
  });
  it('backs off for half an hour after Garmin rate limits', async () => {
    const summaries = vi.fn(async () => { throw new GarminRateLimitError('429'); });
    const { read, clock } = reader(fakeApi({ summaries }));
    expect(await read()).toMatchObject({ status: 'offline', message: expect.stringContaining('ograniczył') });
    clock.at += 20 * 60_000; await read();
    expect(summaries).toHaveBeenCalledTimes(1);
    clock.at += 11 * 60_000; await read();
    expect(summaries).toHaveBeenCalledTimes(2);
  });
  it('marks the list partial when steps or recordings cannot be read, but still serves the plan', async () => {
    const api = fakeApi({ adaptiveWorkout: async () => { throw new Error('boom'); }, activities: async () => { throw new Error('boom'); } });
    const source = await reader(api).read();
    expect(source).toMatchObject({ status: 'connected', partial: true });
    expect(source.data!.workouts.every(w => w.steps === null)).toBe(true);
    expect(source.data!.activities).toEqual([]);
  });
  it('skips plan entries it cannot understand and says so', async () => {
    const api = fakeApi({ summaries: async () => [summary({}), { workoutName: 'Bez daty' }, null] });
    const source = await reader(api).read();
    expect(source).toMatchObject({ status: 'connected', partial: true });
    expect(source.data!.workouts).toHaveLength(1);
  });
  it('treats an unreadable plan header as optional and a failing sign-in during steps as the whole read failing', async () => {
    expect((await reader(fakeApi({ plans: async () => { throw new Error('boom'); } })).read()).data!.plan).toBeNull();
    const source = await reader(fakeApi({ adaptiveWorkout: async () => { throw new GarminAuthError('x'); } })).read();
    expect(source).toMatchObject({ status: 'unavailable', data: null });
  });
});
