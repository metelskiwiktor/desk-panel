import { useRef } from 'react';
import type { ChatMessage, ContextItem } from '../chat-contract';
import { engineOf, useChat } from '../useChat';
import { HERMES_APPROVAL, type CockpitMessage, type CockpitSource, type CockpitState } from './types';

/** No Cezar watchdog reaches the panel yet: the live cockpit says so instead of showing made-up tasks. */
const IDLE: CockpitState = { watching: false, subtasks: [] };

const parseArgs = (input: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(input) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* plain text */ }
  return input ? { input } : {};
};

/** One message of the panel's chat as the cockpit shows it. */
export function cockpitMessage(m: ChatMessage): CockpitMessage {
  if (m.role === 'user') return { id: m.id, role: 'user', at: m.at, parts: [{ type: 'text', text: m.text ?? '' }], context: m.context, status: 'done' };
  return {
    id: m.id, role: 'assistant', at: m.at, error: m.error, notice: m.notice,
    status: m.status === 'streaming' ? 'running' : m.status ?? 'done',
    parts: (m.parts ?? []).map(p => p.type === 'text' ? p
      : p.type === 'tool' ? { type: 'tool', id: p.id, name: p.name, args: parseArgs(p.input), result: p.output, running: p.state === 'running', error: p.error }
      : { type: 'tool', id: p.id, name: HERMES_APPROVAL, args: { tool: p.tool, detail: p.detail, state: p.state, at: p.at }, running: p.state === 'pending' }),
  };
}

/** The real chat, on Hermes only: conversations of the other engine stay on the server but are not listed here. */
export function useLiveCockpit(): CockpitSource {
  const chat = useChat('hermes');
  /** One per draft: a message retried after an error is the same message to the server. */
  const nonce = useRef<string | null>(null);
  const down = chat.engines?.find(e => e.engine === 'hermes' && !e.available);
  const items = chat.active && engineOf(chat.active) === 'hermes' ? chat.active.items : [];
  return {
    mode: 'live',
    title: chat.active?.title ?? 'Nowy czat',
    messages: items.map(cockpitMessage),
    running: chat.active?.running ?? false,
    hermes: { up: !down, checking: false, error: down?.error },
    unavailable: chat.unavailable,
    loading: !!chat.activeId && !chat.active,
    error: chat.error,
    clearError: chat.clearError,
    async send(text: string, context: ContextItem[]) {
      nonce.current ??= crypto.randomUUID();
      const ok = await chat.send(text, context, nonce.current);
      if (ok) nonce.current = null;
      return ok;
    },
    stop: () => void chat.stop(),
    retry: () => void chat.refresh(),
    respond: (id: string, response: unknown) => { if (response === 'approve' || response === 'deny') void chat.approve(id, response); },
    chats: chat.chats?.filter(c => engineOf(c) === 'hermes').map(c => ({ id: c.id, title: c.title, running: c.running, updatedAt: c.updatedAt })) ?? null,
    activeId: chat.activeId,
    open: (id: string | null) => { nonce.current = null; if (id) chat.open(id); else chat.startNew(); },
    remove: () => void chat.remove(),
    cockpit: IDLE,
    toggleSubtask: () => {},
  };
}
