import { MINUTE, quotaState, type QuotaSnapshot } from './model';

export const QUOTA_PACE_TOLERANCE = 5;
export const QUOTA_PACE_WARNING = 15;
export const quotaPaceLabels = {
  green: 'W normie',
  yellow: 'Zużycie wyprzedza czas',
  red: 'Zużycie znacznie wyprzedza czas',
};

/** The reset anchors the nominal window; no usage is predicted after it. */
export function quotaPace(snapshot: QuotaSnapshot, now: number) {
  if (quotaState(snapshot, now) !== 'fresh' || !snapshot.resetAt || !['5h','7d'].includes(snapshot.window)) return null;
  const duration = (snapshot.window === '5h' ? 300 : 7 * 24 * 60) * MINUTE;
  const elapsedPercent = Math.max(0, Math.min(100, ((duration - (snapshot.resetAt! - now)) * 100) / duration));
  const excess = snapshot.usedPercent! - elapsedPercent;
  // Avoid moving an exact boundary across a colour due to floating-point noise.
  const tone: keyof typeof quotaPaceLabels = excess <= QUOTA_PACE_TOLERANCE + 1e-9 ? 'green'
    : excess <= QUOTA_PACE_WARNING + 1e-9 ? 'yellow' : 'red';
  return { elapsedPercent, tone };
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
