// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { appointmentReference } from '../src/appointment-contract';
import { CARD_SHOWN } from '../src/cockpit-contract';
import { createPanelServer } from './app';
import { createScenarioSources, loadScenario } from './scenario';
import { createScenarioChat } from './scenario-chat';
import { PANEL_TOOLS } from './panel-mcp';
import { stableAppointmentCardId } from './appointment-cards';
import { fillFromHistory, stabilizeBankCards } from './hermes-chat';
import type { ChatDetail, ChatMessage, ChatPart } from '../src/chat-contract';

let server: Server | undefined, chat: Awaited<ReturnType<typeof createScenarioChat>> | undefined;
afterEach(async () => { await chat?.dispose(); if (server) { server.closeAllConnections(); await new Promise(r => server!.close(r)); } });
async function setup() {
  const sources = createScenarioSources('scenarios/wizyty.json');
  const act = vi.spyOn(sources.appointments!, 'act'), confirm = vi.spyOn(sources.appointments!, 'calendarConfirm');
  const fixture = loadScenario('scenarios/wizyty.json').appointment;
  if (!('query' in fixture)) throw new Error('fixture');
  const plan = { title: 'Przegląd roweru', start: new Date(Date.now() + 2 * 86400_000).toISOString(), end: new Date(Date.now() + 2 * 86400_000 + 3600_000).toISOString() };
  chat = await createScenarioChat({ toolScript: async message => {
    const name = message.includes('rower') ? 'panel_calendar_propose' : 'panel_znanylekarz';
    const args = name === 'panel_znanylekarz' ? fixture.query : plan;
    const output = await PANEL_TOOLS[name].run(args, { sources, views: {}, now: Date.now(), cezarUrl: 'http://127.0.0.1:4321/' });
    return { tools: [{ name: `mcp__desk_panel__${name}`, args, output }], answer: 'Karta gotowa.' };
  } });
  server = createPanelServer(sources, 'dist', undefined, chat);
  await new Promise<void>(r => server!.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, origin = base) => fetch(base + path, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const conversation = async (text: string) => {
    const created = await post('/api/chats', { text, engine: 'hermes' }); expect(created.status).toBe(201);
    const { id } = await created.json() as { id: string };
    const deadline = Date.now() + 5000; let detail: ChatDetail;
    do { detail = await chat!.get(id); if (!detail.running) break; await new Promise(r => setTimeout(r, 20)); } while (Date.now() < deadline);
    expect(detail!.running).toBe(false);
    const card = detail!.items.flatMap(m => m.parts ?? []).find((p): p is Extract<ChatPart, { type: 'tool' }> => p.type === 'tool' && p.name.includes('panel_'))!;
    expect(card.id).toMatch(/:v-[a-f0-9]{16}$/);
    return { id, card };
  };
  return { base, post, conversation, act, confirm };
}
describe('appointment decisions through the real chat API', () => {
  it('binds the finished Hermes card, rejects forged/cross-origin decisions, selects a slot and saves exactly once', async () => {
    const x = await setup(), { id, card } = await x.conversation('Pokaż wizyty');
    const path = `/api/chats/${id}/appointment`, get = () => fetch(x.base + path + `?toolCallId=${encodeURIComponent(card.id)}`);
    const before = await (await get()).json(); expect(before.selection).toBeNull(); expect(before.saved).toBeNull();
    const body = { toolCallId: card.id, action: { action: 'select', slotId: before.preview.slots[0].id } };
    expect((await x.post(path, body, 'https://evil.test')).status).toBe(403);
    expect((await fetch(x.base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).status).toBe(403);
    expect((await x.post(path, { ...body, toolCallId: 'fake:v-123' })).status).toBe(409);
    expect(x.act).not.toHaveBeenCalled();
    const selectedResponse = await x.post(path, body); expect(selectedResponse.status).toBe(200);
    const selected = await selectedResponse.json(); expect(selected.selection.draft.endAt - selected.selection.draft.startAt).toBe(30 * 60_000);
    expect(new URL(selected.selection.slot.bookingUrl).searchParams.get('address_service_id')).toBe('301');
    const confirm = { toolCallId: card.id, action: { action: 'confirm', selectionId: selected.selection.id } };
    expect((await x.post(path, { ...confirm, action: { ...confirm.action, choice: { startAt: 1 } } })).status).toBe(400);
    const saved = await (await x.post(path, confirm)).json(), again = await (await x.post(path, confirm)).json();
    expect(saved.saved).toEqual(again.saved); expect(saved.saved.draft.startAt).toBe(selected.selection.slot.startAt);
    const { id: otherId } = await x.conversation('Inna wizyta');
    expect((await x.post(`/api/chats/${otherId}/appointment`, confirm)).status).toBe(409);
    expect((await (await get()).json()).saved.id).toBe(saved.saved.id);
  });
  it('offers a generic event proposal without writing, then accepts only the user click', async () => {
    const x = await setup(), { id, card } = await x.conversation('Dodaj rower');
    const path = `/api/chats/${id}/calendar-plan`, before = await (await fetch(x.base + path + `?toolCallId=${encodeURIComponent(card.id)}`)).json();
    expect(before.draft.title).toBe('Przegląd roweru'); expect(before.saved).toBeNull(); expect(x.confirm).not.toHaveBeenCalled();
    expect((await x.post(path, { toolCallId: card.id, action: { action: 'confirm' } })).status).toBe(200);
    expect(x.confirm).toHaveBeenCalledTimes(1);
  });
});
it('reconstructs stable ids from wrapped history answers, distinguishes snapshots and refuses invalid references', () => {
  const fixture = loadScenario('scenarios/wizyty.json').appointment;
  if (!('query' in fixture)) throw new Error('fixture');
  const input = JSON.stringify(fixture.query), name = 'mcp__desk_panel__panel_znanylekarz';
  const output = `${CARD_SHOWN.appointment}; ref=${fixture.id}.`;
  const a = stableAppointmentCardId('m', name, input, output)!;
  expect(stableAppointmentCardId('m', name, input, JSON.stringify({ result: output }))).toBe(a);
  expect(appointmentReference(JSON.stringify({ result: output }))).toBe(fixture.id);
  expect(stableAppointmentCardId('m', name, input, output.replace(fixture.id, 'a-' + '2'.repeat(32)))).not.toBe(a);
  expect(stableAppointmentCardId('m', name, input, 'bad')).toBeNull();
  const message: ChatMessage = { id: 'm', role: 'agent', at: 1, status: 'done', parts: [{ type: 'tool', id: 'pending:m:1', name, input: '', state: 'done' }] };
  fillFromHistory(message, { parts: [{ type: 'tool', id: 'call_real', name, input, output: JSON.stringify({ result: output }), state: 'done' }] });
  expect(stabilizeBankCards(message)).toBe(true); expect(message.parts?.[0]).toMatchObject({ id: a });
});
