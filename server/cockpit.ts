import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import {
  criteriaOf, watchedTask, type CezarStatus, type CheckState, type CockpitDispatch, type CockpitPrView, type CockpitTaskView, type CockpitView, type DispatchOutcome, type StepState,
} from '../src/cockpit-contract';
import { SourceError, type PanelSources } from './sources';

/**
 * The chat cockpit on the server: which Cezar task a conversation watches, how that task is doing (read from Cezar), its
 * pull request and CI checks (read with the GitHub CLI, gently), and its subtasks (a to-do list of the panel).
 *
 * The one write is the user's answer on a dispatch card. Hermes only proposes a task; the panel dispatches it to Cezar
 * when the user clicks "Zleć na Cezarze", with the prompt as the user left it, and keeps the answer so the card shows it
 * again later. What it keeps (`~/.desk-panel/cockpit.json`, outside Git) is ids and the dispatched prompts only.
 */

const outcomeSchema = z.discriminatedUnion('decision', [
  z.object({ decision: z.literal('dispatched'), taskId: z.string(), prompt: z.string(), url: z.string(), at: z.number() }),
  z.object({ decision: z.literal('rejected'), at: z.number() }),
]);
const storeSchema = z.object({
  version: z.literal(1),
  chats: z.record(z.string(), z.object({
    /** Tasks dispatched from the conversation, oldest first: the last one is watched. */
    runs: z.array(z.string()).default([]),
    /** The subtask list of each task. */
    lists: z.record(z.string(), z.string()).default({}),
    dispatches: z.record(z.string(), outcomeSchema).default({}),
    updatedAt: z.number().default(0),
  })),
});
type Store = z.infer<typeof storeSchema>;
const MAX_CHATS = 500;

// ── Cezar run → the task as the cockpit shows it ──

const FINISHED = new Set(['done', 'completed', 'succeeded', 'success', 'failed', 'error', 'cancelled', 'canceled']);
function statusOf(raw: Record<string, any>, prState?: CockpitPrView['state']): CezarStatus {
  const s = String(raw.status ?? '').toLowerCase();
  if (['failed', 'error', 'cancelled', 'canceled'].includes(s)) return 'FAILED';
  if (FINISHED.has(s)) return raw.pullRequestUrl && prState !== 'MERGED' && prState !== 'CLOSED' ? 'REVIEW' : 'DONE';
  if (s === 'paused' || raw.waitingForInput || raw.currentStepId === 'ask') return 'INPUT';
  if (['queued', 'queue', 'pending', 'created', 'scheduled'].includes(s)) return 'QUEUED';
  return 'RUNNING';
}
function stepState(status: unknown, finished: boolean): StepState {
  const s = String(status ?? '').toLowerCase();
  if (['done', 'completed', 'succeeded', 'success', 'passed'].includes(s)) return 'done';
  if (['failed', 'error'].includes(s)) return 'failed';
  if (['skipped', 'cancelled', 'canceled'].includes(s)) return 'skipped';
  if (['running', 'active', 'in_progress', 'started'].includes(s)) return finished ? 'skipped' : 'running';
  // A step that never ran in a finished run was not needed (a fix after a clean check, say).
  return finished ? 'skipped' : 'pending';
}
/** "Prepare worktree (LF line endings, …)" → "Prepare worktree". */
const label = (name: unknown, id: unknown) => String(name || id || 'krok').replace(/\s*\([^)]*\)\s*$/, '').slice(0, 80);

/** The worktree as a path inside the project (`.ai/cezar/worktrees/…`), never the user's whole profile path. */
function worktreeOf(path: unknown, fallback: string): string {
  if (typeof path !== 'string' || !path) return fallback;
  const at = path.replace(/\\/g, '/').indexOf('/.ai/');
  return at >= 0 ? path.replace(/\\/g, '/').slice(at + 1) : path.replace(/\\/g, '/').split('/').slice(-3).join('/');
}

export function cezarTaskView(id: string, raw: Record<string, any>, cezarUrl: string, prState?: CockpitPrView['state']): CockpitTaskView {
  const [project, run] = id.includes('/') ? [id.slice(0, id.indexOf('/')), id.slice(id.indexOf('/') + 1)] : ['desk-panel', id];
  const finished = FINISHED.has(String(raw.status ?? '').toLowerCase());
  const steps = (Array.isArray(raw.steps) ? raw.steps : []).slice(0, 30).map((s: any) => ({ label: label(s?.name, s?.id), state: stepState(s?.status, finished) }));
  const settled = steps.filter((s: { state: StepState }) => s.state !== 'pending' && s.state !== 'running').length;
  const tokens = typeof raw.tokensUsed === 'number' ? raw.tokensUsed
    : typeof raw.inputTokens === 'number' || typeof raw.outputTokens === 'number' ? (raw.inputTokens ?? 0) + (raw.outputTokens ?? 0) : null;
  const started = typeof raw.startedAt === 'string' ? Date.parse(raw.startedAt) : NaN;
  return {
    id: `${project}/${run}`,
    title: String(raw.titleSummary || raw.title || 'Task Cezara').slice(0, 200),
    status: statusOf(raw, prState),
    repo: project,
    worktree: worktreeOf(raw.worktreePath, `.ai/cezar/worktrees/${run.slice(0, 11)}`),
    tokens,
    url: new URL(`/p/${encodeURIComponent(project)}/tasks/${encodeURIComponent(run)}`, cezarUrl).href,
    ...(Number.isFinite(started) ? { startedAt: started } : {}),
    ...(typeof raw.branch === 'string' && raw.branch ? { branch: raw.branch } : {}),
    steps,
    progress: finished ? 1 : steps.length ? settled / steps.length : 0,
    ...(typeof raw.pullRequestUrl === 'string' && PR_URL.test(raw.pullRequestUrl) ? { prUrl: raw.pullRequestUrl } : {}),
  };
}

// ── The pull request and its CI checks, from the GitHub CLI ──

export const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;
export type GhRunner = (args: string[]) => Promise<string>;
/** `gh` without a shell, a time limit and no window: read-only `gh pr view`. */
export const runGh: GhRunner = args => new Promise((resolve, reject) => {
  execFile('gh', args, { timeout: 10_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(error) : resolve(stdout));
});

function checkState(c: Record<string, any>): CheckState {
  const conclusion = String(c.conclusion ?? c.state ?? '').toUpperCase();
  const status = String(c.status ?? '').toUpperCase();
  if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(conclusion)) return 'pass';
  if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(conclusion)) return 'fail';
  if (['IN_PROGRESS', 'PENDING'].includes(status) || conclusion === 'PENDING') return 'running';
  return 'pending';
}
export function prFromGh(json: string, url: string): CockpitPrView {
  const pr = JSON.parse(json) as Record<string, any>;
  const rollup: Record<string, any>[] = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : [];
  // A check re-run appears twice: the last one counts.
  const checks = new Map<string, CheckState>();
  for (const c of rollup) checks.set(String(c.name || c.context || 'check').slice(0, 60), checkState(c));
  const state = String(pr.state ?? '').toUpperCase();
  return {
    number: Number(pr.number) || Number(url.split('/').at(-1)),
    title: String(pr.title ?? '').slice(0, 200),
    branch: String(pr.headRefName ?? ''),
    url,
    state: state === 'OPEN' || state === 'MERGED' || state === 'CLOSED' ? state : 'UNKNOWN',
    checks: [...checks].slice(0, 20).map(([name, s]) => ({ name, state: s })),
  };
}

/** Kept as long as a check runs, longer once all are settled: GitHub is asked gently. */
const PR_TTL_MS = 20_000, PR_SETTLED_TTL_MS = 5 * 60_000;

export interface Cockpit {
  /** `items`: the conversation as the chat has it; the watched task follows from it by the contract (`watchedTask`). */
  view(chatId: string, items: Parameters<typeof watchedTask>[0]): Promise<CockpitView>;
  dispatch(chatId: string, input: CockpitDispatch): Promise<DispatchOutcome>;
}

export function createCockpit({ sources, file, cezarUrl, gh = runGh, now = Date.now }: {
  sources: PanelSources; file: string; cezarUrl: string; gh?: GhRunner; now?: () => number;
}): Cockpit {
  const load = (): Store => {
    try { if (existsSync(file)) return storeSchema.parse(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* a broken file starts over */ }
    return { version: 1, chats: {} };
  };
  let store = load();
  const save = () => {
    const ids = Object.keys(store.chats);
    if (ids.length > MAX_CHATS) for (const id of ids.sort((a, b) => store.chats[a].updatedAt - store.chats[b].updatedAt).slice(0, ids.length - MAX_CHATS)) delete store.chats[id];
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(store, null, 2), 'utf8');
    renameSync(`${file}.tmp`, file);
  };
  const chatOf = (id: string) => store.chats[id] ??= { runs: [], lists: {}, dispatches: {}, updatedAt: now() };

  const prs = new Map<string, { at: number; value: CockpitPrView; settled: boolean }>();
  async function prOf(url: string, fallback: { title: string; branch?: string }): Promise<CockpitPrView> {
    const known = prs.get(url);
    if (known && now() - known.at < (known.settled ? PR_SETTLED_TTL_MS : PR_TTL_MS)) return known.value;
    try {
      const value = prFromGh(await gh(['pr', 'view', url, '--json', 'number,title,state,headRefName,statusCheckRollup']), url);
      prs.set(url, { at: now(), value, settled: value.state !== 'OPEN' || value.checks.every(c => c.state === 'pass' || c.state === 'fail') });
      return value;
    } catch {
      const value: CockpitPrView = {
        number: Number(url.split('/').at(-1)), title: fallback.title, branch: fallback.branch ?? '', url, state: known?.value.state ?? 'UNKNOWN',
        checks: known?.value.checks ?? [], checksError: 'Checków CI nie udało się odczytać (GitHub CLI: gh).',
      };
      prs.set(url, { at: now(), value, settled: false });
      return value;
    }
  }

  return {
    async view(chatId, items) {
      const chat = store.chats[chatId];
      const id = watchedTask(items, chat?.dispatches ?? {}) ?? undefined;
      let task: CockpitTaskView | null = null, pr: CockpitPrView | null = null;
      if (id && sources.cezarRun) {
        const raw = await sources.cezarRun(id).catch(() => null);
        if (raw) {
          task = cezarTaskView(id, raw, cezarUrl);
          if (task.prUrl) {
            pr = await prOf(task.prUrl, { title: task.title, branch: task.branch });
            task = cezarTaskView(id, raw, cezarUrl, pr.state);
          }
        }
      }
      let list: CockpitView['list'] = null;
      const listId = id ? chat?.lists[id] : undefined;
      if (listId) {
        const found = (await sources.todos().catch(() => null))?.data?.lists.find(l => l.id === listId);
        if (found) list = { id: found.id, name: found.name, tasks: found.tasks.map(t => ({ id: t.id, title: t.title, done: t.done })) };
      }
      return { observedAt: now(), task, pr, list, dispatches: { ...chat?.dispatches } };
    },

    async dispatch(chatId, input) {
      const chat = chatOf(chatId);
      // The same answer twice (a double click, a retry after a timeout) dispatches once.
      const known = chat.dispatches[input.toolCallId];
      if (known) return known;
      if (input.decision === 'reject') {
        const outcome: DispatchOutcome = { decision: 'rejected', at: now() };
        chat.dispatches[input.toolCallId] = outcome;
        chat.updatedAt = now();
        save();
        return outcome;
      }
      if (!sources.cezarCreateRun) throw new SourceError(503);
      const created = await sources.cezarCreateRun({ task: input.prompt, title: input.title, ...(input.todoId ? { todoId: input.todoId } : {}) });
      const outcome: DispatchOutcome = { decision: 'dispatched', taskId: created.id, prompt: input.prompt, url: created.url, at: now() };
      chat.dispatches[input.toolCallId] = outcome;
      chat.runs = [...chat.runs.filter(r => r !== created.id), created.id].slice(-20);
      chat.updatedAt = now();
      save();
      // Subtasks: the list of the to-do item the task implements, or a new list of its acceptance criteria.
      try {
        const lists = (await sources.todos()).data?.lists ?? [];
        const own = input.todoId ? lists.find(l => l.tasks.some(t => t.id === input.todoId)) : undefined;
        let listId = own?.id;
        const criteria = criteriaOf(input.prompt);
        if (!listId && criteria.length) {
          const made = await sources.todoAction({ action: 'createList', name: `Wektor · ${input.title}`.slice(0, 80) });
          listId = made.list?.id;
          // An existing list of that name is reused as it is: its tasks are not added twice.
          if (listId && made.list?.created !== false) for (const title of criteria) await sources.todoAction({ action: 'addTask', list: listId, title, by: 'agent' });
        }
        if (listId) { chat.lists[created.id] = listId; save(); }
      } catch { /* the task is dispatched; only its subtasks are missing */ }
      return outcome;
    },
  };
}
