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
import { filaTokens } from './fila-routes';
import type { PanelSources } from './sources';

const SPEC = ['CEL:', 'Cel wątku.', '', 'ZAKRES:', '- Zmiana.', '', 'POZA ZAKRESEM:', '- Nic.', '', 'WARUNKI ODBIORU:', '1. Test.'].join('\n');
const PR = 'https://github.com/metelskiwiktor/desk-panel/pull/77';

let dir = '';
let servers: Server[] = [];
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'fila-dispatch-')); });
afterEach(() => { for (const s of servers.splice(0)) { s.closeAllConnections(); s.close(); } rmSync(dir, { recursive: true, force: true }); });

const snapshotOf = (entries: { id: string; status: 'running' | 'failed' | 'done'; pullRequestUrl?: string }[]): CezarSnapshot => ({
  observedAt: Date.now(), partial: false, scheduled: 0, counts: { running: 0, queue: 0, 'needs-input': 0, review: 0 },
  tasks: entries.filter(e => e.status !== 'failed').map(e => ({ id: e.id, title: 'Task', project: 'desk-panel', status: e.status, checkedAt: Date.now(), description: 'x', sourceUrl: `http://127.0.0.1:4321/p/desk-panel/tasks/${e.id}` })),
  finished: entries.filter(e => e.status === 'failed').map(e => ({ id: e.id, title: 'Task', project: 'desk-panel', status: 'failed' as const, checkedAt: Date.now(), description: 'x', sourceUrl: `http://127.0.0.1:4321/p/desk-panel/tasks/${e.id}` })),
}) as CezarSnapshot;

/** The panel with a real Fila store and cockpit on files in `dir` and a stand-in for Cezar; "restarting" starts it again on the same files. */
async function start(state: { snapshot: CezarSnapshot; run: number; fail: boolean } = { snapshot: snapshotOf([]), run: 0, fail: false }) {
  const fila = createFilaStore({ file: join(dir, 'fila.json') });
  const created = vi.fn(async (input: CezarCreateRunInput) => {
    if (state.fail) throw new Error('timeout');
    state.run += 1;
    return { ok: true as const, id: `desk-panel/run-${state.run}`, project: 'desk-panel', url: `http://127.0.0.1:4321/p/desk-panel/tasks/run-${state.run}`, workflow: input.workflow ?? 'desk-panel-task' };
  });
  const sources = { fila, cezar: async () => state.snapshot, cezarCreateRun: created } as unknown as PanelSources;
  const cockpit = createCockpit({ sources, file: join(dir, 'cockpit.json'), cezarUrl: 'http://127.0.0.1:4321/', gh: async () => '{}' });
  const tokens = filaTokens(join(dir, 'home'));
  const server = createPanelServer(sources, dir, undefined, undefined, { cockpit, filaTokens: tokens });
  servers.push(server);
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const act = (action: FilaAction, actor: 'user' | 'claude-code' = 'claude-code') => fila.apply(action, actor);
  const prepared = async (over: { executor?: 'cezar' | 'lokalnie' | 'rozmowa'; spec?: string } = {}) => {
    if (!(await fila.registries()).projects.length) { await act({ action: 'createProject', key: 'DESK', name: 'DeskPanel' }); await act({ action: 'createProject', key: 'CEZR', name: 'Cezar' }); }
    const id = (await act({ action: 'createThread', project: 'DESK', type: 'funkcja', title: 'Gotowy wątek' })).thread!.id;
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
  return { base, fila, cockpit, created, act, prepared, expectedOf, post, restore, tokens, state, stop };
}

describe('Zlecenie Cezara z wątku Fili (POST /api/fila/threads/ID/cezar-dispatch)', () => {
  it('odrzuca brak i obcy Origin oraz token klienta (403), nieznany wątek (404), zmienione dane (409) i niegotowość z tymi samymi komunikatami co lista, bez zlecenia', async () => {
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
    await act({ action: 'setCezar', thread: id, executor: 'cezar', blocked: 'Czekam na decyzję' });
    const blocked = await post(id, { expected: await expectedOf(id) });
    expect(blocked.status).toBe(409);
    expect((await blocked.json()).error).toContain('blokad');
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
    expect(created).toHaveBeenCalledWith({ task: prompt, title: 'Gotowy wątek', project: 'desk-panel', workflow: 'desk-panel-task' });
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

  it('task w toku albo zakończony sukcesem blokuje (409 z linkiem), nieudany lub nieobecny pozwala ponowić po przywróceniu gotowości', async () => {
    const { created, prepared, expectedOf, post, restore, fila, state } = await start();
    const id = await prepared();
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'running' }]);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    await restore(id);
    const blocked = await post(id, { expected: await expectedOf(id) });
    expect(blocked.status).toBe(409);
    const refused = (await blocked.json()).error as string;
    expect(refused).toContain('desk-panel/run-1');
    expect(refused).toContain('http://127.0.0.1:4321/p/desk-panel/tasks/run-1');
    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'done' }]);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(409);
    expect(created).toHaveBeenCalledTimes(1);

    state.snapshot = snapshotOf([{ id: 'desk-panel/run-1', status: 'failed' }]);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(2);
    expect((await fila.thread(id)).history.filter(h => h.kind === 'comment').at(-1)?.text).toContain('Ponowienie po nieudanym tasku desk-panel/run-1');

    await restore(id);
    state.snapshot = snapshotOf([]);
    expect((await post(id, { expected: await expectedOf(id) })).status).toBe(200);
    expect(created).toHaveBeenCalledTimes(3);
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
