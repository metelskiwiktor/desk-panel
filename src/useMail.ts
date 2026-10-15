import { usePollingEnabled } from './polling';
import { useCallback, useEffect, useRef, useState } from 'react';
import { MAIL_PAGE, mailSourceSchema, type MailAction, type MailSource, type MailThread } from './mail-contract';
import { EVENT_RULES } from './event-rules';

const inverse: Record<'read' | 'trash', MailAction> = { read: 'unread', trash: 'untrash' };
async function post(thread: MailThread, action: MailAction) {
  const response = await fetch('/api/mail/action', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ account: thread.account, threadId: thread.threadId, action }), signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error('action failed');
}

/** Unread inbox conversations; grows by MAIL_PAGE on demand. Actions hide a row at once and are undoable. */
export function useMail() {
  const [source, setSource] = useState<MailSource & { loadedAt?: number }>({ live: true, name: 'Gmail', status: 'loading', observedAt: null, data: null, accounts: [], total: 0 });
  const [limit, setLimit] = useState(MAIL_PAGE);
  const [reload, setReload] = useState(0);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [undo, setUndo] = useState<{ thread: MailThread; action: 'read' | 'trash' } | null>(null);
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
        const response = await fetch(`/api/mail?limit=${limit}`, { signal: controller.signal });
        if (!response.ok) throw new Error('offline');
        const value = mailSourceSchema.parse(await response.json());
        if (stopped) return;
        setSource(previous => ({ ...value, loadedAt: value.status === 'connected' ? Date.now() : previous.loadedAt }));
        // Gmail confirmed the change once a hidden conversation is gone from the list.
        const listed = new Set(value.data?.map(t => t.id));
        setHidden(previous => previous.size && [...previous].some(id => !listed.has(id)) ? new Set([...previous].filter(id => listed.has(id))) : previous);
      } catch {
        if (!stopped) setSource(previous => ({ ...previous, status: 'offline', message: 'Nie można połączyć się z lokalnym serwerem.' }));
      } finally {
        clearTimeout(timeout);
        if (!stopped) timer = setTimeout(read, 30000);
      }
    }
    void read();
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
  }, [limit, reload, pollingEnabled]);
  const act = useCallback(async (thread: MailThread, action: 'read' | 'trash') => {
    setError('');
    setHidden(previous => new Set(previous).add(thread.id));
    setUndo({ thread, action });
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), EVENT_RULES.undoSeconds * 1000);
    try { await post(thread, action); }
    catch {
      setHidden(previous => { const next = new Set(previous); next.delete(thread.id); return next; });
      setUndo(current => current?.thread.id === thread.id ? null : current);
      setError(action === 'read' ? 'Gmail nie oznaczył wiadomości jako przeczytanej.' : 'Gmail nie przeniósł wiadomości do kosza.');
    }
  }, []);
  const restore = useCallback(async () => {
    if (!undo) return;
    clearTimeout(undoTimer.current);
    setUndo(null);
    try { await post(undo.thread, inverse[undo.action]); }
    catch { setError('Nie udało się cofnąć zmiany w Gmailu.'); return; }
    setHidden(previous => { const next = new Set(previous); next.delete(undo.thread.id); return next; });
    setReload(n => n + 1);
  }, [undo]);
  const loadMore = useCallback(() => setLimit(n => n + MAIL_PAGE), []);
  const threads = source.data?.filter(t => !hidden.has(t.id)) ?? null;
  return { source, threads, hasMore: (source.data?.length ?? 0) < source.total,
    loadMore, act, undo: undo?.action ?? null, restore, error };
}
export type MailState = ReturnType<typeof useMail>;
