import { z } from 'zod';
import { todoTaskId } from './todo-contract';

/**
 * The chat cockpit of a conversation (`GET /api/chats/:id/cockpit`): the Cezar task it watches, that task's pull request
 * with its CI checks, the to-do list of its subtasks, and the user's answers on the dispatch cards. Read-only; the only
 * write is the answer on a card (`POST /api/chats/:id/dispatch`), which is what dispatches a task to Cezar.
 */

export type CezarStatus = 'QUEUED' | 'RUNNING' | 'INPUT' | 'REVIEW' | 'DONE' | 'FAILED';
export type StepState = 'done' | 'running' | 'pending' | 'failed' | 'skipped';
export type CheckState = 'pass' | 'fail' | 'running' | 'pending';

export interface CockpitTaskView {
  /** `projekt/uuid`, as everywhere else in the panel. */
  id: string;
  title: string;
  status: CezarStatus;
  repo: string;
  worktree: string;
  /** Tokens the run used so far; null when Cezar does not say. */
  tokens: number | null;
  url: string;
  startedAt?: number;
  branch?: string;
  steps: { label: string; state: StepState }[];
  /** 0…1: the steps that are settled. */
  progress: number;
  prUrl?: string;
}
export interface CockpitPrView {
  number: number;
  title: string;
  branch: string;
  url: string;
  state: 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN';
  checks: { name: string; state: CheckState }[];
  /** Why the checks are not known (GitHub CLI missing or refused), in Polish. */
  checksError?: string;
}
export type DispatchOutcome =
  | { decision: 'dispatched'; taskId: string; prompt: string; url: string; at: number }
  | { decision: 'rejected'; at: number };
export interface CockpitView {
  observedAt: number;
  task: CockpitTaskView | null;
  pr: CockpitPrView | null;
  list: { id: string; name: string; tasks: { id: string; title: string; done: boolean }[] } | null;
  /** The user's answer on each dispatch card of the conversation, by its tool call id. */
  dispatches: Record<string, DispatchOutcome>;
}

export const cezarRunId = z.string().regex(/^[^/\s]{1,128}\/[0-9A-Za-z-]{1,128}$/);
export const cockpitDispatchSchema = z.object({
  toolCallId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['dispatch', 'reject']),
  title: z.string().trim().min(1).max(120),
  /** What goes to the executor: the agent's prompt, or the user's correction of it. */
  prompt: z.string().trim().min(1).max(32_000),
  /** A to-do item the task implements: its list becomes the subtask list. */
  todoId: todoTaskId.optional(),
}).strict();
export type CockpitDispatch = z.infer<typeof cockpitDispatchSchema>;

/** The acceptance criteria of an executor prompt (`- [ ] …`), which become the subtasks of the task. */
export function criteriaOf(prompt: string): string[] {
  return [...prompt.matchAll(/^\s*[-*]\s*\[[ xX]?\]\s+(.+?)\s*$/gm)].map(m => m[1].slice(0, 200)).filter(Boolean).slice(0, 20);
}

/** Cezar tasks a text mentions (`projekt/uuid`, a Cezar task link or `?project=…&run=…`), in order. */
export function cezarIdsIn(text: string): string[] {
  const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  const found: { at: number; id: string }[] = [];
  for (const m of text.matchAll(new RegExp(`/p/([\\w.-]{1,64})/tasks/(${uuid})`, 'gi'))) found.push({ at: m.index, id: `${m[1]}/${m[2]}` });
  for (const m of text.matchAll(new RegExp(`project=([\\w.-]{1,64})&run=(${uuid})`, 'gi'))) found.push({ at: m.index, id: `${m[1]}/${m[2]}` });
  for (const m of text.matchAll(new RegExp(`(?<![\\w/])([a-z][\\w.-]{0,63})/(${uuid})`, 'gi'))) if (m[1] !== 'tasks' && m[1] !== 'runs') found.push({ at: m.index, id: `${m[1]}/${m[2]}` });
  return found.sort((a, b) => a.at - b.at).map(f => f.id);
}
