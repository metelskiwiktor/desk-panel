import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ChatWindow } from './ChatWindow';
import { ChatErrorBoundary } from './components/chat-error-boundary';
import { COCKPIT_TOOLS, CARD_SHOWN, type CockpitTool } from './cockpit-contract';
import { cardOf } from './cockpit/live';
import type { ChatMessage } from './chat-contract';
import { FakeSource, ID, NOW, chatHooks, openConversation, type Call } from './chat.test-kit';
import fixture from '../scenarios/fixtures/machina-chat-cards.json';

// Shape of both calls in the incident: rejected discriminator fields, then a valid program in the same turn.
// Only public program data; conversation identifiers, user wording and unrelated history are omitted.
const message = fixture as ChatMessage;
chatHooks();

async function open(items: ChatMessage[]) {
  const calls: Call[] = [];
  let machinaCards: Record<string, unknown> = {};
  const summary = { id: ID, title: 'Karty Machiny', createdAt: NOW, updatedAt: NOW, messages: items.length, running: false, engine: 'hermes' as const };
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input), method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    calls.push({ url, method, body });
    if (method === 'POST') {
      expect(url).toBe(`/api/chats/${ID}/machina`);
      expect(Object.keys(body).sort()).toEqual(['decision', 'toolCallId']);
      machinaCards = { ...machinaCards, [body.toolCallId]: { decision: 'updated', at: NOW, thread: 'MACH-2', version: 1 } };
    }
    return new Response(JSON.stringify(url === '/api/chats' ? { chats: [summary], engines: [{ engine: 'hermes', available: true }] }
      : url.endsWith('/cockpit') ? { dispatches: {}, machinaCards } : { ok: true }));
  }));
  const user = userEvent.setup({ delay: null });
  render(<ChatWindow onClose={() => {}} />);
  await openConversation(user, /Karty Machiny/);
  act(() => FakeSource.instances.at(-1)!.emit({ type: 'state', chat: { ...summary, items } }));
  return { user, calls };
}

describe('Machina cards in the real chat renderer', () => {
  it('maps every contract card to a defined tool name, including future additions', () => {
    for (const [name, tool] of Object.entries(COCKPIT_TOOLS)) {
      if ((tool as CockpitTool).card) expect(cardOf(`mcp__desk_panel__${name}`)).toEqual(expect.any(String));
    }
    expect(cardOf('external_tool')).toBe('external_tool');
  });

  it('renders two real-shaped proposals, refuses the bad one and accepts only the second call, retaining its decision', async () => {
    const { user, calls } = await open([message]);
    const cards = await screen.findAllByRole('region', { name: 'Program Machiny' });
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByRole('button', { name: 'Zatwierdź program' }).hasAttribute('disabled')).toBe(true);
    expect(within(cards[0]).getByRole('alert').textContent).toContain('Niepoprawne argumenty');
    expect(within(cards[1]).getByText(/codziennie/i)).toBeTruthy();
    expect(within(cards[1]).getAllByText('Odczyt strony')).toHaveLength(3);
    expect(screen.getByText('Sprawdź proponowany program.')).toBeTruthy();
    expect(calls.filter(c => c.method !== 'GET')).toEqual([]);
    await waitFor(() => expect(within(cards[1]).getByRole('button', { name: 'Zatwierdź program' }).hasAttribute('disabled')).toBe(false));
    await user.click(within(cards[1]).getByRole('button', { name: 'Zatwierdź program' }));
    expect(calls.filter(c => c.method === 'POST')).toEqual([{ url: `/api/chats/${ID}/machina`, method: 'POST', body: { toolCallId: 'm1:m-2', decision: 'accept' } }]);
    await screen.findByText('Zapisano decyzję · MACH-2 · wersja 1.');
    expect(within(cards[1]).queryByRole('button', { name: 'Zatwierdź program' })).toBeNull();
  });

  it.each([
    ['panel_machina_situation', 'machinaSituation', { runId: 'mr-111111111111', token: '1'.repeat(32), name: 'Nowa sytuacja', reaction: [{ id: 'alert', kind: 'smartAction', title: 'Zapisy otwarte' }] }, 'Nowa sytuacja Machiny', 'Zatwierdź sytuację'],
    ['panel_machina_correct', 'machinaCorrection', { automat: 'MACH-2', runId: 'mr-111111111111', from: 's-stara', to: 's-nowa', withdraw: true }, 'Poprawka oceny Machiny', 'Zatwierdź poprawkę'],
    ['panel_machina_propose', 'machina', JSON.parse(fixture.parts[1].input!), 'Program Machiny', 'Zatwierdź program'],
  ] as const)('renders and answers %s, including a repair program', async (tool, kind, args, label, button) => {
    const m: ChatMessage = { id: 'm2', role: 'agent', at: NOW, status: 'done', parts: [{ type: 'tool', id: 'm2:m-call', name: `mcp__desk_panel__${tool}`, input: JSON.stringify(args), state: 'done', output: CARD_SHOWN[kind] }] };
    const { user, calls } = await open([m]);
    const card = await screen.findByRole('region', { name: label });
    await waitFor(() => expect(within(card).getByRole('button', { name: button }).hasAttribute('disabled')).toBe(false));
    // The verdict token is never rendered in the card.
    expect(card.textContent).not.toContain('1'.repeat(32));
    await user.click(within(card).getByRole('button', { name: button }));
    expect(calls.find(c => c.method === 'POST')?.body).toEqual({ toolCallId: 'm2:m-call', decision: 'accept' });
  });

  it('keeps a malformed accepted card inert without losing the rest of the message', async () => {
    const m: ChatMessage = { ...message, parts: [{ type: 'tool', id: 'm1:bad', name: 'panel_machina_situation', input: '{"name":{"bad":true}}', output: CARD_SHOWN.machinaSituation, state: 'done' }, { type: 'text', text: 'Reszta odpowiedzi' }] };
    await open([m]);
    await screen.findByText('Reszta odpowiedzi');
    expect(screen.getByRole('button', { name: 'Zatwierdź sytuację' }).hasAttribute('disabled')).toBe(true);
  });

  it('contains a render exception in one message and keeps its sibling usable', () => {
    const Broken = () => { throw new Error('bad card'); };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<><ChatErrorBoundary><Broken /></ChatErrorBoundary><button>Inna wiadomość</button></>);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inna wiadomość' })).toBeTruthy();
  });
});
