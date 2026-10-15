import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { z } from 'zod';
import { quotaSourceSchema, type QuotaSource } from '../src/quota-contract';

const observation = z.object({ window: z.enum(['5h','7d']), usedPercent: z.number().min(0).max(100).nullable(),
  observedAt: z.iso.datetime().nullable(), resetAt: z.iso.datetime().nullable(), stale: z.boolean(), source: z.string().nullable(), freshForMs:z.number().int().positive().max(120000).optional() });
const projection = z.object({ version: z.literal(1), asOf: z.iso.datetime(), availability: z.enum(['available','unavailable']),
  accounts: z.array(z.object({ provider: z.enum(['Claude','Codex']), snapshots: z.array(observation).length(2), history: z.array(observation).max(100) })).length(2) });
export function createQuotaReader(envFile: string, request: typeof fetch = fetch, now = Date.now) {
  let cache: QuotaSource | undefined;
  let at = -Infinity;
  let pending: Promise<QuotaSource> | undefined;
  return async function read(): Promise<QuotaSource> {
    if (pending) return pending;
    if (cache && now() - at < 10000) return cache;
    pending = (async () => {
      at = now();
      try {
        // Parse privately; never load adapter configuration into process.env or the browser.
        const settings = parse(await readFile(envFile));
        if (!settings.ADAPTER_API_KEY) throw new Error('missing configuration');
        const port = Number(settings.PORT || '8787');
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid port');
        const response = await request(`http://127.0.0.1:${port}/panel/v1/quotas/live`, {
          headers: { Authorization: `Bearer ${settings.ADAPTER_API_KEY}` }, signal: AbortSignal.timeout(10000), redirect: 'error',
        });
        if (!response.ok) throw new Error('adapter unavailable');
        const value = projection.parse(await response.json());
        const map = (w: z.infer<typeof observation>) => ({ ...w,
          observedAt: w.observedAt ? Date.parse(w.observedAt) : null, resetAt: w.resetAt ? Date.parse(w.resetAt) : null });
        cache = quotaSourceSchema.parse({ live: true, name: 'Limity AI', mode:'live', status: value.availability === 'available' ? 'connected' : 'unavailable',
          observedAt: Date.parse(value.asOf), data: value.accounts.map(a => ({ ...a, snapshots: a.snapshots.map(map), history: a.history.map(map) })),
          message: 'Bieżące limity z loginów CLI · odczyt co około minutę, bez wywoływania modelu.',
        });
      } catch {
        cache = { ...(cache || { observedAt: null, data: null }), live: true, name: 'Limity AI', mode:'live', status: 'offline',
          message: 'Nie można odczytać limitów z cezar-adapter.' };
      }
      return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
