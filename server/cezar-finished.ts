import { z } from 'zod';
import type { CezarAction, FinishedTask } from '../src/cezar-contract';

// Finished tasks come from Cezar's dashboard overview, which pages 20 light rows (about 8 KB) instead of the 1.1 MB list of
// every run. What the overview leaves out (read receipt, branch, diff, PR) is read from the single run, and cached.
const iso = z.iso.datetime();
const count = z.number().int().nonnegative();
const row = z.object({
  projectId: z.string().min(1), id: z.string().min(1), title: z.string(), titleSummary: z.string().optional(),
  archived: z.boolean().optional(), startedAt: iso.optional(), finishedAt: iso.optional(),
});
const overview = z.object({ asOf: iso, page: z.object({ rows: z.array(row).max(20), total: count, nextOffset: count.nullable() }) });
const detailSchema = z.object({
  seenAt: iso.optional(), branch: z.string().optional(), workflow: z.string().optional(), runner: z.string().optional(),
  model: z.string().optional(), modelIdentity: z.string().optional(),
  diffStat: z.object({ adds: z.number(), dels: z.number(), files: z.number() }).optional(),
  pullRequestUrl: z.string().optional(),
});
type Detail = z.infer<typeof detailSchema>;

/** Most tasks kept, newest first; and how far back and how deep into the pages the overview is read. */
export const FINISHED_LIMIT = 30;
const PAGES = 8, PERIOD = '30d', DETAIL_PARALLEL = 5;
const LIST_TTL_MS = 30_000, SEEN_TTL_MS = 10 * 60_000, UNSEEN_TTL_MS = 60_000;
const groups = [['completed', 'done'], ['failed', 'failed']] as const;

const runPath = (project: string, run: string) => `/api/v1/p/${encodeURIComponent(project)}/runs/${encodeURIComponent(run)}`;

/** Done and failed tasks that are not archived, read gently: the list for 30 s, a task's details for minutes. */
export function createFinishedReader(base: string, request: typeof fetch = fetch, now: () => number = Date.now) {
  const get = async (path: string) => {
    const response = await request(new URL(path, base), { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!response.ok) throw new Error(`Cezar HTTP ${response.status}`);
    return response.json();
  };
  const details = new Map<string, { at: number; value: Detail | null }>();
  let cache: { at: number; tasks: FinishedTask[] } | undefined;
  let pending: Promise<FinishedTask[]> | undefined;

  async function detailOf(project: string, run: string): Promise<Detail | null> {
    const key = `${project}/${run}`;
    const known = details.get(key);
    if (known && now() - known.at < (known.value?.seenAt ? SEEN_TTL_MS : UNSEEN_TTL_MS)) return known.value;
    let value: Detail | null = known?.value ?? null;
    try { value = detailSchema.parse(await get(runPath(project, run))); } catch { /* details are optional; the row stays without them */ }
    details.set(key, { at: now(), value });
    return value;
  }

  async function load(): Promise<FinishedTask[]> {
    const rows: { r: z.infer<typeof row>; status: 'done' | 'failed'; asOf: string }[] = [];
    for (const [group, status] of groups) {
      let offset: number | null = 0, kept = 0;
      for (let n = 0; offset !== null && n < PAGES && kept < FINISHED_LIMIT; n++) {
        const query = new URLSearchParams({ period: PERIOD, group, limit: '20', offset: String(offset) });
        const data = overview.parse(await get(`/api/v1/workspace/dashboard/overview?${query}`));
        for (const r of data.page.rows) if (!r.archived && r.finishedAt) { rows.push({ r, status, asOf: data.asOf }); kept++; }
        offset = data.page.nextOffset;
      }
    }
    rows.sort((a, b) => Date.parse(b.r.finishedAt!) - Date.parse(a.r.finishedAt!));
    const shown = rows.slice(0, FINISHED_LIMIT);
    const found: (Detail | null)[] = new Array(shown.length).fill(null);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(DETAIL_PARALLEL, shown.length) }, async () => {
      while (next < shown.length) { const i = next++; found[i] = await detailOf(shown[i].r.projectId, shown[i].r.id); }
    }));
    const alive = new Set(shown.map(s => `${s.r.projectId}/${s.r.id}`));
    for (const key of details.keys()) if (!alive.has(key)) details.delete(key);
    return shown.map(({ r, status, asOf }, i) => {
      const d = found[i];
      const model = d?.model || d?.modelIdentity;
      return {
        id: `${r.projectId}/${r.id}`, title: r.titleSummary || r.title, project: r.projectId, status,
        checkedAt: Date.parse(asOf), description: r.title,
        sourceUrl: new URL(`/p/${encodeURIComponent(r.projectId)}/tasks/${encodeURIComponent(r.id)}`, base).href,
        completedAt: Date.parse(r.finishedAt!),
        ...(r.startedAt ? { startedAt: Date.parse(r.startedAt) } : {}),
        // Without the details nothing is known about the receipt, and a row is not flagged unread for it.
        ...(d ? { unread: !d.seenAt } : {}),
        ...(d?.branch ? { branch: d.branch } : {}), ...(d?.workflow ? { workflow: d.workflow } : {}),
        ...(d?.runner ? { runner: d.runner } : {}), ...(model ? { model } : {}),
        ...(d?.diffStat ? { diffStat: d.diffStat } : {}), ...(d?.pullRequestUrl ? { pullRequestUrl: d.pullRequestUrl } : {}),
      };
    });
  }

  return {
    async read(): Promise<FinishedTask[]> {
      if (cache && now() - cache.at < LIST_TTL_MS) return cache.tasks;
      pending ??= load().then(tasks => { cache = { at: now(), tasks }; return tasks; }).finally(() => { pending = undefined; });
      return pending;
    },
    /** After a change made through the panel: the next read asks Cezar again. */
    invalidate(id?: string) {
      cache = undefined;
      if (id) details.delete(id); else details.clear();
    },
  };
}

/** The only writes the panel makes to Cezar: archive or restore a run, mark it read or unread. */
export async function cezarAction(base: string, id: string, action: CezarAction, request: typeof fetch = fetch) {
  const [project, run] = id.split('/');
  const unarchive = action === 'unarchive';
  const response = await request(new URL(`${runPath(project, run)}/${unarchive ? 'archive' : action}`, base), {
    method: 'POST', signal: AbortSignal.timeout(4000), redirect: 'error',
    ...(unarchive ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ archived: false }) } : {}),
  });
  if (!response.ok) throw new Error(`Cezar HTTP ${response.status}`);
}
