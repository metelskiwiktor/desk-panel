import { describe, expect, it } from 'vitest';
import type { TrainingStep } from './training-contract';
import { flattenSteps, formatDuration, profileBars, stepLabels, stepsDuration } from './training-view';

const power = (low: number, high: number) => ({ type: 'power' as const, low, high });
/** Garmin's "Próg": 15' warm-up, 2 × (8' hard + 4' easy) with the last rest skipped, 15' cool-down. */
const threshold: TrainingStep[] = [
  { kind: 'warmup', durationSec: 900, target: power(148, 201) },
  { kind: 'repeat', durationSec: null, target: null, iterations: 2, skipLastRest: true, children: [
    { kind: 'interval', durationSec: 480, target: power(242, 282) }, { kind: 'recovery', durationSec: 240, target: power(121, 175) }] },
  { kind: 'cooldown', durationSec: 900, target: power(121, 175) },
];
const longRide: TrainingStep[] = [{ kind: 'interval', durationSec: 5400, target: power(121, 175) }];

describe('training view', () => {
  it('formats planned time', () => {
    expect([formatDuration(3000), formatDuration(5400), formatDuration(4380), formatDuration(3600)]).toEqual(['50 min', '1 h 30', '1 h 13', '1 h']);
  });
  it('describes the steps in a phrase each', () => {
    expect(stepLabels(threshold)).toEqual(['15′ rozgrzewka 148–201 W', '2 × 8′ mocno 242–282 W + 4′ przerwa 121–175 W', '15′ schłodzenie 121–175 W']);
    expect(stepLabels(longRide)).toEqual(['1 h 30 121–175 W']);
    expect(stepLabels([{ kind: 'interval', durationSec: null, target: null }])).toEqual(['mocno']);
    expect(stepLabels([{ kind: 'interval', durationSec: 60, target: { type: 'power', low: 200, high: 200 } }, { kind: 'rest', durationSec: 30, target: null }])).toEqual(['1′ mocno 200 W', '1′ odpoczynek']);
  });
  it('expands repeats and drops the last rest Garmin skips', () => {
    expect(flattenSteps(threshold).map(b => [b.kind, b.sec])).toEqual([['warmup', 900], ['interval', 480], ['recovery', 240], ['interval', 480], ['cooldown', 900]]);
    expect(stepsDuration(threshold)).toBe(3000); // Garmin's own estimate for the workout.
    const keepRest: TrainingStep[] = [{ ...threshold[1], skipLastRest: false }];
    expect(stepsDuration(keepRest)).toBe(1440);
  });
  it('draws the profile proportional to time and power', () => {
    const bars = profileBars(threshold);
    expect(bars.reduce((sum, b) => sum + b.width, 0)).toBeCloseTo(100);
    expect(bars[1]).toMatchObject({ kind: 'interval', height: 100 });
    expect(bars[2].height).toBeCloseTo((148 / 262) * 100, 0);
    expect(bars[0].width).toBeCloseTo(30);
    expect(profileBars(longRide)).toEqual([{ kind: 'interval', width: 100, height: 100 }]);
    expect(profileBars([{ kind: 'interval', durationSec: 600, target: null }])[0].height).toBe(40);
    expect(profileBars([])).toEqual([]);
  });
});
