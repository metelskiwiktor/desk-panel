import { clearChatDraft, setChatDraftTemporary } from './chat-draft';
import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_ENGINE, type ChatDetail, type ChatEngine, type ChatEvent, type ChatList, type ChatMessage, type ChatSummary, type ContextItem, type EngineStatus } from './chat-contract';
import { rememberSnapshot } from './chat-snapshots';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const messageOf = (status: number) => status === 409 ? 'Agent jeszcze odpowiada.' : status === 404 ? 'Nie ma takiej rozmowy.' : status === 503 ? 'Czat jest niedostępny.' : 'Nie udało się wykonać operacji czatu.';

async function call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string; detail?: string } | null;
    const text = payload?.error || (payload?.detail ? `Nie udało się wykonać operacji czatu: ${payload.detail}` : messageOf(response.status));
    throw Object.assign(new Error(text), { status: response.status });
  }
  return response.json().catch(() => ({}));
}

const byRecent = (a: ChatSummary, b: ChatSummary) => b.updatedAt - a.updatedAt;
const LAST_CHAT = 'desk-panel:last-hermes-chat';
const readLastChat = () => { try { return localStorage.getItem(LAST_CHAT); } catch { return null; } };
const summaryOf = (chat: ChatDetail): ChatSummary => ({ archived: chat.archived, archivedAt: chat.archivedAt, temporary: chat.temporary, id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages, running: chat.running, ...(chat.engine ? { engine: chat.engine } : {}) });
/** A chat from a server that predates engines is agy's. */
export const engineOf = (chat: Pick<ChatSummary, 'engine'>): ChatEngine => chat.engine ?? 'agy';

/** One message changed: replace it in place (by id), or add it at the end. */
export function withMessage(items: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const at = items.findIndex(m => m.id === message.id);
  return at < 0 ? [...items, message] : items.map((m, i) => i === at ? message : m);
}

/**
 * The chat with the agent: the list of conversations and the one that is open. An open conversation is a server-sent
 * stream: it sends the whole chat once and then each message that changes, and reconnects (and so catches up) by itself.
 */
export function useChat(fixed?: ChatEngine) {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(() => fixed === 'hermes' ? readLastChat() : null);
  const restored = useRef(activeId);
  const [active, setActive] = useState<ChatDetail | null>(null);
  const snapshots = useRef(new Map<string, ChatDetail>());
  const [syncedId, setSyncedId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const temporaryRef = useRef(false);
  const selection = useRef(0);
  const temporaryIds = useRef(new Set<string>());
  const cleanups = useRef(new Map<string, Promise<unknown>>());
  /** Which engines can take a message (null: the server does not say), and the one new chats start on. */
  const [engines, setEngines] = useState<EngineStatus[] | null>(null);
  /** `fixed`: the window offers one engine only, so new chats start on it whatever the server remembers. */
  const [preferred, setPreferred] = useState<ChatEngine>(fixed ?? DEFAULT_ENGINE);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;
  const preferredRef = useRef(preferred);
  preferredRef.current = preferred;

  const refresh = useCallback(async () => {
    try {
      const { chats: list, engines: status, engine } = await call('/api/chats') as ChatList;
      setChats([...list].filter(c => !c.temporary).sort(byRecent));
      if (restored.current) {
        const id = restored.current;
        restored.current = null;
        if (!list.some(c => c.id === id && (!fixed || engineOf(c) === fixed))) setActiveId(current => current === id ? null : current);
      }
      setEngines(status ?? null);
      if (engine && !fixed) setPreferred(engine);
      setUnavailable(false);
    } catch (e) {
      if ((e as { status?: number }).status === 503) setUnavailable(true);
      setChats(previous => previous ?? []);
    }
  }, [fixed]);
  useEffect(() => { void refresh(); }, [refresh]);
  // Conversations started elsewhere (the phone, another window, a test run) show up without reopening the panel.
  useEffect(() => {
    const visible = () => { if (document.visibilityState === 'visible') void refresh(); };
    const timer = window.setInterval(visible, 30_000);
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', visible); document.removeEventListener('visibilitychange', visible); };
  }, [refresh]);
  useEffect(() => {
    if (fixed !== 'hermes') return;
    try { if (activeId && !temporary) localStorage.setItem(LAST_CHAT, activeId); else localStorage.removeItem(LAST_CHAT); } catch { /* optional preference */ }
  }, [activeId, fixed, temporary]);
  const listed = activeId ? chats?.find(c => c.id === activeId) : undefined;
  const engine: ChatEngine = active ? engineOf(active) : listed ? engineOf(listed) : preferred;
  const engineDown = engines?.find(e => e.engine === engine && !e.available);
  // While the engine in use is down, look again now and then: the window says when it is back.
  useEffect(() => {
    if (!engineDown) return;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [engineDown, refresh]);

  // The stream of the open conversation.
  useEffect(() => {
    if (!activeId || typeof EventSource === 'undefined') return;
    let gone = false;
    const source = new EventSource(`/api/chats/${activeId}/events`);
    source.onmessage = message => {
      let event: ChatEvent;
      try { event = JSON.parse(message.data) as ChatEvent; } catch { return; }
      if (gone || event.chat.id !== activeId) return;
      if (event.type === 'state') {
        rememberSnapshot(snapshots.current, activeId, event.chat);
        setActive(event.chat);
        setSyncedId(activeId);
        setChats(previous => previous && [...previous.filter(c => c.id !== event.chat.id), ...(!event.chat.temporary ? [summaryOf(event.chat)] : [])].sort(byRecent));
      } else {
        const previous = snapshots.current.get(activeId);
        if (previous) {
          const next = { ...event.chat, items: withMessage(previous.items, event.message) };
          rememberSnapshot(snapshots.current, activeId, next);
          setActive(next);
        }
        setChats(previous => previous && [...previous.filter(c => c.id !== event.chat.id), ...(!event.chat.temporary ? [event.chat] : [])].sort(byRecent));
      }
    };
    source.onerror = () => {
      // The browser retries by itself while the stream is merely interrupted; a closed one means the chat is gone.
      if (!gone && source.readyState === EventSource.CLOSED) { snapshots.current.delete(activeId); setActive(null); setError(messageOf(404)); setActiveId(null); void refresh(); }
    };
    return () => { gone = true; source.close(); };
  }, [activeId, refresh]);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try { return await work(); }
    catch (e) { setError(e instanceof Error ? e.message : messageOf(500)); return undefined; }
    finally { setBusy(false); }
  }, []);

  /**
   * Writes in the open conversation, or starts one on the chosen engine when none is open. Returns true once the agent
   * has the message; on failure the caller keeps the draft. `nonce` is one per draft, so a retry is not a second turn.
   */
  const send = useCallback((text: string, context: ContextItem[], nonce?: string) => guard(async () => {
    const id = activeRef.current;
    const selected = selection.current, temp = temporaryRef.current;
    if (id) await call(`/api/chats/${id}/messages`, 'POST', { text, context, ...(nonce ? { nonce } : {}) });
    else {
      const created = await call('/api/chats', 'POST', { text, context, engine: preferredRef.current, ...(temp ? { temporary: true } : {}), ...(nonce ? { nonce } : {}) }) as { id: string };
      if (selected !== selection.current) {
        if (temp) await call(`/api/chats/${created.id}`, 'DELETE');
        return true;
      }
      if (temp) { temporaryIds.current.add(created.id); setChatDraftTemporary(created.id, true); }
      activeRef.current = created.id;
      setActiveId(created.id);
    }
    void refresh();
    return true;
  }).then(Boolean, () => false).then(async ok => { if (!ok) await refresh(); return ok; }), [guard, refresh]);

  /**
   * The engine of the next new chat, remembered by the server for every screen. A conversation keeps its own engine, so
   * choosing the other one while a chat is open goes to a new chat of the chosen engine (the open one stays as it is).
   */
  const chooseEngine = useCallback((engine: ChatEngine) => {
    setPreferred(engine);
    preferredRef.current = engine;
    setError('');
    void call('/api/chats/engine', 'PUT', { engine }).catch(() => { /* chosen for this screen anyway */ });
  }, []);

  const approve = useCallback((approvalId: string, decision: 'approve' | 'deny') => guard(async () => {
    if (activeRef.current) await call(`/api/chats/${activeRef.current}/approval`, 'POST', { approvalId, decision });
  }), [guard]);

  const stop = useCallback(() => guard(async () => { if (activeRef.current) await call(`/api/chats/${activeRef.current}/stop`, 'POST', {}); }), [guard]);
  const rename = useCallback((title: string) => guard(async () => {
    if (!activeRef.current) return;
    await call(`/api/chats/${activeRef.current}`, 'PATCH', { title });
    await refresh();
  }), [guard, refresh]);
  const remove = useCallback(() => guard(async () => {
    const id = activeRef.current;
    if (!id) return;
    await call(`/api/chats/${id}`, 'DELETE');
    snapshots.current.delete(id);
    temporaryIds.current.delete(id); clearChatDraft(id); setChatDraftTemporary(id, false);
    temporaryRef.current = false; setTemporary(false); setChatDraftTemporary(null, false);
    activeRef.current = null;
    setActive(null);
    setActiveId(null);
    await refresh();
  }), [guard, refresh]);

  const leaveTemporary = useCallback(async () => {
    const id = activeRef.current;
    if (id && temporaryIds.current.has(id)) {
      let cleanup = cleanups.current.get(id);
      if (!cleanup) { cleanup = call(`/api/chats/${id}`, 'DELETE'); cleanups.current.set(id, cleanup); }
      try { await cleanup; } finally { cleanups.current.delete(id); }
      temporaryIds.current.delete(id);
      snapshots.current.delete(id);
      clearChatDraft(id); setChatDraftTemporary(id, false);
    }
    if (temporaryRef.current) { clearChatDraft(null); setChatDraftTemporary(null, false); }
  }, []);
  const select = useCallback((id: string | null, temp = false) => guard(async () => {
    if (id && activeRef.current === id) return;
    const selected = ++selection.current;
    await leaveTemporary();
    if (selected !== selection.current) return;
    setChatDraftTemporary(null, temp);
    temporaryRef.current = temp; setTemporary(temp);
    activeRef.current = id;
    setError(''); setActive(id ? snapshots.current.get(id) ?? null : null); setSyncedId(null); setActiveId(id);
  }), [guard, leaveTemporary]);
  const update = useCallback((id: string, changes: { archived?: boolean; temporary?: false }) => guard(async () => {
    await call(`/api/chats/${id}`, 'PATCH', changes);
    if (changes.temporary === false) {
      temporaryIds.current.delete(id); setChatDraftTemporary(id, false);
      if (activeRef.current === id) { temporaryRef.current = false; setTemporary(false); setChatDraftTemporary(null, false); }
      setActive(previous => previous?.id === id ? { ...previous, temporary: false } : previous);
    }
    await refresh();
  }), [guard, refresh]);
  // Page exit is best effort; startup cleanup is the durable backstop.
  useEffect(() => {
    const cleanup = () => { for (const id of temporaryIds.current) { clearChatDraft(id); void fetch(`/api/chats/${id}`, { method: 'DELETE', keepalive: true }).catch(() => {}); } };
    window.addEventListener('pagehide', cleanup);
    return () => window.removeEventListener('pagehide', cleanup);
  }, []);

  return {
    chats, unavailable, active, activeId, error, busy, engines, preferred,
    syncing: !!activeId && syncedId !== activeId,
    /** The engine the composer writes to: the open chat's, or the preferred one for a new chat; and why it cannot, if so. */
    engine, engineDown,
    chooseEngine, approve,
    temporary, update,
    keepTemporary: () => { if (activeRef.current) void update(activeRef.current, { temporary: false }); else { temporaryRef.current = false; setTemporary(false); setChatDraftTemporary(null, false); } },
    open: (id: string) => void select(id),
    startNew: (temp = false) => void select(null, temp),
    closeTemporary: useCallback(() => { if (temporaryRef.current) void select(null); }, [select]),
    send, stop, rename, remove, refresh, clearError: useCallback(() => setError(''), []),
  };
}
