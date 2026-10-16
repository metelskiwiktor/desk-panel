import { join } from 'node:path';
import { createScenarioSources, loadScenario } from '../server/scenario';
import { jsonRoutes } from '../server/sources';
import type { DashboardData, Source } from './model';
import { mailActionSchema } from './mail-contract';
import { warmupEditSchema,warmupProviderSchema } from './warmup-contract';

/** Scenario files in scenarios/ — the only mock data, shared by tests and `npm run scenario`. */
export type ScenarioName = 'standard' | 'empty' | 'stale' | 'offline' | 'unavailable' | 'loading' | 'high-ram' | 'quota-missing' | 'mail-many' | 'quota-settings';
export const scenarioFile = (name: ScenarioName) => join(process.cwd(), 'scenarios', `${name}.json`);

/** What a UI hook holds when the endpoint fails or never answers. */
function read<T>(value: T | { $error: number } | { $pending: true }): T | Source<never> {
  if (value && typeof value === 'object' && '$error' in value) return { status: 'offline', observedAt: null, data: null };
  if (value && typeof value === 'object' && '$pending' in value) return { status: 'loading', observedAt: null, data: null };
  return value as T;
}

/** Dashboard model the UI would hold after reading the scenario through the API. */
export function createFixture(now: number, name: ScenarioName = 'standard'): DashboardData {
  const scenario = loadScenario(scenarioFile(name), now);
  const cezar = read(scenario.cezar);
  return {
    tasks: 'tasks' in cezar ? { status: 'connected', observedAt: cezar.observedAt, data: cezar.tasks, live: true, partial: cezar.partial } : cezar,
    calendar: read(scenario.calendar),
    system: read(scenario.system),
    quotas: read(scenario.quotas),
  };
}

/** `fetch` replacement answering the panel API from a scenario file, as the scenario server does. */
export function scenarioFetch(name: ScenarioName): typeof fetch {
  const sources = createScenarioSources(scenarioFile(name));
  const routes = jsonRoutes(sources);
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input), 'http://127.0.0.1');
    try {
      if(init?.method==='POST' && url.pathname.startsWith('/api/quotas/warmup/')) {
        const provider=warmupProviderSchema.parse(url.pathname.split('/').at(-1));
        return Response.json(await sources.saveWarmup!(provider,warmupEditSchema.parse(JSON.parse(String(init.body)))));
      }
      if (init?.method === 'POST' && url.pathname === '/api/mail/action') {
        const { account, threadId, action } = mailActionSchema.parse(JSON.parse(String(init.body)));
        await sources.mailAction(account, threadId, action);
        return Response.json({ ok: true });
      }
      const route = routes[url.pathname];
      if (!route || init?.method === 'POST') return new Response('', { status: 404 });
      return Response.json(await route(url));
    } catch (error) { return new Response('', { status: (error as { status?: number }).status ?? 502 }); }
  }) as typeof fetch;
}
