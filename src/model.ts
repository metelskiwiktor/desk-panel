export type SourceStatus = 'connected' | 'offline' | 'unavailable' | 'loading';
export interface Source<T> {
  live?: boolean;
  mode?: 'live' | 'historical';
  name?: string;
  message?: string;
  partial?: boolean;
  status: SourceStatus;
  observedAt: number | null;
  loadedAt?: number;
  data: T | null;
}
export type TaskStatus = 'needs-input' | 'review' | 'running' | 'queue' | 'done' | 'failed';

export interface TaskActivityDetail {
  state: 'executing_tool' | 'thinking' | 'waiting_for_input' | 'completed' | 'queued';
  activeTool?: string;
  activeToolInput?: string;
  elapsedMs?: number;
  message?: string;
}

export interface TaskChecks {
  executed: boolean;
  total: number;
  passed: number;
  failed: number;
  items?: Array<{
    command: string;
    status: 'passed' | 'failed' | 'running' | 'unknown';
    exitCode?: number;
    outputExcerpt?: string;
  }>;
}

export interface Task {
  id: string;
  title: string;
  project: string;
  runner?: string;
  model?: string;
  branch?: string;
  workflow?: string;
  activity?: string;
  activityDetail?: TaskActivityDetail;
  checks?: TaskChecks;
  diffStat?: { adds: number; dels: number; files: number };
  currentStep?: { id: string; name?: string; status: string } | null;
  question?: string | null;
  lastMessage?: string;
  unread?: boolean;
  pullRequestUrl?: string;
  status: TaskStatus;
  startedAt?: number;
  checkedAt: number;
  completedAt?: number;
  description: string;
  sourceUrl?: string;
}
export interface CalendarEvent {
  id: string;
  title: string;
  startAt: number;
  endAt: number;
  location?: string;
  description: string;
  sourceUrl?: string;
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
}
export type Provider = 'Claude' | 'Codex' | 'AGY';
export interface QuotaSnapshot {
  window: string;
  model?: string;
  label?: string;
  state?: 'fresh'|'stale'|'unavailable'|'auth_required';
  reason?: string|null;
  attemptedAt?: number;
  retryAt?: number;
  usedPercent: number | null;
  observedAt: number | null;
  resetAt: number | null;
  stale?: boolean;
  freshForMs?: number;
  source?: string | null;
}
export interface QuotaAccount {
  provider: Provider;
  accountId?: string|null;
  reason?: string|null;
  attemptedAt?: number;
  snapshots: QuotaSnapshot[];
  history: QuotaSnapshot[];
}
export interface SystemSample {
  at: number;
  cpuPercent: number;
  ramUsedGb: number;
  ramTotalGb: number;
}
export interface DashboardData {
  tasks: Source<Task[]>;
  calendar: Source<CalendarEvent[]>;
  quotas: Source<QuotaAccount[]>;
  system: Source<SystemSample[]>;
}
export type Detail =
  | { kind: 'task'; id: string }
  | { kind: 'event'; id: string }
  | { kind: 'quota'; provider: Provider }
  | { kind: 'mail'; id: string }
  | { kind: 'workout'; id: string }
  | { kind: 'breakdown' }
  | { kind: 'system' };
export const MINUTE = 60_000;
export const MAX_AGE = {
  tasks: 75_000,
  calendar: 5 * MINUTE,
  quotas: 5 * MINUTE,
  system: 15_000,
  mail: 2 * MINUTE,
  training: 45 * MINUTE,
  /** The server reads the bank every 7 hours (four unattended reads a day is the limit). */
  bank: 9 * 60 * MINUTE,
};
export function fresh<T>(source: Source<T>, now: number, maxAge: number): boolean {
  return (
    source.status === 'connected' &&
    source.data !== null &&
    source.observedAt !== null &&
    source.observedAt <= now &&
    now - source.observedAt <= maxAge
  );
}
export function sourceLabel<T>(source: Source<T>, now: number, maxAge: number): string {
  if (source.status === 'loading') return 'Ładowanie danych';
  if (source.status === 'offline' && source.data === null) return `${source.name || 'Cezar'} niedostępny`;
  if (source.status === 'unavailable' || source.data === null) return 'Brak źródła danych';
  if (source.status === 'offline') return 'Offline · ostatni zapis';
  if (!fresh(source, now, maxAge)) return 'Nieaktualny zapis';
  return source.partial ? 'Dane częściowe' : source.name ? `Połączono · ${source.name}` : 'Połączono z Cezarem';
}
export type QuotaState = 'fresh' | 'stale' | 'unavailable';
export function quotaState(snapshot: QuotaSnapshot, now: number): QuotaState {
  if (
    snapshot.usedPercent === null ||
    !Number.isFinite(snapshot.usedPercent) ||
    snapshot.usedPercent < 0 ||
    snapshot.usedPercent > 100
  )
    return 'unavailable';
  if (
    (snapshot.state !== undefined && snapshot.state !== 'fresh') || snapshot.stale || snapshot.observedAt === null || !Number.isFinite(snapshot.observedAt) ||
    snapshot.observedAt > now ||
    now - snapshot.observedAt > (snapshot.freshForMs ?? (snapshot.source ? 60_000 : MAX_AGE.quotas)) ||
    (snapshot.resetAt === null ? snapshot.state === undefined : !Number.isFinite(snapshot.resetAt) || snapshot.resetAt <= now)
  )
    return 'stale';
  return 'fresh';
}
export const taskLabels: Record<TaskStatus, string> = {
  'needs-input': 'Wymaga odpowiedzi',
  review: 'Do przeglądu',
  running: 'W toku',
  queue: 'W kolejce',
  done: 'Zakończone',
  failed: 'Nieudane',
};
export const taskOrder: Record<TaskStatus, number> = {
  'needs-input': 0,
  review: 1,
  running: 2,
  queue: 3,
  done: 4,
  failed: 5,
};
export function orderedTasks(tasks: Task[]): Task[] {
  return [...tasks].sort(
    (a, b) =>
      taskOrder[a.status] - taskOrder[b.status] ||
      b.checkedAt - a.checkedAt ||
      a.id.localeCompare(b.id),
  );
}
export function safeUrl(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
