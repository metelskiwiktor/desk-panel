import { z } from 'zod';
import { deriveInsights } from './insights';
import { fresh, MAX_AGE, type DashboardData } from './model';
import { EVENT_RULES } from './event-rules';

export const ACTIVITY_STORAGE_KEY = 'desk-panel.events.v1';
export const ACTIVITY_LIMIT = 100;
const entrySchema = z.object({
  id: z.string().max(200),
  detectedAt: z.number().finite(),
  title: z.string().max(2000),
  context: z.string().max(4000),
  tone: z.enum(['amber', 'blue', 'green', 'red']),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('task'), id: z.string().max(1000) }),
    z.object({ kind: z.literal('event'), id: z.string().max(1000) }),
    z.object({ kind: z.literal('quota'), provider: z.enum(['Claude', 'Codex']) }),
    z.object({ kind: z.literal('system') }),
  ]),
});
const logSchema = z.object({
  version: z.literal(1),
  sequence: z.number().int().nonnegative(),
  entries: z.array(entrySchema).max(ACTIVITY_LIMIT),
  seen: z.array(z.string().max(2000)).max(2000),
  active: z.array(z.string().max(2000)).max(1000),
});
export type ActivityEntry = z.infer<typeof entrySchema>;
export type ActivityLog = z.infer<typeof logSchema>;
export const emptyActivityLog = (): ActivityLog => ({ version: 1, sequence: 0, entries: [], seen: [], active: [] });

export function readActivityLog(): ActivityLog {
  try { return logSchema.parse(JSON.parse(localStorage.getItem(ACTIVITY_STORAGE_KEY) ?? 'null')); }
  catch { return emptyActivityLog(); }
}
export function saveActivityLog(log: ActivityLog): boolean {
  try { localStorage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify(logSchema.parse(log))); return true; }
  catch { return false; }
}

export function recordActivity(log: ActivityLog, data: DashboardData, now: number): ActivityLog {
  let active = log.active;
  if (fresh(data.tasks, now, MAX_AGE.tasks)) {
    active = active.filter(key => {
      if (!key.startsWith('task:')) return true;
      const task = data.tasks.data!.find(task => `task:${task.id}` === key);
      return task ? task.status === 'needs-input' : !!data.tasks.partial;
    });
  }
  if (fresh(data.system, now, MAX_AGE.system)) {
    const latest = data.system.data!.filter(s => s.at <= now).sort((a,b) => b.at-a.at)[0];
    // Only a real below-threshold sample rearms RAM; gaps/offline do not.
    if (latest && now - latest.at <= MAX_AGE.system && latest.ramTotalGb > 0 && latest.ramUsedGb / latest.ramTotalGb < EVENT_RULES.ramHighPercent / 100) {
      active = active.filter(key => key !== 'system:ram');
    }
  }
  const seen = new Set(log.seen);
  const current = new Set(active);
  const added: ActivityEntry[] = [];
  let sequence = log.sequence;
  for (const fact of deriveInsights(data, now)) {
    const repeatable = fact.id.startsWith('task:') || fact.id === 'system:ram';
    if (repeatable ? current.has(fact.id) : seen.has(fact.id)) continue;
    if (repeatable) current.add(fact.id); else seen.add(fact.id);
    // A later fall from red to yellow is recovery, not a new warning.
    if (fact.id.startsWith('quota-pace:') && fact.id.endsWith(':red')) seen.add(fact.id.replace(/:red$/, ':yellow'));
    added.push({ id: `${now}:${++sequence}`, detectedAt: now, title: fact.title, context: fact.context, tone: fact.tone, target: fact.target });
  }
  if (!added.length && active.length === log.active.length) return log;
  return {
    version: 1, sequence,
    entries: [...added, ...log.entries].slice(0, ACTIVITY_LIMIT),
    seen: [...seen].slice(-2000), active: [...current].slice(-1000),
  };
}

export function dismissActivity(log: ActivityLog, id: string): ActivityLog {
  return { ...log, entries: log.entries.filter(entry => entry.id !== id) };
}
export function restoreActivity(log: ActivityLog, entry: ActivityEntry): ActivityLog {
  if (log.entries.some(item => item.id === entry.id)) return log;
  return { ...log, entries: [...log.entries, entry].sort((a,b) => b.detectedAt-a.detectedAt || Number(b.id.split(':').at(-1))-Number(a.id.split(':').at(-1))).slice(0, ACTIVITY_LIMIT) };
}
