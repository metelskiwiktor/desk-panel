// What the chat tests share: a fake event stream, a scripted /api/chats and the conversation fixtures.
import { afterEach, beforeEach, expect, vi } from 'vitest';
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import type userEvent from '@testing-library/user-event';
import type { ChatDetail, ChatEvent, ChatMessage, ChatSummary } from './chat-contract';
import { clearChatDraft } from './chat-draft';

export const ID = '0b6d1f0e-7c2a-4c47-9d0e-5f3f0a9a1b11';
export const NOW = new Date('2026-10-25T12:00:00').getTime();

export class FakeSource {
  static CLOSED = 2;
  static instances: FakeSource[] = [];
  readyState = 1;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) { FakeSource.instances.push(this); }
  close() { this.readyState = 2; }
  emit(event: ChatEvent) { act(() => this.onmessage?.({ data: JSON.stringify(event) })); }
}

export const summary = (over: Partial<ChatSummary> = {}): ChatSummary => ({ id: ID, title: 'Zadanie z maila od Anny', createdAt: NOW - 3600_000, updatedAt: NOW - 1800_000, messages: 2, running: false, engine: 'hermes', ...over });
export const detail = (items: ChatMessage[], over: Partial<ChatSummary> = {}): ChatDetail => ({ ...summary({ messages: items.length, ...over }), items });
export const mailChip = { kind: 'mail' as const, id: 't1', title: 'Anna Nowak', text: 'Od: Anna' };
export const history: ChatMessage[] = [
  { id: 'u1', role: 'user', at: NOW - 3000_000, text: 'Zrób z tego zadanie na jutro.', context: [mailChip] },
  { id: 'a1', role: 'agent', at: NOW - 2900_000, status: 'done', parts: [
    { type: 'tool', id: 's1', name: 'add_todo', input: '{"title":"Odpowiedzieć Annie"}', output: 'ok', state: 'done' },
    { type: 'text', text: 'Dodałem **zadanie** na jutro.' },
  ] },
];

export interface Call { url: string; method: string; body?: any }
export function mockServer(chats: ChatSummary[] = [summary()], status = 200) {
  const calls: Call[] = [];
  const reply = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code, headers: { 'Content-Type': 'application/json' } });
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    calls.push({ url, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (status !== 200) return reply({ error: 'x' }, status);
    if (url === '/api/chats' && method === 'GET') return reply({ chats });
    if (url === '/api/chats' && method === 'POST') return reply({ id: ID }, 201);
    return reply({ ok: true }, method === 'POST' ? 202 : 200);
  }));
  return calls;
}

/** The fake EventSource and pointer events every chat test needs, and the clean-up after it. */
export function chatHooks() {
  beforeEach(() => {
    FakeSource.instances = [];
    vi.stubGlobal('EventSource', FakeSource);
    vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId = 1; isPrimary = true; });
    vi.useRealTimers();
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); clearChatDraft(); localStorage.clear(); document.body.removeAttribute('data-picking'); document.body.removeAttribute('data-chat-dock'); window.history.replaceState(null, '', '/'); });
}

/** The conversations sit behind the title of the window. */
export async function openConversation(user: ReturnType<typeof userEvent.setup>, title: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Pokaż rozmowy' }));
  await user.click(await within(screen.getByRole('group', { name: 'Poprzednie rozmowy' })).findByRole('button', { name: title }));
}
/** The list has loaded (the window asks for it when it opens). */
export const listed = () => waitFor(() => expect(vi.mocked(fetch).mock.calls.some(([url]) => url === '/api/chats')).toBe(true));
