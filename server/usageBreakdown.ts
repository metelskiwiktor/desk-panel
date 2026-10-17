import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { z } from 'zod';
import { usageProviderSchema, type UsageBreakdown } from '../src/usage-breakdown-contract';

const wire = z.object({ version: z.literal(1), asOf: z.iso.datetime(), availability: z.enum(['available', 'unavailable']),
  providers: z.array(usageProviderSchema.extend({ observedAt: z.iso.datetime().nullable(), resetAt: z.iso.datetime().nullable() })).max(3) });

/** Fixed loopback adapter route; the browser never receives the owner credential. Keeps the last good answer when the adapter is down. */
export function createUsageBreakdownReader(envFile: string, request: typeof fetch = fetch, now = Date.now) {
  let cache: UsageBreakdown | undefined, at = -Infinity, pending: Promise<UsageBreakdown> | undefined;
  return async function read(): Promise<UsageBreakdown> {
    if (pending) return pending;
    if (cache && now() - at < 20000) return cache;
    pending = (async () => {
      at = now();
      try {
        const env = parse(await readFile(envFile)), port = Number(env.PORT || '8787');
        if (!env.ADAPTER_API_KEY || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('configuration');
        const response = await request(`http://127.0.0.1:${port}/panel/v2/usage/breakdown`, {
          headers: { Authorization: `Bearer ${env.ADAPTER_API_KEY}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw new Error('adapter unavailable');
        const value = wire.parse(await response.json());
        const time = (iso: string | null) => iso ? Date.parse(iso) : null;
        cache = { status: value.availability === 'available' ? 'connected' : 'unavailable', observedAt: Date.parse(value.asOf),
          providers: value.providers.map(p => ({ ...p, observedAt: time(p.observedAt), resetAt: time(p.resetAt) })) };
      } catch {
        cache = { observedAt: null, providers: [], ...cache, status: 'offline' };
      }
      return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
