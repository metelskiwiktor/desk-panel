// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_SHOWN } from '../src/cockpit-contract';
import type { MachinaCard } from '../src/machina-contract';
import { AgentViewError } from './agent-views';
import { handleChatRoute } from './chat-routes';
import { stabilizeBankCards } from './hermes-chat';
import { createCockpit } from './cockpit';
import { createFilaStore } from './fila';
import { createMachina } from './machina';
import { PANEL_TOOLS } from './panel-mcp';
import { createScenarioSources } from './scenario';

/** Wektor's Machina tools and the chat's Machina cards, over a real Machina on an in-memory Fila (no model, no network). */
const NOW = Date.parse('2026-11-13T12:00:00+01:00');
const CHAT = '00000000-0000-4000-8000-000000000009';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desk-machina-chat-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const card = (over: Partial<MachinaCard> = {}): MachinaCard => ({ title: 'Przegląd auta', description: 'Przypomnij o przeglądzie', module: 'Przypomnienia', trigger: { kind: 'daily', times: ['8:00'] }, blocks: [{ id: 'm', kind: 'message', text: 'Przegląd auta' }], ...over });
function world() {
  const fila = createFilaStore();
  const notes: string[] = [];
  const machina = createMachina({ fila, now: () => NOW, log: () => undefined, chat: { note: async (_id, input) => { notes.push(input.text); } } });
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json')), fila, machina };
  const ctx = (activeChats: string[] = [CHAT]) => ({ views: {}, sources, now: NOW, cezarUrl: 'http://127.0.0.1:4321/', activeChats: () => activeChats });
  return { fila, machina, sources, ctx, notes };
}
const conversation = (parts: { id: string; name: string; input: unknown; output: string }[]) => ({ get: async () => ({ id: CHAT, engine: 'hermes', items: parts.map((p, i) => ({ id: p.id.split(':')[0], role: 'agent', status: 'done', at: i, parts: [{ type: 'tool', id: p.id, name: `mcp__desk_panel__${p.name}`, input: JSON.stringify(p.input), output: p.output, state: 'done' }] })) }) }) as never;
function response() {
  let status = 200; let body = '';
  return { get status() { return status; }, get body() { return JSON.parse(body || 'null'); }, setHeader() {}, writeHead(code: number) { status = code; return this; }, end(value?: string) { body = value ?? ''; return this; } };
}
const request = (method: string, body?: unknown, origin = 'http://panel') => ({ method, headers: { origin }, setEncoding() {}, async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body); } }) as never;
const url = new URL(`http://panel/api/chats/${CHAT}/machina`);

describe('Wektor\'s Machina tools', () => {
  it('tells Wektor that notify reaches the phone through ntfy and that there is no separate ntfy block, without leaking secrets', () => {
    const blocks = JSON.stringify(PANEL_TOOLS.panel_machina_propose.schema);
    expect(blocks).toMatch(/notify \{[^}]*\} \(wpis w dzwonku panelu i, gdy w panelu jest skonfigurowany ntfy, także powiadomienie na telefon; osobnego klocka ntfy nie ma\)/);
    expect(blocks).not.toMatch(/DESK_NTFY_URL|panel\.env/);
  });
  it('shows a program card without writing, refuses a bad one with its reason, and makes only a one-shot of the running conversation without a card', async () => {
    const { fila, machina, ctx } = world();
    expect(await PANEL_TOOLS.panel_machina_propose.run(card(), ctx())).toContain(CARD_SHOWN.machina);
    expect((await fila.registries()).projects).toEqual([]);
    await expect(PANEL_TOOLS.panel_machina_propose.run(card({ blocks: [{ id: 'f', kind: 'fetch', url: 'https://example.com/' }] }), ctx())).rejects.toThrow(AgentViewError);
    await expect(PANEL_TOOLS.panel_machina_propose.run(card({ blocks: [{ id: 'f', kind: 'fetch', url: 'https://example.com/' }] }), ctx())).rejects.toThrow(/poza zatwierdzonymi domenami|outside the approved domains/);
    // The reminder takes the conversation from the turn that runs now, never from the model.
    await expect(PANEL_TOOLS.panel_machina_reminder.run({ title: 'Herbata', at: NOW + 60_000, kind: 'message', text: 'Herbata!' }, ctx([]))).rejects.toThrow(/rozmowie, w której trwa tura/);
    expect(await PANEL_TOOLS.panel_machina_reminder.run({ title: 'Herbata', at: NOW + 60_000, kind: 'message', text: 'Herbata!' }, ctx())).toContain('MACH-1');
    expect((await machina.get('MACH-1')).program.chatId).toBe(CHAT);
    const list = await PANEL_TOOLS.panel_machina.run({}, ctx());
    expect(list).toContain('MACH-1 „Herbata” · Aktywny · wersja 1');
    expect(await PANEL_TOOLS.panel_machina.run({ thread: 'MACH-1' }, ctx())).toContain('Koszt rozmów: 0.0000 USD');
    // A verdict outside an open assessment is refused.
    await expect(PANEL_TOOLS.panel_machina_assess.run({ runId: 'mr-000000000000', token: '0'.repeat(32), situation: 's-x' }, ctx())).rejects.toThrow(/nie jest otwarta/);
    // Without Machina (no active Fila) the tools say so.
    await expect(PANEL_TOOLS.panel_machina.run({}, { ...ctx(), sources: { ...ctx().sources, machina: undefined } })).rejects.toThrow(/Machina nie jest dostępna/);
  });
});

describe('Machina cards in the chat', () => {
  it('gives a Machina card the same id live, kept and read back from Hermes, so the route can find it', () => {
    const input = JSON.stringify(card());
    const message = (id: string, callId: string) => ({ id: 'm1', role: 'agent', at: 1, parts: [{ type: 'tool', id: callId, name: 'mcp__desk_panel__panel_machina_propose', input, output: CARD_SHOWN.machina, state: 'done' }, { type: 'tool', id: 'x', name: 'mcp__desk_panel__panel_machina', input: '{}', state: 'done' }] }) as never as { parts: { id: string }[] };
    const live = message('m1', 'panel_machina_propose'), history = message('m1', 'call_abc123');
    stabilizeBankCards(live as never);
    stabilizeBankCards(history as never);
    expect(live.parts[0]!.id).toMatch(/^m1:m-[0-9a-f]{16}$/);
    expect(history.parts[0]!.id).toBe(live.parts[0]!.id);
    // Only the cards: a read keeps the id Hermes gave it.
    expect(live.parts[1]!.id).toBe('x');
    const other = { id: 'm1', role: 'agent', at: 1, parts: [{ type: 'tool', id: 'y', name: 'panel_machina_propose', input: JSON.stringify(card({ title: 'Inny' })), state: 'done' }] } as never as { parts: { id: string }[] };
    stabilizeBankCards(other as never);
    expect(other.parts[0]!.id).not.toBe(live.parts[0]!.id);
  });

  it('applies a program card only on the user\'s yes, with the card from the conversation, once; a refused card cannot be accepted; the cockpit shows the automat', async () => {
    const { fila, machina, sources } = world();
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const chat = conversation([
      { id: 'm1:call1', name: 'panel_machina_propose', input: card(), output: `${CARD_SHOWN.machina}: nowy automat` },
      { id: 'm2:call2', name: 'panel_machina_propose', input: card({ title: 'Odrzucona' }), output: 'Błąd: Niepoprawna karta programu.' },
      { id: 'm3:call3', name: 'panel_automation_propose', input: {}, output: 'x' },
    ]);
    const post = async (body: unknown, origin?: string) => { const res = response(); await handleChatRoute(request('POST', body, origin), res as never, url, 'http://panel', chat, cockpit, undefined, undefined, true, machina); return res; };
    expect((await post({ toolCallId: 'm1:call1', decision: 'accept' }, 'http://evil')).status).toBe(403);
    expect((await fila.registries()).projects).toEqual([]);
    expect((await post({ toolCallId: 'm9:call9', decision: 'accept' })).status).toBe(409);
    expect((await post({ toolCallId: 'm3:call3', decision: 'accept' })).status).toBe(409);
    const refused = await post({ toolCallId: 'm2:call2', decision: 'accept' });
    expect([refused.status, refused.body.error]).toEqual([409, expect.stringMatching(/Panel odrzucił/)]);
    const accepted = await post({ toolCallId: 'm1:call1', decision: 'accept' });
    expect([accepted.status, accepted.body]).toEqual([200, { decision: 'created', thread: 'MACH-1', version: 1, at: expect.any(Number) }]);
    // A second click (or a reload) gets the same answer and makes nothing more.
    const again = await post({ toolCallId: 'm1:call1', decision: 'reject' });
    expect(again.body).toEqual(accepted.body);
    expect((await machina.list()).map(a => a.thread)).toEqual(['MACH-1']);
    expect((await machina.get('MACH-1')).conversations.items.map(c => [c.chatId, c.reason])).toEqual([[CHAT, 'projektowanie']]);
    expect((await cockpit.view(CHAT, [])).machinaCards).toEqual({ 'm1:call1': accepted.body });
    expect((await post({ toolCallId: 'm2:call2', decision: 'reject' })).body).toMatchObject({ decision: 'rejected' });
    // The conversation's Machina cockpit: its automat, why, the program and what it cost.
    const res = response();
    await handleChatRoute(request('GET'), res as never, url, 'http://panel', chat, cockpit, undefined, undefined, true, machina);
    expect(res.body.machina).toMatchObject({ thread: 'MACH-1', reason: 'projektowanie', version: 1, blocks: [{ id: 'm', kind: 'message' }], cost: { usd: 0, unknown: 1 } });
    const none = response();
    await handleChatRoute(request('GET'), none as never, url, 'http://panel', chat, cockpit, undefined, undefined, true, undefined);
    expect(none.status).toBe(503);
  });

  it('answers a correction card from the conversation: rejected changes nothing', async () => {
    const { machina } = world();
    await machina.decideCard(card(), { accept: true, chatId: CHAT });
    const chat = conversation([{ id: 'm1:call1', name: 'panel_machina_correct', input: { automat: 'MACH-1', from: 's-a', runId: 'mr-000000000001', to: 's-b' }, output: `${CARD_SHOWN.machinaCorrection}: próbka` }]);
    const res = response();
    await handleChatRoute(request('POST', { toolCallId: 'm1:call1', decision: 'reject' }), res as never, url, 'http://panel', chat, undefined, undefined, undefined, true, machina);
    expect([res.status, res.body]).toEqual([200, { decision: 'rejected', thread: 'MACH-1', at: expect.any(Number) }]);
    const accepted = response();
    await handleChatRoute(request('POST', { toolCallId: 'm1:call1', decision: 'accept' }), accepted as never, url, 'http://panel', chat, undefined, undefined, undefined, true, machina);
    expect([accepted.status, accepted.body.error]).toEqual([404, 'Katalog nie ma jednej z tych sytuacji.']);
  });
});
