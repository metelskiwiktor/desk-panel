// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CARD_SHOWN } from '../src/cockpit-contract';
import { createAutomationExecutor } from './automation-actions';
import { createAutomations } from './automations';
import { handleChatRoute } from './chat-routes';
import { createFilaStore, type FilaStore } from './fila';
import { createMachina } from './machina';
import { createMachinaReader } from './machina-fetch';
import { moveTimeAutomations } from './machina-migration';
import { PANEL_TOOLS } from './panel-mcp';
import { createScenarioSources } from './scenario';

/**
 * DESK-87 on an isolated copy: an old automations.json built here from the contract (never the user's store), Machina on an
 * in-memory Fila, Hermes, Google and ntfy as fakes. Nothing reaches a model or the network.
 */
const IRONMAN = JSON.parse(readFileSync(join(process.cwd(), 'scenarios/fixtures/machina-ironman.json'), 'utf8'));
const NOW = Date.parse('2026-11-13T12:00:00+01:00');
const CHAT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const PAGE = 'https://www.ironman.com/im703-gdynia-register';
let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'desk-machina-move-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const old = (over: Record<string, unknown>) => ({
  name: 'Automat', goal: 'Cel', trigger: { kind: 'daily', times: ['7:00'] }, status: 'active', notebook: '', learn: false, actions: [{ kind: 'message' }],
  chatId: CHAT, createdAt: NOW - 86_400_000, snapshot: {}, changes: [], runs: [], ...over,
});
/** Every kind of record the move meets: cycles and one-shots, open and closed, plain and with extra actions, Cezar and PR. */
const RECORDS = [
  IRONMAN.automation,
  old({ id: 'a-000000000002', name: 'Wstrzymany cykl', status: 'paused', trigger: { kind: 'weekly', weekday: 1, times: ['9:00'] } }),
  old({ id: 'a-000000000003', name: 'Herbata', goal: 'Przypomnij o herbacie', trigger: { kind: 'once', at: NOW + 3_600_000 }, nextRunAt: NOW + 3_600_000 }),
  old({ id: 'a-000000000004', name: 'Wstrzymane przypomnienie', status: 'paused', trigger: { kind: 'once', at: NOW + 7_200_000 }, nextRunAt: NOW + 7_200_000 }),
  old({ id: 'a-000000000005', name: 'Jednorazowy z kalendarzem', trigger: { kind: 'once', at: NOW + 3_600_000 }, nextRunAt: NOW + 3_600_000, actions: [{ kind: 'message' }, { kind: 'calendarEvent' }, { kind: 'notify' }] }),
  old({ id: 'a-000000000006', name: 'Zakończony', status: 'done', trigger: { kind: 'once', at: NOW - 3_600_000 } }),
  old({ id: 'a-000000000007', name: 'Wygasły', status: 'expired' }),
  old({ id: 'a-000000000008', name: 'Anulowany', status: 'cancelled' }),
  old({ id: 'a-000000000009', name: 'Task Cezara', trigger: { kind: 'cezar', taskId: 'desk/1' } }),
  old({ id: 'a-00000000000a', name: 'PR', trigger: { kind: 'pr', url: 'https://github.com/o/r/pull/1' } }),
];

function world(records: unknown[] = RECORDS, fila: FilaStore = createFilaStore()) {
  const file = join(dir, 'automations.json');
  try { readFileSync(file); } catch { writeFileSync(file, JSON.stringify({ version: 1, automations: records, pending: [], outbox: [] })); }
  const w = {
    clock: NOW, fila, file,
    pages: {} as Record<string, string>,
    notes: [] as { chat: string; text: string }[], turns: [] as { chat: string; text: string }[],
    wakes: [] as { chatId: string; nonce: string; text: string; reason: string }[], oldTurns: [] as string[],
    calendar: [] as { key: string; title: string; startAt: number }[], ntfy: [] as { title: string; body: string }[],
  };
  const chat = {
    note: async (id: string, input: { text: string }) => { w.notes.push({ chat: id, text: input.text }); },
    sendAutomation: async (id: string, input: { text: string }) => { w.turns.push({ chat: id, text: input.text }); },
    createAutomation: async (input: { chatId?: string; nonce?: string; text: string; automation: { reason: string } }) => { w.wakes.push({ chatId: input.chatId!, nonce: input.nonce!, text: input.text, reason: input.automation.reason }); return { id: input.chatId! }; },
  };
  const executeAction = createAutomationExecutor({
    writeCalendar: async (key, draft) => { w.calendar.push({ key, title: draft.title, startAt: draft.startAt }); return { id: `google-${w.calendar.length}` } as never; },
    ntfyUrl: 'https://ntfy.example/desk', fetcher: (async (_url: unknown, init: { headers: Record<string, string>; body: string }) => { w.ntfy.push({ title: Buffer.from(init.headers.Title!.slice(10, -2), 'base64').toString('utf8'), body: init.body }); return new Response('ok'); }) as never,
  });
  const read = createMachinaReader({ resolve: async () => ['93.184.216.34'], get: async url => w.pages[url.href] ? { status: 200, type: 'text/html', body: w.pages[url.href]! } : { status: 404, body: '' } });
  const automations = createAutomations({ file, chat: { sendAutomation: async (id, input) => { w.oldTurns.push(`${id}: ${input.text.slice(0, 40)}`); }, createAutomation: async input => { w.oldTurns.push(input.text.slice(0, 40)); return { id: 'x' }; } }, now: () => w.clock, log: () => undefined, timeInMachina: true, executeAction });
  const machina = createMachina({ fila, now: () => w.clock, log: () => undefined, read, chat: chat as never, executeAction, busy: () => automations.busy() });
  const kit = async (thread: string) => { const view = await fila.machinaKit(thread); const t = await fila.thread(thread); return { program: view.program.content as any, journal: view.journal.content as any, conversations: view.conversations.content as any, state: t.state, module: t.module, tags: t.fields.Tagi, description: t.description, title: t.title }; };
  const tick = async () => { await automations.tick(); await machina.tick(); await machina.idle(); };
  return { w, automations, machina, kit, tick };
}
const verdictOf = (wake: { text: string }) => ({ runId: /runId: "(mr-[0-9a-f]{12})"/.exec(wake.text)![1]!, token: /token: "([0-9a-f]{32})"/.exec(wake.text)![1]! });

describe('moving the old time automations to Machina (DESK-87)', () => {
  it('makes one thread per time automation with the described Stan, once, without waking any design; the old store keeps the rest', async () => {
    const fila = createFilaStore();
    const { w, automations, machina, kit } = world(RECORDS, fila);
    const moved = await moveTimeAutomations({ automations, machina });
    expect(moved.map(m => [m.id, m.thread, m.created])).toEqual([
      ['a-1a0000000001', 'MACH-1', true], ['a-000000000002', 'MACH-2', true], ['a-000000000003', 'MACH-3', true], ['a-000000000004', 'MACH-4', true],
      ['a-000000000005', 'MACH-5', true], ['a-000000000006', 'MACH-6', true], ['a-000000000007', 'MACH-7', true], ['a-000000000008', 'MACH-8', true],
    ]);
    const rows = await Promise.all(moved.map(async m => { const k = await kit(m.thread); return [k.title, k.state, k.module, k.tags, k.program === null ? null : k.program.versions[0].reason]; }));
    expect(rows).toEqual([
      ['Zapisy IRONMAN 70.3 Gdynia', 'Wstrzymany', 'Obserwacja', [], null],
      ['Wstrzymany cykl', 'Wstrzymany', 'Obserwacja', [], null],
      ['Herbata', 'Aktywny', 'Przypomnienia', [], 'przeniesienie'],
      ['Wstrzymane przypomnienie', 'Wstrzymany', 'Przypomnienia', [], 'przeniesienie'],
      ['Jednorazowy z kalendarzem', 'Wstrzymany', 'Przypomnienia', [], null],
      ['Zakończony', 'Zakończony', 'Przypomnienia', [], null],
      ['Wygasły', 'Wygasł', 'Obserwacja', [], null],
      ['Anulowany', 'Anulowany', 'Obserwacja', [], null],
    ]);
    // The move wakes nobody: no design turn, no assessment.
    expect([w.wakes, w.turns, w.oldTurns]).toEqual([[], [], []]);
    // Again, and after a restart (a crash between the thread and the old store's mark is the same case): nothing twice.
    expect((await moveTimeAutomations({ automations, machina })).every(m => !m.created)).toBe(true);
    const again = world(RECORDS, fila);
    await again.machina.adopt(await again.automations.list());
    expect((await moveTimeAutomations({ automations: again.automations, machina: again.machina })).filter(m => m.created)).toEqual([]);
    expect((await fila.registries()).projects[0]!.counts).toMatchObject({ open: 5, closed: 3 });
    // The old store keeps every record; the moved ones point at their threads, Cezar and PR do not move.
    const kept = JSON.parse(readFileSync(join(dir, 'automations.json'), 'utf8')).automations;
    expect(kept.map((a: any) => [a.id, a.movedTo ?? null])).toEqual([...moved.map(m => [m.id, m.thread]), ['a-000000000009', null], ['a-00000000000a', null]]);
  });

  it('keeps the old history and notebook with the thread, read-only and outside the new journal; a plain reminder keeps its time, conversation and work', async () => {
    const { w, automations, machina, kit, tick } = world();
    await moveTimeAutomations({ automations, machina });
    const ironman = await kit('MACH-1');
    expect(ironman.journal.runs).toEqual([]);
    expect(ironman.journal.legacy).toMatchObject({ id: 'a-1a0000000001', notebook: IRONMAN.automation.notebook, goal: IRONMAN.automation.goal, status: 'active', actions: ['message', 'calendarEvent', 'smartAction', 'notify'] });
    expect(ironman.journal.legacy.runs).toEqual(IRONMAN.automation.runs.map((r: any) => ({ at: r.at, outcome: r.outcome, summary: r.summary, chatId: r.chatId, ...(r.costUsd !== undefined ? { costUsd: r.costUsd } : {}) })));
    expect(ironman.description).toBe(IRONMAN.automation.goal);
    // The notebook is not material for a program: Wektor's view of a moved automat does not show it.
    const ctx = { views: {}, sources: { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), machina }, now: NOW, cezarUrl: 'x', activeChats: () => [CHAT] };
    const shown = await PANEL_TOOLS.panel_machina.run({ thread: 'MACH-1' }, ctx);
    expect(shown).toContain('bez programu');
    expect(shown).not.toContain('Rejestracja');
    const tea = await kit('MACH-3');
    expect(tea.program).toMatchObject({ nextRunAt: NOW + 3_600_000, chatId: CHAT, versions: [{ by: 'panel', reason: 'przeniesienie', trigger: { kind: 'once', at: NOW + 3_600_000 }, blocks: [{ kind: 'resume', text: 'Przypomnij o herbacie' }] }] });
    // At its time the reminder goes back to its conversation, once, by Machina; the old engine starts nothing.
    w.clock = NOW + 3_600_000 + 1000;
    await tick();
    await tick();
    expect([w.turns, w.oldTurns, (await kit('MACH-3')).state]).toEqual([[{ chat: CHAT, text: 'Przypomnij o herbacie' }], [], 'Zakończony']);
    // Cycles and the one-shot with extra actions do nothing before a new consent, however much time passes.
    w.clock = NOW + 3 * 86_400_000;
    await tick();
    expect([w.calendar, w.ntfy, w.notes, w.wakes, w.oldTurns]).toEqual([[], [], [], [], []]);
    for (const thread of ['MACH-1', 'MACH-2', 'MACH-5']) expect((await kit(thread)).journal.runs).toEqual([]);
    await expect(machina.action({ thread: 'MACH-1', action: 'resume' })).rejects.toThrow(/najpierw karta programu/);
  });

  it('lets Cezar and PR go on in the old store while time is Machina\'s: new time automations and their control go to Machina', async () => {
    const { w, automations, machina } = world();
    await moveTimeAutomations({ automations, machina });
    // Old control of a moved automation points at its thread; a new time automation the old way is refused.
    await expect(automations.update({ id: 'a-000000000003', action: 'pause' })).rejects.toThrow(/MACH-3/);
    await expect(automations.createFromPlan(CHAT, { name: 'Nowy', goal: 'x', trigger: { kind: 'daily', times: ['8:00'] }, actions: [{ kind: 'message' }], learn: false })).rejects.toThrow(/Machinie/);
    await expect(automations.createObserver({ chatId: CHAT, kind: 'time', target: 'za 10 minut', instruction: 'x' })).rejects.toThrow(/Machinie/);
    // Cezar and PR: created, changed and listed as before.
    const pr = await automations.createFromPlan(CHAT, { name: 'PR drugi', goal: 'Daj znać o PR', trigger: { kind: 'pr', url: 'https://github.com/o/r/pull/2' }, actions: [{ kind: 'message' }], learn: false });
    expect((await automations.update({ id: pr.id, action: 'pause' })).status).toBe('paused');
    expect((await automations.update({ id: 'a-000000000009', action: 'pause' })).status).toBe('paused');
    // Wektor's tools: a time observer becomes a Machina reminder of this conversation; a time automation card is refused.
    const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), machina };
    const ctx = { views: {}, sources, now: w.clock, cezarUrl: 'x', automations, activeChats: () => [OTHER] };
    expect(await PANEL_TOOLS.panel_observe.run({ action: 'create', kind: 'time', target: 'za 10 minut', instruction: 'Sprawdź wynik' }, ctx)).toContain('MACH-9');
    expect((await machina.get('MACH-9')).program).toMatchObject({ chatId: OTHER, versions: [{ blocks: [{ kind: 'resume', text: 'Sprawdź wynik' }] }] });
    await expect(PANEL_TOOLS.panel_automation_propose.run({ name: 'Ceny', goal: 'x', trigger: { kind: 'daily', times: ['7:00'] }, actions: [{ kind: 'message' }], learn: false }, ctx)).rejects.toThrow(/panel_machina_propose/);
    expect(await PANEL_TOOLS.panel_automation_propose.run({ name: 'PR', goal: 'x', trigger: { kind: 'pr', url: 'https://github.com/o/r/pull/3' }, actions: [{ kind: 'message' }], learn: false }, ctx)).toContain(CARD_SHOWN.automation);
    // No time is done by both engines: the old one never starts one of them, Machina only the reminders.
    w.clock += 2 * 86_400_000;
    await automations.tick();
    expect(w.oldTurns).toEqual([]);
    expect((await automations.list()).find(a => a.id === 'a-000000000003')!.runs).toEqual([]);
  });
});

describe('IRONMAN: moved, designed on request, run on fakes (DESK-87)', () => {
  /** The moved IRONMAN gets its first program from the card Wektor proposed when the user asked for it, answered in the chat. */
  async function designed() {
    const s = world([IRONMAN.automation]);
    await moveTimeAutomations({ automations: s.automations, machina: s.machina });
    expect((await s.kit('MACH-1')).state).toBe('Wstrzymany');
    const card = { ...IRONMAN.card, automat: 'MACH-1' };
    const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), machina: s.machina };
    expect(await PANEL_TOOLS.panel_machina_propose.run(card, { views: {}, sources, now: NOW, cezarUrl: 'x', activeChats: () => [CHAT] })).toContain(CARD_SHOWN.machina);
    const conversation = { get: async () => ({ id: CHAT, engine: 'hermes', items: [{ id: 'm1', role: 'agent', status: 'done', at: 1, parts: [{ type: 'tool', id: 'm1:m-ironman', name: 'mcp__desk_panel__panel_machina_propose', input: JSON.stringify(card), output: CARD_SHOWN.machina, state: 'done' }] }] }) } as never;
    let body = '';
    const res = { setHeader() {}, writeHead() { return this; }, end(value?: string) { body = value ?? ''; return this; } };
    const req = { method: 'POST', headers: { origin: 'http://panel' }, setEncoding() {}, async *[Symbol.asyncIterator]() { yield JSON.stringify({ toolCallId: 'm1:m-ironman', decision: 'accept' }); } } as never;
    await handleChatRoute(req, res as never, new URL(`http://panel/api/chats/${CHAT}/machina`), 'http://panel', conversation, undefined, undefined, undefined, true, s.machina);
    expect(JSON.parse(body)).toMatchObject({ decision: 'updated', thread: 'MACH-1', version: 1 });
    const k = await s.kit('MACH-1');
    expect([k.state, k.program.versions[0].by, k.program.versions[0].reason, k.journal.legacy.id]).toEqual(['Aktywny', 'user', 'karta programu', 'a-1a0000000001']);
    // The run at 19:00 with a page of the given look; the first look of every situation is Wektor's (a fake verdict).
    const at = async (look: string, iso: string) => { s.w.pages[PAGE] = IRONMAN.pages[look]; s.w.clock = Date.parse(iso); await s.tick(); return (await s.kit('MACH-1')).journal.runs.at(-1); };
    const assess = async (situation: string) => { const wake = s.w.wakes.at(-1)!; await s.machina.assess({ ...verdictOf(wake), situation }); s.machina.turnChanged({ turnId: wake.nonce, ended: true }); await s.machina.idle(); };
    return { ...s, at, assess };
  }

  it('a known situation: no model and no action, Aktywny', async () => {
    const { w, at, assess, kit } = await designed();
    await at('zamkniete', '2026-11-13T19:00:00+01:00');
    await assess('s-zamkniete');
    const run = await at('zamkniete', '2026-11-14T07:00:00+01:00');
    expect([run.state, run.blocks.find((b: any) => b.id === 'cmp').situation, w.wakes.length, w.calendar, w.ntfy, w.notes, (await kit('MACH-1')).state]).toEqual(['ok', 's-zamkniete', 1, [], [], [], 'Aktywny']);
  });

  it('an announced date: calendar and notification, Aktywny', async () => {
    const { w, at, assess, kit } = await designed();
    const run = await at('data', '2026-11-13T19:00:00+01:00');
    await assess('s-data');
    expect(w.calendar).toEqual([{ key: `${run.id}:kal-data`, title: 'IRONMAN: otwarcie zapisów', startAt: Date.parse('2026-12-01T10:00:00+01:00') }]);
    expect(w.ntfy).toEqual([{ title: 'IRONMAN: ogłoszono datę zapisów', body: 'Zapisy ruszą 1 grudnia o 10:00.' }]);
    const k = await kit('MACH-1');
    expect([k.state, k.journal.runs[0].blocks.map((b: any) => [b.id, b.result])]).toEqual(['Aktywny', [['strona', 'ok'], ['status', 'ok'], ['cmp', 'ok'], ['kal-data', 'ok'], ['tel-data', 'ok']]]);
  });

  it('open registration: message, calendar, alert with a link and notification, then Zakończony', async () => {
    const { w, machina, at, assess, kit } = await designed();
    const run = await at('otwarte', '2026-11-13T19:00:00+01:00');
    await assess('s-otwarte');
    const link = 'https://www.ironman.com/im703-gdynia-register/form';
    expect(w.notes).toEqual([{ chat: CHAT, text: `Zapisy na IRONMAN 70.3 Gdynia są otwarte: Zapisy otwarte! [Formularz](${link})` }]);
    expect(w.calendar.map(c => c.title)).toEqual(['IRONMAN: zapisz się']);
    expect(w.ntfy.map(n => n.title)).toEqual(['Zapisy na IRONMAN otwarte']);
    expect((await machina.effects()).filter(e => e.kind === 'smartAction')).toMatchObject([{ thread: 'MACH-1', runId: run.id, title: 'Zapisz się na IRONMAN 70.3 Gdynia', url: link, result: 'ok' }]);
    const k = await kit('MACH-1');
    expect([k.state, k.journal.runs[0].state, k.journal.runs[0].blocks.at(-1)]).toMatchObject(['Zakończony', 'ok', { id: 'koniec', result: 'ok' }]);
  });

  it('an unknown look: a card for the user, Czeka na decyzję', async () => {
    const { w, machina, at, kit } = await designed();
    const run = await at('nieznany', '2026-11-13T19:00:00+01:00');
    const wake = w.wakes.at(-1)!;
    await machina.proposeSituation({ ...verdictOf(wake), name: 'Lista rezerwowa', reaction: [{ id: 'rez', kind: 'notify', title: 'IRONMAN: lista rezerwowa' }] });
    machina.turnChanged({ turnId: wake.nonce, ended: true });
    await machina.idle();
    const k = await kit('MACH-1');
    expect([k.state, k.journal.runs[0].state, k.journal.runs[0].blocks.find((b: any) => b.id === 'cmp').result, run.id, w.ntfy]).toEqual(['Czeka na decyzję', 'waiting', 'waiting', k.journal.runs[0].id, []]);
  });

  it('a missing extract: a repair notice, Czeka na naprawę', async () => {
    const { w, at, kit } = await designed();
    const run = await at('brak', '2026-11-13T19:00:00+01:00');
    expect([run.state, run.error, w.ntfy.map(n => n.title), w.wakes.map(x => x.reason), (await kit('MACH-1')).state])
      .toEqual(['error', 'Brak wycinka: nie znaleziono fragmentu.', ['Automat wymaga naprawy: Zapisy IRONMAN 70.3 Gdynia'], ['naprawa: Zapisy IRONMAN 70.3 Gdynia'], 'Czeka na naprawę']);
  });
});
