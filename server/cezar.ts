import { z } from 'zod';
import { cezarSchema } from '../src/cezar-contract';

// Read only the documented subset of Cezar's versioned dashboard contract.
// Its api-client is private; avoid importing checkout internals or run storage.
const iso = z.iso.datetime();
const count = z.number().int().nonnegative();
const row = z.object({
  projectId: z.string().min(1), id: z.string().min(1), title: z.string(),
  titleSummary: z.string().optional(), status: z.string(),
  activity: z.string().optional(), startedAt: iso.optional(), finishedAt: iso.optional(),
});
const page = z.object({ rows: z.array(row).max(20), total: count, nextOffset: count.nullable() });
const coverage = z.object({ projects: z.array(z.object({ state: z.enum(['complete', 'partial', 'unavailable']) })) });
const snapshot = z.object({
  snapshotId: z.string().min(1), asOf: iso, coverage,
  counts: z.object({ running: count, queued: count, questions: count, reviews: count, scheduled: count }),
});
const groupPage = z.object({ snapshotId: z.string(), asOf: iso, coverage, page });
const statuses = { questions: 'needs-input', reviews: 'review', running: 'running', queued: 'queue' } as const;

export async function readCezar(base: string, request: typeof fetch = fetch) {
  const get = async (path: string) => {
    const response = await request(new URL(path, base), { signal: AbortSignal.timeout(4000), redirect: 'error' });
    if (!response.ok) throw new Error(`Cezar HTTP ${response.status}`);
    return response.json();
  };
  const state = snapshot.parse(await get('/api/v1/workspace/dashboard'));
  let partial = state.coverage.projects.some(p => p.state !== 'complete');
  const groups = await Promise.all(Object.entries(statuses).map(async ([group, status]) => {
    const tasks = [];
    let offset: number | null = 0;
    // Bound each group to 200 rows; counts still come from the complete snapshot.
    for (let n = 0; offset !== null && n < 10; n++) {
      const query = new URLSearchParams({ snapshotId: state.snapshotId, group, offset: String(offset), limit: '20' });
      const data = groupPage.parse(await get(`/api/v1/workspace/dashboard/tasks?${query}`));
      if (data.snapshotId !== state.snapshotId || data.asOf !== state.asOf) throw new Error('Inconsistent snapshot');
      partial ||= data.coverage.projects.some(p => p.state !== 'complete');
      tasks.push(...data.page.rows.map(r => ({
        id: `${r.projectId}/${r.id}`, title: r.titleSummary || r.title, project: r.projectId,
        status, checkedAt: Date.parse(state.asOf), description: r.title,
        ...(r.activity ? { activity: r.activity } : {}),
        ...(r.startedAt ? { startedAt: Date.parse(r.startedAt) } : {}),
        ...(r.finishedAt ? { completedAt: Date.parse(r.finishedAt) } : {}),
        sourceUrl: new URL(`/p/${encodeURIComponent(r.projectId)}/tasks/${encodeURIComponent(r.id)}`, base).href,
      })));
      if (data.page.nextOffset !== null && data.page.nextOffset <= offset) throw new Error('Invalid pagination');
      offset = data.page.nextOffset;
    }
    partial ||= offset !== null;
    return tasks;
  }));
  return cezarSchema.parse({ observedAt: Date.parse(state.asOf), tasks: groups.flat(), partial,
    scheduled: state.counts.scheduled,
    counts: { running: state.counts.running, queue: state.counts.queued, 'needs-input': state.counts.questions, review: state.counts.reviews },
  });
}
