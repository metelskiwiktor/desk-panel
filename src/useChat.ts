import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChatDetail, ChatEvent, ChatMessage, ChatSummary, ContextItem } from './chat-contract';

const JSON_HEADERS = { 'Content-Type': 'application/json' };
const messageOf = (status: number) => status === 409 ? 'Agent jeszcze odpowiada.' : status === 404 ? 'Nie ma takiej rozmowy.' : status === 503 ? 'Czat jest niedostępny.' : 'Nie udało się wykonać operacji czatu.';

async function call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw Object.assign(new Error(messageOf(response.status)), { status: response.status });
  return response.json().catch(() => ({}));
}

const byRecent = (a: ChatSummary, b: ChatSummary) => b.updatedAt - a.updatedAt;
const summaryOf = (chat: ChatDetail): ChatSummary => ({ id: chat.id, title: chat.title, createdAt: chat.createdAt, updatedAt: chat.updatedAt, messages: chat.messages, running: chat.running });

/** One message changed: replace it in place (by id), or add it at the end. */
export function withMessage(items: ChatMessage[], message: ChatMessage): ChatMessage[] {
  const at = items.findIndex(m => m.id === message.id);
  return at < 0 ? [...items, message] : items.map((m, i) => i === at ? message : m);
}

/**
 * The chat with the agent: the list of conversations and the one that is open. An open conversation is a server-sent
 * stream: it sends the whole chat once and then each message that changes, and reconnects (and so catches up) by itself.
 */
export function useChat() {
  const [chats, setChats] = useState<ChatSummary[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ChatDetail | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeId;

  const refresh = useCallback(async () => {
    try {
      const { chats: list } = await call('/api/chats') as { chats: ChatSummary[] };
      setChats([...list].sort(byRecent));
      setUnavailable(false);
    } catch (e) {
      if ((e as { status?: number }).status === 503) setUnavailable(true);
      setChats(previous => previous ?? []);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  // The stream of the open conversation.
  useEffect(() => {
    setActive(null);
    if (!activeId || typeof EventSource === 'undefined') return;
    const source = new EventSource(`/api/chats/${activeId}/events`);
    source.onmessage = message => {
      let event: ChatEvent;
      try { event = JSON.parse(message.data) as ChatEvent; } catch { return; }
      if (event.type === 'state') {
        setActive(event.chat);
        setChats(previous => previous && [...previous.filter(c => c.id !== event.chat.id), summaryOf(event.chat)].sort(byRecent));
      } else {
        setActive(previous => previous && previous.id === event.chat.id ? { ...event.chat, items: withMessage(previous.items, event.message) } : previous);
        setChats(previous => previous && [...previous.filter(c => c.id !== event.chat.id), event.chat].sort(byRecent));
      }
    };
    source.onerror = () => {
      // The browser retries by itself while the stream is merely interrupted; a closed one means the chat is gone.
      if (source.readyState === EventSource.CLOSED) { setError(messageOf(404)); setActiveId(null); void refresh(); }
    };
    return () => source.close();
  }, [activeId, refresh]);

  const guard = useCallback(async <T,>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError('');
    try { return await work(); }
    catch (e) { setError(e instanceof Error ? e.message : messageOf(500)); return undefined; }
    finally { setBusy(false); }
  }, []);

  /** Writes in the open conversation, or starts one when none is open. Returns true once the agent has the message. */
  const send = useCallback((text: string, context: ContextItem[]) => guard(async () => {
    const id = activeRef.current;
    if (id) await call(`/api/chats/${id}/messages`, 'POST', { text, context });
    else {
      const created = await call('/api/chats', 'POST', { text, context }) as { id: string };
      setActiveId(created.id);
    }
    void refresh();
    return true;
  }).then(Boolean), [guard, refresh]);

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
    setActiveId(null);
    await refresh();
  }), [guard, refresh]);

  return {
    chats, unavailable, active, activeId, error, busy,
    open: useCallback((id: string) => { setError(''); setActiveId(id); }, []),
    startNew: useCallback(() => { setError(''); setActiveId(null); }, []),
    send, stop, rename, remove, refresh, clearError: useCallback(() => setError(''), []),
  };
}
export type ChatState = ReturnType<typeof useChat>;
