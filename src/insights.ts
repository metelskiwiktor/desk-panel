import { fresh, MAX_AGE, MINUTE, quotaState, type DashboardData, type Detail } from './model';
/** Events point at dashboard sources; mail is not an event source. */
type InsightTarget = Extract<Detail, { kind: 'task' | 'event' | 'quota' | 'system' }>;
import { quotaPace, quotaResetIn } from './quota-pace';
import { EVENT_RULES } from './event-rules';

export interface Insight {
  id: string;
  priority: number;
  title: string;
  context: string;
  target: InsightTarget;
  tone: 'amber' | 'blue' | 'green' | 'red';
}
/** Fresh conditions only; the event journal records their occurrences separately. */
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
          now - t.completedAt <= EVENT_RULES.completedWithinMinutes * MINUTE,
      )
      .sort((a, b) => b.completedAt! - a.completedAt!);
    for (const task of completed)
      facts.push({
        id: `task-done:${task.id}:${task.completedAt}`,
        priority: 40,
        title: 'Zadanie zostało zakończone',
        context: task.title,
        target: { kind: 'task', id: task.id },
        tone: 'green',
      });
  }
  if (fresh(data.calendar, now, MAX_AGE.calendar)) {
    const events = (data.calendar.data ?? [])
      .filter((e) => !e.allDay && e.startAt >= now && e.startAt - now <= EVENT_RULES.meetingWithinMinutes * MINUTE)
      .sort((a, b) => a.startAt - b.startAt);
    for (const event of events)
      facts.push({
        id: `event:${event.id}:${event.startAt}`,
        priority: 90,
        title: `Spotkanie za ${Math.ceil((event.startAt - now) / MINUTE)} min`,
        context: event.title,
        target: { kind: 'event', id: event.id },
        tone: 'blue',
      });
  }
  if (fresh(data.quotas, now, MAX_AGE.quotas)) {
    for (const account of data.quotas.data ?? []) {
      if (account.provider === 'AGY') continue; // Group windows have no inferred nominal pacing.
      for (const snapshot of account.snapshots) {
        if (quotaState(snapshot, now) !== 'fresh') continue;
        const pace = quotaPace(snapshot, now);
        const context = `${snapshot.window}: ${snapshot.usedPercent}% limitu${snapshot.resetAt ? ` · reset za ${quotaResetIn(snapshot.resetAt, now)}` : ''}`;
        if (pace && pace.tone !== 'green') {
          const excess = snapshot.usedPercent! - pace.elapsedPercent;
          facts.push({
            id: `quota-pace:${account.provider}:${snapshot.window}:${snapshot.resetAt}:${pace.tone}`,
            priority: pace.tone === 'red' ? 85 : 60,
            title: `${account.provider} · ${snapshot.window}: ${pace.tone === 'red' ? 'wysokie tempo zużycia' : 'zużycie wyprzedza czas'}`,
            context: `+${excess.toLocaleString('pl-PL', { maximumFractionDigits: 2 })} p.p. względem czasu · ${context}`,
            target: { kind: 'quota', provider: account.provider },
            tone: pace.tone === 'red' ? 'red' : 'amber',
          });
        }
        if (snapshot.usedPercent! >= EVENT_RULES.quotaHighPercent)
          facts.push({
            id: `quota:${account.provider}:${snapshot.window}:${snapshot.resetAt}`,
            priority: 80,
            title: `${account.provider} · ${snapshot.window}: limit blisko wyczerpania`,
            context,
            target: { kind: 'quota', provider: account.provider },
            tone: 'amber',
          });
      }
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
      if (s.ramTotalGb <= 0 || s.ramUsedGb / s.ramTotalGb < EVENT_RULES.ramHighPercent / 100 || next - s.at > 30_000) break;
      start = s.at;
      next = s.at;
    }
    if (last && now - last.at <= 30_000 && last.at - start >= EVENT_RULES.ramForMinutes * MINUTE)
      facts.push({
        id: 'system:ram',
        priority: 70,
        title: `RAM ≥${EVENT_RULES.ramHighPercent}% przez ${EVENT_RULES.ramForMinutes} minutę`,
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
  ];
}
