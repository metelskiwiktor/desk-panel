import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ContextItem } from '../chat-contract';
import { cezarIdsIn, type CockpitView, type DispatchOutcome } from '../cockpit-contract';
import { engineOf, useChat } from '../useChat';
import { DISPATCH, HERMES_APPROVAL, RECON, WATCH, type CockpitMessage, type CockpitSource, type CockpitState } from './types';

const IDLE: CockpitState = { watching: false, subtasks: [] };
/** While the task runs (or a check does) the cockpit is read often; otherwise now and then. */
const ACTIVE_MS = 5_000, IDLE_MS = 30_000;
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'INPUT']);

const parseArgs = (input: string): Record<string, unknown> => {
  try {
    const value = JSON.parse(input) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch { /* plain text */ }
  return input ? { input } : {};
};

/** The panel's MCP tools as Hermes names them (`mcp__desk_panel__panel_cezar_watch`, `mcp_desk-panel_…`): the cards. */
const CARD_TOOLS: Record<string, string> = { panel_recon_report: RECON, panel_cezar_propose: DISPATCH, panel_cezar_watch: WATCH };
export const cardOf = (name: string) => CARD_TOOLS[name.replace(/^mcp_+desk[-_]panel_+/i, '')] ?? name;

const resultOf = (outcome: DispatchOutcome) => outcome.decision === 'dispatched'
  ? { decision: 'dispatched' as const, taskId: outcome.taskId, prompt: outcome.prompt, url: outcome.url }
  : { decision: 'rejected' as const };

/** One message of the panel's chat as the cockpit shows it; a dispatch card carries the user's answer, if any. */
export function cockpitMessage(m: ChatMessage, dispatches: CockpitView['dispatches'] = {}): CockpitMessage {
  if (m.role === 'user') return { id: m.id, role: 'user', at: m.at, parts: [{ type: 'text', text: m.text ?? '' }], context: m.context, status: 'done' };
  return {
    id: m.id, role: 'assistant', at: m.at, error: m.error, notice: m.notice,
    status: m.status === 'streaming' ? 'running' : m.status ?? 'done',
    parts: (m.parts ?? []).map(p => {
      if (p.type === 'text') return p;
      if (p.type === 'approval') return { type: 'tool', id: p.id, name: HERMES_APPROVAL, args: { tool: p.tool, detail: p.detail, state: p.state, at: p.at }, running: p.state === 'pending' };
      const name = cardOf(p.name);
      // A proposal is not done by its tool: it waits for the user's answer (none yet: no result).
      const result = name === DISPATCH ? (dispatches[p.id] ? resultOf(dispatches[p.id]) : undefined) : p.output;
      return { type: 'tool', id: p.id, name, args: parseArgs(p.input), result, running: p.state === 'running', error: p.error };
    }),
  };
}

/** The Cezar task a conversation is about, when the panel did not dispatch one from it: the last one it mentions. */
export function mentionedTask(items: ChatMessage[]): string | undefined {
  let last: string | undefined;
  for (const m of items) {
    for (const id of cezarIdsIn(m.text ?? '')) last = id;
    for (const p of m.parts ?? []) {
      if (p.type === 'text') for (const id of cezarIdsIn(p.text)) last = id;
      else if (p.type === 'tool') {
        const args = parseArgs(p.input);
        if (cardOf(p.name) === WATCH && typeof args.id === 'string') last = args.id;
        else for (const id of cezarIdsIn(`${p.input}\n${p.output ?? ''}`)) last = id;
      }
    }
  }
  return last;
}

async function call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || (response.status === 502 ? 'Cezar nie przyjął taska.' : 'Nie udało się wykonać operacji.'));
  return payload;
}

/** The cockpit of the open conversation, read again while it shows something that changes. */
function useCockpitView(chatId: string | null, hint: string | undefined) {
  const [view, setView] = useState<CockpitView | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { setView(null); setError(''); }, [chatId]);
  useEffect(() => {
    if (!chatId) return;
    let gone = false;
    const query = hint ? `?run=${encodeURIComponent(hint)}` : '';
    call(`/api/chats/${chatId}/cockpit${query}`).then(
      value => { if (!gone) { setView(value as CockpitView); setError(''); } },
      e => { if (!gone) setError(e instanceof Error ? e.message : 'Kokpit jest niedostępny.'); },
    );
    return () => { gone = true; };
  }, [chatId, hint, tick]);
  const busy = !!view && ((view.task && ACTIVE.has(view.task.status)) || view.pr?.checks.some(c => c.state === 'running' || c.state === 'pending'));
  useEffect(() => {
    if (!chatId) return;
    const t = window.setTimeout(refresh, busy ? ACTIVE_MS : IDLE_MS);
    return () => window.clearTimeout(t);
  }, [chatId, busy, view, refresh]);
  return { view, error, refresh };
}

/** The real chat, on Hermes only: conversations of the other engine stay on the server but are not listed here. */
export function useLiveCockpit(): CockpitSource {
  const chat = useChat('hermes');
  /** One per draft: a message retried after an error is the same message to the server. */
  const nonce = useRef<string | null>(null);
  const down = chat.engines?.find(e => e.engine === 'hermes' && !e.available);
  const items = useMemo(() => chat.active && engineOf(chat.active) === 'hermes' ? chat.active.items : [], [chat.active]);
  const hint = useMemo(() => mentionedTask(items), [items]);
  const { view, error: cockpitError, refresh } = useCockpitView(chat.activeId, hint);
  const dispatches = view?.dispatches;
  const messages = useMemo(() => items.map(m => cockpitMessage(m, dispatches)), [items, dispatches]);
  const activeId = chat.activeId;

  const cockpit: CockpitState = useMemo(() => {
    if (!view) return IDLE;
    const { task, pr, list } = view;
    return {
      watching: !!task && ACTIVE.has(task.status),
      since: task?.startedAt,
      task: task ?? undefined,
      pr: pr ?? undefined,
      list: list ? { id: list.id, name: list.name } : undefined,
      subtasks: list?.tasks ?? [],
    };
  }, [view]);

  return {
    mode: 'live',
    title: chat.active?.title ?? 'Nowy czat',
    messages,
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
    async respond(id: string, response: unknown) {
      if (response === 'approve' || response === 'deny') { await chat.approve(id, response); return; }
      // A dispatch card: the panel dispatches (or not) as the user answered; the card shows the outcome from the cockpit.
      const r = response as { decision: 'dispatch' | 'reject'; title: string; prompt: string; todoId?: string };
      if (!activeId) throw new Error('Nie ma otwartej rozmowy.');
      await call(`/api/chats/${activeId}/dispatch`, 'POST', { toolCallId: id, decision: r.decision, title: r.title, prompt: r.prompt, ...(r.todoId ? { todoId: r.todoId } : {}) });
      refresh();
    },
    chats: chat.chats?.filter(c => engineOf(c) === 'hermes').map(c => ({ id: c.id, title: c.title, running: c.running, updatedAt: c.updatedAt })) ?? null,
    activeId,
    open: (id: string | null) => { nonce.current = null; if (id) chat.open(id); else chat.startNew(); },
    remove: () => void chat.remove(),
    cockpit,
    cockpitError: cockpitError || undefined,
    toggleSubtask: (taskId: string) => {
      const done = !cockpit.subtasks.find(s => s.id === taskId)?.done;
      void call('/api/todos/action', 'POST', { action: 'updateTask', task: taskId, done }).then(refresh, () => refresh());
    },
  };
}
