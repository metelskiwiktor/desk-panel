import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChatMessage, ContextItem } from '../chat-contract';
import { cardRefusal, COCKPIT_TOOLS, panelToolName, type CockpitToolName, type CockpitView, type DispatchOutcome } from '../cockpit-contract';
import { engineOf, useChat } from '../useChat';
import { DISPATCH, HERMES_APPROVAL, RECON, WATCH, type CockpitMessage, type CockpitSource, type CockpitState } from './types';

const IDLE: CockpitState = { watching: false };
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

/** The card of a panel tool Hermes called, by the cockpit contract; any other tool keeps its name (a plain tool row). */
const CARDS = { recon: RECON, dispatch: DISPATCH, watch: WATCH } as const;
export const cardOf = (name: string) => {
  const tool = COCKPIT_TOOLS[panelToolName(name) as CockpitToolName] as { card?: keyof typeof CARDS } | undefined;
  return tool?.card ? CARDS[tool.card] : name;
};

const resultOf = (outcome: DispatchOutcome) => outcome.decision === 'dispatched'
  ? { decision: 'dispatched' as const, taskId: outcome.taskId, prompt: outcome.prompt, url: outcome.url, runner: outcome.runner, model: outcome.model }
  : { decision: 'rejected' as const };

/** One message of the panel's chat as the cockpit shows it; a dispatch card carries the user's answer, if any. */
export function cockpitMessage(m: ChatMessage, dispatches: CockpitView['dispatches'] = {}, legacyUnresolved = false): CockpitMessage {
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
      const card = name === DISPATCH ? 'dispatch' : name === RECON ? 'recon' : null;
      const refused = card && p.state === 'done' ? cardRefusal(card, p.output, p.error) : null;
      return { type: 'tool', id: p.id, name, args: { ...parseArgs(p.input), ...(name === DISPATCH ? { legacyUnresolved } : {}), ...(refused ? { refused } : {}) }, result, running: p.state === 'running', error: p.error };
    }),
  };
}

async function call(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const response = await fetch(path, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || (response.status === 502 ? 'Cezar nie przyjął taska.' : 'Nie udało się wykonać operacji.'));
  return payload;
}

/** The cockpit of the open conversation, read again while it shows something that changes. */
function useCockpitView(chatId: string | null, items: readonly ChatMessage[]) {
  const [view, setView] = useState<CockpitView | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  /** Grows with every message and step: a watch call inside a running answer counts too. */
  const steps = items.reduce((n, m) => n + 1 + (m.parts?.length ?? 0), 0);
  const refresh = useCallback(() => setTick(t => t + 1), []);
  useEffect(() => { setView(null); setError(''); }, [chatId]);
  useEffect(() => {
    if (!chatId) return;
    let gone = false;
    // Which task is watched the server decides from the conversation (the cockpit contract): read again as it grows.
    call(`/api/chats/${chatId}/cockpit`).then(
      value => { if (!gone) { setView(value as CockpitView); setError(''); } },
      e => { if (!gone) setError(e instanceof Error ? e.message : 'Kokpit jest niedostępny.'); },
    );
    return () => { gone = true; };
  }, [chatId, steps, tick]);
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
  const { view, error: cockpitError, refresh } = useCockpitView(chat.activeId, items);
  const dispatches = view?.dispatches;
  const messages = useMemo(() => items.map(m => cockpitMessage(m, dispatches, view?.legacyUnresolved)), [items, dispatches, view?.legacyUnresolved]);
  const activeId = chat.activeId;

  const cockpit: CockpitState = useMemo(() => {
    if (!view) return IDLE;
    const { task, pr } = view;
    return {
      watching: !!task && ACTIVE.has(task.status),
      since: task?.startedAt,
      task: task ?? undefined,
      pr: pr ?? undefined,
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
      const r = response as { decision: 'dispatch' | 'reject'; title: string; prompt: string; workflow?: string; todoId?: string; runner?: string; model?: string };
      if (!activeId) throw new Error('Nie ma otwartej rozmowy.');
      await call(`/api/chats/${activeId}/dispatch`, 'POST', { toolCallId: id, decision: r.decision, title: r.title, prompt: r.prompt, ...(r.workflow ? { workflow: r.workflow } : {}), ...(r.todoId ? { todoId: r.todoId } : {}), ...(r.runner ? { runner: r.runner } : {}), ...(r.model ? { model: r.model } : {}) });
      refresh();
    },
    chats: chat.chats?.filter(c => engineOf(c) === 'hermes').map(c => ({ id: c.id, title: c.title, running: c.running, updatedAt: c.updatedAt })) ?? null,
    activeId,
    open: (id: string | null) => { nonce.current = null; if (id) chat.open(id); else chat.startNew(); },
    remove: () => void chat.remove(),
    cockpit,
    cockpitError: cockpitError || undefined,
  };
}
