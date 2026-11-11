import { defaultFilaCezarSettings, type FilaCezar, type FilaReadyState } from './fila-contract';
import { evaluateDispatch, type TodoDispatch } from './todo-dispatch';

/** The parts of a Fila thread C1 reads (`FilaThreadView` has them); `specText` is the current Specyfikacja, '' without one. */
export interface FilaDispatchThread {
  id: string; uid: string; title: string; state: string; workflow: { id: string };
  spec: { enabled: boolean; revision: number }; cezar: FilaCezar;
}

/**
 * C1 on a thread (2.1): the rules and messages of the to-do list (`evaluateDispatch`) with two differences. The state must
 * be on the list of ready states (`cezarSettings.readyStates` of `GET /api/fila`; without it the default pair), and the
 * manual block is not looked at (D-105). The thread's ID stands in the prompt's `Zadanie:` line.
 */
export function getFilaDispatch(thread: FilaDispatchThread, specText: string | null, readyStates: FilaReadyState[] = defaultFilaCezarSettings().readyStates): TodoDispatch {
  const names = [...new Set(readyStates.map(pair => `„${pair.state}”`))].join(', ');
  return evaluateDispatch({
    id: thread.id, title: thread.title, specRevision: thread.spec.revision, spec: thread.spec.enabled ? specText ?? '' : '',
    ready: readyStates.some(pair => pair.workflow === thread.workflow.id && pair.state === thread.state), stateLabel: thread.state,
    notReady: `Wątek musi mieć Stan, z którego wolno zlecić Cezarowi (${names}, w workflow z ustawień zestawu), a ma „${thread.state}”.`,
    blocked: null, executor: thread.cezar.executor, repo: thread.cezar.repo, mode: thread.cezar.mode,
  });
}

/** The fields a dispatch may rely on: what the user saw in the preview (the to-do's seven, `state` instead of `status`). */
export interface FilaDispatchExpected {
  specRevision: number; title: string;
  executor: FilaCezar['executor']; repo: FilaCezar['repo']; mode: FilaCezar['mode'];
  state: string; blocked: string | null;
}
export const filaDispatchExpected = (thread: FilaDispatchThread): FilaDispatchExpected => ({
  specRevision: thread.spec.revision, title: thread.title,
  executor: thread.cezar.executor, repo: thread.cezar.repo, mode: thread.cezar.mode,
  state: thread.state, blocked: thread.cezar.blocked ?? null,
});
export const filaDispatchMatches = (thread: FilaDispatchThread, expected: FilaDispatchExpected): boolean => {
  const now = filaDispatchExpected(thread);
  return now.specRevision === expected.specRevision && now.title === expected.title && now.executor === expected.executor
    && now.repo === expected.repo && now.mode === expected.mode && now.state === expected.state && now.blocked === expected.blocked;
};

/** The register key: the thread's permanent uid (so a move cannot dodge the block), the revision and the mode. */
export const filaDispatchKey = (uid: string, specRevision: number, mode: string | null): string => `${uid}|${specRevision}|${mode ?? ''}`;

/** Cezar's limit of a task title (`cezarCreateRunSchema`), in UTF-16 units like every length the contracts count. */
const TASK_TITLE_MAX = 120;
/**
 * The name of a task dispatched from a thread (2.2): `<ID> <title>`, at most 120 units with the „…” inside the limit.
 * Only the title is shortened (never through the middle of a surrogate pair); the ID always stays whole.
 */
export function filaTaskTitle(id: string, title: string): string {
  const full = `${id} ${title}`;
  if (full.length <= TASK_TITLE_MAX) return full;
  let kept = '';
  for (const char of title) { if (id.length + 1 + kept.length + char.length + 1 > TASK_TITLE_MAX) break; kept += char; }
  return `${id} ${kept.trimEnd()}…`;
}
