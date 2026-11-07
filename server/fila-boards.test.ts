// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import type { FilaAction, FilaActor } from '../src/fila-contract';
import { createPanelServer } from './app';
import { createFilaStore, FilaError, type FilaStore } from './fila';
import { filaTokens } from './fila-routes';
import { createScenarioSources } from './scenario';

const dirs: string[] = [];
const closers: (() => void)[] = [];
afterEach(() => { for (const c of closers.splice(0)) c(); for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fila-boards-')); dirs.push(d); return d; };

const act = (store: FilaStore, action: FilaAction, actor: FilaActor = 'claude-code') => store.apply(action, actor);
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
const structure = async (store: FilaStore, id: string) => (await store.board(id)).views.map(v => ({ view: v.name, sections: v.sections.map(s => ({ name: s.name, columns: s.columns.map(c => c.name) })) }));

it('gives a new project one starter board with one list section over the whole project, and keeps it across a restart', async () => {
  const file = join(tmp(), 'fila.json');
  const first = createFilaStore({ file });
  await act(first, { action: 'createProject', key: 'DESK', name: 'DeskPanel' }, 'user');
  await act(first, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Zamknięta' }, 'user');
  await act(first, { action: 'updateThread', thread: 'DESK-1', state: 'Zakończone' }, 'user');
  await act(first, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Otwarta' }, 'user');
  const reg = await first.registries();
  expect(reg.boards).toHaveLength(1);
  expect(reg.projects[0]!.board).toBe(reg.boards[0]!.id);
  const board = await first.board(reg.boards[0]!.id);
  expect(board).toMatchObject({ name: 'DeskPanel', project: 'DESK', views: [{ sections: [{ kind: 'list', query: 'projekt = DESK', columns: [] }] }] });
  expect(board.history[0]).toMatchObject({ by: 'user', kind: 'created', target: 'board' });
  // The starter section has no open/closed filter: both threads are in it.
  const view = await first.boardView(board.id, board.views[0]!.id);
  expect(view.sections[0]!.threads.map(t => t.id)).toEqual(['DESK-1', 'DESK-2']);
  await first.drain();

  const second = createFilaStore({ file });
  const again = await second.registries();
  expect(again.boards).toEqual(reg.boards);
  expect(await second.board(board.id)).toEqual(board); // the structure and its history persisted unchanged
  expect(JSON.parse(readFileSync(file, 'utf8')).data.boards).toHaveLength(1);
});

it('gives a project from before 1.2 its board once, and does not make a deleted one again', async () => {
  const file = join(tmp(), 'fila.json');
  const old = { version: 1, data: {
    projects: [{ key: 'DESK', name: 'DeskPanel', createdAt: 1, modules: [], nextNumber: 2 }, { key: 'CEZA', name: 'Cezar', createdAt: 1, modules: [], nextNumber: 1 }],
    workflows: [{ id: 'w-praca', name: 'Praca', states: [{ name: 'Pomysł', closing: false }] }], fieldDefs: [{ name: 'Tagi', kind: 'multi' }],
    threads: [{ uid: 'f-00000001', project: 'DESK', number: 1, type: 'sprawa', workflow: 'w-praca', state: 'Pomysł', title: 'Stary', description: '', parent: null, module: null, fields: {}, archived: false, revision: 1, createdAt: 1, updatedAt: 1, history: [] }],
  } };
  writeFileSync(file, JSON.stringify(old));
  const store = createFilaStore({ file });
  const reg = await store.registries();
  expect(reg.boards.map(b => b.name).sort()).toEqual(['Cezar', 'DeskPanel']);
  expect((await store.board(reg.projects[0]!.board!)).history[0]).toMatchObject({ by: 'panel', kind: 'created' });
  await store.drain();
  // Opened again: nothing doubles. Then the user deletes one board; after another restart it stays gone.
  const reopened = createFilaStore({ file });
  expect((await reopened.registries()).boards).toHaveLength(2);
  await act(reopened, { action: 'deleteBoard', board: reg.projects[0]!.board! }, 'user');
  await reopened.drain();
  const last = await createFilaStore({ file }).registries();
  expect(last.boards.map(b => b.name)).toEqual(['Cezar']);
  expect(last.projects.find(p => p.key === 'DESK')!.board).toBeNull();
});

it('builds views, sections and columns, reorders them, refuses to empty a container, and records each change', async () => {
  const store = createFilaStore();
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  const [board] = (await store.registries()).boards;
  const startView = board!.views[0]!.id;
  const kanban = await act(store, { action: 'createView', board: board!.id, name: 'Kanban', section: { name: 'Funkcje', kind: 'kanban', query: 'projekt=desk and typ=funkcja', columns: [{ name: 'Pomysły', query: 'stan = Pomysł' }, { name: 'W toku', query: 'stan = "W realizacji"' }] } }, 'user');
  const stored = await store.board(board!.id);
  expect(stored.views.map(v => v.name)).toEqual(['Widok', 'Kanban']);
  expect(stored.views[1]!.sections[0]).toMatchObject({ kind: 'kanban', query: 'projekt = DESK AND typ = funkcja', columns: [{ query: 'stan = "Pomysł"' }, { query: 'stan = "W realizacji"' }] });
  const section = kanban.section!;
  const secondView = kanban.view!;

  await act(store, { action: 'createSection', view: startView, position: 0, section: { name: 'Błędy', kind: 'list', query: 'projekt = DESK AND typ = błąd SORTUJ tytuł' } });
  await act(store, { action: 'createColumn', section, name: 'Gotowe', query: 'stan = Zakończone', position: 1 });
  const columns = (await store.board(board!.id)).views[1]!.sections[0]!.columns;
  expect(columns.map(c => c.name)).toEqual(['Pomysły', 'Gotowe', 'W toku']);
  await act(store, { action: 'moveColumn', column: columns[2]!.id, position: 0 });
  await act(store, { action: 'moveView', view: secondView, position: 0 });
  await act(store, { action: 'renameView', view: startView, name: 'Wszystko' });
  await act(store, { action: 'updateSection', section, name: 'Funkcje DeskPanelu', query: 'projekt = DESK AND typ = funkcja AND otwarte' });
  await act(store, { action: 'renameBoard', board: board!.id, name: 'Moja' });
  expect(await structure(store, board!.id)).toEqual([
    { view: 'Kanban', sections: [{ name: 'Funkcje DeskPanelu', columns: ['W toku', 'Pomysły', 'Gotowe'] }] },
    { view: 'Wszystko', sections: [{ name: 'Błędy', columns: [] }, { name: 'Wszystkie wątki', columns: [] }] },
  ]);

  // The last view and the last section cannot go; a list has no columns; positions are checked.
  const final = await store.board(board!.id);
  await act(store, { action: 'deleteView', view: secondView });
  await refused(act(store, { action: 'deleteView', view: startView }), 409, /ostatniego/);
  await act(store, { action: 'deleteSection', section: final.views[1]!.sections[0]!.id });
  await refused(act(store, { action: 'deleteSection', section: final.views[1]!.sections[1]!.id }), 409, /ostatniej/);
  await refused(act(store, { action: 'createColumn', section: final.views[1]!.sections[1]!.id, name: 'X', query: '' }), 409, /kanbanu/);
  await refused(act(store, { action: 'createSection', view: startView, section: { name: 'L', kind: 'list', query: 'projekt = DESK', columns: [{ name: 'X', query: '' }] } }), 400, /nie ma kolumn/);
  await refused(act(store, { action: 'moveView', view: startView, position: 5 }), 409, /poza zakresem/);
  await refused(act(store, { action: 'moveView', view: 'v-00000000', position: 0 }), 404);

  // The history covers the whole structure and the settings, with who and the old and new value.
  const history = (await store.board(board!.id)).history.map(h => `${h.by}:${h.kind}:${h.target}:${h.name}`);
  expect(history).toEqual(expect.arrayContaining([
    'claude-code:created:board:DeskPanel', 'user:created:view:Kanban', 'user:created:column:Pomysły', 'claude-code:created:section:Błędy',
    'claude-code:created:column:Gotowe', 'claude-code:moved:column:W toku', 'claude-code:moved:view:Kanban', 'claude-code:renamed:view:Wszystko',
    'claude-code:renamed:section:Funkcje DeskPanelu', 'claude-code:changed:section:Funkcje DeskPanelu', 'claude-code:renamed:board:Moja', 'claude-code:removed:view:Kanban', 'claude-code:removed:section:Błędy',
  ]));
  const change = (await store.board(board!.id)).history.find(h => h.kind === 'changed')!;
  expect(change.changes).toEqual([{ field: 'Zapytanie', from: 'projekt = DESK AND typ = funkcja', to: 'projekt = DESK AND typ = funkcja AND otwarte' }]);
  expect((await store.board(board!.id)).history.find(h => h.kind === 'moved' && h.target === 'column')!.changes).toEqual([{ field: 'Pozycja', from: '3', to: '1' }]);
});

it('refuses a structure whose query is wrong, writing nothing; a repeated rename is not a change', async () => {
  const store = createFilaStore();
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  const [board] = (await store.registries()).boards;
  const before = await store.board(board!.id);
  await refused(act(store, { action: 'createView', board: board!.id, name: 'Zły', section: { name: 'S', kind: 'list', query: 'typ = funkcja' } }), 400, /musi wskazywać projekt/);
  await refused(act(store, { action: 'createSection', view: board!.views[0]!.id, section: { name: 'S', kind: 'kanban', query: 'projekt = DESK', columns: [{ name: 'K', query: 'projekt = DESK' }] } }), 400, /dziedziczy projekt/);
  await refused(act(store, { action: 'updateSection', section: before.views[0]!.sections[0]!.id, query: 'projekt = DESK AND kiedy = jutro' }), 400, /dat i terminów/);
  await refused(act(store, { action: 'createBoard', name: 'B', section: { name: 'S', kind: 'list', query: 'projekt = DESK AND pole("Brak") = 1' } }), 400, /Nie ma pola/);
  expect(await store.board(board!.id)).toEqual(before);
  expect((await store.registries()).boards).toHaveLength(1);
  await act(store, { action: 'renameBoard', board: board!.id, name: 'DeskPanel' });
  expect((await store.board(board!.id)).history).toEqual(before.history);
});

it('answers a view by the same queries used on their own: a thread in several sections is in each, a column narrows its section', async () => {
  const store = createFilaStore();
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  for (const [type, title] of [['funkcja', 'A'], ['funkcja', 'B'], ['funkcja', 'C'], ['blad', 'D']] as const) await act(store, { action: 'createThread', project: 'DESK', type, title });
  await act(store, { action: 'updateThread', thread: 'DESK-2', state: 'W realizacji' });
  await act(store, { action: 'updateThread', thread: 'DESK-3', state: 'Zakończone' });
  await act(store, { action: 'archiveThread', thread: 'DESK-1' });
  const [board] = (await store.registries()).boards;
  const made = await act(store, { action: 'createView', board: board!.id, name: 'Mieszany', section: {
    name: 'Lista funkcji', kind: 'list', query: 'projekt = DESK AND typ = funkcja SORTUJ tytuł malejąco' } });
  await act(store, { action: 'createSection', view: made.view!, section: { name: 'Kanban', kind: 'kanban', query: 'projekt = DESK AND typ = funkcja AND archiwum = włącz SORTUJ id', columns: [
    { name: 'Pomysł', query: 'stan = Pomysł' }, { name: 'Otwarte', query: 'otwarte SORTUJ id malejąco' }, { name: 'Zamknięte', query: 'zamknięte' }, { name: 'Nic', query: 'typ = błąd' }] } });
  const view = await store.boardView(board!.id, made.view!);
  const [list, kanban] = view.sections;
  const idsOf = (t: { id: string }[]) => t.map(x => x.id);
  expect(idsOf(list!.threads)).toEqual(['DESK-3', 'DESK-2']);
  expect(list!.threads.map(t => t.id)).toEqual((await store.query(list!.query)).threads.map(t => t.id)); // the section's text, alone
  expect(kanban!.threads).toEqual([]);
  expect(kanban!.columns.map(c => idsOf(c.threads))).toEqual([['DESK-1'], ['DESK-2', 'DESK-1'], ['DESK-3'], []]);
  // Section AND column, column order over the section's, and the archived thread (asked for by the section) is in two columns.
  expect(kanban!.columns[1]).toMatchObject({ total: 2 });
  const combined = await store.query('projekt = DESK AND typ = funkcja AND archiwum = włącz AND otwarte SORTUJ id malejąco');
  expect(idsOf(kanban!.columns[1]!.threads)).toEqual(idsOf(combined.threads));
  expect(idsOf(list!.threads).includes('DESK-2') && idsOf(kanban!.columns[1]!.threads).includes('DESK-2')).toBe(true);
  // A thread outside every column is not in the kanban.
  expect(kanban!.columns.flatMap(c => idsOf(c.threads))).not.toContain('DESK-4');
  await refused(store.boardView(board!.id, 'v-00000000'), 404);
});

it('serves lists and a kanban over HTTP on a separate store, with the same threads and a refusal of what stage 1 lacks', async () => {
  const dir = tmp();
  const tokens = filaTokens(join(dir, 'home'));
  const file = join(dir, 'fila.json');
  const sources = { ...createScenarioSources(join(process.cwd(), 'scenarios/standard.json')), fila: createFilaStore({ file }) };
  const server = createPanelServer(sources, process.cwd(), undefined, undefined, { filaTokens: tokens }).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  closers.push(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (body: unknown, as: 'user' | 'ai' = 'ai') => fetch(`${base}/api/fila/action`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(as === 'user' ? { Origin: base } : { Authorization: `Bearer ${tokens.codex}` }) } });
  const get = async (path: string) => { const res = await fetch(`${base}${path}`); return { status: res.status, body: await res.json() }; };
  const q = (text: string, extra = '') => `/api/fila/query?q=${encodeURIComponent(text)}${extra}`;

  await post({ action: 'createProject', key: 'DESK', name: 'DeskPanel' }, 'user');
  for (const title of ['Jeden', 'Dwa', 'Trzy']) await post({ action: 'createThread', project: 'DESK', type: 'funkcja', title });
  await post({ action: 'updateThread', thread: 'DESK-2', state: 'W realizacji' });
  const reg = (await get('/api/fila')).body;
  const boardId = reg.projects[0].board as string;
  const { view: listView } = await (await post({ action: 'createView', board: boardId, name: 'Lista', section: { name: 'Funkcje', kind: 'list', query: 'projekt = DESK AND typ = funkcja' } }, 'user')).json();
  const kanbanMade = await (await post({ action: 'createView', board: boardId, name: 'Kanban', section: { name: 'Funkcje', kind: 'kanban', query: 'projekt = DESK AND typ = funkcja', columns: [{ name: 'Pomysł', query: 'stan = Pomysł' }, { name: 'W toku', query: 'stan = "W realizacji"' }] } })).json();

  const asList = (await get(`/api/fila/boards/${boardId}/views/${listView}`)).body.sections[0];
  const asKanban = (await get(`/api/fila/boards/${boardId}/views/${kanbanMade.view}`)).body.sections[0];
  const listIds = asList.threads.map((t: { id: string }) => t.id);
  expect(listIds).toEqual(['DESK-1', 'DESK-2', 'DESK-3']);
  expect(asKanban.columns.flatMap((c: { threads: { id: string }[] }) => c.threads.map(t => t.id)).sort()).toEqual(listIds);
  expect((await get(q(asList.query))).body.threads.map((t: { id: string }) => t.id)).toEqual(listIds);
  expect((await get(q(asKanban.query))).body).toMatchObject({ total: 3, query: 'projekt = DESK AND typ = funkcja' });
  expect((await get(`/api/fila/boards/${boardId}`)).body.history.length).toBeGreaterThan(3);

  // Check without writing: the canonical text, or a readable 400; stage 1 has no dates and no several projects.
  expect((await get(`/api/fila/query/check?q=${encodeURIComponent('PROJEKT=desk')}`)).body).toMatchObject({ ok: true, text: 'projekt = DESK' });
  for (const [text, reason] of [['projekt = DESK AND kiedy < dziś', /dat i terminów/], ['projekt IN (DESK, CEZA)', /projekty/], ['typ = funkcja', /projekt/]] as const) {
    const res = await get(q(text));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(reason);
  }
  const before = readFileSync(file, 'utf8');
  expect((await post({ action: 'createSection', view: listView, section: { name: 'Zła', kind: 'list', query: 'projekt = DESK AND kiedy < dziś' } })).status).toBe(400);
  expect((await get(q('projekt = DESK AND zamknięte'))).body.total).toBe(0);
  expect(readFileSync(file, 'utf8')).toBe(before);
  expect((await fetch(`${base}/api/fila/action`, { method: 'POST', body: '{}' })).status).toBe(403);
});
