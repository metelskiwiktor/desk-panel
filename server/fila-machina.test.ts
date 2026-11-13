// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FILA_AUTOMAT_WORKFLOW, FILA_MACHINA_PROJECT, type FilaAction, type FilaActor } from '../src/fila-contract';
import { createPanelServer } from './app';
import { createFilaStore, FilaError, type FilaStore } from './fila';
import { filaTokens } from './fila-routes';
import { createScenarioSources } from './scenario';

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => { for (const c of closers.splice(0)) c(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fila-machina-')); dirs.push(d); return d; };

const act = (store: FilaStore, action: FilaAction, actor: FilaActor = 'claude-code') => store.apply(action, actor);
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
const STATES = ['Czeka na kartę programu', 'Aktywny', 'Czeka na decyzję', 'Czeka na naprawę', 'Wstrzymany', 'Zakończony', 'Wygasł', 'Anulowany'];
const MODULES = ['Obserwacja', 'Obsługa', 'Przypomnienia', 'Systemowe'];

describe('the home of Machina: preparation on first use', () => {
  it('prepares MACH, its modules, the workflow and a starter board once; a repeat and a restart duplicate nothing', async () => {
    const file = join(tmp(), 'fila.json');
    const store = createFilaStore({ file });
    expect((await store.registries()).projects).toEqual([]);
    expect((await store.registries()).workflows.map(w => w.id)).toEqual(['w-praca']);
    const first = await store.machina.create({ title: 'Pilnuj ceny', description: 'Cel: cena poniżej 100 zł', module: 'Obserwacja', tags: ['ceny', 'ceny'] });
    expect(first).toMatchObject({ id: 'MACH-1', state: 'Czeka na kartę programu', closed: false, builtIn: false, program: null, situations: null, journal: null, conversations: null });
    const second = await store.machina.create({ title: 'Drugi', state: 'Aktywny' });
    expect(second).toMatchObject({ id: 'MACH-2', state: 'Aktywny' });
    const check = async (s: FilaStore) => {
      const reg = await s.registries();
      expect(reg.projects.map(p => [p.key, p.name, p.modules])).toEqual([['MACH', 'Machina', MODULES]]);
      expect(reg.projects[0]!.board).toMatch(/^b-/);
      expect(reg.boards).toHaveLength(1);
      const workflow = reg.workflows.filter(w => w.name === 'Automat');
      expect(workflow).toHaveLength(1);
      expect(workflow[0]).toMatchObject({ id: 'w-automat' });
      expect(workflow[0]!.states.map(s => s.name)).toEqual(STATES);
      expect(workflow[0]!.states.filter(s => s.closing).map(s => s.name)).toEqual(['Zakończony', 'Wygasł', 'Anulowany']);
      expect(reg.types.find(t => t.key === 'automat')).toEqual({ key: 'automat', label: 'Automat', workflow: 'w-automat', fields: ['Tagi'], spec: false, cezar: false, machina: true });
    };
    await check(store);
    // The thread is the source of identity, title, purpose, module and tags; the author is Machina.
    expect(await store.thread('MACH-1')).toMatchObject({
      uid: first.uid, type: { key: 'automat' }, workflow: { id: 'w-automat', name: 'Automat' }, title: 'Pilnuj ceny', description: 'Cel: cena poniżej 100 zł',
      module: 'Obserwacja', fields: { Tagi: ['ceny'] }, createdBy: 'machina', spec: { enabled: false }, cezar: { enabled: false },
      machina: { builtIn: false, parts: { program: false, situations: false, journal: false, conversations: false } },
    });
    const reopened = createFilaStore({ file });
    await check(reopened);
    expect((await reopened.machina.create({ title: 'Po restarcie' })).id).toBe('MACH-3');
    await check(reopened);
  });

  it('uses a configuration that is there and fits, and fills in only what is missing', async () => {
    const store = createFilaStore();
    await act(store, { action: 'createProject', key: 'MACH', name: 'Machina' }, 'user');
    await act(store, { action: 'setModules', project: 'MACH', modules: [...MODULES, 'Własny'] });
    await act(store, { action: 'createThread', project: 'MACH', type: 'notatka', title: 'Zwykła notatka' });
    expect((await store.machina.create({ title: 'Automat', module: 'Własny' })).id).toBe('MACH-2');
    const reg = await store.registries();
    expect(reg.projects).toHaveLength(1);
    expect(reg.projects[0]!.modules).toEqual([...MODULES, 'Własny']);
    expect(reg.boards).toHaveLength(1);
    // The modules Machina needs stay in MACH.
    await refused(act(store, { action: 'setModules', project: 'MACH', modules: ['Własny'] }), 409, /moduły Machiny/);
  });

  it('refuses a collision and a locked store without changing the data', async () => {
    const dir = tmp();
    // A project MACH that is not Machina's.
    const other = join(dir, 'other.json');
    const taken = createFilaStore({ file: other });
    await act(taken, { action: 'createProject', key: 'MACH', name: 'Machiny rolnicze' }, 'user');
    let before = readFileSync(other, 'utf8');
    await refused(taken.machina.create({ title: 'x' }), 409, /Kolizja: projekt MACH/);
    expect(readFileSync(other, 'utf8')).toBe(before);
    expect((await taken.registries()).workflows.map(w => w.name)).toEqual(['Praca']);
    // MACH named Machina but without the modules.
    const bare = createFilaStore();
    await act(bare, { action: 'createProject', key: 'MACH', name: 'Machina' }, 'user');
    await refused(bare.machina.create({ title: 'x' }), 409, /Kolizja/);
    expect((await bare.registries()).projects[0]!.modules).toEqual([]);
    // A stored workflow Automat that differs (only a file edited by hand can hold one).
    const edited = join(dir, 'edited.json');
    const seed = createFilaStore({ file: edited });
    await seed.machina.create({ title: 'x' });
    const raw = JSON.parse(readFileSync(edited, 'utf8'));
    raw.data.threads = [];
    raw.data.workflows.find((w: { id: string }) => w.id === 'w-automat').states.pop();
    writeFileSync(edited, JSON.stringify(raw));
    before = readFileSync(edited, 'utf8');
    await refused(createFilaStore({ file: edited }).machina.create({ title: 'x' }), 409, /Kolizja: w Fili jest inny workflow/);
    expect(readFileSync(edited, 'utf8')).toBe(before);
    // The public actions cannot make that collision: the name is Machina's.
    await refused(act(createFilaStore(), { action: 'createWorkflow', name: 'automat', states: [{ name: 'A', closing: false }] }), 409, /należy do Machiny/);
    // A locked (read-only) store: the door refuses and the file stays byte for byte.
    const lockedFile = join(dir, 'locked.json');
    const open = createFilaStore({ file: lockedFile });
    await act(open, { action: 'createProject', key: 'DESK', name: 'DeskPanel' }, 'user');
    before = readFileSync(lockedFile, 'utf8');
    const locked = createFilaStore({ file: lockedFile, readOnly: true });
    await refused(locked.machina.create({ title: 'x' }), 503, /zapis zablokowany/);
    expect(readFileSync(lockedFile, 'utf8')).toBe(before);
    expect((await locked.registries()).projects.map(p => p.key)).toEqual(['DESK']);
  });
});

it('gives MACH a board whose list is the Fila query for automats: threads of that type only, by the usual rules of archive and closing states', async () => {
  const store = createFilaStore();
  const a = await store.machina.create({ title: 'Aktywny', state: 'Aktywny' });
  const b = await store.machina.create({ title: 'Zakończony', state: 'Zakończony' });
  const c = await store.machina.create({ title: 'W archiwum', state: 'Anulowany' });
  await act(store, { action: 'createThread', project: 'MACH', type: 'sprawa', title: 'Zwykła sprawa w MACH' });
  await act(store, { action: 'archiveThread', thread: c.id });
  const reg = await store.registries();
  const board = await store.board(reg.projects[0]!.board!);
  expect(board.views[0]!.sections.map(s => [s.name, s.kind, s.query])).toEqual([['Automaty', 'list', 'projekt = MACH AND typ = automat']]);
  expect(board.history[0]).toMatchObject({ by: 'panel', kind: 'created' });
  const view = await store.boardView(board.id, board.views[0]!.id);
  expect(view.sections[0]!.threads.map(t => [t.id, t.type.key, t.closed])).toEqual([[a.id, 'automat', false], [b.id, 'automat', true]]);
  const ids = async (q: string) => (await store.query(q)).threads.map(t => t.id);
  expect(await ids('projekt = MACH')).toEqual(['MACH-1', 'MACH-2', 'MACH-4']);
  expect(await ids('projekt = MACH AND typ = automat AND otwarte')).toEqual(['MACH-1']);
  expect(await ids('projekt = MACH AND typ = automat AND zamknięte')).toEqual(['MACH-2']);
  expect(await ids('projekt = MACH AND typ = automat AND archiwum = tylko')).toEqual(['MACH-3']);
  expect(await ids('projekt = MACH AND typ = automat AND stan = "Aktywny"')).toEqual(['MACH-1']);
  // A MACH that was there before Machina keeps the board it had.
  const own = createFilaStore();
  await act(own, { action: 'createProject', key: 'MACH', name: 'Machina' }, 'user');
  await act(own, { action: 'setModules', project: 'MACH', modules: ['Obserwacja', 'Obsługa', 'Przypomnienia', 'Systemowe'] });
  await own.machina.create({ title: 'x' });
  const kept = await own.board((await own.registries()).projects[0]!.board!);
  expect(kept.views[0]!.sections.map(s => s.query)).toEqual(['projekt = MACH']);
});

describe('the internal door: Stan, kit, archive and delete', () => {
  it('writes the Stan it is given with the right closed flag, a history entry by machina and one write for Stan and kit', async () => {
    const store = createFilaStore();
    const { uid } = await store.machina.create({ title: 'Automat' });
    for (const state of STATES) {
      const after = await store.machina.update(uid, { state });
      expect(after.state).toBe(state);
      expect(after.closed).toBe(['Zakończony', 'Wygasł', 'Anulowany'].includes(state));
      expect((await store.thread('MACH-1')).closed).toBe(after.closed);
    }
    const thread = await store.thread('MACH-1');
    expect(thread.history.at(-1)).toEqual({ at: expect.any(Number), by: 'machina', kind: 'changed', changes: [{ field: 'Stan', from: 'Wygasł', to: 'Anulowany' }] });
    // The same Stan again writes no history; a Stan outside the workflow and an unknown uid are refused.
    const revision = thread.revision;
    await store.machina.update(uid, { state: 'Anulowany' });
    expect((await store.thread('MACH-1')).revision).toBe(revision);
    await refused(store.machina.update(uid, { state: 'W realizacji' }), 409, /nie ma Stanu/);
    // A refused Stan takes back the kit parts of the same change.
    await refused(store.machina.update(uid, { state: 'Nie ma takiego', kit: { program: { lost: true } } }), 409);
    expect((await store.machina.read(uid))!.program).toBeNull();
    // A part is plain JSON, kept exactly as the file keeps it, and never shares the caller's object.
    for (const bad of [{ n: Number.NaN }, { at: new Date(0) }, { f: () => 1 }, [undefined]]) await refused(store.machina.update(uid, { kit: { program: bad as never } }), 400);
    await refused(store.machina.create({ title: 'x', kit: { journal: { n: Number.POSITIVE_INFINITY } } }), 400);
    const shared = { version: 1, steps: [{ kind: 'a' }] };
    const made = await store.machina.create({ title: 'Kopia', kit: { program: shared } });
    await store.machina.update(uid, { kit: { situations: shared } });
    shared.version = 2; shared.steps[0]!.kind = 'b';
    expect((await store.machina.read(made.uid))!.program).toEqual({ version: 1, steps: [{ kind: 'a' }] });
    expect((await store.machina.read(uid))!.situations).toEqual({ version: 1, steps: [{ kind: 'a' }] });
    await store.machina.update(uid, { kit: { situations: null } });
    await refused(store.machina.update('f-00000000', { state: 'Aktywny' }), 404);
    await refused(store.machina.update(uid, {} as never), 400);
    // A kit write alone changes neither the thread's revision nor its history; a part left out stays.
    await store.machina.update(uid, { kit: { program: { version: 1 }, journal: [{ at: 1 }] } });
    await store.machina.update(uid, { state: 'Aktywny', kit: { journal: [{ at: 1 }, { at: 2 }] } });
    expect(await store.machina.read(uid)).toMatchObject({ id: 'MACH-1', state: 'Aktywny', closed: false, program: { version: 1 }, situations: null, journal: [{ at: 1 }, { at: 2 }], conversations: null });
    expect((await store.thread('MACH-1')).revision).toBe(revision + 1);
    expect(await store.machina.read('f-00000000')).toBeNull();
  });

  it('archives only a closed automat, deletes the kit with the thread and never deletes a built-in one', async () => {
    const file = join(tmp(), 'fila.json');
    const store = createFilaStore({ file });
    const plain = await store.machina.create({ title: 'Zwykły', state: 'Aktywny', kit: { program: { secret: 'kit-content' } } });
    const builtIn = await store.machina.create({ title: 'Wbudowany', state: 'Aktywny', builtIn: true, module: 'Systemowe' });
    await refused(act(store, { action: 'archiveThread', thread: plain.id }), 409, /tylko zamknięty automat/);
    await refused(act(store, { action: 'archiveThread', thread: plain.id }, 'user'), 409);
    expect((await store.thread(plain.id)).archived).toBe(false);
    await store.machina.update(plain.uid, { state: 'Zakończony' });
    await store.machina.update(builtIn.uid, { state: 'Anulowany' });
    await act(store, { action: 'archiveThread', thread: plain.id });
    await act(store, { action: 'archiveThread', thread: builtIn.id }, 'user');
    await act(store, { action: 'restoreThread', thread: plain.id });
    await act(store, { action: 'archiveThread', thread: plain.id });
    // Only the user deletes; the built-in one stays, whatever its editable Moduł says.
    await refused(act(store, { action: 'deleteThread', thread: plain.id }), 403);
    await act(store, { action: 'updateThread', thread: builtIn.id, module: 'Obsługa' });
    await refused(act(store, { action: 'deleteThread', thread: builtIn.id }, 'user'), 409, /Wbudowanego/);
    expect((await store.thread(builtIn.id)).machina).toMatchObject({ builtIn: true });
    expect(readFileSync(file, 'utf8')).toContain('kit-content');
    await act(store, { action: 'deleteThread', thread: plain.id }, 'user');
    await refused(store.thread(plain.id), 404);
    await refused(store.machinaKit(plain.id), 404);
    expect(await store.machina.read(plain.uid)).toBeNull();
    expect(readFileSync(file, 'utf8')).not.toContain('kit-content');
    await refused(store.machina.update(plain.uid, { state: 'Aktywny' }), 404);
  });
});

/** The real store on its own file in a temporary directory, behind the real server: nothing here touches the service's data. */
async function serve() {
  const dir = tmp();
  const tokens = filaTokens(join(dir, 'home'));
  const file = join(dir, 'fila.json');
  const fila = createFilaStore({ file });
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila };
  const server = createPanelServer(sources, process.cwd(), undefined, undefined, { filaTokens: tokens }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, who: 'user' | 'ai') => fetch(`${base}/api/fila/action`, {
    method: 'POST', body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json', ...(who === 'user' ? { Origin: base } : { Authorization: `Bearer ${tokens['claude-code']}` }) },
  });
  const get = async (path: string) => { const response = await fetch(`${base}${path}`); return { status: response.status, body: await response.json() }; };
  const mcp = async (name: string, args: unknown) => {
    const response = await fetch(`${base}/api/fila/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.codex}` },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
    const result = (await response.json() as { result: { isError?: boolean; content: { text: string }[] } }).result;
    return { isError: !!result.isError, text: result.content[0]!.text };
  };
  return { base, file, fila, post, get, mcp };
}

describe('the public doors (HTTP and MCP) on an automat', () => {
  it('refuse to create an automat, to write its Stan, kit or workflow, to move it out of MACH, and write nothing', async () => {
    const s = await serve();
    const automat = await s.fila.machina.create({ title: 'Pilnuj ceny', state: 'Aktywny', module: 'Obserwacja', kit: { program: { version: 1 } } });
    await s.fila.apply({ action: 'createProject', key: 'DESK', name: 'DeskPanel' }, 'user');
    await s.fila.apply({ action: 'createThread', project: 'MACH', type: 'sprawa', title: 'Zwykła sprawa w MACH' }, 'user');
    const before = readFileSync(s.file, 'utf8');
    const id = automat.id;
    const refusals: [unknown, number][] = [
      [{ action: 'createThread', project: 'MACH', type: 'automat', title: 'Podrobiony' }, 403],
      [{ action: 'updateThread', thread: id, state: 'Wstrzymany' }, 403],
      [{ action: 'updateThread', thread: id, state: 'Zakończony' }, 403],
      [{ action: 'updateThread', thread: id, workflow: 'w-praca', state: 'Pomysł' }, 403],
      [{ action: 'updateThread', thread: id, project: 'DESK', module: null }, 409],
      // The workflow Automat is fixed and no other type gets it.
      [{ action: 'updateWorkflow', workflow: 'w-automat', states: [{ name: 'Aktywny', closing: true }] }, 403],
      [{ action: 'updateWorkflow', workflow: 'w-automat', name: 'Inny' }, 403],
      [{ action: 'updateThread', thread: 'MACH-2', workflow: 'w-automat', state: 'Aktywny' }, 409],
      // The kit is not an action field and the Stan is not a custom field.
      [{ action: 'updateThread', thread: id, machina: { builtIn: true } }, 400],
      [{ action: 'updateThread', thread: id, title: 'x', kit: { program: null } }, 400],
      [{ action: 'setField', thread: id, field: 'Stan', value: 'Zakończony', kind: 'text' }, 400],
      [{ action: 'setField', thread: id, field: 'Workflow', value: 'w-praca', kind: 'text' }, 400],
      [{ action: 'archiveThread', thread: id }, 409],
    ];
    for (const [body, status] of refusals) {
      for (const who of ['user', 'ai'] as const) {
        // Workflow definitions are the AI's alone; the user's refusal comes from that older rule.
        const expected = who === 'user' && (body as { action: string }).action === 'updateWorkflow' ? 403 : status;
        expect([(body as { action: string }).action, who, (await s.post(body, who)).status]).toEqual([(body as { action: string }).action, who, expected]);
      }
      expect((await s.mcp('fila_apply', { actions: [body] })).isError).toBe(true);
    }
    // A batch with one refused action is dropped whole: the comment before it is not written.
    const batch = await s.mcp('fila_apply', { actions: [{ action: 'comment', thread: id, text: 'przed odmową' }, { action: 'updateThread', thread: id, state: 'Anulowany' }] });
    expect(batch.isError).toBe(true);
    expect(batch.text).toMatch(/Akcja 2 \(updateThread\).*Stan automatu ustawia tylko Machina.*Cała paczka odrzucona/);
    expect((await s.mcp('fila_apply', { actions: [{ action: 'updateThread', thread: id, state: 'Anulowany' }], dryRun: true })).isError).toBe(true);
    // The panel's own bookkeeping author (the dispatch sets a Stan with it) has no way around either, alone or in a batch.
    for (const action of [{ action: 'updateThread', thread: id, state: 'Wstrzymany' }, { action: 'updateThread', thread: id, project: 'DESK', module: null }, { action: 'updateThread', thread: id, workflow: 'w-praca', state: 'Pomysł' }] as FilaAction[]) {
      await refused(s.fila.apply(action, 'panel'), action.action === 'updateThread' && 'project' in action ? 409 : 403);
      await refused(s.fila.applyBatch([action], 'panel'), action.action === 'updateThread' && 'project' in action ? 409 : 403);
    }
    await refused(s.fila.apply({ action: 'createThread', project: 'MACH', type: 'automat', title: 'x' }, 'panel'), 403);
    expect(readFileSync(s.file, 'utf8')).toBe(before);
    expect(await s.fila.machina.read(automat.uid)).toMatchObject({ state: 'Aktywny', program: { version: 1 } });
  });

  it('let ordinary fields, Moduł, Tagi, title, description, parent and comments through, and a custom field never becomes kit data', async () => {
    const s = await serve();
    const automat = await s.fila.machina.create({ title: 'Pilnuj ceny', state: 'Aktywny', kit: { program: { version: 1 } } });
    await s.fila.apply({ action: 'createThread', project: 'MACH', type: 'funkcja', title: 'Rodzic' }, 'user');
    const id = automat.id;
    const allowed: [unknown, 'user' | 'ai'][] = [
      [{ action: 'updateThread', thread: id, title: 'Pilnuj ceny roweru', description: 'Cel: poniżej 3000 zł', module: 'Obserwacja', parent: 'MACH-2' }, 'user'],
      [{ action: 'setField', thread: id, field: 'Tagi', value: ['rower'] }, 'ai'],
      [{ action: 'setField', thread: id, field: 'Koszt', value: 3, kind: 'number' }, 'user'],
      // A field named like a kit part is an ordinary field: the kit does not read it.
      [{ action: 'setField', thread: id, field: 'Program', value: 'podrobiony', kind: 'text' }, 'ai'],
      [{ action: 'setField', thread: id, field: 'Dziennik', value: 'podrobiony', kind: 'text' }, 'ai'],
      [{ action: 'comment', thread: id, text: 'Zwykły komentarz' }, 'ai'],
      // The Stan it already has is no change.
      [{ action: 'updateThread', thread: id, state: 'Aktywny', title: 'Pilnuj ceny roweru' }, 'ai'],
    ];
    for (const [body, who] of allowed) expect([(body as { action: string }).action, (await s.post(body, who)).status]).toEqual([(body as { action: string }).action, 200]);
    const viaMcp = await s.mcp('fila_apply', { actions: [{ action: 'comment', thread: id, text: 'Komentarz z MCP' }, { action: 'removeField', thread: id, field: 'Koszt' }] });
    expect(viaMcp.isError).toBe(false);
    const thread = (await s.get(`/api/fila/threads/${id}`)).body;
    expect(thread).toMatchObject({
      title: 'Pilnuj ceny roweru', description: 'Cel: poniżej 3000 zł', module: 'Obserwacja', parent: 'MACH-2', state: 'Aktywny',
      fields: { Tagi: ['rower'], Program: 'podrobiony', Dziennik: 'podrobiony' },
      machina: { builtIn: false, parts: { program: true, situations: false, journal: false, conversations: false } },
    });
    expect(thread.history.filter((h: { kind: string }) => h.kind === 'comment').map((h: { by: string }) => h.by)).toEqual(['claude-code', 'codex']);
    expect((await s.get(`/api/fila/threads/${id}/machina`)).body).toMatchObject({ program: { available: true, content: { version: 1 } }, journal: { available: false, content: null } });
  });

  it('read an automat with its kit by the thread ID: the link in GET and fila_get, the four parts with an explicit lack of content', async () => {
    const s = await serve();
    const empty = await s.fila.machina.create({ title: 'Bez treści' });
    const full = await s.fila.machina.create({ title: 'Z treścią', kit: { program: { version: 2 }, conversations: [{ chat: 'c-1' }] } });
    await s.fila.apply({ action: 'createThread', project: 'MACH', type: 'notatka', title: 'Notatka' }, 'user');
    expect(await s.get(`/api/fila/threads/${empty.id}/machina`)).toEqual({ status: 200, body: {
      thread: 'MACH-1', uid: empty.uid, builtIn: false,
      program: { available: false, content: null }, situations: { available: false, content: null },
      journal: { available: false, content: null }, conversations: { available: false, content: null },
    } });
    expect((await s.get(`/api/fila/threads/${full.id}/machina`)).body).toMatchObject({
      thread: 'MACH-2', uid: full.uid, program: { available: true, content: { version: 2 } }, situations: { available: false, content: null }, conversations: { available: true, content: [{ chat: 'c-1' }] },
    });
    // Lower case works like every thread read; a thread without the kit and an unknown one are 404.
    expect((await s.get('/api/fila/threads/mach-2/machina')).status).toBe(200);
    expect((await s.get('/api/fila/threads/MACH-3/machina')).status).toBe(404);
    expect((await s.get('/api/fila/threads/MACH-9/machina')).status).toBe(404);
    const got = JSON.parse((await s.mcp('fila_get', { thread: full.id, history: false })).text).thread;
    expect(got).toMatchObject({ id: 'MACH-2', uid: full.uid, type: { key: 'automat' }, machina: { builtIn: false, parts: { program: true, situations: false, journal: false, conversations: true } } });
    expect((await s.get('/api/fila/threads/MACH-3')).body.machina).toBeUndefined();
    // The list of automats is a Fila query: the note in MACH is not on it.
    expect((await s.get(`/api/fila/query?q=${encodeURIComponent('projekt = MACH AND typ = automat')}`)).body.threads.map((t: { id: string }) => t.id)).toEqual(['MACH-1', 'MACH-2']);
    const structure = JSON.parse((await s.mcp('fila_structure', {})).text);
    expect(structure.types.find((t: { key: string }) => t.key === 'automat')).toMatchObject({ workflow: 'w-automat', fields: ['Tagi', 'zestaw Machiny'] });
  });
});

it('refuses stored data where the kit, the workflow Automat or MACH are on the wrong thread', async () => {
  const seed = createFilaStore();
  await seed.machina.create({ title: 'Automat' });
  await seed.apply({ action: 'createThread', project: 'MACH', type: 'sprawa', title: 'Sprawa' }, 'user');
  const good = { projects: [{ key: FILA_MACHINA_PROJECT.key, name: 'Machina', createdAt: 1, modules: [], nextNumber: 3 }], workflows: [{ id: 'w-praca', name: 'Praca', states: [{ name: 'Pomysł', closing: false }] }, FILA_AUTOMAT_WORKFLOW], fieldDefs: [], boards: [], starterBoards: {} };
  const thread = (over: Record<string, unknown>) => ({ uid: 'f-00000001', project: 'MACH', number: 1, type: 'sprawa', workflow: 'w-praca', state: 'Pomysł', title: 't', description: '', parent: null, module: null, fields: {}, archived: false, revision: 1, createdAt: 1, updatedAt: 1, history: [], ...over });
  const kit = { builtIn: false, program: null, situations: null, journal: null, conversations: null };
  const load = (t: Record<string, unknown>) => createFilaStore({ initial: { ...good, threads: [t] } as never }).registries();
  await expect(load(thread({}))).resolves.toBeTruthy();
  await expect(load(thread({ type: 'automat', workflow: 'w-automat', state: 'Aktywny', machina: kit }))).resolves.toBeTruthy();
  await expect(load(thread({ machina: kit }))).rejects.toThrow(/kit belongs to automats/);
  await expect(load(thread({ type: 'automat', workflow: 'w-automat', state: 'Aktywny' }))).rejects.toThrow(/kit belongs to automats/);
  await expect(load(thread({ workflow: 'w-automat', state: 'Aktywny' }))).rejects.toThrow(/workflow Automat/);
  await expect(load(thread({ type: 'automat', workflow: 'w-praca', machina: kit }))).rejects.toThrow(/workflow Automat/);
  const elsewhere = { ...good, projects: [...good.projects, { key: 'DESK', name: 'DeskPanel', createdAt: 1, modules: [], nextNumber: 2 }], threads: [thread({ project: 'DESK', type: 'automat', workflow: 'w-automat', state: 'Aktywny', machina: kit })] };
  await expect(createFilaStore({ initial: elsewhere as never }).registries()).rejects.toThrow(/An automat lives in MACH/);
});
