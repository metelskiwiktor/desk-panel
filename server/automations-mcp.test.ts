import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutomations } from './automations';
import { createCockpit } from './cockpit';
import { PANEL_TOOLS } from './panel-mcp';
import { createScenarioSources } from './scenario';
import { handleChatRoute } from './chat-routes';

let dir: string;
let clock = Date.parse('2026-10-30T12:00:00+01:00');
let sent: { id: string; text: string }[];
const sources = createScenarioSources(join(process.cwd(), 'scenarios', 'standard.json'));
const chat = { sendAutomation: vi.fn(async (id: string, input: { text: string }) => { sent.push({ id, text: input.text }); }), createAutomation: vi.fn(async () => ({ id: 'run-chat' })) };

beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desk-auto-mcp-')); sent = []; clock = Date.parse('2026-10-30T12:00:00+01:00'); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const make = (over: Partial<Parameters<typeof createAutomations>[0]> = {}) => createAutomations({ file: join(dir, 'automations.json'), chat, now: () => clock, log: () => {}, ...over });

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
    const output = await PANEL_TOOLS.panel_automation_report.run({ outcome: 'done', summary: 'Cel osiągnięty.' }, ctx);
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
