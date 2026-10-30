import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomations } from './automations';
import { createCockpit } from './cockpit';
import { PANEL_TOOLS } from './panel-mcp';
import { createScenarioSources } from './scenario';
import { handleChatRoute } from './chat-routes';
import { createPanelServer } from './app';
import { createHermesChat } from './hermes-chat';
import { createHermesClient } from './hermes-api';
import { startMockHermes } from './hermes-mock';

let dir: string;
let clock = Date.parse('2026-10-30T12:00:00+01:00');
let sent: { id: string; text: string }[];
const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
const chat = { sendAutomation: vi.fn(async (id: string, input: { text: string }) => { sent.push({ id, text: input.text }); }), createAutomation: vi.fn(async () => ({ id: 'run-chat' })) };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desk-auto-mcp-')); sent = []; clock = Date.parse('2026-10-30T12:00:00+01:00'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (over: Partial<Parameters<typeof createAutomations>[0]> = {}) => createAutomations({ file: join(dir, 'automations.json'), chat: { ...chat, automationTurn: () => pending() ? { chatId: pending().chatId, turnId: pending().turnId, runId: 'hermes-run' } : undefined }, now: () => clock, log: () => {}, ...over });
const pending = () => existsSync(join(dir, 'automations.json')) ? JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8')).pending[0] : undefined;
const pendingId = () => JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8')).pending[0].id as string;

describe('automation tools', () => {
  it('proposes a card and saves nothing', async () => {
    const automations = make();
    const output = await PANEL_TOOLS.panel_automation_propose.run({
      name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: true,
    }, { views: {}, sources, now: clock, cezarUrl: 'http://127.0.0.1:4321/', automations, activeChats: () => ['chat-1'] });
    expect(output).toContain('Karta „Nowy automat” jest u użytkownika');
    expect(await automations.list()).toHaveLength(0);
  });

  it('refuses a report outside a run and accepts it inside one', async () => {
    const automations = make();
    const ctx = { views: {}, sources, now: clock, cezarUrl: 'http://127.0.0.1:4321/', automations, activeChats: () => ['chat-1'] };
    await expect(PANEL_TOOLS.panel_automation_report.run({ outcome: 'done', summary: 'x' }, ctx)).rejects.toThrow(/nie należy do runu/);
    const created = await PANEL_TOOLS.panel_observe.run({ action: 'create', kind: 'time', target: 'za 1 minutę', instruction: 'Sprawdź.' }, ctx);
    const id = /a-[0-9a-f]{12}/.exec(created)![0];
    clock += 2 * 60_000;
    await automations.tick();
    expect(sent).toHaveLength(1);
    automations.turnChanged({ chatId: pending().chatId, turnId: pending().turnId, runId: 'hermes-run', ended: false });
    const output = await PANEL_TOOLS.panel_automation_report.run({ runId: pendingId(), token: pending().token, outcome: 'done', summary: 'Cel osiągnięty.' }, ctx);
    expect(output).toContain('Raport zapisany');
    const list = await PANEL_TOOLS.panel_automations.run({ id }, ctx);
    expect(list).toContain('Cel osiągnięty.');
  });

  it('lists, pauses, resumes and cancels an automation without a card', async () => {
    const automations = make();
    const created = await automations.createFromPlan('chat-1', { name: 'Ceny', goal: 'Sprawdź.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: false });
    const ctx = { views: {}, sources, now: clock, cezarUrl: 'http://127.0.0.1:4321/', automations, activeChats: () => [] };
    expect(await PANEL_TOOLS.panel_automations.run({ id: created.id }, ctx)).toContain('Ceny');
    await PANEL_TOOLS.panel_automation_update.run({ id: created.id, action: 'pause' }, ctx);
    expect((await automations.get(created.id))!.status).toBe('paused');
    await PANEL_TOOLS.panel_automation_update.run({ id: created.id, action: 'resume' }, ctx);
    expect((await automations.get(created.id))!.status).toBe('active');
    await PANEL_TOOLS.panel_automation_update.run({ id: created.id, action: 'cancel' }, ctx);
    expect((await automations.get(created.id))!.status).toBe('cancelled');
  });

  it('accepts the report of an open run in one of several active conversations', async () => {
    const automations = make();
    const created = await automations.createFromPlan('origin', { name: 'Ceny', goal: 'Sprawdź.', trigger: { kind: 'once', at: clock + 60_000 }, actions: [{ kind: 'message' }], learn: false });
    clock += 60_000;
    await automations.tick();
    const ctx = { views: {}, sources, now: clock, cezarUrl: 'http://127.0.0.1:4321/', automations, activeChats: () => ['origin', 'other'] };
    automations.turnChanged({ chatId: pending().chatId, turnId: pending().turnId, runId: 'hermes-run', ended: false });
    await expect(PANEL_TOOLS.panel_automation_report.run({ runId: pendingId(), token: pending().token, outcome: 'done', summary: 'Cel osiągnięty.' }, ctx)).resolves.toContain('Raport zapisany');
    expect((await automations.get(created.id))!.runs).toHaveLength(1);
  });

  it('refuses a report in an ordinary turn that names no open run', async () => {
    const automations = make();
    const ctx = { views: {}, sources, now: clock, cezarUrl: 'http://127.0.0.1:4321/', automations, activeChats: () => ['origin'] };
    await expect(PANEL_TOOLS.panel_automation_report.run({ runId: 'run-000000000000', outcome: 'done', summary: 'Zwykła tura.' }, ctx)).rejects.toThrow(/nie należy do runu/);
  });
});

describe('automation HTTP action', () => {
  it('calls automationAction for an allowed origin and refuses a foreign one', async () => {
    const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
    const action = vi.fn(async (input: { id: string }) => ({ id: input.id, status: 'paused' }));
    sources.automationAction = action as unknown as NonNullable<typeof sources.automationAction>;
    const server = createPanelServer(sources, process.cwd());
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const payload = JSON.stringify({ id: 'a-111111111111', action: 'pause' });
      const denied = await fetch(`${origin}/api/automations/action`, { method: 'POST', headers: { Origin: 'http://evil' }, body: payload });
      expect(denied.status).toBe(403);
      expect(action).not.toHaveBeenCalled();
      const allowed = await fetch(`${origin}/api/automations/action`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: payload });
      expect(allowed.status).toBe(200);
      expect(await allowed.json()).toMatchObject({ id: 'a-111111111111', status: 'paused' });
      expect(action).toHaveBeenCalledWith({ id: 'a-111111111111', action: 'pause' });
    } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
  });
});

describe('automation card route', () => {
  const plan = { name: 'Ceny', goal: 'Sprawdź cennik.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: true };
  const chatId = '00000000-0000-4000-8000-000000000009';
  const conversation = () => ({ id: chatId, engine: 'hermes', items: [{ id: 'm1', role: 'agent', status: 'done', at: 1, parts: [{ type: 'tool', id: 'm1:call1', name: 'mcp__desk_panel__panel_automation_propose', input: JSON.stringify(plan), output: 'Karta „Nowy automat” jest u użytkownika', state: 'done' }] }] }) as never;
  function response() {
    let status = 200; let body = '';
    return {
      get status() { return status; }, get body() { return body; },
      setHeader() {}, writeHead(code: number) { status = code; return this; }, end(value?: string) { body = value ?? ''; return this; },
    };
  }
  function request(body: unknown, origin = 'http://panel') {
    const text = JSON.stringify(body);
    return { method: 'POST', headers: { origin }, setEncoding() {}, async *[Symbol.asyncIterator]() { yield text; } } as never;
  }
  const cockpit = () => createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
  const url = new URL(`http://panel/api/chats/${chatId}/automation`);

  it('creates the automation only after the user click, with the plan from the conversation', async () => {
    const automations = make();
    const chatStub = { get: async () => conversation() } as never;
    const first = response();
    const handled = await handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }), first as never, url, 'http://panel', chatStub, undefined, undefined, automations);
    expect(handled).toBe(true);
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body)).toMatchObject({ decision: 'created' });
    expect((await automations.list())[0]).toMatchObject({ name: 'Ceny', chatId });

    const before = make({ file: join(dir, 'before.json') });
    const denied = response();
    await handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }, 'http://evil'), denied as never, url, 'http://panel', chatStub, undefined, undefined, before);
    expect(denied.status).toBe(403);
    expect(await before.list()).toHaveLength(0);
  });

  it('applies an update once under concurrent clicks, keeps its before preview after restart', async () => {
    const automations = make();
    const a = await automations.createFromPlan(chatId, plan as never);
    const updatedPlan = { ...plan, replaces: a.id, goal: 'Sprawdź nowy cennik.' };
    const detail = JSON.parse(JSON.stringify(conversation()));
    detail.items[0].parts[0].input = JSON.stringify(updatedPlan);
    const chatStub = { get: async () => detail } as never;
    const keeper = cockpit();
    const responses = [response(), response()];
    await Promise.all(responses.map(res => handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }), res as never, url, 'http://panel', chatStub, keeper, undefined, automations)));
    const result = JSON.parse(responses[0].body);
    expect(result).toMatchObject({ decision: 'updated', automationId: a.id, before: { goal: plan.goal } });
    expect(JSON.parse(responses[1].body)).toEqual(result);
    expect(await automations.list()).toHaveLength(1);
    expect((await automations.get(a.id))!.changes).toHaveLength(1);
    const again = response();
    await handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }), again as never, url, 'http://panel', chatStub, cockpit(), undefined, automations);
    expect(JSON.parse(again.body)).toEqual(result);
    expect((await automations.get(a.id))!.changes).toHaveLength(1);
  });

  it('keeps the decision in the cockpit: a second answer creates nothing and a reload shows it', async () => {
    const automations = make();
    const chatStub = { get: async () => conversation() } as never;
    const first = response();
    await handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }), first as never, url, 'http://panel', chatStub, cockpit(), undefined, automations);
    const created = JSON.parse(first.body);
    expect(created).toMatchObject({ decision: 'created', name: 'Ceny' });
    expect(created.automationId).toMatch(/^a-[0-9a-f]{12}$/);

    const second = response();
    await handleChatRoute(request({ toolCallId: 'm1:call1', decision: 'create' }), second as never, url, 'http://panel', chatStub, cockpit(), undefined, automations);
    expect(JSON.parse(second.body)).toEqual(created);
    expect(await automations.list()).toHaveLength(1);

    const view = await cockpit().view(chatId, (conversation() as unknown as { items: never }).items);
    expect(view.automationCards['m1:call1']).toEqual({ decision: 'created', at: created.at, automationId: created.automationId, name: 'Ceny' });
    const restarted = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    expect((await restarted.view(chatId, (conversation() as unknown as { items: never }).items)).automationCards['m1:call1']).toEqual(view.automationCards['m1:call1']);
  });
});

describe('an automation card from real Hermes history', () => {
  it('is identifiable live and after a restart, and the HTTP click creates the automation', async () => {
    const mock = await startMockHermes({ stepMs: 1, streamToolArgs: false });
    const services: ReturnType<typeof createHermesChat>[] = [];
    const makeChat = () => {
      const service = createHermesChat({ dir, client: createHermesClient({ url: mock.url }), log: { trace() {}, turn() {}, async drain() {} } as never });
      services.push(service);
      return service;
    };
    const automations = createAutomations({ file: join(dir, 'automations.json'), chat: makeChat(), log: () => {} });
    const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
    const chat = services[0];
    const server = createPanelServer(sources, dir, undefined, chat, { automations, cockpit });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const { id } = await chat.create({ text: 'Zaproponuj automat' });
      let detail = await chat.get(id);
      for (let i = 0; i < 300 && (detail.running || !detail.items[1]?.parts?.some(p => p.type === 'tool' && p.input.includes('Ceny'))); i++) {
        await new Promise(resolve => setTimeout(resolve, 10));
        detail = await chat.get(id);
      }
      expect(detail.running).toBe(false);
      const agent = detail.items.find(m => m.role === 'agent')!;
      const tool = agent.parts!.find(p => p.type === 'tool')!;
      expect(tool.id.startsWith('pending:')).toBe(false);
      expect(tool.id).toMatch(new RegExp(`^${agent.id}:x-[0-9a-f]{16}$`));
      const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const res = await fetch(`${origin}/api/chats/${id}/automation`, {
        method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ toolCallId: tool.id, decision: 'create' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ decision: 'created' });
      expect(await automations.list()).toHaveLength(1);

      await chat.drain(); chat.close();
      const restored = await makeChat().get(id);
      const restoredAgent = restored.items.find(m => m.role === 'agent')!;
      const restoredTool = restoredAgent.parts!.find(p => p.type === 'tool')!;
      expect(restoredTool.id).toBe(tool.id);
    } finally {
      automations.stop();
      for (const service of services) { service.close(); await service.drain().catch(() => {}); }
      await mock.close();
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }
  });
});
