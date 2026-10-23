import { describe, expect, it } from 'vitest';
import { trainingLevel, trainingSourceSchema, trainingStepSchema, type TrainingActivity, type TrainingWorkout } from './training-contract';
import { localDate, sameSport, workoutProgress } from './training-progress';

const zone = 'Europe/Warsaw';
const now = Date.parse('2026-10-24T09:20:00Z'); // 11:20 on the 24th in Warsaw
const workout = (over: Partial<TrainingWorkout> = {}): TrainingWorkout => ({
  id: 'w', name: 'Długa jazda', sport: 'cycling', date: '2026-10-24', durationSec: 5400, phrase: 'LONG_WORKOUT', trainingEffect: null, trainingEffectLabel: null,
  keyWorkout: false, restDay: false, race: false, steps: null, ...over,
});
const ride = (iso: string, durationSec: number, sport = 'indoor_cycling'): TrainingActivity => ({ startAt: Date.parse(iso), durationSec, sport, avgPower: null, avgHeartRate: null, trainingStress: null });

describe('workout progress', () => {
  it('is planned until something is recorded, then missed once the day is over', () => {
    expect(workoutProgress(workout(), [], now, zone)).toEqual({ state: 'planned', doneSec: 0, ratio: 0 });
    expect(workoutProgress(workout({ date: '2026-10-25' }), [], now, zone).state).toBe('planned');
    expect(workoutProgress(workout({ date: '2026-10-23' }), [], now, zone).state).toBe('missed');
  });
  it('is done from about 80% of the planned time', () => {
    expect(workoutProgress(workout(), [ride('2026-10-24T06:00:00Z', 4319)], now, zone).state).toBe('partial');
    expect(workoutProgress(workout(), [ride('2026-10-24T06:00:00Z', 4320)], now, zone).state).toBe('done');
    expect(workoutProgress(workout(), [ride('2026-10-24T06:00:00Z', 5520)], now, zone)).toMatchObject({ state: 'done', doneSec: 5520 });
  });
  it('adds up the recordings of the day and ignores accidental starts', () => {
    const parts = [ride('2026-10-24T06:00:00Z', 2400), ride('2026-10-24T07:00:00Z', 2000), ride('2026-10-24T08:00:00Z', 60)];
    expect(workoutProgress(workout(), parts, now, zone)).toMatchObject({ state: 'done', doneSec: 4400 });
    expect(workoutProgress(workout(), [ride('2026-10-24T08:00:00Z', 119)], now, zone).state).toBe('planned');
  });
  it('judges yesterday\'s Sprint as partial: 10 of 53 minutes, the 1-minute start does not count', () => {
    const sprint = workout({ name: 'Sprint', date: '2026-10-23', durationSec: 3180 });
    const progress = workoutProgress(sprint, [ride('2026-10-23T20:10:32Z', 601), ride('2026-10-23T20:25:16Z', 62)], now, zone);
    expect(progress.state).toBe('partial');
    expect(progress.doneSec).toBe(601);
    expect(progress.ratio).toBeCloseTo(0.189, 3);
  });
  it('counts only the same sport on the same local day', () => {
    expect(workoutProgress(workout(), [ride('2026-10-24T06:00:00Z', 6000, 'running')], now, zone).state).toBe('planned');
    expect(workoutProgress(workout(), [ride('2026-10-23T06:00:00Z', 6000)], now, zone).state).toBe('planned');
    // 00:30 on the 24th in Warsaw is the 23rd in UTC.
    expect(workoutProgress(workout(), [ride('2026-10-23T22:30:00Z', 6000)], now, zone).state).toBe('done');
  });
  it('is done by any real recording when Garmin gave no planned time, and rest days stay rest', () => {
    expect(workoutProgress(workout({ durationSec: null }), [ride('2026-10-24T06:00:00Z', 1800)], now, zone)).toMatchObject({ state: 'done', ratio: null });
    expect(workoutProgress(workout({ restDay: true }), [ride('2026-10-24T06:00:00Z', 1800)], now, zone).state).toBe('rest');
  });
  it('matches sports by family', () => {
    expect(sameSport('cycling', 'indoor_cycling')).toBe(true);
    expect(sameSport('cycling', 'road_biking')).toBe(true);
    expect(sameSport('running', 'treadmill_running')).toBe(true);
    expect(sameSport('cycling', 'running')).toBe(false);
    expect(localDate(Date.parse('2026-10-23T22:30:00Z'), zone)).toBe('2026-10-24');
  });
});

describe('training contract', () => {
  it('maps Garmin phrases to levels and leaves unknown ones without', () => {
    expect([trainingLevel('BASE'), trainingLevel('LONG_WORKOUT'), trainingLevel('LACTATE_THRESHOLD'), trainingLevel('ANAEROBIC_CAPACITY'), trainingLevel('ANAEROBIC_SPEED')]).toEqual([1, 1, 2, 3, 3]);
    expect([trainingLevel('RECOVERY'), trainingLevel(null), trainingLevel(undefined)]).toEqual([null, null, null]);
  });
  it('accepts a nested step tree and rejects malformed data', () => {
    const tree = { kind: 'repeat', durationSec: null, target: null, iterations: 2, children: [{ kind: 'interval', durationSec: 480, target: { type: 'power', low: 242, high: 282 } }] };
    expect(trainingStepSchema.safeParse(tree).success).toBe(true);
    expect(trainingStepSchema.safeParse({ ...tree, kind: 'sprint' }).success).toBe(false);
    expect(trainingStepSchema.safeParse({ ...tree, children: [{ kind: 'interval' }] }).success).toBe(false);
    const source = { live: true, name: 'Garmin Connect', status: 'connected', observedAt: now, data: { plan: null, workouts: [workout()], activities: [] } };
    expect(trainingSourceSchema.safeParse(source).success).toBe(true);
    expect(trainingSourceSchema.safeParse({ ...source, data: { plan: null, workouts: [workout({ date: '24.10.2026' })], activities: [] } }).success).toBe(false);
  });
});
