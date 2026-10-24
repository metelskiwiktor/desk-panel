import { describe, expect, it } from 'vitest';
import { createFixture } from './test-fixtures';
import { deriveInsights } from './insights';
import { MAX_AGE, MINUTE, quotaState, safeUrl } from './model';

const now = new Date('2026-10-14T10:00:00Z').getTime();
describe('Insights: fakty z tych samych źródeł', () => {
  it('priorytetyzuje odpowiedź i spotkanie, zachowuje wszystkie sygnały dla dziennika', () => {
    const facts = deriveInsights(createFixture(now), now);
    expect(facts[0].id).toBe('task:decision');
    expect(facts[1].id).toBe(`event:planning:${now + 12 * MINUTE}`);
    expect(facts.some(f => f.id.startsWith('quota:Claude:5h:'))).toBe(true);
    expect(facts.length).toBeGreaterThan(3);
    expect(facts[1].title).toContain('12 min');
  });
  it.each(['empty', 'loading', 'unavailable', 'offline', 'stale'] as const)(
    'nie tworzy faktów dla %s',
    (scenario) => {
      expect(deriveInsights(createFixture(now, scenario), now)).toEqual([]);
    },
  );
  it('usuwa fakt po rozwiązaniu warunku; nie zachowuje poprzednich wyników', () => {
    const data = createFixture(now);
    data.tasks.data![0].status = 'running';
    expect(deriveInsights(data, now).some((f) => f.id === 'task:decision')).toBe(false);
  });
  it('deduplikuje zadania i zachowuje osobne okna tego samego konta', () => {
    const data = createFixture(now);
    data.tasks.data!.push(data.tasks.data![0]);
    data.quotas.data![0].snapshots[1].usedPercent = 96;
    const facts = deriveInsights(data, now);
    expect(facts.filter(f => f.id === 'task:decision')).toHaveLength(1);
    const quota = facts.filter(f => f.id.startsWith('quota:Claude:'));
    expect(quota).toHaveLength(2);
    expect(quota[0].context).toContain('5h: 92% limitu');
    expect(quota[1].context).toContain('7d: 96% limitu');
  });
  it.each([89.9, 90, 100])('próg quota >=90 dla %s', (value) => {
    const data = createFixture(now);
    data.quotas.data![0].snapshots[0].usedPercent = value;
    expect(deriveInsights(data, now).some((f) => f.id.startsWith('quota:Claude:5h:'))).toBe(value >= 90);
  });
  it.each(['expired', 'old', 'null', 'future', 'reset-missing'] as const)(
    'tłumi sygnał quota: %s',
    (kind) => {
      const data = createFixture(now);
      const quota = data.quotas.data![0].snapshots[0];
      if (kind === 'expired') quota.resetAt = now;
      if (kind === 'old') quota.observedAt = now - MAX_AGE.quotas - 1;
      if (kind === 'null') quota.usedPercent = null;
      if (kind === 'future') quota.observedAt = now + 1;
      if (kind === 'reset-missing') quota.resetAt = null;
      expect(deriveInsights(data, now).some((f) => f.id.startsWith('quota:Claude:5h:') || f.id.startsWith('quota-pace:Claude:5h:'))).toBe(false);
    },
  );
  it('próg spotkania: od teraz do 15 min włącznie; najbliższe najpierw', () => {
    const data = createFixture(now);
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
      expect(deriveInsights(data, now).some((f) => f.id.startsWith('event:planning:'))).toBe(expected);
    }
  });
  it('zbiera wszystkie ukończone zadania z ostatnich 10 min, bez przyszłych', () => {
    const data = createFixture(now);
    data.calendar.data = [];
    data.quotas.data = [];
    const done = data.tasks.data!.find((t) => t.status === 'done')!;
    data.tasks.data = [
      done,
      { ...done, id: 'older', completedAt: now - 9 * MINUTE },
      { ...done, id: 'future', completedAt: now + 1 },
    ];
    expect(deriveInsights(data, now).map((f) => f.target)).toEqual([{ kind: 'task', id: 'done-1' }, { kind: 'task', id: 'older' }]);
    data.tasks.data.forEach((t) => {
      t.completedAt = now - 10 * MINUTE - 1;
    });
    expect(deriveInsights(data, now)).toEqual([]);
  });
  it('RAM wymaga ciągłej minuty i świeżej próbki, nie tylko wysokiej wartości', () => {
    const data = createFixture(now, 'high-ram');
    expect(deriveInsights(data, now).map((f) => f.id)).toEqual(['system:ram']);
    data.system.data = data.system.data!.slice(-6);
    expect(deriveInsights(data, now)).toEqual([]); // only 50 s
    data.system.data = createFixture(now, 'high-ram').system.data!.filter((_, i) => i < 5 || i > 9);
    expect(deriveInsights(data, now)).toEqual([]); // gap > 30 s
  });
  it('CPU wymaga dwóch minut ciągłego obciążenia; skok nie tworzy zdarzenia', () => {
    const data = createFixture(now, 'high-ram');
    data.system.data!.forEach((s) => { s.ramUsedGb = 10; s.cpuPercent = 96; });
    const facts = deriveInsights(data, now);
    expect(facts.map((f) => f.id)).toEqual(['system:cpu']);
    expect(facts[0].title).toBe('CPU ≥90% przez 2 minuty');
    data.system.data!.at(-3)!.cpuPercent = 40;
    expect(deriveInsights(data, now)).toEqual([]);
    const spike = createFixture(now, 'high-ram');
    spike.system.data!.forEach((s) => { s.ramUsedGb = 10; });
    spike.system.data!.at(-1)!.cpuPercent = 100;
    expect(deriveInsights(spike, now)).toEqual([]);
  });
  it('RAM poniżej progu przerywa serię; stare źródło nie generuje faktu', () => {
    const data = createFixture(now, 'high-ram');
    data.system.data!.at(-2)!.ramUsedGb = 20;
    expect(deriveInsights(data, now)).toEqual([]);
    const old = createFixture(now, 'high-ram');
    old.system.observedAt = now - MAX_AGE.system - 1;
    expect(deriveInsights(old, now)).toEqual([]);
  });
});
describe('quota i bezpieczne linki', () => {
  it('nie uznaje niepoprawnych czasów za świeżą obserwację', () => {
    const snapshot = createFixture(now).quotas.data![0].snapshots[0];
    expect(quotaState({ ...snapshot, observedAt: Number.NaN }, now)).toBe('stale');
    expect(quotaState({ ...snapshot, resetAt: Number.POSITIVE_INFINITY }, now)).toBe('stale');
  });
  it('oddziela null, stary zapis i reset bez interpolacji', () => {
    const snapshot = createFixture(now).quotas.data![0].snapshots[0];
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
