import { useCallback, useEffect, useRef, useState } from 'react';
import { usePollingEnabled } from './polling';
import { todoSourceSchema, type TodoAction, type TodoData, type TodoResult, type TodoSource } from './todo-contract';

/** The lists live on the server and the agent writes to them too, so they are read often: it is a local, in-memory read. */
const POLL_MS = 5000;

/**
 * The to-do lists, shared by every Zadania tile (each shows one list). Actions go to the server one by one; a tick is
 * shown at once (`optimistic`) and the server's answer replaces it on the next read.
 */
export function useTodos() {
  const [source, setSource] = useState<TodoSource>({ live: true, name: 'Zadania', status: 'loading', observedAt: null, data: null });
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  // While an action is on its way a read could bring back the old state over the one just shown: that read is dropped.
  const inFlight = useRef(0);
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
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
  }, [reload, pollingEnabled]);

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
  return { source, error, clearError, act };
}
export type TodosState = ReturnType<typeof useTodos>;
