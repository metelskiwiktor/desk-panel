import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { cezarSchema } from '../src/cezar-contract';
import { calendarSourceSchema } from '../src/calendar-contract';
import { googleAccountsSchema } from '../src/google-contract';
import { trainingSourceSchema } from '../src/training-contract';
import { MAIL_WINDOW_MS, mailSourceSchema } from '../src/mail-contract';
import { systemSourceSchema } from '../src/system-contract';
import { quotaSourceSchema } from '../src/quota-contract';
import { usageBreakdownSchema } from '../src/usage-breakdown-contract';
import { warmupStatusSchema,warmupEditFor,warmupRunResultSchema } from '../src/warmup-contract';
import { SourceError, type PanelSources } from './sources';

/**
 * A scenario file holds one response per API endpoint, in exactly the shape the
 * real server returns. Instead of a body an endpoint may be `{ "$error": 502 }`
 * (HTTP failure) or `{ "$pending": true }` (never answers, the UI keeps loading).
 * Any string of the form `now`, `now-20m`, `now+2h30m` is a timestamp relative
 * to the moment of the request (units: ms, s, m, h, d). `today`, `today+2`, `today-1` are calendar
 * days (YYYY-MM-DD, local time) counted from the day of the request; `today-1@22:10` is that moment.
 */
const special = z.union([
  z.object({ $error: z.number().int().min(400).max(599) }).strict(),
  z.object({ $pending: z.literal(true) }).strict(),
]);
const endpoint = <T extends z.ZodType>(schema: T) => z.union([special, schema]).default({ $error: 503 });
export const scenarioSchema = z.object({
  $schema: z.string().optional(),
  description: z.string().optional(),
  cezar: endpoint(cezarSchema),
  calendar: endpoint(calendarSourceSchema),
  training: endpoint(trainingSourceSchema),
  googleAccounts: endpoint(googleAccountsSchema),
  /** All listed conversations; the server applies `limit` and the actions taken in this session. */
  mail: endpoint(mailSourceSchema),
  system: endpoint(systemSourceSchema),
  quotas: endpoint(quotaSourceSchema),
  warmup: endpoint(warmupStatusSchema),
  warmupRun: endpoint(z.object({Claude:warmupRunResultSchema,Codex:warmupRunResultSchema,Gemini:warmupRunResultSchema})),
  usageBreakdown: endpoint(usageBreakdownSchema),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioEndpoint = Exclude<keyof Scenario, '$schema' | 'description'>;

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const AMOUNT = '\\d+(?:ms|s|m|h|d)';
const RELATIVE = new RegExp(`^now((?:[+-](?:${AMOUNT})+)*)$`);
const DAY = /^today([+-]\d+)?(?:@(\d{2}):(\d{2}))?$/;
function resolveTimes(value: unknown, now: number): unknown {
  if (typeof value === 'string') {
    const day = DAY.exec(value);
    if (day) {
      const d = new Date(now);
      d.setDate(d.getDate() + Number(day[1] ?? 0));
      // `today-1@22:10` is a moment (ms) of that local day; without a time it is the date.
      if (day[2]) return d.setHours(Number(day[2]), Number(day[3]), 0, 0);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
    const match = RELATIVE.exec(value);
    if (!match) return value;
    let at = now;
    for (const [, sign, amounts] of match[1].matchAll(new RegExp(`([+-])((?:${AMOUNT})+)`, 'g')))
      for (const [, amount, unit] of amounts.matchAll(/(\d+)(ms|s|m|h|d)/g))
        at += (sign === '-' ? -1 : 1) * Number(amount) * UNITS[unit as keyof typeof UNITS];
    return at;
  }
  if (Array.isArray(value)) return value.map(v => resolveTimes(v, now));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolveTimes(v, now)]));
  return value;
}

/** Parses a scenario relative to `now`; throws a readable error for invalid data. */
export function parseScenario(json: unknown, now: number): Scenario {
  const result = scenarioSchema.safeParse(resolveTimes(json, now));
  if (!result.success) throw new Error(z.prettifyError(result.error));
  return result.data;
}
export function loadScenario(file: string, now = Date.now()): Scenario {
  try { return parseScenario(JSON.parse(readFileSync(file, 'utf8')), now); }
  catch (error) { throw new Error(`Invalid scenario ${file}:\n${error instanceof Error ? error.message : error}`); }
}

/**
 * Serves a scenario file; it is re-read on every request so edits apply live.
 * Mail actions are remembered in memory, so swiping behaves like Gmail until restart.
 */
export function createScenarioSources(file: string): PanelSources {
  const handled = new Set<string>();
  /** What the panel changed on finished Cezar tasks, so a scenario answers like Cezar would. */
  const finishedChanges = new Map<string, { archived?: boolean; unread?: boolean }>();
  let warmup:import('../src/warmup-contract').WarmupStatus|undefined;
  async function serve<K extends ScenarioEndpoint>(key: K) {
    const value = loadScenario(file)[key];
    if ('$error' in value) throw new SourceError(value.$error);
    if ('$pending' in value) return new Promise<never>(() => {});
    return value as Exclude<Scenario[K], z.infer<typeof special>>;
  }
  return {
    async cezar() {
      const source = await serve('cezar');
      if (!('finished' in source)) return source;
      const finished = source.finished.flatMap(task => {
        const change = finishedChanges.get(task.id);
        return change?.archived ? [] : [change?.unread === undefined ? task : { ...task, unread: change.unread }];
      });
      return { ...source, finished };
    },
    async cezarAction(id, action) {
      const source = await serve('cezar');
      if (!('finished' in source) || !source.finished.some(t => t.id === id)) throw new SourceError(404);
      const change = finishedChanges.get(id) ?? {};
      if (action === 'archive') change.archived = true;
      else if (action === 'unarchive') change.archived = false;
      else change.unread = action === 'unread';
      finishedChanges.set(id, change);
    },
    calendar: () => serve('calendar'),
    training: () => serve('training'),
    googleAccounts: () => serve('googleAccounts'),
    async mail(limit) {
      const source = await serve('mail');
      // Same rolling window as Gmail, so a scenario cannot show what the service would not.
      const cutoff = Date.now() - MAIL_WINDOW_MS;
      const all = source.data?.filter(t => t.receivedAt >= cutoff && !handled.has(t.id)) ?? null;
      return { ...source, data: all && all.slice(0, limit), total: all?.length ?? 0 };
    },
    async mailAction(account, threadId, action) {
      const id = `${account}:${threadId}`;
      if (!(await serve('mail')).data?.some(t => t.id === id)) throw new SourceError(404);
      if (action === 'read' || action === 'trash') handled.add(id); else handled.delete(id);
    },
    system: () => serve('system'),
    quotas: () => serve('quotas'),
    usageBreakdown: () => serve('usageBreakdown'),
    warmup:async()=>warmup ?? serve('warmup'),
    runWarmup:async(provider)=>(await serve('warmupRun'))[provider],
    saveWarmup:async(provider,value)=>{
      const current=warmup ?? await serve('warmup');
      warmup={...current,settings:{...current.settings,[provider]:warmupEditFor(provider).parse(value)}};return warmup;
    },
    googleConnect: async () => { throw new SourceError(409); },
    googleCallback: async () => ({ ok: false, message: 'Scenariusz nie obsługuje logowania Google.' }),
  };
}
