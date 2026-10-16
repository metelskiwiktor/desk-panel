import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { z } from 'zod';
import { taskUsageEntrySchema, type TaskUsage } from '../src/task-usage-contract';

const wire = z.object({ version: z.literal(1), asOf: z.iso.datetime(), availability: z.enum(['available', 'unavailable']),
  tasks: z.array(taskUsageEntrySchema.extend({ startedAt: z.iso.datetime().nullable(), finishedAt: z.iso.datetime().nullable() })).max(50) });

/** Fixed loopback adapter route; the browser never receives the owner credential. Keeps the last good answer when the adapter is down. */
export function createTaskUsageReader(envFile: string, request: typeof fetch = fetch, now = Date.now) {
  let cache: TaskUsage | undefined, at = -Infinity, pending: Promise<TaskUsage> | undefined;
  return async function read(): Promise<TaskUsage> {
    if (pending) return pending;
    if (cache && now() - at < 30000) return cache;
    pending = (async () => {
      at = now();
      try {
        const env = parse(await readFile(envFile)), port = Number(env.PORT || '8787');
        if (!env.ADAPTER_API_KEY || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('configuration');
        const response = await request(`http://127.0.0.1:${port}/panel/v2/tasks/usage?limit=20`, {
          headers: { Authorization: `Bearer ${env.ADAPTER_API_KEY}` }, signal: AbortSignal.timeout(15000), redirect: 'error' });
        if (!response.ok) throw new Error('adapter unavailable');
        const value = wire.parse(await response.json());
        const time = (iso: string | null) => iso ? Date.parse(iso) : null;
        cache = { status: value.availability === 'available' ? 'connected' : 'unavailable', observedAt: Date.parse(value.asOf),
          tasks: value.tasks.map(t => ({ ...t, startedAt: time(t.startedAt), finishedAt: time(t.finishedAt) })) };
      } catch {
        cache = { observedAt: null, tasks: [], ...cache, status: 'offline' };
      }
      return cache;
    })().finally(() => { pending = undefined; });
    return pending;
  };
}
