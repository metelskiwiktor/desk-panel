import {
  MINUTE,
  type DashboardData,
  type Source,
  type Task,
  type TaskStatus,
  type QuotaSnapshot,
} from './model';

/** Deterministic dashboard data for tests; never imported by the app. */
export const fixtureCases = {
  standard: 'Dzień pracy',
  empty: 'Puste źródła',
  stale: 'Nieaktualne zapisy',
  offline: 'Usługi offline',
  unavailable: 'Brak źródeł',
  loading: 'Ładowanie',
  ram: 'Wysokie użycie RAM',
  'quota-missing': 'Quota bez pomiaru',
} as const;
export type FixtureCase = keyof typeof fixtureCases;
export function createFixture(now: number, scenario: FixtureCase = 'standard'): DashboardData {
  const source = <T>(data: T): Source<T> => ({ status: 'connected', observedAt: now, data });
  const task = (
    id: string,
    title: string,
    status: TaskStatus,
    project = 'Tabnote',
    runner = 'Codex',
  ): Task => ({
    id,
    title,
    project,
    runner,
    status,
    startedAt: status === 'queue' ? undefined : now - 24 * MINUTE,
    checkedAt: now,
    sourceUrl: `http://127.0.0.1:4321/p/tabnote/tasks/${id}`,
    description:
      status === 'needs-input'
        ? 'Wybrać zakres regresji przed dalszą implementacją.'
        : 'Zadanie w trakcie pracy.',
  });
  const tasks = [
    task('decision', 'Potwierdź zakres testów kalendarza', 'needs-input'),
    task('review-1', 'Widok notatki gotowy do przeglądu', 'review'),
    task('running-1', 'Poprawa wyszukiwania po etykietach', 'running'),
    ...[2, 3, 4].map((i) =>
      task(
        `review-${i}`,
        ['Porządki w filtrach', 'Regresje widoku tablicy', 'Walidacja scenariuszy'][i - 2],
        'review',
      ),
    ),
    task('running-2', 'Testy selektorów zadań', 'running', 'Cezar', 'Claude'),
    task('running-3', 'Dostępność paska nawigacji', 'running'),
    task('queue-1', 'Przegląd kontraktów źródeł', 'queue', 'Desk Panel'),
    task('queue-2', 'Sprawdzenie pustych stanów', 'queue', 'Desk Panel'),
    { ...task('done-1', 'Aktualizacja opisów testów', 'done'), completedAt: now - 4 * MINUTE },
  ];
  const quota = (
    window: '5h' | '7d',
    usedPercent: number,
    resetMinutes: number,
    observedAt = now,
  ): QuotaSnapshot => ({ window, usedPercent, observedAt, resetAt: now + resetMinutes * MINUTE });
  const data: DashboardData = {
    tasks: source(tasks),
    calendar: source([
      {
        id: 'planning',
        title: 'Planowanie Tabnote',
        startAt: now + 12 * MINUTE,
        endAt: now + 42 * MINUTE,
        location: 'Biurko · sesja robocza',
        description: 'Priorytety, regresje i zakres kolejnej iteracji.',
      },
      {
        id: 'design',
        title: 'Przegląd interfejsu',
        startAt: now + 90 * MINUTE,
        endAt: now + 120 * MINUTE,
        description: 'Czytelność panelu na ekranie pionowym.',
      },
      {
        id: 'focus',
        title: 'Czas na pracę własną',
        startAt: now + 180 * MINUTE,
        endAt: now + 240 * MINUTE,
        description: 'Blok skupienia.',
      },
    ]),
    quotas: source([
      {
        provider: 'Claude',
        snapshots: [quota('5h', 92, 125), quota('7d', 61, 4300)],
        history: [
          quota('5h', 75, 125, now - 50 * MINUTE),
          quota('7d', 58, 4300, now - 50 * MINUTE),
        ],
      },
      {
        provider: 'Codex',
        snapshots: [quota('5h', 38, 205), quota('7d', 24, 6100)],
        history: [
          quota('5h', 30, 205, now - 40 * MINUTE),
          quota('7d', 22, 6100, now - 40 * MINUTE),
        ],
      },
    ]),
    system: source(
      [32, 39, 35, 51, 43, 38, 47, 42, 36, 41, 33, 34, 38].map((cpuPercent, i) => ({
        at: now - (12 - i) * 10_000,
        cpuPercent,
        ramUsedGb: +(20.2 + i * 0.075).toFixed(1),
        ramTotalGb: 32,
      })),
    ),
  };
  if (scenario === 'empty') {
    data.tasks.data = [];
    data.calendar.data = [];
    data.quotas.data = [];
    data.system.data = [];
  }
  if (scenario === 'stale' || scenario === 'offline') {
    for (const src of Object.values(data)) {
      src.observedAt = now - 20 * MINUTE;
      if (scenario === 'offline') src.status = 'offline';
    }
    data.tasks.data?.forEach((t) => {
      t.checkedAt -= 20 * MINUTE;
    });
    data.system.data?.forEach((s) => {
      s.at -= 20 * MINUTE;
    });
    data.quotas.data?.forEach((a) =>
      a.snapshots.forEach((s) => {
        if (s.observedAt !== null) s.observedAt -= 20 * MINUTE;
      }),
    );
  }
  if (scenario === 'unavailable' || scenario === 'loading')
    for (const src of Object.values(data)) {
      src.status = scenario;
      src.data = null;
      src.observedAt = null;
    }
  if (scenario === 'ram') {
    data.tasks.data = [];
    data.calendar.data = [];
    data.quotas.data = [];
    data.system.data?.forEach((s) => {
      s.ramUsedGb = 30;
    });
  }
  if (scenario === 'quota-missing')
    data.quotas.data?.forEach((a) =>
      a.snapshots.forEach((s) => {
        s.usedPercent = null;
      }),
    );
  return data;
}
