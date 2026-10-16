import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { z } from 'zod';
import { quotaSourceSchema, type QuotaSource } from '../src/quota-contract';

const observation = z.object({ window: z.string().min(1).max(120), model:z.string().max(160).optional(), label:z.string().max(200).optional(), state:z.enum(['fresh','stale','unavailable','auth_required']).optional(), reason:z.string().nullable().optional(), attemptedAt:z.iso.datetime().optional(), retryAt:z.iso.datetime().optional(), usedPercent: z.number().min(0).max(100).nullable(),
  observedAt: z.iso.datetime().nullable(), resetAt: z.iso.datetime().nullable(), stale: z.boolean(), source: z.string().nullable(), freshForMs:z.number().int().positive().max(300000).optional() });
const projection = z.object({ version: z.union([z.literal(1),z.literal(2)]), asOf: z.iso.datetime(), availability: z.enum(['available','unavailable']),
  accounts: z.array(z.object({ provider: z.enum(['Claude','Codex','AGY']), accountId:z.string().nullable().optional(), reason:z.string().nullable().optional(), attemptedAt:z.iso.datetime().optional(), snapshots: z.array(observation).max(200), history: z.array(observation).max(100) })).max(3) });
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
        let response = await request(`http://127.0.0.1:${port}/panel/v2/quotas/live`, {
          headers: { Authorization: `Bearer ${settings.ADAPTER_API_KEY}` }, signal: AbortSignal.timeout(45000), redirect: 'error',
        });
        if (response.status===404) response = await request(`http://127.0.0.1:${port}/panel/v1/quotas/live`, {headers:{Authorization:`Bearer ${settings.ADAPTER_API_KEY}`},signal:AbortSignal.timeout(45000),redirect:'error'});
        if (!response.ok) throw new Error('adapter unavailable');
        const value = projection.parse(await response.json());
        const map = (w: z.infer<typeof observation>) => ({ ...w, attemptedAt:w.attemptedAt ? Date.parse(w.attemptedAt) : undefined, retryAt:w.retryAt ? Date.parse(w.retryAt) : undefined,
          observedAt: w.observedAt ? Date.parse(w.observedAt) : null, resetAt: w.resetAt ? Date.parse(w.resetAt) : null });
        cache = quotaSourceSchema.parse({ live: true, name: 'Limity AI', mode:'live', status: value.availability === 'available' ? 'connected' : 'unavailable',
          observedAt: Date.parse(value.asOf), data: value.accounts.map(a => ({ ...a, attemptedAt:a.attemptedAt ? Date.parse(a.attemptedAt) : undefined, snapshots: a.snapshots.map(map), history: a.history.map(map) })),
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
