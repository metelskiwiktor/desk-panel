import { MINUTE, quotaState, type QuotaSnapshot } from './model';

export const QUOTA_PACE_TOLERANCE = 5;
export const QUOTA_PACE_WARNING = 15;
export const quotaPaceLabels = {
  green: 'W normie',
  yellow: 'Zużycie wyprzedza czas',
  red: 'Zużycie znacznie wyprzedza czas',
};

export function normalizeQuotaWindow(window: string): '5h' | '7d' | null {
  if (window === '5h' || window.endsWith('-5h') || window.includes('5h')) return '5h';
  if (window === '7d' || window.endsWith('weekly') || window.includes('weekly') || window.includes('7d')) return '7d';
  return null;
}

/** The nominal length of a window; the reset anchors it, so the start of the window is only inferred. */
const quotaWindowMs = (norm: '5h' | '7d') => (norm === '5h' ? 300 : 7 * 24 * 60) * MINUTE;

/** The local hour at which the tile shows where each window will stand; there is no setting for it. */
export const QUOTA_CHECKPOINT_HOUR = 10;

/** The next local 10:00 strictly after `now`. */
export function nextCheckpoint(now: number): number {
  const at = new Date(now);
  at.setHours(QUOTA_CHECKPOINT_HOUR, 0, 0, 0);
  if (at.getTime() <= now) at.setDate(at.getDate() + 1);
  return at.getTime();
}

export function sortSnapshots(snapshots: QuotaSnapshot[]): QuotaSnapshot[] {
  return [...snapshots].sort((a, b) => {
    if (a.model !== b.model) return 0;
    const normA = normalizeQuotaWindow(a.window);
    const normB = normalizeQuotaWindow(b.window);
    if (normA === '5h' && normB !== '5h') return -1;
    if (normA !== '5h' && normB === '5h') return 1;
    return 0;
  });
}

/** The reset anchors the nominal window; no usage is predicted after it. A spent limit (100%) is red until the reset, however close it is. */
export function quotaPace(snapshot: QuotaSnapshot, now: number) {
  const norm = normalizeQuotaWindow(snapshot.window);
  if (quotaState(snapshot, now) !== 'fresh' || !snapshot.resetAt || !norm) return null;
  const duration = quotaWindowMs(norm);
  const elapsedPercent = Math.max(0, Math.min(100, ((duration - (snapshot.resetAt! - now)) * 100) / duration));
  const excess = snapshot.usedPercent! - elapsedPercent;
  // Avoid moving an exact boundary across a colour due to floating-point noise.
  const exhausted = snapshot.usedPercent! >= 100;
  const tone: keyof typeof quotaPaceLabels = exhausted ? 'red' : excess <= QUOTA_PACE_TOLERANCE + 1e-9 ? 'green'
    : excess <= QUOTA_PACE_WARNING + 1e-9 ? 'yellow' : 'red';
  return { elapsedPercent, tone, exhausted };
}

/** Where the window's time will be at `at`; `running` is false once the reset has passed, and then the time is spent (100%). */
export function quotaProjection(snapshot: QuotaSnapshot, now: number, at: number): { percent: number; running: boolean } | null {
  const norm = normalizeQuotaWindow(snapshot.window);
  if (quotaState(snapshot, now) !== 'fresh' || !snapshot.resetAt || !norm) return null;
  const duration = quotaWindowMs(norm);
  const percent = Math.max(0, Math.min(100, ((duration - (snapshot.resetAt! - at)) * 100) / duration));
  return { percent, running: snapshot.resetAt > at };
}

export function quotaResetIn(resetAt: number, now: number) {
  if (resetAt - now < MINUTE) return '<1 min';
  const minutes = Math.ceil((resetAt - now) / MINUTE);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}d${hours ? ` ${hours}h` : ''}`;
  if (hours) return `${hours}h${rest ? ` ${rest} min` : ''}`;
  return `${rest} min`;
}
