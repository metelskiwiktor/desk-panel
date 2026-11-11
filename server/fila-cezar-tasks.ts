import type { CezarSnapshot } from '../src/cezar-contract';
import type { ThreadDispatchRun } from './cockpit';
import type { FilaThreadView } from './fila';

/** One Cezar task of a thread (stage 2.2, docs/fila.md): computed at read time, never stored. */
export interface FilaCezarTask {
  taskId: string;
  /** The task's title in Cezar's snapshot; null when the snapshot does not hold the task. */
  name: string | null;
  status: 'needs-input' | 'review' | 'running' | 'queue' | 'done' | 'failed' | 'nieznany';
  /** From the dispatch register; null for a task the panel did not dispatch from this thread. */
  mode: ThreadDispatchRun['mode'] | null; specRevision: number | null;
  url: string | null; branch: string | null; prUrl: string | null;
  /** Where the task was found; with several sources the first of this order wins. */
  source: 'rejestr' | 'powiązanie' | 'nazwa';
  at: number;
}
export interface FilaCezarTasks { partial: boolean; tasks: FilaCezarTask[] }

/** The ID at the very start, whatever the case, and then the end or a character that is no letter or digit: `DESK-6` is not in `DESK-61 …`. */
export function startsWithThreadId(text: string | undefined, id: string): boolean {
  if (!text || text.length < id.length || text.slice(0, id.length).toLowerCase() !== id.toLowerCase()) return false;
  const next = text.slice(id.length);
  return next === '' || !/^[\p{L}\p{N}]/u.test(next);
}

/**
 * The tasks of one thread, each once by its id, from three sources: (a) every entry of the dispatch register with the
 * thread's uid (a retry leaves both tasks), (b) the thread's `cezar` links, (c) tasks of Cezar's snapshot whose title, raw
 * title (`description`) or branch starts with the thread's ID or one of its „Dawne ID”. Tasks of subthreads are not the
 * thread's: a task the register keeps under another thread stays there, whatever its name says. `snapshot: null` (Cezar
 * unreachable) answers with the register and the links and says `partial`.
 */
export function filaCezarTasks(thread: Pick<FilaThreadView, 'id' | 'uid' | 'fields' | 'cezar'>, register: ThreadDispatchRun[], snapshot: CezarSnapshot | null): FilaCezarTasks {
  const known = new Map((snapshot ? [...snapshot.tasks, ...snapshot.finished] : []).map(task => [task.id, task]));
  const found = new Map<string, Pick<FilaCezarTask, 'taskId' | 'mode' | 'specRevision' | 'source' | 'at'> & { url?: string }>();
  // One task under several register entries (it cannot happen through the panel's own dispatch): the newest entry speaks, as in the limit of 2.1.
  for (const entry of register) if (entry.uid === thread.uid && (found.get(entry.taskId)?.at ?? -Infinity) <= entry.at) {
    found.set(entry.taskId, { taskId: entry.taskId, mode: entry.mode, specRevision: entry.specRevision, url: entry.url, source: 'rejestr', at: entry.at });
  }
  for (const link of thread.cezar.links) if (link.kind === 'cezar' && !found.has(link.id)) {
    found.set(link.id, { taskId: link.id, mode: null, specRevision: null, source: 'powiązanie', at: link.at });
  }
  const former = thread.fields['Dawne ID'];
  const ids = [thread.id, ...(Array.isArray(former) ? former : [])];
  const elsewhere = new Set(register.filter(entry => entry.uid !== thread.uid).map(entry => entry.taskId));
  for (const task of known.values()) {
    if (found.has(task.id) || elsewhere.has(task.id)) continue;
    if (!ids.some(id => startsWithThreadId(task.title, id) || startsWithThreadId(task.description, id) || startsWithThreadId(task.branch, id))) continue;
    found.set(task.id, { taskId: task.id, mode: null, specRevision: null, source: 'nazwa', at: task.startedAt ?? task.completedAt ?? task.checkedAt });
  }
  const tasks = [...found.values()].map(({ url, ...entry }): FilaCezarTask => {
    const task = known.get(entry.taskId);
    return {
      taskId: entry.taskId, name: task?.title ?? null, status: task?.status ?? 'nieznany', mode: entry.mode, specRevision: entry.specRevision,
      url: url ?? task?.sourceUrl ?? null, branch: task?.branch ?? null, prUrl: task?.pullRequestUrl ?? null, source: entry.source, at: entry.at,
    };
  }).sort((a, b) => a.at - b.at || (a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0));
  return { partial: !snapshot || snapshot.partial, tasks };
}
