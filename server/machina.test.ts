// @vitest-environment node
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { MachinaCard } from '../src/machina-contract';
import { ChatError } from './agent-chat';
import { createPanelServer } from './app';
import { createFilaStore, type FilaStore } from './fila';
import { createMachina, MachinaError, type MachinaOptions } from './machina';
import { createMachinaReader, type MachinaHop } from './machina-fetch';
import { createScenarioSources } from './scenario';

const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-13T12:00:00+01:00');
const CHAT = '11111111-1111-4111-8111-111111111111', OTHER = '22222222-2222-4222-8222-222222222222';
const closers: (() => void)[] = [];
afterEach(() => { for (const c of closers.splice(0)) c(); });

/** Machina over an in-memory Fila with every outside service faked: nothing here reaches a model, Google, ntfy or the network. */
function setup(over: Partial<MachinaOptions> & { fila?: FilaStore } = {}) {
  const world = {
    clock: NOW,
    fila: over.fila ?? createFilaStore(),
    notes: [] as { chat: string; text: string; key: string }[],
    turns: [] as { chat: string; text: string; nonce?: string }[],
    acts: [] as { action: string; key: string; title: string; when?: string; url?: string; text?: string; domain?: string }[],
    pages: {} as Record<string, MachinaHop>,
    hosts: {} as Record<string, string[]>,
    gets: [] as string[],
    chatBusy: false,
    hang: undefined as undefined | Promise<never>,
    /** While set, a page read waits for it (to change the automat in the middle of a run). */
    gate: undefined as undefined | Promise<void>,
    /** Conversations the panel started for Wektor's assessment or repair: the fake Hermes only records them. */
    wakes: [] as { chatId: string; nonce: string; text: string; title?: string; reason: string }[],
    /** What Hermes reported a conversation's turns really cost (missing: no actual cost). */
    costs: {} as Record<string, number[]>,
  };
  const read = createMachinaReader({
    resolve: async host => world.hosts[host] ?? ['93.184.216.34'],
    get: async url => { world.gets.push(url.href); if (world.gate) await world.gate; return world.pages[url.href] ?? { status: 404, body: '' }; },
  });
  const make = (extra: Partial<MachinaOptions> = {}) => createMachina({
    fila: world.fila, now: () => world.clock, log: () => undefined, read,
    chat: {
      note: async (chat, input) => { if (!world.notes.some(n => n.key === input.key)) world.notes.push({ chat, text: input.text, key: input.key }); },
      sendAutomation: async (chat, input) => {
        if (world.chatBusy) throw new ChatError(409, 'Agent jeszcze odpowiada.');
        if (!world.turns.some(t => t.nonce === input.nonce)) world.turns.push({ chat, text: input.text, nonce: input.nonce });
      },
      createAutomation: async input => {
        if (!world.wakes.some(w => w.nonce === input.nonce)) world.wakes.push({ chatId: input.chatId!, nonce: input.nonce!, text: input.text, title: input.title, reason: input.automation.reason });
        return { id: input.chatId! };
      },
      get: async id => ({ id, engine: 'hermes', title: 'x', createdAt: 0, updatedAt: 0, items: (world.costs[id] ?? []).map((usd, i) => ({ id: `m${i}`, role: 'agent', at: i, usage: { costStatus: 'actual', costUsd: usd, input: 1, output: 1, thinking: 0, cached: 0, calls: 1, tools: 0 } })) }) as never,
    },
    executeAction: async (input, approved, key) => {
      world.acts.push({ action: input.action, key, title: input.title, when: input.when, url: input.url, text: input.text, domain: 'domain' in approved ? approved.domain : undefined });
      if (world.hang) await world.hang;
      return input.action === 'calendarEvent' ? `google-${key}` : key;
    },
    ...over, ...extra,
  });
  return { world, make, machina: make() };
}
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(MachinaError);
  expect([error.status, error.message]).toEqual([status, error.message]);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
const reminder = (over: Partial<MachinaCard> = {}): MachinaCard => ({
  title: 'Przypomnij o przeglądzie', description: 'Przypomnij mi o przeglądzie auta', module: 'Przypomnienia', tags: ['auto'],
  trigger: { kind: 'once', at: NOW + 60 * 60_000 }, blocks: [{ id: 'm', kind: 'message', text: 'Przegląd auta jutro o 9:00.' }], ...over,
});
const PAGE = 'https://example.com/zapisy';
const watcher = (over: Partial<MachinaCard> = {}): MachinaCard => ({
  title: 'Zapisy IRONMAN', description: 'Pilnuj otwarcia zapisów', module: 'Obserwacja',
  trigger: { kind: 'daily', times: ['7:00', '19:00'] }, scope: { domains: ['example.com'], resumeChats: [] },
  blocks: [
    { id: 'strona', kind: 'fetch', url: PAGE },
    { id: 'status', kind: 'extract', from: 'strona', after: 'Status:', before: 'Regulamin' },
    { id: 'tel', kind: 'notify', title: 'Zapisy: {{status}}', url: '{{status.link}}', domain: 'example.com' },
    { id: 'kal', kind: 'calendarEvent', title: 'Zapisy IRONMAN', when: '2026-12-01T10:00', text: '{{status}}', reminderMinutes: 30 },
    { id: 'alert', kind: 'smartAction', title: 'Zapisz się', text: '{{status}}', url: '{{strona.url}}', domain: 'example.com' },
    { id: 'wpis', kind: 'message', text: 'Na stronie: {{status}}' },
  ],
  ...over,
});
const HTML = '<html><head><script>ignore()</script></head><body><h1>Status:</h1>\n  <p>Zapisy   otwarte <a href="/formularz">Formularz</a></p><footer>Regulamin</footer></body></html>';
const kit = async (fila: FilaStore, thread: string) => (await (async () => { const view = await fila.machinaKit(thread); return { program: view.program.content as any, journal: view.journal.content as any, conversations: view.conversations.content as any, state: (await fila.thread(thread)).state, closed: (await fila.thread(thread)).closed }; })());

describe('program cards and versions', () => {
  it('makes the thread and the program only on an accepted card; a rejected card changes nothing', async () => {
    const { world, machina } = setup();
    expect(await machina.decideCard(reminder(), { accept: false, chatId: CHAT })).toEqual({ decision: 'rejected' });
    expect((await world.fila.registries()).projects).toEqual([]);
    expect(await machina.decideCard(reminder(), { accept: true, chatId: CHAT })).toEqual({ decision: 'created', thread: 'MACH-1', version: 1 });
    // The thread carries identity, purpose, Moduł, Tagi and Stan; the kit only how it works.
    expect(await world.fila.thread('MACH-1')).toMatchObject({ type: { key: 'automat' }, title: 'Przypomnij o przeglądzie', description: 'Przypomnij mi o przeglądzie auta', module: 'Przypomnienia', fields: { Tagi: ['auto'] }, state: 'Aktywny', createdBy: 'machina' });
    const made = await kit(world.fila, 'MACH-1');
    expect(made.program).toMatchObject({ current: 1, nextRunAt: NOW + 60 * 60_000, chatId: CHAT, versions: [{ number: 1, by: 'user', reason: 'karta programu', trigger: { kind: 'once' }, blocks: [{ id: 'm', kind: 'message' }] }] });
    expect(made.journal).toEqual({ runs: [] });
    expect(made.conversations.items).toEqual([{ chatId: CHAT, reason: 'projektowanie', at: NOW }]);
    // A rejected change of an existing automat leaves its program as it was.
    const before = JSON.stringify(await world.fila.machinaKit('MACH-1'));
    expect(await machina.decideCard(reminder({ automat: 'MACH-1', blocks: [{ id: 'm', kind: 'message', text: 'Inna treść' }] }), { accept: false })).toEqual({ decision: 'rejected', thread: 'MACH-1' });
    expect(JSON.stringify(await world.fila.machinaKit('MACH-1'))).toBe(before);
  });

  it('keeps every version through a change and a restore, and does not restore a version that drops a situation with samples', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    world.clock += 1000;
    expect(await machina.decideCard(reminder({ automat: 'MACH-1', title: undefined, trigger: { kind: 'daily', times: ['8:00'] }, blocks: [{ id: 'm', kind: 'message', text: 'Druga wersja' }, { id: 'k', kind: 'finish' }] }), { accept: true, chatId: OTHER }))
      .toEqual({ decision: 'updated', thread: 'MACH-1', version: 2 });
    let made = await kit(world.fila, 'MACH-1');
    expect(made.program.versions.map((v: any) => [v.number, v.blocks.length, v.trigger.kind])).toEqual([[1, 1, 'once'], [2, 2, 'daily']]);
    expect(made.program).toMatchObject({ current: 2, nextRunAt: at('2026-11-14T08:00:00+01:00') });
    expect(made.conversations.items.map((c: any) => [c.chatId, c.reason])).toEqual([[CHAT, 'projektowanie'], [OTHER, 'zmiana programu']]);
    // The thread's own data are Fila's: a card for an existing automat does not rewrite them.
    expect((await world.fila.thread('MACH-1')).title).toBe('Przypomnij o przeglądzie');
    // A direct restore, without Wektor: a new version with the older blocks and scope; the schedule stays the current one.
    await machina.action({ thread: 'MACH-1', action: 'restore', version: 1 });
    made = await kit(world.fila, 'MACH-1');
    expect(made.program.versions.map((v: any) => [v.number, v.by, v.reason, v.restoredFrom ?? null, v.blocks[0].text, v.trigger.kind])).toEqual([
      [1, 'user', 'karta programu', null, 'Przegląd auta jutro o 9:00.', 'once'], [2, 'user', 'karta programu', null, 'Druga wersja', 'daily'],
      [3, 'user', 'przywrócenie wersji 1', 1, 'Przegląd auta jutro o 9:00.', 'daily'],
    ]);
    expect(made.program.current).toBe(3);
    await refused(machina.action({ thread: 'MACH-1', action: 'restore', version: 3 }), 409, /bieżąca wersja/);
    await refused(machina.action({ thread: 'MACH-1', action: 'restore', version: 9 }), 404);
    // A situation with samples must still be recognised by a restored version (DESK-86): this one has no comparison at all.
    const uid = (await world.fila.thread('MACH-1')).uid;
    await world.fila.machina.update(uid, { kit: { situations: { items: [{ id: 's-zamkniete', name: 'Zamknięte', createdAt: NOW, samples: [{ runId: 'mr-000000000001', at: NOW, text: 'Zapisy zamknięte', links: [] }] }], pending: [] } } });
    await refused(machina.action({ thread: 'MACH-1', action: 'restore', version: 2 }), 409, /próbki/);
    expect((await kit(world.fila, 'MACH-1')).program.versions).toHaveLength(3);
  });

  it('refuses a card that reads outside its approved scope, reads a later block or resumes a conversation it was not given', async () => {
    const { world, machina } = setup();
    const bad: MachinaCard[] = [
      watcher({ scope: { domains: ['inna.pl'], resumeChats: [] } }),
      watcher({ blocks: [{ id: 'strona', kind: 'fetch', url: 'http://example.com/' }] }),
      watcher({ blocks: [{ id: 'strona', kind: 'fetch', url: 'https://127.0.0.1/' }], scope: { domains: ['example.com'], resumeChats: [] } }),
      watcher({ blocks: [{ id: 'status', kind: 'extract', from: 'strona' }, { id: 'strona', kind: 'fetch', url: PAGE }] }),
      watcher({ blocks: [{ id: 'm', kind: 'message', text: '{{status}}' }] }),
      reminder({ blocks: [{ id: 'r', kind: 'resume', text: 'Wróć', chat: OTHER }] }),
      reminder({ blocks: [{ id: 'm', kind: 'message', text: 'a' }, { id: 'm', kind: 'message', text: 'b' }] }),
      reminder({ trigger: { kind: 'cezar', taskId: 'x' } as never }),
      watcher({ blocks: [{ id: 'strona', kind: 'fetch', url: 'nie-adres' }] }),
      // A link without the domain approved for it could never be used: the card says so instead of the run.
      reminder({ blocks: [{ id: 'n', kind: 'notify', title: 'Zobacz', url: 'https://example.com/' }] }),
      reminder({ title: undefined }),
    ];
    for (const card of bad) await refused(machina.decideCard(card, { accept: true, chatId: CHAT }), 400);
    expect((await world.fila.registries()).projects).toEqual([]);
    // The same resume is fine once the card names the conversation.
    expect((await machina.decideCard(reminder({ blocks: [{ id: 'r', kind: 'resume', text: 'Wróć', chat: OTHER }], scope: { domains: [], resumeChats: [OTHER] } }), { accept: true, chatId: CHAT })).decision).toBe('created');
  });
});

describe('the clock, the Stan and the journal', () => {
  it('runs a cycle once per time without a model turn, moves on, and a second tick or a restart adds no run', async () => {
    const { world, make, machina } = setup();
    world.pages[PAGE] = { status: 200, type: 'text/html', body: HTML };
    await machina.decideCard(watcher({ blocks: watcher().blocks.slice(0, 2) }), { accept: true, chatId: CHAT });
    await machina.tick();
    expect((await kit(world.fila, 'MACH-1')).journal.runs).toEqual([]);
    world.clock = at('2026-11-13T19:00:30+01:00');
    await machina.tick();
    await machina.tick();
    await make().tick();
    const first = await kit(world.fila, 'MACH-1');
    expect(first.journal.runs).toHaveLength(1);
    expect(first.journal.runs[0]).toMatchObject({
      slot: at('2026-11-13T19:00:00+01:00'), manual: false, version: 1, state: 'ok', startedAt: world.clock, endedAt: world.clock,
      blocks: [{ id: 'strona', kind: 'fetch', result: 'ok', url: PAGE }, { id: 'status', kind: 'extract', result: 'ok', text: 'Zapisy otwarte [Formularz](https://example.com/formularz)', links: ['https://example.com/formularz'] }],
    });
    expect(first.program.nextRunAt).toBe(at('2026-11-14T07:00:00+01:00'));
    expect(first.state).toBe('Aktywny');
    world.clock = at('2026-11-14T07:05:00+01:00');
    await machina.tick();
    expect((await kit(world.fila, 'MACH-1')).journal.runs.map((r: any) => r.slot)).toEqual([at('2026-11-13T19:00:00+01:00'), at('2026-11-14T07:00:00+01:00')]);
    expect(world.turns).toEqual([]);
    expect(world.gets).toEqual([PAGE, PAGE]);
  });

  it('ends a one-shot after its work as Zakończony, a finishing program as Zakończony and a cycle past its last day as Wygasł', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    await machina.decideCard(reminder({ title: 'Cykl z końcem', trigger: { kind: 'daily', times: ['13:00'] }, blocks: [{ id: 'm', kind: 'message', text: 'Koniec' }, { id: 'k', kind: 'finish' }] }), { accept: true, chatId: CHAT });
    await machina.decideCard(reminder({ title: 'Cykl do dziś', trigger: { kind: 'daily', times: ['13:00'], until: '2026-11-13' } }), { accept: true, chatId: CHAT });
    world.clock = at('2026-11-13T13:00:10+01:00');
    await machina.tick();
    expect(world.notes.map(n => [n.chat, n.text])).toEqual([[CHAT, 'Przegląd auta jutro o 9:00.'], [CHAT, 'Koniec'], [CHAT, 'Przegląd auta jutro o 9:00.']]);
    expect(world.turns).toEqual([]);
    const states = async () => Promise.all(['MACH-1', 'MACH-2', 'MACH-3'].map(async id => { const k = await kit(world.fila, id); return [k.state, k.closed, k.program.nextRunAt, k.journal.runs.length]; }));
    expect(await states()).toEqual([['Zakończony', true, null, 1], ['Zakończony', true, at('2026-11-14T13:00:00+01:00'), 1], ['Wygasł', true, null, 1]]);
    expect((await world.fila.thread('MACH-3')).history.at(-1)).toMatchObject({ by: 'machina', changes: [{ field: 'Stan', from: 'Aktywny', to: 'Wygasł' }] });
    // Closed automats never run again.
    world.clock = at('2026-11-15T13:00:10+01:00');
    await machina.tick();
    expect((await states()).map(s => s[3])).toEqual([1, 1, 1]);
  });

  it('lets the user pause, resume, cancel and run now without a card; a pause comes first and keeps what was pending', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder({ trigger: { kind: 'daily', times: ['13:00'] } }), { accept: true, chatId: CHAT });
    const id = 'MACH-1';
    // Run now: a run of its own that does not move the schedule.
    await machina.action({ thread: id, action: 'runNow' });
    await machina.tick();
    let k = await kit(world.fila, id);
    expect(k.journal.runs.map((r: any) => [r.manual, r.slot, r.state])).toEqual([[true, NOW, 'ok']]);
    expect(k.program.nextRunAt).toBe(at('2026-11-13T13:00:00+01:00'));
    // Paused: the time passes without a run; run now is refused.
    await machina.action({ thread: id, action: 'pause' });
    expect((await kit(world.fila, id)).state).toBe('Wstrzymany');
    world.clock = at('2026-11-13T13:01:00+01:00');
    await machina.tick();
    await refused(machina.action({ thread: id, action: 'runNow' }), 409, /aktywny/);
    expect((await kit(world.fila, id)).journal.runs).toHaveLength(1);
    // A card accepted while paused makes the version and leaves the automat paused.
    await machina.decideCard(reminder({ automat: id, trigger: { kind: 'daily', times: ['14:00'] } }), { accept: true });
    expect((await kit(world.fila, id)).state).toBe('Wstrzymany');
    await machina.action({ thread: id, action: 'resume' });
    k = await kit(world.fila, id);
    expect([k.state, k.program.nextRunAt, k.program.paused]).toEqual(['Aktywny', at('2026-11-13T14:00:00+01:00'), undefined]);
    world.clock = at('2026-11-13T14:00:05+01:00');
    await machina.tick();
    expect((await kit(world.fila, id)).journal.runs.map((r: any) => [r.manual, r.version])).toEqual([[true, 1], [false, 2]]);
    await machina.action({ thread: id, action: 'cancel' });
    k = await kit(world.fila, id);
    expect([k.state, k.closed, k.program.nextRunAt]).toEqual(['Anulowany', true, null]);
    for (const action of ['pause', 'resume', 'cancel', 'runNow'] as const) await refused(machina.action({ thread: id, action }), 409);
    world.clock = at('2026-11-14T14:00:05+01:00');
    await machina.tick();
    expect((await kit(world.fila, id)).journal.runs).toHaveLength(2);
    expect((await world.fila.thread(id)).history.filter(h => h.changes?.[0]?.field === 'Stan').map(h => [h.by, h.changes![0]!.to])).toEqual([['machina', 'Wstrzymany'], ['machina', 'Aktywny'], ['machina', 'Anulowany']]);
  });

  it('treats „uruchom teraz” as the one run of a one-shot: it ends there and does not do its work again at its time', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    await machina.action({ thread: 'MACH-1', action: 'runNow' });
    await machina.tick();
    let k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.program.nextRunAt, k.journal.runs.map((r: any) => r.manual)]).toEqual(['Zakończony', null, [true]]);
    world.clock = NOW + 2 * 60 * 60_000;
    await machina.tick();
    k = await kit(world.fila, 'MACH-1');
    expect(k.journal.runs).toHaveLength(1);
    expect(world.notes).toHaveLength(1);
  });

  it('keeps the Stan a run ended in while the automat is paused, and gives it back on resume', async () => {
    const { world, make } = setup();
    let release!: () => void;
    const slow = make({ executeAction: async (_input, _approved, key) => { await new Promise<void>(resolve => { release = resolve; }); return key; } });
    await slow.decideCard(reminder({ blocks: [{ id: 'n', kind: 'notify', title: 'Już czas' }] }), { accept: true, chatId: CHAT });
    world.clock = NOW + 61 * 60_000;
    const ticking = slow.tick();
    await expect.poll(() => typeof release).toBe('function');
    await slow.action({ thread: 'MACH-1', action: 'pause' });
    release();
    await ticking;
    let k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.program.paused, k.journal.runs[0].state]).toEqual(['Wstrzymany', { from: 'Zakończony' }, 'ok']);
    await slow.action({ thread: 'MACH-1', action: 'resume' });
    k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.closed]).toEqual(['Zakończony', true]);
  });
});

describe('effects of blocks', () => {
  it('does the approved effects from what the page gave, once: a later tick and a restart repeat nothing', async () => {
    const { world, make, machina } = setup();
    world.pages[PAGE] = { status: 200, type: 'text/html; charset=utf-8', body: HTML };
    await machina.decideCard(watcher(), { accept: true, chatId: CHAT });
    world.clock = at('2026-11-13T19:00:00+01:00');
    await machina.tick();
    const run = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    const status = 'Zapisy otwarte [Formularz](https://example.com/formularz)';
    expect(world.acts).toEqual([
      { action: 'notify', key: `${run.id}:tel`, title: `Zapisy: ${status}`, when: undefined, url: 'https://example.com/formularz', text: undefined, domain: 'example.com' },
      { action: 'calendarEvent', key: `${run.id}:kal`, title: 'Zapisy IRONMAN', when: '2026-12-01T10:00', url: undefined, text: status, domain: undefined },
      { action: 'smartAction', key: `${run.id}:alert`, title: 'Zapisz się', when: undefined, url: PAGE, text: status, domain: 'example.com' },
    ]);
    expect(world.notes).toEqual([{ chat: CHAT, text: `Na stronie: ${status}`, key: `${run.id}:wpis` }]);
    expect(world.turns).toEqual([]);
    expect(run.blocks.map((b: any) => [b.id, b.result, b.ref ?? null])).toEqual([
      ['strona', 'ok', null], ['status', 'ok', null], ['tel', 'ok', `${run.id}:tel`], ['kal', 'ok', `google-${run.id}:kal`], ['alert', 'ok', `${run.id}:alert`], ['wpis', 'ok', CHAT],
    ]);
    expect(run.state).toBe('ok');
    // The alerts and the bell read the settled effects; a cancelled automat's alert is marked gone.
    expect(await machina.effects()).toMatchObject([
      { thread: 'MACH-1', name: 'Zapisy IRONMAN', cancelled: false, runId: run.id, block: 'tel', kind: 'notify', result: 'ok', url: 'https://example.com/formularz' },
      { thread: 'MACH-1', runId: run.id, block: 'alert', kind: 'smartAction', result: 'ok', ref: `${run.id}:alert`, title: 'Zapisz się', url: PAGE },
    ]);
    await machina.tick();
    await make().tick();
    expect(world.acts).toHaveLength(3);
    expect(world.notes).toHaveLength(1);
    expect((await kit(world.fila, 'MACH-1')).journal.runs).toHaveLength(1);
  });

  it('after a crash mid-run sends no reserved notification again, repeats only what its key makes safe, and finishes the same run', async () => {
    const { world, make, machina } = setup();
    world.pages[PAGE] = { status: 200, type: 'text/html', body: HTML };
    await machina.decideCard(watcher(), { accept: true, chatId: CHAT });
    world.clock = at('2026-11-13T19:00:00+01:00');
    // The first process dies inside the phone notification: it never comes back.
    world.hang = new Promise<never>(() => undefined);
    void machina.tick();
    await expect.poll(() => world.acts.length).toBe(1);
    const reserved = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    expect(reserved.blocks.at(-1)).toMatchObject({ id: 'tel', result: 'pending' });
    expect(reserved.state).toBe('running');
    world.hang = undefined;
    world.clock += 90_000;
    const restarted = make();
    await restarted.tick();
    await restarted.tick();
    const run = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    expect((await kit(world.fila, 'MACH-1')).journal.runs).toHaveLength(1);
    expect(run.id).toBe(reserved.id);
    expect(run.blocks.map((b: any) => [b.id, b.result])).toEqual([['strona', 'ok'], ['status', 'ok'], ['tel', 'error'], ['kal', 'ok'], ['alert', 'ok'], ['wpis', 'ok']]);
    expect(run.blocks.find((b: any) => b.id === 'tel').error).toMatch(/niepotwierdzony/);
    expect(run.state).toBe('error');
    expect(world.acts.map(a => a.action)).toEqual(['notify', 'calendarEvent', 'smartAction']);
    expect(world.notes).toHaveLength(1);
  });

  it('repeats a reserved effect after a crash with exactly what was reserved, even when the page has changed since', async () => {
    const { world, make, machina } = setup();
    world.pages[PAGE] = { status: 200, type: 'text/html', body: HTML };
    await machina.decideCard(watcher({ blocks: [...watcher().blocks.slice(0, 2), { id: 'kal', kind: 'calendarEvent', title: 'Zapisy: {{status}}', when: '2026-12-01T10:00', text: '{{status}}', url: '{{status.link}}', domain: 'example.com' }] }), { accept: true, chatId: CHAT });
    world.clock = at('2026-11-13T19:00:00+01:00');
    // Google took the event, then the process died before the result was written down.
    world.hang = new Promise<never>(() => undefined);
    void machina.tick();
    await expect.poll(() => world.acts.length).toBe(1);
    const status = 'Zapisy otwarte [Formularz](https://example.com/formularz)';
    expect((await kit(world.fila, 'MACH-1')).journal.runs[0].blocks.at(-1)).toMatchObject({ id: 'kal', result: 'pending', title: `Zapisy: ${status}`, text: status, url: 'https://example.com/formularz', when: '2026-12-01T10:00' });
    world.hang = undefined;
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Status: Zapisy zamknięte <a href="/inne">Inne</a> Regulamin</p>' };
    world.clock += 120_000;
    await make().tick();
    expect(world.acts).toHaveLength(2);
    expect(world.acts[1]).toEqual(world.acts[0]);
    const run = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    expect([run.state, run.blocks.find((b: any) => b.id === 'kal')]).toMatchObject(['ok', { result: 'ok', text: status, url: 'https://example.com/formularz' }]);
  });

  it('ends a read that leaves the approved scope, also through a redirect or a private address, with no effect at all', async () => {
    const { world, machina } = setup();
    await machina.decideCard(watcher(), { accept: true, chatId: CHAT });
    const cases: [string, () => void, RegExp][] = [
      ['a redirect out of the scope', () => { world.pages[PAGE] = { status: 302, location: 'https://evil.test/zapisy', body: '' }; world.pages['https://evil.test/zapisy'] = { status: 200, type: 'text/html', body: HTML }; }, /poza zatwierdzonym zakresem/],
      ['a redirect to plain http', () => { world.pages[PAGE] = { status: 301, location: 'http://example.com/zapisy', body: '' }; }, /https/],
      ['a name that resolves to loopback', () => { world.pages[PAGE] = { status: 200, type: 'text/html', body: HTML }; world.hosts['example.com'] = ['127.0.0.1']; }, /nie jest publiczny/],
      ['a redirect inside the scope to a private address', () => { world.hosts = { 'intra.example.com': ['93.184.216.34', '10.0.0.8'] }; world.pages[PAGE] = { status: 307, location: 'https://intra.example.com/', body: '' }; }, /nie jest publiczny/],
      // A missing fragment is no read error since DESK-86: it asks for a repair (see „a missing fragment …” below).
    ];
    let day = 13;
    for (const [name, arrange, message] of cases) {
      arrange();
      world.clock = at(`2026-11-${day++}T19:00:00+01:00`);
      await machina.tick();
      const run = (await kit(world.fila, 'MACH-1')).journal.runs.at(-1);
      expect([name, run.state, run.error], name).toEqual([name, 'error', expect.stringMatching(message)]);
      expect(run.blocks.filter((b: any) => !['strona', 'status'].includes(b.id)).map((b: any) => b.result), name).toEqual(['skipped', 'skipped', 'skipped', 'skipped']);
      world.clock = at(`2026-11-${day - 1}T19:30:00+01:00`);
    }
    expect(world.gets).not.toContain('https://evil.test/zapisy');
    expect(world.gets).not.toContain('https://intra.example.com/');
    expect(world.acts).toEqual([]);
    expect(world.notes).toEqual([]);
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Aktywny');
  });

  it('keeps an action link on the action\'s own approved domain; a link outside it fails that action only', async () => {
    const { world, machina } = setup();
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Status: <a href="https://tracker.test/x">Zapisy</a> Regulamin</p>' };
    await machina.decideCard(watcher(), { accept: true, chatId: CHAT });
    world.clock = at('2026-11-13T19:00:00+01:00');
    await machina.tick();
    const run = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    expect(run.blocks.map((b: any) => [b.id, b.result])).toEqual([['strona', 'ok'], ['status', 'ok'], ['tel', 'error'], ['kal', 'ok'], ['alert', 'ok'], ['wpis', 'ok']]);
    expect(run.blocks.find((b: any) => b.id === 'tel').error).toMatch(/poza zatwierdzoną domeną/);
    expect(world.acts.map(a => a.action)).toEqual(['calendarEvent', 'smartAction']);
  });

  it('starts a turn only for an explicit resume, in the approved conversation, and waits for a busy one with the same key', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder({ blocks: [{ id: 'r', kind: 'resume', text: 'Wróć do planu treningu' }] }), { accept: true, chatId: CHAT });
    world.clock = NOW + 60 * 60_000;
    world.chatBusy = true;
    await machina.tick();
    let k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs[0].state, k.journal.runs[0].blocks[0].result, k.state]).toEqual(['running', 'waiting', 'Aktywny']);
    world.chatBusy = false;
    world.clock += 60_000;
    await machina.tick();
    await machina.tick();
    k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs.length, k.journal.runs[0].state, k.journal.runs[0].blocks[0].result, k.state]).toEqual([1, 'ok', 'ok', 'Zakończony']);
    expect(world.turns).toEqual([{ chat: CHAT, text: 'Wróć do planu treningu', nonce: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);
    expect(world.notes).toEqual([]);
  });

  it('lets Wektor make without a card only a one-shot that writes to, or resumes, the conversation it is in', async () => {
    const { world, machina } = setup();
    expect(await machina.createReminder({ chatId: CHAT, title: 'Za godzinę: herbata', at: NOW + 60_000, kind: 'message', text: 'Herbata!' })).toEqual({ thread: 'MACH-1' });
    await machina.createReminder({ chatId: CHAT, title: 'Wróć do rozmowy', at: NOW + 60_000, kind: 'resume', text: 'Sprawdź wynik' });
    expect((await kit(world.fila, 'MACH-1')).program.versions[0]).toMatchObject({ by: 'wektor', reason: 'bez karty', trigger: { kind: 'once', at: NOW + 60_000 }, blocks: [{ kind: 'message', text: 'Herbata!' }], scope: { domains: [], resumeChats: [] } });
    expect(await world.fila.thread('MACH-1')).toMatchObject({ module: 'Przypomnienia', state: 'Aktywny' });
    world.clock = NOW + 61_000;
    await machina.tick();
    expect(world.notes.map(n => [n.chat, n.text])).toEqual([[CHAT, 'Herbata!']]);
    expect(world.turns.map(t => [t.chat, t.text])).toEqual([[CHAT, 'Sprawdź wynik']]);
    expect(world.acts).toEqual([]);
  });
});

describe('switches and the shared run slot', () => {
  it('with automations off or Fila not active starts nothing and refuses to create, change or run; pause and cancel still work', async () => {
    const fila = createFilaStore();
    const on = setup({ fila });
    await on.machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    for (const over of [{ enabled: false }, { filaActive: () => false }]) {
      const { world, machina } = setup({ fila, ...over });
      world.clock = NOW + 2 * 60 * 60_000;
      await machina.tick();
      expect((await kit(fila, 'MACH-1')).journal.runs).toEqual([]);
      expect(world.notes).toEqual([]);
      await refused(machina.decideCard(reminder({ title: 'Nowy' }), { accept: true, chatId: CHAT }), 409);
      await refused(machina.createReminder({ chatId: CHAT, title: 'x', at: NOW, kind: 'message', text: 'x' }), 409);
      await refused(machina.action({ thread: 'MACH-1', action: 'runNow' }), 409);
      expect(await machina.decideCard(reminder({ title: 'Nowy' }), { accept: false })).toEqual({ decision: 'rejected' });
    }
    expect((await fila.registries()).projects[0]!.counts).toEqual({ open: 1, closed: 0, archived: 0 });
    const off = setup({ fila, enabled: false }).machina;
    await off.action({ thread: 'MACH-1', action: 'pause' });
    await off.action({ thread: 'MACH-1', action: 'cancel' });
    expect((await kit(fila, 'MACH-1')).state).toBe('Anulowany');
  });

  it('waits while an old automation holds the one run slot, and says when it runs itself', async () => {
    let busy = true;
    const { world, machina } = setup({ busy: () => busy });
    await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    world.clock = NOW + 61 * 60_000;
    expect(machina.running()).toBe(false);
    await machina.tick();
    expect(world.notes).toEqual([]);
    expect((await kit(world.fila, 'MACH-1')).journal.runs).toEqual([]);
    busy = false;
    await machina.tick();
    expect(world.notes).toHaveLength(1);
    expect((await kit(world.fila, 'MACH-1')).journal.runs[0]).toMatchObject({ slot: NOW + 60 * 60_000, state: 'ok' });
  });

  it('holds the run slot while a turn started by a resume block is going: no second turn and no old automation until it ends', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder({ title: 'Pierwsza', blocks: [{ id: 'r', kind: 'resume', text: 'Pierwsza rozmowa' }] }), { accept: true, chatId: CHAT });
    await machina.decideCard(reminder({ title: 'Druga', blocks: [{ id: 'r', kind: 'resume', text: 'Druga rozmowa' }] }), { accept: true, chatId: OTHER });
    await machina.decideCard(reminder({ title: 'Trzecia', blocks: [{ id: 'r', kind: 'resume', text: 'Trzecia rozmowa' }] }), { accept: true, chatId: OTHER });
    world.clock = NOW + 61 * 60_000;
    await machina.tick();
    await machina.tick();
    // The first turn runs on its own after the block is done; the slot is still taken.
    expect(world.turns.map(t => t.text)).toEqual(['Pierwsza rozmowa']);
    expect(machina.running()).toBe(true);
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Zakończony');
    expect((await kit(world.fila, 'MACH-2')).journal.runs).toEqual([]);
    // Another turn's end changes nothing; this turn's end frees the slot and the next run starts.
    machina.turnChanged({ turnId: '99999999-9999-4999-8999-999999999999', ended: true });
    machina.turnChanged({ turnId: world.turns[0]!.nonce!, ended: false });
    expect(machina.running()).toBe(true);
    machina.turnChanged({ turnId: world.turns[0]!.nonce!, ended: true });
    await expect.poll(() => world.turns.length).toBe(2);
    await machina.tick();
    expect(world.turns.map(t => t.text)).toEqual(['Pierwsza rozmowa', 'Druga rozmowa']);
    // A turn whose end never arrives gives the slot up after the old automations' 15 minutes.
    world.clock += 15 * 60_000 + 1;
    expect(machina.running()).toBe(false);
    await machina.tick();
    expect(world.turns.map(t => t.text)).toEqual(['Pierwsza rozmowa', 'Druga rozmowa', 'Trzecia rozmowa']);
  });

  it('runs nothing when the store cannot be written: the run is reserved on disk before any effect', async () => {
    const { world, machina } = setup();
    await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
    const update = world.fila.machina.update;
    world.fila.machina.update = () => Promise.reject(new Error('Nie można bezpiecznie zastąpić pliku Fili.'));
    world.clock = NOW + 61 * 60_000;
    await machina.tick();
    expect(world.notes).toEqual([]);
    world.fila.machina.update = update;
    await machina.tick();
    expect(world.notes).toHaveLength(1);
  });
});

it('takes the direct actions only from the panel\'s own page, and answers a refusal with its reason', async () => {
  const fila = createFilaStore();
  const { machina } = setup({ fila });
  await machina.decideCard(reminder(), { accept: true, chatId: CHAT });
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila, machinaAction: machina.action };
  const server = createPanelServer(sources, process.cwd()).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, origin?: string) => fetch(`${base}/api/machina/action`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } });
  expect((await post({ thread: 'MACH-1', action: 'pause' })).status).toBe(403);
  expect((await post({ thread: 'MACH-1', action: 'pause' }, 'https://evil.test')).status).toBe(403);
  expect((await fila.thread('MACH-1')).state).toBe('Aktywny');
  const paused = await post({ thread: 'MACH-1', action: 'pause' }, base);
  expect([paused.status, (await paused.json()).state]).toEqual([200, 'Wstrzymany']);
  expect((await post({ thread: 'MACH-1', action: 'restore' }, base)).status).toBe(400);
  expect((await post({ thread: 'MACH-1', action: 'pause', state: 'Aktywny' }, base)).status).toBe(400);
  const missing = await post({ thread: 'MACH-9', action: 'pause' }, base);
  expect([missing.status, (await missing.json()).error]).toEqual([404, 'Nie ma wątku MACH-9.']);
  const stale = await post({ thread: 'MACH-1', action: 'restore', version: 1 }, base);
  expect([stale.status, (await stale.json()).error]).toEqual([409, 'To jest bieżąca wersja programu.']);
  // The kit is read through Fila, by the thread's ID.
  expect((await (await fetch(`${base}/api/fila/threads/MACH-1/machina`)).json()).program.content.versions).toHaveLength(1);
});

// DESK-86: situations, Wektor's assessment and repair. Hermes is a fake that records the conversations the panel starts;
// Wektor's verdicts are given the way its tools give them (machina.assess / proposeSituation with the turn's token).
const statusPage = (status: string): MachinaHop => ({ status: 200, type: 'text/html', body: `<p>Status: ${status} Regulamin</p>` });
const SITUATION_BLOCKS: MachinaCard['blocks'] = [
  { id: 'strona', kind: 'fetch', url: PAGE },
  { id: 'status', kind: 'extract', from: 'strona', after: 'Status:', before: 'Regulamin' },
  { id: 'cmp', kind: 'compare', from: 'status' },
];
const OPEN_REACTION: MachinaCard['blocks'] = [{ id: 'tel', kind: 'notify', title: 'Zapisy otwarte', text: '{{status}}' }, { id: 'koniec', kind: 'finish' }];
/** A watcher that compares its extract with the catalogue; two situations are predicted on its card. */
const comparer = (over: Partial<MachinaCard> = {}): MachinaCard => watcher({
  blocks: SITUATION_BLOCKS,
  reactions: { 's-zamkniete': [{ id: 'wpis', kind: 'message', text: 'Nadal: {{status}}' }], 's-otwarte': OPEN_REACTION },
  situations: [{ id: 's-zamkniete', name: 'Zapisy zamknięte' }, { id: 's-otwarte', name: 'Zapisy otwarte' }],
  ...over,
});
const change = (over: Partial<MachinaCard> = {}) => comparer({ automat: 'MACH-1', title: undefined, ...over });
/** The times of the watcher (7:00 and 19:00), from the evening of the 13th on. */
const TIMES = Array.from({ length: 40 }, (_, i) => at(`2026-11-${String(13 + Math.floor((i + 1) / 2)).padStart(2, '0')}T${i % 2 ? '07' : '19'}:00:00+01:00`));
const verdictOf = (wake: { text: string }) => ({ runId: /runId: "(mr-[0-9a-f]{12})"/.exec(wake.text)![1]!, token: /token: "([0-9a-f]{32})"/.exec(wake.text)![1]! });
function situations(world: { fila: FilaStore }) { return world.fila.machinaKit('MACH-1').then(view => view.situations.content as any); }

function stage(over: Partial<MachinaOptions> = {}) {
  const s = setup(over);
  let next = 0;
  /** The clock moves to the next time and the panel does what it does then (and what that started in the background). */
  const runNext = async () => { s.world.clock = TIMES[next++]!; await s.machina.tick(); await s.machina.idle(); return (await kit(s.world.fila, 'MACH-1')).journal.runs.at(-1); };
  /** Hermes says the last turn the panel started has ended. */
  const endTurn = async () => { s.machina.turnChanged({ turnId: s.world.wakes.at(-1)!.nonce, ended: true }); await s.machina.idle(); };
  return { ...s, runNext, endTurn };
}

describe('situations, assessment and repair (DESK-86)', () => {
  it('handles a known extract without a model, does a known situation\'s reaction for a new look of it, and does a new situation\'s reaction in its own run only after a yes', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    // Nothing is known yet: Wektor assesses the extract in a conversation of its own and the run waits for the verdict.
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    let run = await runNext();
    expect([run.state, world.wakes.length]).toEqual(['evaluating', 1]);
    expect(world.wakes[0]!.text).toContain('Zapisy zamknięte');
    expect(world.wakes[0]!.text).toContain('s-zamkniete');
    await machina.assess({ ...verdictOf(world.wakes[0]!), situation: 's-zamkniete' });
    await endTurn();
    run = (await kit(world.fila, 'MACH-1')).journal.runs[0];
    expect([run.state, run.blocks.find((b: any) => b.id === 'cmp')]).toMatchObject(['ok', { result: 'ok', situation: 's-zamkniete' }]);
    expect(world.notes.map(n => n.text)).toEqual(['Nadal: Zapisy zamknięte']);
    // The same extract, spaced differently, is known now: its reaction without a model.
    world.pages[PAGE] = statusPage('Zapisy    zamknięte');
    run = await runNext();
    expect([run.state, run.blocks.find((b: any) => b.id === 'cmp').situation, world.wakes.length]).toEqual(['ok', 's-zamkniete', 1]);
    expect(world.notes.map(n => n.text)).toEqual(['Nadal: Zapisy zamknięte', 'Nadal: Zapisy zamknięte']);
    // A new look that Wektor assigns to a known situation: no card, the known reaction in that run.
    world.pages[PAGE] = statusPage('Zapisy jeszcze nie ruszyły');
    await runNext();
    expect(world.wakes).toHaveLength(2);
    await machina.assess({ ...verdictOf(world.wakes[1]!), situation: 's-zamkniete' });
    await endTurn();
    expect(world.notes.at(-1)!.text).toBe('Nadal: Zapisy jeszcze nie ruszyły');
    expect((await situations(world)).items[0].samples.map((s: any) => s.text)).toEqual(['Zapisy zamknięte', 'Zapisy jeszcze nie ruszyły']);
    // A new situation: a card, and nothing happens until the user says yes.
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    await runNext();
    const card = await machina.proposeSituation({ ...verdictOf(world.wakes[2]!), name: 'Lista rezerwowa', reaction: [{ id: 'rez', kind: 'notify', title: 'Lista rezerwowa: {{status}}' }] });
    await endTurn();
    let k = await kit(world.fila, 'MACH-1');
    const waiting = k.journal.runs[3];
    expect([waiting.state, waiting.blocks.find((b: any) => b.id === 'cmp')]).toMatchObject(['waiting', { result: 'waiting', card: card.card }]);
    expect([k.state, world.acts, machina.running()]).toEqual(['Czeka na decyzję', [], false]);
    expect(await machina.decideSituation(waiting.id, true)).toEqual({ decision: 'accepted', thread: 'MACH-1', situation: 's-lista-rezerwowa' });
    expect(world.acts).toMatchObject([{ action: 'notify', key: `${waiting.id}:rez`, title: 'Lista rezerwowa: Lista rezerwowa otwarta' }]);
    k = await kit(world.fila, 'MACH-1');
    // The decision and the reaction are later entries of the same run; the reaction joined the program by the same yes.
    expect(k.journal.runs).toHaveLength(4);
    expect([k.journal.runs[3].state, k.journal.runs[3].blocks.map((b: any) => [b.id, b.result, b.situation ?? null])]).toEqual(['ok', [['strona', 'ok', null], ['status', 'ok', null], ['cmp', 'ok', 's-lista-rezerwowa'], ['rez', 'ok', null]]]);
    expect([k.state, k.program.current, k.program.versions[1].reason, Object.keys(k.program.versions[1].reactions)]).toEqual(['Aktywny', 2, 'nowa sytuacja: Lista rezerwowa', ['s-zamkniete', 's-otwarte', 's-lista-rezerwowa']]);
    // Known from now on: the next time does it without asking anyone.
    run = await runNext();
    expect([run.blocks.find((b: any) => b.id === 'cmp').situation, world.wakes.length, world.acts.map(a => a.key)]).toEqual(['s-lista-rezerwowa', 3, [`${waiting.id}:rez`, `${run.id}:rez`]]);
    // A plain run and a panel entry never start a turn.
    expect(world.turns).toEqual([]);
  });

  it('lets later times run while a card waits: the same extract joins the card, another one is assessed; a failed assessment does nothing and the next time assesses again', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    const first = await runNext();
    const card = await machina.proposeSituation({ ...verdictOf(world.wakes[0]!), name: 'Lista rezerwowa', reaction: [{ id: 'rez', kind: 'notify', title: 'Lista rezerwowa' }] });
    await endTurn();
    world.pages[PAGE] = statusPage('Lista   rezerwowa otwarta');
    const joined = await runNext();
    expect([joined.state, joined.blocks.find((b: any) => b.id === 'cmp').card, world.wakes.length]).toEqual(['ok', card.card, 1]);
    expect((await situations(world)).pending[0].runs).toEqual([first.id, joined.id]);
    // Another extract wakes a new assessment; its turn ends without a verdict: an assessment error, no effect.
    world.pages[PAGE] = statusPage('Zapisy otwarte');
    const failed = await runNext();
    expect([failed.state, world.wakes.length]).toEqual(['evaluating', 2]);
    await refused(machina.assess({ runId: failed.id, token: '0'.repeat(32), situation: 's-otwarte' }), 403);
    await endTurn();
    let k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs[2].state, k.journal.runs[2].error]).toEqual(['error', 'Błąd oceny: tura zakończyła się bez werdyktu.']);
    expect([world.acts, world.notes, k.state]).toEqual([[], [], 'Czeka na decyzję']);
    // A verdict after its turn ended is refused too, and the next time assesses the same extract again.
    await refused(machina.assess({ ...verdictOf(world.wakes[1]!), situation: 's-otwarte' }), 403);
    await runNext();
    expect(world.wakes).toHaveLength(3);
    await machina.assess({ ...verdictOf(world.wakes[2]!), situation: 's-zamkniete' });
    await endTurn();
    expect(world.notes.map(n => n.text)).toEqual(['Nadal: Zapisy otwarte']);
    // The waiting card's yes does its reaction once, in the run it came from; the joined run gets none.
    await machina.decideSituation(first.id, true);
    expect(world.acts.map(a => a.key)).toEqual([`${first.id}:rez`]);
    k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.journal.runs[1].blocks.map((b: any) => b.id)]).toEqual(['Aktywny', ['strona', 'status', 'cmp']]);
  });

  it('a missing fragment notifies the user and skips the times until the repair card is answered; a pause comes first and keeps the card', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Strona w przebudowie</p>' };
    const broken = await runNext();
    expect([broken.state, broken.error]).toEqual(['error', 'Brak wycinka: nie znaleziono fragmentu.']);
    expect(broken.blocks.map((b: any) => [b.id, b.result])).toEqual([['strona', 'ok'], ['status', 'error'], ['naprawa', 'ok']]);
    expect(world.acts).toMatchObject([{ action: 'notify', key: `${broken.id}:naprawa`, title: 'Automat wymaga naprawy: Zapisy IRONMAN' }]);
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Czeka na naprawę');
    // Wektor is asked once, in a conversation of the run, with the page and the program to repair.
    expect(world.wakes.map(w => w.reason)).toEqual(['naprawa: Zapisy IRONMAN']);
    expect(world.wakes[0]!.text).toContain('Strona w przebudowie');
    expect(world.wakes[0]!.text).toContain('panel_machina_propose');
    await endTurn();
    // The times pass with no run, no read and no new turn.
    await runNext();
    await runNext();
    expect([(await kit(world.fila, 'MACH-1')).journal.runs.length, world.gets.length, world.wakes.length, world.acts.length]).toEqual([1, 1, 1, 1]);
    // A pause comes first; resumed with the card still open, it waits for the repair again.
    await machina.action({ thread: 'MACH-1', action: 'pause' });
    expect((await kit(world.fila, 'MACH-1')).program.paused).toEqual({ from: 'Czeka na naprawę' });
    await machina.action({ thread: 'MACH-1', action: 'resume' });
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Czeka na naprawę');
    // The repair accepted while paused makes the version and leaves the automat paused, now to go back to work.
    await machina.action({ thread: 'MACH-1', action: 'pause' });
    const repaired = change({ blocks: [SITUATION_BLOCKS[0]!, { id: 'status', kind: 'extract', from: 'strona', after: 'Stan:', before: 'Koniec' }, SITUATION_BLOCKS[2]!] });
    expect(await machina.decideCard(repaired, { accept: true, chatId: world.wakes[0]!.chatId })).toEqual({ decision: 'updated', thread: 'MACH-1', version: 2 });
    let k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.program.paused, k.program.versions[1].reason]).toEqual(['Wstrzymany', { from: 'Aktywny' }, 'karta naprawy']);
    await machina.action({ thread: 'MACH-1', action: 'resume' });
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Stan: Zapisy zamknięte Koniec</p>' };
    const fixed = await runNext();
    expect([fixed.version, fixed.state, world.wakes.length]).toEqual([2, 'evaluating', 2]);
    k = await kit(world.fila, 'MACH-1');
    expect(k.conversations.items.filter((c: any) => c.reason === 'naprawa').map((c: any) => [c.chatId, c.runId])).toEqual([[world.wakes[0]!.chatId, broken.id]]);
  });

  it('keeps a sample with its situation through versions: a contradicting change or restore is refused, a program card changes the reaction, a correction card moves the sample and a withdrawn situation never matches', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    // A predicted situation gets its first sample from Wektor's assessment.
    expect((await situations(world)).items.map((s: any) => [s.id, s.samples.length])).toEqual([['s-zamkniete', 0], ['s-otwarte', 0]]);
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    const r0 = await runNext();
    await machina.assess({ ...verdictOf(world.wakes[0]!), situation: 's-zamkniete' });
    await endTurn();
    world.pages[PAGE] = statusPage('Zapisy nadal zamknięte');
    const r1 = await runNext();
    await machina.assess({ ...verdictOf(world.wakes[1]!), situation: 's-zamkniete' });
    await endTurn();
    expect((await situations(world)).items[0].samples.map((s: any) => s.runId)).toEqual([r0.id, r1.id]);
    // A version that no longer recognises the situation of a sample, or claims a sample for another situation, is refused.
    await refused(machina.decideCard(change({ reactions: { 's-otwarte': OPEN_REACTION } }), { accept: true }), 409, /Sprzeczność z próbkami.*s-zamkniete/);
    await refused(machina.checkCard(change({ situations: [{ id: 's-otwarte', name: 'Zapisy otwarte', samples: ['Zapisy zamknięte'] }] })), 409, /należy do sytuacji/);
    expect((await kit(world.fila, 'MACH-1')).program.versions).toHaveLength(1);
    // A program card changes the reaction of a situation with samples.
    await machina.decideCard(change({ reactions: { 's-zamkniete': [{ id: 'wpis2', kind: 'message', text: 'Bez zmian: {{status}}' }], 's-otwarte': OPEN_REACTION }, situations: [{ id: 's-czekam', name: 'Bez reakcji na razie' }] }), { accept: true });
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    await runNext();
    expect(world.notes.at(-1)!.text).toBe('Bez zmian: Zapisy zamknięte');
    // A new situation joins as version 3; restoring a version without it (it has a sample now) is refused.
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    const r3 = await runNext();
    await machina.proposeSituation({ ...verdictOf(world.wakes[2]!), name: 'Lista rezerwowa', reaction: [] });
    await endTurn();
    await machina.decideSituation(r3.id, true);
    await refused(machina.action({ thread: 'MACH-1', action: 'restore', version: 2 }), 409, /s-lista-rezerwowa.*ma próbki/);
    await refused(machina.action({ thread: 'MACH-1', action: 'restore', version: 1 }), 409, /próbki/);
    expect((await kit(world.fila, 'MACH-1')).program.versions).toHaveLength(3);
    // The correction card: checked first, applied only on the user's yes.
    const correction = { automat: 'MACH-1', from: 's-zamkniete', runId: r0.id, to: 's-otwarte', withdraw: true };
    expect(await machina.correction(correction, 'check')).toEqual({ decision: 'checked', thread: 'MACH-1' });
    await refused(machina.correction({ ...correction, to: 's-nieznana' }, 'check'), 404);
    // A sample goes only to a situation the program in force reacts to.
    await refused(machina.correction({ ...correction, to: 's-czekam' }, 'check'), 409, /najpierw karta programu/);
    expect((await situations(world)).items[0].samples).toHaveLength(2);
    expect(await machina.correction(correction, { accept: true })).toEqual({ decision: 'applied', thread: 'MACH-1' });
    const catalogue = (await situations(world)).items;
    expect(catalogue.map((s: any) => [s.id, s.samples.map((x: any) => x.runId), !!s.withdrawn])).toEqual([['s-zamkniete', [r1.id], true], ['s-otwarte', [r0.id], false], ['s-czekam', [], false], ['s-lista-rezerwowa', [r3.id], false]]);
    // The withdrawn situation's remaining sample matches nothing any more: Wektor is asked, and may not pick it.
    world.pages[PAGE] = statusPage('Zapisy nadal zamknięte');
    await runNext();
    expect(world.wakes).toHaveLength(4);
    await refused(machina.assess({ ...verdictOf(world.wakes[3]!), situation: 's-zamkniete' }), 404, /wycofana/);
    await endTurn();
    // The moved sample is the other situation's now: its reaction, which ends the automat.
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    const moved = await runNext();
    expect([moved.blocks.find((b: any) => b.id === 'cmp').situation, world.acts.map(a => a.title)]).toEqual(['s-otwarte', ['Zapisy otwarte']]);
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Zakończony');
  });

  it('answers a rejected card the way the user decided: a new situation gives no action and may be assessed again, a correction changes nothing, a repair pauses; no card expires', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    const r0 = await runNext();
    await machina.proposeSituation({ ...verdictOf(world.wakes[0]!), name: 'Lista rezerwowa', reaction: [{ id: 'rez', kind: 'notify', title: 'Lista' }] });
    await endTurn();
    expect(await machina.decideSituation(r0.id, false)).toEqual({ decision: 'rejected', thread: 'MACH-1' });
    let k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.program.versions.length, world.acts, k.journal.runs[0].state, k.journal.runs[0].blocks.find((b: any) => b.id === 'cmp').result]).toEqual(['Aktywny', 1, [], 'ok', 'skipped']);
    expect((await situations(world))).toMatchObject({ pending: [], items: [{ id: 's-zamkniete' }, { id: 's-otwarte' }] });
    await refused(machina.decideSituation(r0.id, true), 404);
    // The next time may assess the same extract again; this card is left waiting for a month: it does not expire.
    const r1 = await runNext();
    expect(world.wakes).toHaveLength(2);
    await machina.proposeSituation({ ...verdictOf(world.wakes[1]!), name: 'Lista rezerwowa', reaction: [] });
    await endTurn();
    world.clock += 30 * 24 * 60 * 60_000;
    await machina.tick();
    await machina.idle();
    k = await kit(world.fila, 'MACH-1');
    expect([k.state, (await situations(world)).pending.map((c: any) => c.runId)]).toEqual(['Czeka na decyzję', [r1.id]]);
    await machina.decideSituation(r1.id, true);
    // A rejected correction leaves the kit as it was.
    const before = JSON.stringify(await world.fila.machinaKit('MACH-1'));
    expect(await machina.correction({ automat: 'MACH-1', from: 's-lista-rezerwowa', runId: r1.id, to: 's-zamkniete' }, { accept: false })).toEqual({ decision: 'rejected', thread: 'MACH-1' });
    expect(JSON.stringify(await world.fila.machinaKit('MACH-1'))).toBe(before);
    // A rejected repair pauses the automat; resumed, it goes back to work (no card waits any more).
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Strona w przebudowie</p>' };
    world.clock = at('2026-12-20T19:00:00+01:00');
    await machina.tick();
    await machina.idle();
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Czeka na naprawę');
    await endTurn();
    expect(await machina.decideCard(change(), { accept: false })).toEqual({ decision: 'rejected', thread: 'MACH-1' });
    k = await kit(world.fila, 'MACH-1');
    expect([k.state, k.program.paused, k.program.versions.length]).toEqual(['Wstrzymany', { from: 'Aktywny' }, 2]);
    await machina.action({ thread: 'MACH-1', action: 'resume' });
    expect((await kit(world.fila, 'MACH-1')).state).toBe('Aktywny');
  });

  it('keeps one conversation per event with its reason and run, and sums what Hermes really charged without counting a conversation twice', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.costs[CHAT] = [0.03, 0.02];
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    const run = await runNext();
    const wake = world.wakes[0]!;
    expect([wake.reason, wake.title]).toEqual(['ocena: Zapisy IRONMAN', 'Automat · Zapisy IRONMAN · ocena']);
    world.costs[wake.chatId] = [0.02];
    await machina.assess({ ...verdictOf(wake), situation: 's-zamkniete' });
    await endTurn();
    let k = await kit(world.fila, 'MACH-1');
    // The assessment's cost is in its run; the run and its conversation point at each other.
    expect([k.journal.runs[0].chatId, k.journal.runs[0].costUsd]).toEqual([wake.chatId, 0.02]);
    expect(k.conversations.items.map((c: any) => [c.chatId, c.reason, c.runId ?? null])).toEqual([[CHAT, 'projektowanie', null], [wake.chatId, 'ocena', run.id]]);
    // The cockpit of a conversation: its automat, why, the program in force and the last run.
    expect(await machina.conversation(wake.chatId)).toMatchObject({ thread: 'MACH-1', title: 'Zapisy IRONMAN', reason: 'ocena', runId: run.id, version: 1, blocks: [{ id: 'strona' }, { id: 'status' }, { id: 'cmp' }], lastRun: { id: run.id, state: 'ok' } });
    expect(await machina.conversation(OTHER)).toBeNull();
    // A change made in the design conversation adds no second entry; one made elsewhere has no real cost: unknown, not zero.
    await machina.decideCard(change({ trigger: { kind: 'daily', times: ['8:00'] } }), { accept: true, chatId: CHAT });
    await machina.decideCard(change({ trigger: { kind: 'daily', times: ['9:00'] } }), { accept: true, chatId: OTHER });
    const cost = await machina.cost('MACH-1');
    expect(cost.usd).toBeCloseTo(0.07, 10);
    expect([cost.unknown, cost.conversations.map(c => [c.reason, c.usd])]).toEqual([1, [['projektowanie', 0.05], ['ocena', 0.02], ['zmiana programu', null]]]);
    k = await kit(world.fila, 'MACH-1');
    expect(k.conversations.items.map((c: any) => c.reason)).toEqual(['projektowanie', 'ocena', 'zmiana programu']);
    expect(world.turns).toEqual([]);
  });
});

describe('DESK-86 review: continuation, once-only effects, the run slot and stopped automats', () => {
  it('goes on with a decided reaction stopped by a busy conversation using the program in force, without reading or assessing again', async () => {
    const { world, machina, runNext, endTurn } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    const run = await runNext();
    await machina.proposeSituation({ ...verdictOf(world.wakes[0]!), name: 'Lista rezerwowa', reaction: [{ id: 'powrot', kind: 'resume', text: 'Lista: {{status}}' }] });
    await endTurn();
    world.chatBusy = true;
    await machina.decideSituation(run.id, true);
    let k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs[0].state, k.journal.runs[0].blocks.at(-1)]).toMatchObject(['running', { id: 'powrot', result: 'waiting' }]);
    // The version the run was made with has no reaction for the new situation; the one in force has.
    expect([k.journal.runs[0].version, k.program.current]).toEqual([1, 2]);
    world.chatBusy = false;
    world.pages[PAGE] = statusPage('Zupełnie inna treść');
    world.clock += 60_000;
    await machina.tick();
    await machina.idle();
    k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs.length, k.journal.runs[0].state, world.turns.map(t => t.text), world.gets.length, world.wakes.length]).toEqual([1, 'ok', ['Lista: Lista rezerwowa otwarta'], 1, 1]);
  });

  it('waits for the one run slot before a decided reaction, whoever holds it', async () => {
    let busy = false;
    const { world, machina, runNext, endTurn } = stage({ busy: () => busy });
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = statusPage('Lista rezerwowa otwarta');
    const run = await runNext();
    await machina.proposeSituation({ ...verdictOf(world.wakes[0]!), name: 'Lista rezerwowa', reaction: [{ id: 'rez', kind: 'notify', title: 'Lista' }] });
    await endTurn();
    busy = true;
    await machina.decideSituation(run.id, true);
    expect(world.acts).toEqual([]);
    busy = false;
    await machina.tick();
    expect(world.acts.map(a => a.key)).toEqual([`${run.id}:rez`]);
  });

  it('ends an assessment whose turn outlives its 15 minutes as an assessment error, and its token dies with it', async () => {
    const { world, machina, runNext } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = statusPage('Zapisy zamknięte');
    const run = await runNext();
    world.clock += 15 * 60_000 + 1;
    await machina.tick();
    await machina.idle();
    const k = await kit(world.fila, 'MACH-1');
    expect([k.journal.runs[0].state, k.journal.runs[0].error]).toEqual(['error', 'Błąd oceny: tura nie skończyła się w 15 minut.']);
    await refused(machina.assess({ ...verdictOf(world.wakes[0]!), situation: 's-zamkniete' }), 403);
    expect([world.notes, run.id]).toEqual([[], k.journal.runs[0].id]);
  });

  it('sends the repair notice at most once, also when the process dies inside it', async () => {
    const { world, make, machina, runNext } = stage();
    await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
    world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Strona w przebudowie</p>' };
    world.hang = new Promise<never>(() => undefined);
    void runNext();
    await expect.poll(() => world.acts.length).toBe(1);
    world.hang = undefined;
    world.clock += 90_000;
    const restarted = make();
    await restarted.tick();
    await restarted.idle();
    const k = await kit(world.fila, 'MACH-1');
    expect([world.acts.length, k.journal.runs.length, k.state]).toEqual([1, 1, 'Czeka na naprawę']);
    expect(k.journal.runs[0].blocks.find((b: any) => b.id === 'naprawa')).toMatchObject({ result: 'error', error: expect.stringMatching(/niepotwierdzony/) });
  });

  it('neither notifies nor wakes Wektor for an automat cancelled or paused while its page was read', async () => {
    for (const action of ['cancel', 'pause'] as const) {
      const { world, machina, runNext } = stage();
      await machina.decideCard(comparer(), { accept: true, chatId: CHAT });
      for (const body of ['<p>Strona w przebudowie</p>', '<p>Status: Coś nowego Regulamin</p>']) {
        let open!: () => void;
        world.gate = new Promise<void>(resolve => { open = resolve; });
        world.pages[PAGE] = { status: 200, type: 'text/html', body };
        const running = runNext();
        await expect.poll(() => world.gets.length).toBeGreaterThan(0);
        await machina.action({ thread: 'MACH-1', action });
        open();
        await running;
        world.gate = undefined;
        world.gets = [];
        if (action === 'pause') await machina.action({ thread: 'MACH-1', action: 'resume' });
        if (action === 'cancel') break;
      }
      expect([action, world.acts, world.wakes]).toEqual([action, [], []]);
    }
  });

  it('applies a chat card once even when it is answered again after a crash between the two stores', async () => {
    const { world, machina } = setup();
    const key = `${CHAT}:m1:m-0123456789abcdef`;
    expect(await machina.decideCard(reminder(), { accept: true, chatId: CHAT, key })).toEqual({ decision: 'created', thread: 'MACH-1', version: 1 });
    expect(await machina.decideCard(reminder(), { accept: true, chatId: CHAT, key })).toEqual({ decision: 'created', thread: 'MACH-1', version: 1 });
    const change = `${CHAT}:m2:m-fedcba9876543210`;
    expect(await machina.decideCard(reminder({ automat: 'MACH-1', blocks: [{ id: 'm', kind: 'message', text: 'Druga' }] }), { accept: true, key: change })).toEqual({ decision: 'updated', thread: 'MACH-1', version: 2 });
    expect(await machina.decideCard(reminder({ automat: 'MACH-1', blocks: [{ id: 'm', kind: 'message', text: 'Druga' }] }), { accept: true, key: change })).toEqual({ decision: 'updated', thread: 'MACH-1', version: 2 });
    expect([(await world.fila.registries()).projects[0]!.counts.open, (await kit(world.fila, 'MACH-1')).program.versions.length]).toEqual([1, 2]);
  });

  it('refuses a program that acts before its comparison, and a reaction that would need a whole page later', async () => {
    const { machina } = setup();
    await refused(machina.checkCard(comparer({ blocks: [SITUATION_BLOCKS[0]!, SITUATION_BLOCKS[1]!, { id: 'n', kind: 'notify', title: 'Za wcześnie' }, SITUATION_BLOCKS[2]!] })), 400, /reads only/);
    await refused(machina.checkCard(comparer({ reactions: { 's-zamkniete': [{ id: 'w', kind: 'message', text: '{{strona}}' }], 's-otwarte': [] } })), 400, /address of a page/);
    await machina.checkCard(comparer({ reactions: { 's-zamkniete': [{ id: 'w', kind: 'message', text: 'Zobacz {{strona.url}}: {{status}}' }], 's-otwarte': [] } }));
  });
});
