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
  branch: z.string().optional(), workflow: z.string().optional(),
});
const page = z.object({ rows: z.array(row).max(20), total: count, nextOffset: count.nullable() });
const coverage = z.object({ projects: z.array(z.object({ state: z.enum(['complete', 'partial', 'unavailable']) })) });
const snapshot = z.object({
  snapshotId: z.string().min(1), asOf: iso, coverage,
  counts: z.object({ running: count, queued: count, questions: count, reviews: count, scheduled: count }),
});
const groupPage = z.object({ snapshotId: z.string(), asOf: iso, coverage, page });
const statuses = { questions: 'needs-input', reviews: 'review', running: 'running', queued: 'queue' } as const;

async function enrichTask(task: any, get: (p: string) => Promise<any>, defaultModels: Record<string, string> = {}) {
  try {
    const rawId = task.id.includes('/') ? task.id.split('/')[1] : task.id;
    const run = await get(`/api/v1/p/${encodeURIComponent(task.project)}/runs/${encodeURIComponent(rawId)}`);
    const enriched = { ...task };
    if (run.branch) enriched.branch = run.branch;
    if (run.workflow) enriched.workflow = run.workflow;
    if (run.runner) enriched.runner = run.runner;
    const resolvedModel = run.model || run.modelIdentity || defaultModels[run.runner] || defaultModels[task.runner];
    if (resolvedModel) enriched.model = resolvedModel;
    if (run.diffStat) enriched.diffStat = run.diffStat;
    if (run.currentStepId) {
      const step = run.steps?.find((s: any) => s.id === run.currentStepId);
      enriched.currentStep = {
        id: run.currentStepId,
        name: step?.name,
        status: step?.status || 'running',
      };
    }
    if (run.status === 'paused' || run.waitingForInput || run.currentStepId === 'ask') {
      enriched.status = 'needs-input';
      enriched.question = run.question || run.inputPrompt || 'Agent zadał pytanie lub czeka na decyzję.';
    }

    try {
      const hist = await get(`/api/v1/p/${encodeURIComponent(task.project)}/runs/${encodeURIComponent(rawId)}/history`);
      const events: any[] = Array.isArray(hist?.events) ? hist.events : [];
      if (events.length > 0) {
        const toolEvents = events.filter((e: any) => e.type === 'tool-call' || (e.type === 'item.started' && e.item?.kind === 'tool'));
        const lastTool = toolEvents.at(-1);
        if (lastTool) {
          const toolName = lastTool.tool || lastTool.item?.name || 'tool';
          const command = lastTool.input?.command || (typeof lastTool.input === 'string' ? lastTool.input : (lastTool.item?.input?.command || lastTool.item?.command || ''));
          enriched.activityDetail = {
            state: 'executing_tool',
            activeTool: toolName === 'commandExecution' ? 'Bash' : toolName,
            activeToolInput: command ? String(command).slice(0, 300) : undefined,
          };
        } else {
          const textEvents = events.filter((e: any) => e.type === 'text' || (e.type === 'item.completed' && e.item?.kind === 'message'));
          const lastText = textEvents.at(-1);
          const msg = lastText?.text || lastText?.item?.text;
          if (msg) {
            enriched.activityDetail = {
              state: 'thinking',
              message: String(msg).replace(/\s*CEZ:DONE\s*$/, '').trim().slice(0, 200),
            };
          }
        }
      }
    } catch {
      // history optional
    }

    return enriched;
  } catch {
    return task;
  }
}

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
        ...(r.branch ? { branch: r.branch } : {}),
        ...(r.workflow ? { workflow: r.workflow } : {}),
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

  let defaultModels: Record<string, string> = {
    claude: 'sonnet',
    codex: 'gpt-6.1-sol',
    opencode: 'google/gemini-3.8-flash',
  };
  try {
    const config = await get('/api/v1/config');
    if (config?.defaultModels && typeof config.defaultModels === 'object') {
      defaultModels = { ...defaultModels, ...config.defaultModels };
    }
  } catch {
    // optional config
  }

  const flatTasks = groups.flat();
  // Enrich active tasks (running or needs-input) with rich live details
  const enrichedTasks = await Promise.all(
    flatTasks.map(async (t) => {
      if (t.status === 'running' || t.status === 'needs-input') {
        return enrichTask(t, get, defaultModels);
      }
      return t;
    })
  );

  return cezarSchema.parse({ observedAt: Date.parse(state.asOf), tasks: enrichedTasks, partial,
    scheduled: state.counts.scheduled,
    counts: { running: state.counts.running, queue: state.counts.queued, 'needs-input': state.counts.questions, review: state.counts.reviews },
  });
}
