// @vitest-environment node
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CezarCreateRunInput, CezarSnapshot } from '../src/cezar-contract';
import type { FilaAction } from '../src/fila-contract';
import { filaDispatchExpected, getFilaDispatch } from '../src/fila-dispatch';
import { createPanelServer } from './app';
import { createCockpit } from './cockpit';
import { createFilaStore } from './fila';
import type { FilaCezarTask } from './fila-cezar-tasks';
import { filaTokens } from './fila-routes';
import type { PanelSources } from './sources';

const SPEC = ['CEL:', 'Cel wątku.', '', 'ZAKRES:', '- Zmiana.', '', 'POZA ZAKRESEM:', '- Nic.', '', 'WARUNKI ODBIORU:', '1. Test.'].join('\n');
const PR = 'https://github.com/metelskiwiktor/desk-panel/pull/77';

let dir = '';
let servers: Server[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fila-dispatch-')); });
afterEach(() => { for (const s of servers.splice(0)) { s.closeAllConnections(); s.close(); } rmSync(dir, { recursive: true, force: true }); });

type Entry = { id: string; status: 'running' | 'failed' | 'done'; title?: string; description?: string; branch?: string; startedAt?: number; pullRequestUrl?: string };
const taskOf = ({ title = 'Task', description = 'x', ...e }: Entry) => ({ title, description, project: 'desk-panel', checkedAt: Date.now(), sourceUrl: `http://127.0.0.1:4321/p/desk-panel/tasks/${e.id}`, ...e });
const snapshotOf = (entries: Entry[]): CezarSnapshot => ({
  observedAt: Date.now(), partial: false, scheduled: 0, counts: { running: 0, queue: 0, 'needs-input': 0, review: 0 },
  tasks: entries.filter(e => e.status !== 'failed').map(taskOf), finished: entries.filter(e => e.status === 'failed').map(taskOf),
}) as CezarSnapshot;

/** The panel with a real Fila store and cockpit on files in `dir` and a stand-in for Cezar; "restarting" starts it again on the same files. */
async function start(state: { snapshot: CezarSnapshot; run: number; fail: boolean; down?: boolean } = { snapshot: snapshotOf([]), run: 0, fail: false }) {
  const fila = createFilaStore({ file: join(dir, 'fila.json') });
  const created = vi.fn(async (input: CezarCreateRunInput) => {
    if (state.fail) throw new Error('timeout');
    state.run += 1;
    return { ok: true as const, id: `desk-panel/run-${state.run}`, project: 'desk-panel', url: `http://127.0.0.1:4321/p/desk-panel/tasks/run-${state.run}`, workflow: input.workflow ?? 'desk-panel-task' };
  });
  const sources = { fila, cezar: async () => { if (state.down) throw new Error('Cezar nie odpowiada'); return state.snapshot; }, cezarCreateRun: created } as unknown as PanelSources;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
  const tokens = filaTokens(join(dir, 'home'));
  const server = createPanelServer(sources, dir, undefined, undefined, { cockpit, filaTokens: tokens });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const act = (action: FilaAction, actor: 'user' | 'claude-code' = 'claude-code') => fila.apply(action, actor);
  const prepared = async (over: { executor?: 'cezar' | 'lokalnie' | 'rozmowa'; spec?: string; title?: string; parent?: string } = {}) => {
    if (!(await fila.registries()).projects.length) { await act({ action: 'createProject', key: 'DESK', name: 'DeskPanel' }); await act({ action: 'createProject', key: 'CEZR', name: 'Cezar' }); }
    const id = (await act({ action: 'createThread', project: 'DESK', type: 'funkcja', title: over.title ?? 'Gotowy wątek', ...(over.parent ? { parent: over.parent } : {}) })).thread!.id;
    await act({ action: 'setSpec', thread: id, text: over.spec ?? SPEC, baseRevision: 0 });
    await act({ action: 'addCezarKit', thread: id });
    await act({ action: 'setCezar', thread: id, executor: over.executor ?? 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    await act({ action: 'updateThread', thread: id, state: 'Gotowe do realizacji' });
    return id;
  };
  const expectedOf = async (id: string) => filaDispatchExpected(await fila.thread(id));
  const post = (id: string, body: unknown, headers: Record<string, string> = { Origin: base }) => fetch(`${base}/api/fila/threads/${id}/cezar-dispatch`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...headers },
  });
  const restore = (id: string) => act({ action: 'updateThread', thread: id, state: 'Gotowe do realizacji' });
  const stop = () => { server.closeAllConnections(); server.close(); };
  const tasks = async (id: string) => (await fetch(`${base}/api/fila/threads/${id}/cezar-tasks`)).json() as Promise<{ thread: string; partial: boolean; tasks: FilaCezarTask[] }>;
  return { base, fila, cockpit, created, act, prepared, expectedOf, post, restore, tasks, tokens, state, stop };
}

describe('Zlecenie Cezara z wątku Fili (POST /api/fila/threads/ID/cezar-dispatch)', () => {
  it('odrzuca brak i obcy Origin oraz token klienta (403), nieznany wątek (404), zmienione dane (409) i niegotowość z komunikatem braku, bez zlecenia', async () => {
    const { created, prepared, expectedOf, post, tokens, fila, act } = await start();
    const id = await prepared();
    const expected = await expectedOf(id);
    expect((await post(id, { expected }, {})).status).toBe(403);
    expect((await post(id, { expected }, { Origin: 'http://evil.example' })).status).toBe(403);
    // A token never makes the user, with or without the panel's Origin.
    expect((await post(id, { expected }, { Authorization: `Bearer ${tokens.codex}` })).status).toBe(403);
    expect((await post(id, { expected }, { Origin: `http://127.0.0.1`, Authorization: `Bearer ${tokens.codex}` })).status).toBe(403);
    expect((await post('DESK-99', { expected })).status).toBe(404);
    expect((await post(id, { expected: { ...expected, title: 'Inny tytuł' } })).status).toBe(409);
    await act({ action: 'setCezar', thread: id, executor: 'lokalnie' });
    const local = await post(id, { expected: await expectedOf(id) });
    expect(local.status).toBe(409);
    expect((await local.json()).error).toBe('Wykonawca (executor) to „lokalnie”, a gotowość wymaga „cezar”.');
    expect(created).not.toHaveBeenCalled();
    expect((await fila.thread(id)).state).toBe('Gotowe do realizacji');
  });

  it('nie przyjmuje promptu, modelu, workflow ani runnera od klienta (400) i składa prompt z C1 na serwerze', async () => {
    const { created, prepared, expectedOf, post, fila } = await start();
    const id = await prepared();
    const expected = await expectedOf(id);
    for (const extra of [{ prompt: 'Zrób coś innego' }, { task: 'x' }, { model: 'm' }, { workflow: 'analysis' }, { runner: 'r' }]) {
      expect((await post(id, { expected, ...extra })).status).toBe(400);
    }
    expect((await post(id, { expected: { ...expected, prompt: 'x' } })).status).toBe(400);
    expect(created).not.toHaveBeenCalled();
    const thread = await fila.thread(id);
    const prompt = getFilaDispatch(thread, (await fila.spec(id)).text).prompt;
    expect((await post(id, { expected })).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(1);
    // The task is named after the thread (2.2): the ID first, the prompt and `expected` untouched.
    expect(created).toHaveBeenCalledWith({ task: prompt, title: 'DESK-1 Gotowy wątek', project: 'desk-panel', workflow: 'desk-panel-task' });
    expect(prompt).toContain('Zadanie: DESK-1');
    expect(prompt).toContain('Rewizja specyfikacji: 1');
    expect(prompt!.endsWith(SPEC)).toBe(true);
  });

  it('po sukcesie dopina task, komentarz i Stan „W realizacji” (autor: panel), a rejestr jest czytelny', async () => {
    const { prepared, expectedOf, post, fila, base } = await start();
    const id = await prepared();
    const response = await post(id, { expected: await expectedOf(id) });
    expect(await response.json()).toEqual({ ok: true, taskId: 'desk-panel/run-1', url: 'http://127.0.0.1:4321/p/desk-panel/tasks/run-1' });
    const thread = await fila.thread(id);
    expect(thread.state).toBe('W realizacji');
    expect(thread.cezar.links).toEqual([expect.objectContaining({ kind: 'cezar', id: 'desk-panel/run-1', title: 'Gotowy wątek' })]);
    const comment = thread.history.filter(h => h.kind === 'comment').at(-1);
    expect(comment).toMatchObject({ by: 'panel' });
    expect(comment?.text).toContain('rewizja v1');
    expect(comment?.text).toContain('desk-panel/run-1');
    const register = await (await fetch(`${base}/api/fila/threads/${id}/cezar-dispatch/register`)).json();
    expect(register).toEqual({ thread: id, dispatches: [{ thread: id, specRevision: 1, mode: 'implementacja', taskId: 'desk-panel/run-1', url: 'http://127.0.0.1:4321/p/desk-panel/tasks/run-1' }] });
  });

  it('zleca tylko ze Stanu z listy ustawień (odczyt w GET /api/fila), a blokada nie odbiera gotowości', async () => {
    const { created, prepared, expectedOf, post, act, fila, base } = await start();
    const id = await prepared();
    await act({ action: 'setCezar', thread: id, blocked: 'Czekam na decyzję' });
    await act({ action: 'updateThread', thread: id, state: 'Pomysł' });
    const outside = await post(id, { expected: await expectedOf(id) });
    expect(outside.status).toBe(409);
    expect((await outside.json()).error).toBe('Wątek musi mieć Stan, z którego wolno zlecić Cezarowi („Gotowe do realizacji”, w workflow z ustawień zestawu), a ma „Pomysł”.');
    expect(created).not.toHaveBeenCalled();
    const readyStates = [{ workflow: 'w-praca', state: 'Gotowe do realizacji' }, { workflow: 'w-praca', state: 'Pomysł' }];
    await act({ action: 'setCezarSettings', readyStates });
    expect((await (await fetch(`${base}/api/fila`)).json()).cezarSettings).toEqual({ readyStates });
    // On the list now, and still blocked by hand: ready all the same.
    expect((await fila.thread(id)).cezar.blocked).toBe('Czekam na decyzję');
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(1);
  });

  it('jedna udana implementacja na rewizję: task w toku, zakończony i nieobecny blokują (409 z linkiem), failed i nowa rewizja pozwalają, o blokadzie decyduje najnowszy wpis; analiza bez limitu', async () => {
    const { created, prepared, expectedOf, post, restore, act, fila, cockpit, state } = await start();
    const id = await prepared();
    const again = async () => { await restore(id); return post(id, { expected: await expectedOf(id) }); };
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'running' }]);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    const blocked = await again();
    expect(blocked.status).toBe(409);
    const refused = (await blocked.json()).error as string;
    expect(refused).toContain('desk-panel/run-1');
    expect(refused).toContain('http://127.0.0.1:4321/p/desk-panel/tasks/run-1');
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'done' }]);
    expect((await again()).status).toBe(409);
    // Gone from Cezar's snapshot: blocks as well (it used to unblock).
    state.snapshot = snapshotOf([]);
    expect((await again()).status).toBe(409);
    expect(created).toHaveBeenCalledTimes(1);

    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'failed' }]);
    expect((await again()).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(2);
    expect((await fila.thread(id)).history.filter(h => h.kind === 'comment').at(-1)?.text).toContain('Ponowienie po nieudanym tasku desk-panel/run-1');
    // failed, then a retry in flight: the newest entry decides, so a third try is refused.
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'failed' }, { id: 'desk-panel/run-2', status: 'running' }]);
    const third = await again();
    expect(third.status).toBe(409);
    expect((await third.json()).error).toContain('desk-panel/run-2');
    expect(created).toHaveBeenCalledTimes(2);

    // An analysis may be dispatched beside the running implementation, as often as the user clicks; each is its own entry.
    await act({ action: 'setCezar', thread: id, mode: 'analiza' });
    expect((await again()).status).toBe(200);
    expect((await again()).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(4);
    expect(created).toHaveBeenLastCalledWith(expect.objectContaining({ workflow: 'analysis' }));
    expect((await fila.thread(id)).history.filter(h => h.kind === 'comment').at(-1)?.text).not.toContain('Ponowienie');
    expect((await fila.thread(id)).cezar.links.filter(l => l.kind === 'cezar').map(l => l.id)).toEqual(['desk-panel/run-1', 'desk-panel/run-2', 'desk-panel/run-3', 'desk-panel/run-4']);

    // A new revision is a new key: the implementation may go again while the old one still runs.
    await act({ action: 'setCezar', thread: id, mode: 'implementacja' });
    expect((await again()).status).toBe(409);
    await act({ action: 'setSpec', thread: id, text: `${SPEC}\n2. Drugi test.`, baseRevision: 1 });
    expect((await again()).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(5);
    expect(cockpit.threadDispatches().map(d => `${d.specRevision}|${d.mode}|${d.taskId}`)).toEqual(['1|implementacja|desk-panel/run-2', '1|analiza|desk-panel/run-4', '2|implementacja|desk-panel/run-5']);
  });

  it('nazywa task od ID wątku: tytuł 200 znaków daje nazwę do 120 znaków z pełnym ID i skróconym tytułem', async () => {
    const { created, prepared, expectedOf, post } = await start();
    const long = await prepared({ title: `${'Bardzo długi tytuł wątku '.repeat(8)}`.slice(0, 198) + '😀' });
    expect((await post(long, { expected: await expectedOf(long) })).status).toBe(200);
    const title = created.mock.calls[0]![0].title!;
    expect(title.length).toBeLessThanOrEqual(120);
    expect(title.length).toBeGreaterThan(110);
    expect(title.startsWith('DESK-1 Bardzo długi tytuł wątku Bardzo')).toBe(true);
    expect(title.endsWith('…')).toBe(true);
  });

  it('lista tasków wątku: oba wpisy rejestru po ponowieniu, task bez snapshotu jako „nieznany”, a przy błędzie Cezara rejestr z partial', async () => {
    const { prepared, expectedOf, post, restore, tasks, state } = await start();
    const id = await prepared();
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'failed', title: 'DESK-1 Gotowy wątek', branch: 'desk-1-gotowy', pullRequestUrl: PR }]);
    await restore(id);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    const listed = await tasks(id);
    expect(listed).toMatchObject({ thread: id, partial: false });
    expect(listed.tasks).toEqual([
      { taskId: 'desk-panel/run-1', name: 'DESK-1 Gotowy wątek', status: 'failed', mode: 'implementacja', specRevision: 1, url: 'http://127.0.0.1:4321/p/desk-panel/tasks/run-1', branch: 'desk-1-gotowy', prUrl: PR, source: 'rejestr', at: expect.any(Number) },
      { taskId: 'desk-panel/run-2', name: null, status: 'nieznany', mode: 'implementacja', specRevision: 1, url: 'http://127.0.0.1:4321/p/desk-panel/tasks/run-2', branch: null, prUrl: null, source: 'rejestr', at: expect.any(Number) },
    ]);
    expect(listed.tasks[0]!.at).toBeLessThanOrEqual(listed.tasks[1]!.at);
    state.down = true;
    const partial = await tasks(id);
    expect(partial.partial).toBe(true);
    expect(partial.tasks.map(t => [t.taskId, t.status, t.source])).toEqual([['desk-panel/run-1', 'nieznany', 'rejestr'], ['desk-panel/run-2', 'nieznany', 'rejestr']]);
    expect((await fetch(`${(await start()).base}/api/fila/threads/DESK-99/cezar-tasks`)).status).toBe(404);
  });

  it('lista tasków wątku: taski spoza panelu po ID na początku nazwy, surowego tytułu lub brancha (także po przeniesieniu), powiązanie bez wpisu, bez tasków podwątku i bez duplikatów', async () => {
    const { prepared, expectedOf, post, act, tasks, fila, state } = await start();
    // DESK-32 with neighbours DESK-3 and (as names only) DESK-321: the fillers are bare threads, written in one batch.
    await prepared({ title: 'Wątek 1' });
    await fila.applyBatch(Array.from({ length: 30 }, (_, i) => ({ action: 'createThread', project: 'DESK', type: 'sprawa', title: `Wątek ${i + 2}` })), 'claude-code');
    expect(await prepared({ title: 'Wątek 32' })).toBe('DESK-32');
    const child = await prepared({ title: 'Podwątek', parent: 'DESK-32' });
    expect(child).toBe('DESK-33');
    // One task dispatched from the thread, one from its subthread; the subthread's task is even named after the parent.
    expect((await post('DESK-32', { expected: await expectedOf('DESK-32') })).status).toBe(200);
    expect((await post(child, { expected: await expectedOf(child) })).status).toBe(200);
    await act({ action: 'linkCezar', thread: 'DESK-32', kind: 'cezar', id: 'desk-panel/linked', title: 'Dopięty ręcznie' });
    state.snapshot = snapshotOf([
      { id: 'desk-panel/run-1', status: 'running', title: 'DESK-32 Wątek 32' },
      { id: 'desk-panel/run-2', status: 'running', title: 'DESK-32 zlecony z podwątku' },
      { id: 'desk-panel/by-title', status: 'done', title: 'desk-32: poprawka', startedAt: 5 },
      { id: 'desk-panel/by-raw', status: 'failed', title: 'Podsumowanie bez ID', description: 'DESK-32 surowy tytuł', startedAt: 3 },
      { id: 'desk-panel/by-branch', status: 'running', branch: 'desk-32-lista-taskow', startedAt: 4 },
      { id: 'desk-panel/longer', status: 'running', title: 'DESK-321 inny wątek', branch: 'desk-321-x' },
      { id: 'desk-panel/shorter', status: 'running', title: 'DESK-3 inny wątek' },
      { id: 'desk-panel/inside', status: 'running', title: 'Poprawka DESK-32' },
    ]);
    const before = await tasks('DESK-32');
    expect(before.tasks.map(t => [t.taskId, t.source])).toEqual([
      ['desk-panel/by-raw', 'nazwa'], ['desk-panel/by-branch', 'nazwa'], ['desk-panel/by-title', 'nazwa'], ['desk-panel/run-1', 'rejestr'], ['desk-panel/linked', 'powiązanie'],
    ]);
    expect(before.tasks.find(t => t.taskId === 'desk-panel/by-raw')).toMatchObject({ name: 'Podsumowanie bez ID', status: 'failed', mode: null, specRevision: null, url: 'http://127.0.0.1:4321/p/desk-panel/tasks/desk-panel/by-raw', at: 3 });
    expect(before.tasks.find(t => t.taskId === 'desk-panel/linked')).toMatchObject({ name: null, status: 'nieznany', url: null });
    expect((await tasks(child)).tasks.map(t => [t.taskId, t.source])).toEqual([['desk-panel/run-2', 'rejestr']]);
    expect((await tasks('DESK-3')).tasks.map(t => t.taskId)).toEqual(['desk-panel/shorter']);

    // Moved to another project: the tasks named after the former ID are still the thread's.
    await act({ action: 'createProject', key: 'TABL', name: 'Tabularium' });
    const moved = await act({ action: 'updateThread', thread: 'DESK-32', project: 'TABL' });
    expect(moved.thread!.id).toBe('TABL-1');
    expect((await tasks('TABL-1')).tasks.map(t => t.taskId)).toEqual(before.tasks.map(t => t.taskId));
  });

  it('niepewny wynik (błąd Cezara) mówi „sprawdź Cezara”, niczego nie zapisuje i sam nie ponawia', async () => {
    const { created, prepared, expectedOf, post, fila, cockpit, state } = await start({ snapshot: snapshotOf([]), run: 0, fail: true });
    const id = await prepared();
    const response = await post(id, { expected: await expectedOf(id) });
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain('sprawdź Cezara');
    expect(created).toHaveBeenCalledTimes(1);
    expect(cockpit.threadDispatches()).toEqual([]);
    expect((await fila.thread(id)).state).toBe('Gotowe do realizacji');
    expect((await fila.thread(id)).cezar.links).toEqual([]);
    state.fail = false;
  });

  it('blokada ponowień i powiązanie PR przeżywają restart i przeniesienie wątku (nowe ID), a koniec taska nie zmienia Stanu', async () => {
    const first = await start();
    const id = await first.prepared();
    const { uid } = await first.fila.thread(id);
    expect((await first.post(id, { expected: await first.expectedOf(id) })).status).toBe(200);
    first.stop();

    // The panel is started again on the same files, after the thread was moved to another project.
    const second = await start({ snapshot: snapshotOf([{ id: 'desk-panel/run-1', status: 'running' }]), run: 1, fail: false });
    const moved = await second.act({ action: 'updateThread', thread: id, project: 'CEZR', state: 'Gotowe do realizacji' });
    expect(moved.thread).toMatchObject({ id: 'CEZR-1', previousId: 'DESK-1' });
    expect(await second.fila.idOfUid(uid)).toBe('CEZR-1');
    expect((await second.post(id, { expected: await second.expectedOf('CEZR-1') })).status).toBe(404);
    const blocked = await second.post('CEZR-1', { expected: await second.expectedOf('CEZR-1') });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain('desk-panel/run-1');
    expect(second.created).not.toHaveBeenCalled();
    expect((await (await fetch(`${second.base}/api/fila/threads/CEZR-1/cezar-dispatch/register`)).json()).dispatches).toHaveLength(1);

    // The task gets a PR: it lands on the moved thread, once, and the thread's state stays the user's.
    await second.act({ action: 'updateThread', thread: 'CEZR-1', state: 'Do sprawdzenia' });
    await second.cockpit.linkPrs([{ id: 'desk-panel/run-1', pullRequestUrl: PR, title: 'PR wątku' }]);
    await second.cockpit.linkPrs([{ id: 'desk-panel/run-1', pullRequestUrl: PR, title: 'PR wątku' }]);
    const thread = await second.fila.thread('CEZR-1');
    expect(thread.state).toBe('Do sprawdzenia');
    expect(thread.cezar.links.filter(l => l.kind === 'pr')).toEqual([expect.objectContaining({ id: PR, title: 'PR wątku' })]);
    expect(thread.history.filter(h => h.by === 'panel' && h.changes?.some(c => c.field === 'PR'))).toHaveLength(1);
  });

  it('wątek bez zestawu pól Cezara jest niegotowy, a zlecenie jednego wątku nie blokuje drugiego', async () => {
    const { created, prepared, expectedOf, post, act } = await start();
    const a = await prepared();
    const b = await prepared();
    await act({ action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Bez zestawu' });
    const bare = await post('DESK-3', { expected: await expectedOf('DESK-3') });
    expect(bare.status).toBe(409);
    expect((await bare.json()).error).toContain('Brak wykonawcy');
    expect((await post(a, { expected: await expectedOf(a) })).status).toBe(200);
    expect((await post(b, { expected: await expectedOf(b) })).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(2);
  });
});
