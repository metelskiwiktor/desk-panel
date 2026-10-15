import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { cezarSchema } from '../src/cezar-contract';
import { calendarConnectionSchema, calendarSourceSchema } from '../src/calendar-contract';
import { systemSourceSchema } from '../src/system-contract';
import { quotaSourceSchema } from '../src/quota-contract';
import { SourceError, type PanelSources } from './sources';

/**
 * A scenario file holds one response per API endpoint, in exactly the shape the
 * real server returns. Instead of a body an endpoint may be `{ "$error": 502 }`
 * (HTTP failure) or `{ "$pending": true }` (never answers, the UI keeps loading).
 * Any string of the form `now`, `now-20m`, `now+2h30m` is a timestamp relative
 * to the moment of the request (units: ms, s, m, h, d).
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
  calendarConnection: endpoint(calendarConnectionSchema),
  system: endpoint(systemSourceSchema),
  quotas: endpoint(quotaSourceSchema),
}).strict();
export type Scenario = z.infer<typeof scenarioSchema>;
export type ScenarioEndpoint = Exclude<keyof Scenario, '$schema' | 'description'>;

const UNITS = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
const AMOUNT = '\\d+(?:ms|s|m|h|d)';
const RELATIVE = new RegExp(`^now((?:[+-](?:${AMOUNT})+)*)$`);
function resolveTimes(value: unknown, now: number): unknown {
  if (typeof value === 'string') {
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

/** Serves a scenario file; it is re-read on every request so edits apply live. */
export function createScenarioSources(file: string): PanelSources {
  async function serve<K extends ScenarioEndpoint>(key: K) {
    const value = loadScenario(file)[key];
    if ('$error' in value) throw new SourceError(value.$error);
    if ('$pending' in value) return new Promise<never>(() => {});
    return value as Exclude<Scenario[K], z.infer<typeof special>>;
  }
  return {
    cezar: () => serve('cezar'),
    calendar: () => serve('calendar'),
    calendarConnection: () => serve('calendarConnection'),
    system: () => serve('system'),
    quotas: () => serve('quotas'),
    calendarConnect: async () => { throw new SourceError(409); },
    calendarCallback: async () => ({ ok: false, message: 'Scenariusz nie obsługuje logowania Google.' }),
  };
}
