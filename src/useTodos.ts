import { useCallback, useEffect, useRef, useState } from 'react';
import { usePollingEnabled } from './polling';
import { todoSourceSchema, type TodoAction, type TodoData, type TodoResult, type TodoSource } from './todo-contract';
import type { TodoDispatchExpected } from './todo-dispatch';

/** The lists live on the server and the agent writes to them too, so they are read often: it is a local, in-memory read. */
const POLL_MS = 5000;

/**
 * The to-do lists, shared by every Zadania tile (each shows one list). Actions go to the server one by one; a tick is
 * shown at once (`optimistic`) and the server's answer replaces it on the next read.
 */
export function useTodos(enabled = true) {
  const [source, setSource] = useState<TodoSource>({ live: true, name: 'Zadania', status: 'loading', observedAt: null, data: null });
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // While an action is on its way a read could bring back the old state over the one just shown: that read is dropped.
  const inFlight = useRef(0);
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled || !enabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const response = await fetch('/api/todos', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = todoSourceSchema.parse(await response.json());
        if (!stopped && inFlight.current === 0) setSource(value);
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, POLL_MS);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [reload, pollingEnabled, enabled]);

  const act = useCallback(async (action: TodoAction, optimistic?: (data: TodoData) => TodoData): Promise<TodoResult | null> => {
    setError('');
    inFlight.current += 1;
    if (optimistic) setSource(previous => previous.data ? { ...previous, data: optimistic(previous.data) } : previous);
    try {
      const response = await fetch('/api/todos/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action), signal: AbortSignal.timeout(12000) });
      if (!response.ok) {
        const reason = await response.json().then((body: { error?: unknown }) => typeof body.error === 'string' ? body.error : '', () => '');
        throw new Error(reason || 'Nie udało się zapisać zmiany.');
      }
      return await response.json() as TodoResult;
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : 'Nie udało się zapisać zmiany.');
      return null;
    } finally {
      inFlight.current -= 1;
      // The server's state replaces what was shown, with or without the change.
      setReload(n => n + 1);
    }
  }, []);
  const clearError = useCallback(() => setError(''), []);
  /** The one write outside the small actions: the dialog sends exactly what it previewed, and the server re-checks it. */
  const dispatchCezar = useCallback(async (taskId: string, expected: TodoDispatchExpected): Promise<{ ok: true; taskId: string; url: string } | { ok: false; status: number; error: string }> => {
    setError('');
    inFlight.current += 1;
    try {
      const response = await fetch(`/api/todos/${taskId}/cezar-dispatch`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expected }), signal: AbortSignal.timeout(20000),
      });
      const body = await response.json().catch(() => ({})) as { taskId?: unknown; url?: unknown; error?: unknown };
      if (!response.ok) return { ok: false, status: response.status, error: typeof body.error === 'string' ? body.error : '' };
      if (typeof body.taskId !== 'string' || typeof body.url !== 'string') return { ok: false, status: 0, error: '' };
      return { ok: true, taskId: body.taskId, url: body.url };
    } catch {
      // A timeout or a lost answer says only what to do: no automatic retry.
      return { ok: false, status: 0, error: '' };
    } finally {
      inFlight.current -= 1;
      setReload(n => n + 1);
    }
  }, []);
  return { source, error, clearError, act, dispatchCezar };
}
export type TodosState = ReturnType<typeof useTodos>;
