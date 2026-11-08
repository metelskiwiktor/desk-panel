import { FILA_DEFAULT_WORKFLOW, type FilaCezar } from './fila-contract';
import { TODO_STATUSES } from './todo-contract';
import { evaluateDispatch, type TodoDispatch } from './todo-dispatch';

/** The parts of a Fila thread C1 reads (`FilaThreadView` has them); `specText` is the current Specyfikacja, '' without one. */
export interface FilaDispatchThread {
  id: string; uid: string; title: string; state: string; workflow: { id: string };
  spec: { enabled: boolean; revision: number }; cezar: FilaCezar;
}

/** Today's „Gotowe do realizacji” is the state of the workflow Praca with that name (D-005); no other workflow is ready. */
export const FILA_READY_STATE = TODO_STATUSES.gotowe;

const stateLabel = (thread: FilaDispatchThread): string => {
  const key = Object.entries(TODO_STATUSES).find(([, label]) => label === thread.state)?.[0];
  return thread.workflow.id === FILA_DEFAULT_WORKFLOW && key ? `${thread.state} (${key})` : thread.state;
};

/** C1 on a thread: the very rules and messages of the to-do list (`getTodoDispatch`), the thread's ID in the prompt's `Zadanie:` line. */
export function getFilaDispatch(thread: FilaDispatchThread, specText: string | null): TodoDispatch {
  return evaluateDispatch({
    id: thread.id, title: thread.title, specRevision: thread.spec.revision, spec: thread.spec.enabled ? specText ?? '' : '',
    ready: thread.workflow.id === FILA_DEFAULT_WORKFLOW && thread.state === FILA_READY_STATE, stateLabel: stateLabel(thread),
    blocked: thread.cezar.blocked, executor: thread.cezar.executor, repo: thread.cezar.repo, mode: thread.cezar.mode,
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
