import { usePollingEnabled } from './polling';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cezarSchema, type CezarAction, type CezarSnapshot, type FinishedTask } from './cezar-contract';
import { EVENT_RULES } from './event-rules';
import type { Source, Task } from './model';

async function post(id: string, action: CezarAction) {
  const response = await fetch('/api/cezar/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, action }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('action failed');
}

/**
 * Cezar's tasks, and the finished ones that wait to be archived. Archiving hides a task at once (and is undoable for a few
 * seconds); opening one marks it read. Both are written to Cezar, so its own list agrees.
 */
export function useCezar() {
  const [source, setSource] = useState<Source<Task[]>>({ status: 'loading', data: null, observedAt: null, live: true });
  const [snapshot, setSnapshot] = useState<CezarSnapshot | null>(null);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [readNow, setReadNow] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<FinishedTask | null>(null);
  const [error, setError] = useState('');
  const undoTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(undoTimer.current), []);
  const pollingEnabled = usePollingEnabled();
  useEffect(() => {
    if (!pollingEnabled) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController;
    async function read() {
      controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 12000);
      try {
        const response = await fetch('/api/cezar', { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = cezarSchema.parse(await response.json());
        if (!stopped) {
          setSnapshot(value);
          setSource({ status: 'connected', observedAt: value.observedAt, data: value.tasks, live: true, partial: value.partial, loadedAt:Date.now() });
          // Cezar confirmed a change once the list shows it: an archived task is gone, a read one no longer unread.
          const listed = new Map(value.finished.map(t => [t.id, t]));
          setHidden(previous => previous.size && [...previous].some(id => !listed.has(id)) ? new Set([...previous].filter(id => listed.has(id))) : previous);
          setReadNow(previous => previous.size && [...previous].some(id => !listed.get(id)?.unread) ? new Set([...previous].filter(id => listed.get(id)?.unread)) : previous);
        }
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 5000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [pollingEnabled]);

  const archive = useCallback(async (task: FinishedTask) => {
    setError('');
    setHidden(previous => new Set(previous).add(task.id));
    setUndo(task);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), EVENT_RULES.undoSeconds * 1000);
    try { await post(task.id, 'archive'); }
    catch {
      setHidden(previous => { const next = new Set(previous); next.delete(task.id); return next; });
      setUndo(current => current?.id === task.id ? null : current);
      setError('Cezar nie zarchiwizował zadania.');
    }
  }, []);
  const restore = useCallback(async () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    try { await post(undo.id, 'unarchive'); }
    catch { setError('Nie udało się cofnąć archiwizacji w Cezarze.'); return; }
    setHidden(previous => { const next = new Set(previous); next.delete(undo.id); return next; });
  }, [undo]);
  const markRead = useCallback(async (task: FinishedTask) => {
    if (!task.unread) return;
    setReadNow(previous => new Set(previous).add(task.id));
    try { await post(task.id, 'read'); }
    catch { setReadNow(previous => { const next = new Set(previous); next.delete(task.id); return next; }); }
  }, []);

  const finished = (snapshot?.finished ?? []).filter(t => !hidden.has(t.id)).map(t => readNow.has(t.id) ? { ...t, unread: false } : t);
  return { source, snapshot, finished, archive, restore, markRead, undo: undo !== null, error };
}
export type CezarState = ReturnType<typeof useCezar>;
