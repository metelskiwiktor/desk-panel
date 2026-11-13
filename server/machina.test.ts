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
  };
  const read = createMachinaReader({
    resolve: async host => world.hosts[host] ?? ['93.184.216.34'],
    get: async url => { world.gets.push(url.href); return world.pages[url.href] ?? { status: 404, body: '' }; },
  });
  const make = (extra: Partial<MachinaOptions> = {}) => createMachina({
    fila: world.fila, now: () => world.clock, log: () => undefined, read,
    chat: {
      note: async (chat, input) => { if (!world.notes.some(n => n.key === input.key)) world.notes.push({ chat, text: input.text, key: input.key }); },
      sendAutomation: async (chat, input) => {
        if (world.chatBusy) throw new ChatError(409, 'Agent jeszcze odpowiada.');
        if (!world.turns.some(t => t.nonce === input.nonce)) world.turns.push({ chat, text: input.text, nonce: input.nonce });
      },
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
    expect(await machina.decideCard(reminder({ automat: 'MACH-1', blocks: [{ id: 'm', kind: 'message', text: 'Inna treść' }] }), { accept: false })).toEqual({ decision: 'rejected' });
    expect(JSON.stringify(await world.fila.machinaKit('MACH-1'))).toBe(before);
  });

  it('keeps every version through a change and a restore, and does not restore a program that has samples', async () => {
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
    // With samples in the catalogue the restore waits for the samples check of stage 1b.2.
    const uid = (await world.fila.thread('MACH-1')).uid;
    await world.fila.machina.update(uid, { kit: { situations: { items: [{ id: 's1', name: 'Zamknięte', samples: [{ runId: 'mr-000000000001', text: 'Zapisy zamknięte' }] }] } } });
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

  it('ends a read that leaves the approved scope, also through a redirect or a private address, with no effect at all', async () => {
    const { world, machina } = setup();
    await machina.decideCard(watcher(), { accept: true, chatId: CHAT });
    const cases: [string, () => void, RegExp][] = [
      ['a redirect out of the scope', () => { world.pages[PAGE] = { status: 302, location: 'https://evil.test/zapisy', body: '' }; world.pages['https://evil.test/zapisy'] = { status: 200, type: 'text/html', body: HTML }; }, /poza zatwierdzonym zakresem/],
      ['a redirect to plain http', () => { world.pages[PAGE] = { status: 301, location: 'http://example.com/zapisy', body: '' }; }, /https/],
      ['a name that resolves to loopback', () => { world.pages[PAGE] = { status: 200, type: 'text/html', body: HTML }; world.hosts['example.com'] = ['127.0.0.1']; }, /nie jest publiczny/],
      ['a redirect inside the scope to a private address', () => { world.hosts = { 'intra.example.com': ['93.184.216.34', '10.0.0.8'] }; world.pages[PAGE] = { status: 307, location: 'https://intra.example.com/', body: '' }; }, /nie jest publiczny/],
      ['the fragment is missing', () => { world.hosts = {}; world.pages[PAGE] = { status: 200, type: 'text/html', body: '<p>Strona w przebudowie</p>' }; }, /Brak wycinka/],
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
