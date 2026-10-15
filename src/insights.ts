import { fresh, MAX_AGE, MINUTE, quotaState, type DashboardData, type Detail } from './model';

export interface Insight {
  id: string;
  priority: number;
  title: string;
  context: string;
  target: Detail;
  tone: 'amber' | 'blue' | 'green';
}
/** Pure recomputation suppresses resolved conditions. IDs deduplicate source facts. */
export function deriveInsights(data: DashboardData, now: number): Insight[] {
  const facts: Insight[] = [];
  if (fresh(data.tasks, now, MAX_AGE.tasks)) {
    for (const task of data.tasks.data ?? []) {
      if (task.status === 'needs-input')
        facts.push({
          id: `task:${task.id}`,
          priority: 100,
          title: 'Cezar czeka na odpowiedź',
          context: task.title,
          target: { kind: 'task', id: task.id },
          tone: 'amber',
        });
    }
    const completed = (data.tasks.data ?? [])
      .filter(
        (t) =>
          t.status === 'done' &&
          t.completedAt !== undefined &&
          t.completedAt <= now &&
          now - t.completedAt <= 10 * MINUTE,
      )
      .sort((a, b) => b.completedAt! - a.completedAt!)[0];
    if (completed)
      facts.push({
        id: `task:${completed.id}`,
        priority: 40,
        title: 'Zadanie zostało zakończone',
        context: completed.title,
        target: { kind: 'task', id: completed.id },
        tone: 'green',
      });
  }
  if (fresh(data.calendar, now, MAX_AGE.calendar)) {
    const event = (data.calendar.data ?? [])
      .filter((e) => !e.allDay && e.startAt >= now && e.startAt - now <= 15 * MINUTE)
      .sort((a, b) => a.startAt - b.startAt)[0];
    if (event)
      facts.push({
        id: `event:${event.id}`,
        priority: 90,
        title: `Spotkanie za ${Math.ceil((event.startAt - now) / MINUTE)} min`,
        context: event.title,
        target: { kind: 'event', id: event.id },
        tone: 'blue',
      });
  }
  if (fresh(data.quotas, now, MAX_AGE.quotas)) {
    for (const account of data.quotas.data ?? []) {
      const high = account.snapshots.filter(
        (s) => quotaState(s, now) === 'fresh' && s.usedPercent! >= 90,
      );
      if (high.length)
        facts.push({
          id: `quota:${account.provider}`,
          priority: 80,
          title: `${account.provider}: limit blisko wyczerpania`,
          context: high.map((s) => `${s.window}: ${s.usedPercent}% limitu`).join(' · '),
          target: { kind: 'quota', provider: account.provider },
          tone: 'amber',
        });
    }
  }
  if (fresh(data.system, now, MAX_AGE.system)) {
    const samples = [...(data.system.data ?? [])]
      .filter((s) => s.at <= now)
      .sort((a, b) => a.at - b.at);
    const last = samples.at(-1);
    // Require a continuous, bounded-gap high-RAM run covering at least 60 seconds.
    let start = last?.at ?? now;
    let next = start;
    for (const s of samples.slice().reverse()) {
      if (s.ramTotalGb <= 0 || s.ramUsedGb / s.ramTotalGb < 0.9 || next - s.at > 30_000) break;
      start = s.at;
      next = s.at;
    }
    if (last && now - last.at <= 30_000 && last.at - start >= MINUTE)
      facts.push({
        id: 'system:ram',
        priority: 70,
        title: 'RAM powyżej 90% przez minutę',
        context: `${last.ramUsedGb.toLocaleString('pl-PL')} z ${last.ramTotalGb} ${data.system.live ? 'GiB' : 'GB'}`,
        target: { kind: 'system' },
        tone: 'amber',
      });
  }
  return [
    ...new Map(
      facts
        .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id))
        .map((f) => [f.id, f]),
    ).values(),
  ].slice(0, 3);
}
