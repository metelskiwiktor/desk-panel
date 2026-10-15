import { describe, expect, it } from 'vitest';
import { createDemo } from './demo';
import { deriveInsights } from './insights';
import { MAX_AGE, MINUTE, quotaState, safeUrl } from './model';

const now = new Date('2026-10-14T10:00:00Z').getTime();
describe('Insights: fakty z tych samych źródeł', () => {
  it('priorytetyzuje odpowiedź, spotkanie i świeży limit; maksymalnie 3', () => {
    const facts = deriveInsights(createDemo(now), now);
    expect(facts.map((f) => f.id)).toEqual(['task:decision', 'event:planning', 'quota:Claude']);
    expect(facts[1].title).toContain('12 min');
  });
  it.each(['empty', 'loading', 'unavailable', 'offline', 'stale'] as const)(
    'nie tworzy faktów dla %s',
    (scenario) => {
      expect(deriveInsights(createDemo(now, scenario), now)).toEqual([]);
    },
  );
  it('usuwa fakt po rozwiązaniu warunku; nie zachowuje poprzednich wyników', () => {
    const data = createDemo(now);
    data.tasks.data![0].status = 'running';
    expect(deriveInsights(data, now).some((f) => f.id === 'task:decision')).toBe(false);
  });
  it('deduplikuje zadania oraz okna tego samego konta', () => {
    const data = createDemo(now);
    data.tasks.data!.push(data.tasks.data![0]);
    data.quotas.data![0].snapshots[1].usedPercent = 96;
    const facts = deriveInsights(data, now);
    expect(facts.map((f) => f.id)).toEqual(['task:decision', 'event:planning', 'quota:Claude']);
    expect(facts[2].context).toBe('5h: 92% limitu · 7d: 96% limitu');
  });
  it.each([89.9, 90, 100])('próg quota >=90 dla %s', (value) => {
    const data = createDemo(now);
    data.quotas.data![0].snapshots[0].usedPercent = value;
    expect(deriveInsights(data, now).some((f) => f.id === 'quota:Claude')).toBe(value >= 90);
  });
  it.each(['expired', 'old', 'null', 'future', 'reset-missing'] as const)(
    'tłumi sygnał quota: %s',
    (kind) => {
      const data = createDemo(now);
      const quota = data.quotas.data![0].snapshots[0];
      if (kind === 'expired') quota.resetAt = now;
      if (kind === 'old') quota.observedAt = now - MAX_AGE.quotas - 1;
      if (kind === 'null') quota.usedPercent = null;
      if (kind === 'future') quota.observedAt = now + 1;
      if (kind === 'reset-missing') quota.resetAt = null;
      expect(deriveInsights(data, now).some((f) => f.id === 'quota:Claude')).toBe(false);
    },
  );
  it('próg spotkania: od teraz do 15 min włącznie; najbliższe najpierw', () => {
    const data = createDemo(now);
    data.tasks.data = [];
    data.quotas.data = [];
    const event = data.calendar.data![0];
    for (const [delta, expected] of [
      [-1, false],
      [0, true],
      [15 * MINUTE, true],
      [15 * MINUTE + 1, false],
    ] as const) {
      event.startAt = now + delta;
      expect(deriveInsights(data, now).some((f) => f.id === 'event:planning')).toBe(expected);
    }
  });
  it('wybiera tylko najnowsze ukończone zadanie z ostatnich 10 min, bez przyszłych', () => {
    const data = createDemo(now);
    data.calendar.data = [];
    data.quotas.data = [];
    const done = data.tasks.data!.find((t) => t.status === 'done')!;
    data.tasks.data = [
      done,
      { ...done, id: 'older', completedAt: now - 9 * MINUTE },
      { ...done, id: 'future', completedAt: now + 1 },
    ];
    expect(deriveInsights(data, now).map((f) => f.id)).toEqual(['task:done-1']);
    data.tasks.data.forEach((t) => {
      t.completedAt = now - 10 * MINUTE - 1;
    });
    expect(deriveInsights(data, now)).toEqual([]);
  });
  it('RAM wymaga ciągłej minuty i świeżej próbki, nie tylko wysokiej wartości', () => {
    const data = createDemo(now, 'ram');
    expect(deriveInsights(data, now).map((f) => f.id)).toEqual(['system:ram']);
    data.system.data = data.system.data!.slice(-6);
    expect(deriveInsights(data, now)).toEqual([]); // only 50 s
    data.system.data = createDemo(now, 'ram').system.data!.filter((_, i) => i < 5 || i > 9);
    expect(deriveInsights(data, now)).toEqual([]); // gap > 30 s
  });
  it('RAM poniżej progu przerywa serię; stare źródło nie generuje faktu', () => {
    const data = createDemo(now, 'ram');
    data.system.data!.at(-2)!.ramUsedGb = 20;
    expect(deriveInsights(data, now)).toEqual([]);
    const old = createDemo(now, 'ram');
    old.system.observedAt = now - MAX_AGE.system - 1;
    expect(deriveInsights(old, now)).toEqual([]);
  });
});
describe('quota i bezpieczne linki', () => {
  it('nie uznaje niepoprawnych czasów za świeżą obserwację', () => {
    const snapshot = createDemo(now).quotas.data![0].snapshots[0];
    expect(quotaState({ ...snapshot, observedAt: Number.NaN }, now)).toBe('stale');
    expect(quotaState({ ...snapshot, resetAt: Number.POSITIVE_INFINITY }, now)).toBe('stale');
  });
  it('oddziela null, stary zapis i reset bez interpolacji', () => {
    const snapshot = createDemo(now).quotas.data![0].snapshots[0];
    expect(quotaState(snapshot, now)).toBe('fresh');
    expect(quotaState({ ...snapshot, usedPercent: null }, now)).toBe('unavailable');
    expect(quotaState({ ...snapshot, usedPercent: 101 }, now)).toBe('unavailable');
    expect(quotaState({ ...snapshot, observedAt: now - MAX_AGE.quotas }, now)).toBe('fresh');
    expect(quotaState({ ...snapshot, observedAt: now - MAX_AGE.quotas - 1 }, now)).toBe('stale');
    expect(quotaState({ ...snapshot, resetAt: now }, now)).toBe('stale');
    expect(snapshot.usedPercent).toBe(92);
  });
  it('akceptuje wyłącznie poprawne HTTP(S) bez poświadczeń', () => {
    for (const url of [
      undefined,
      '',
      'javascript:alert(1)',
      '/task/1',
      'https://user:secret@example.org',
    ])
      expect(safeUrl(url)).toBeUndefined();
    expect(safeUrl('http://localhost:3010/task/1')).toBe('http://localhost:3010/task/1');
  });
});
