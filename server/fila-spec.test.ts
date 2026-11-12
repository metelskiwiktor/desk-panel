// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilaAction, FilaActor } from '../src/fila-contract';
import { createFilaStore, FilaError, type FilaStore } from './fila';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fila-spec-')); dirs.push(d); return d; };

const act = (store: FilaStore, action: FilaAction, actor: FilaActor = 'claude-code') => store.apply(action, actor);
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
const spec = (store: FilaStore, thread: string, text: string, baseRevision: number, actor: FilaActor = 'claude-code') => act(store, { action: 'setSpec', thread, text, baseRevision }, actor);
async function seeded(store = createFilaStore()) {
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  await act(store, { action: 'createProject', key: 'CEZR', name: 'Cezar' });
  await act(store, { action: 'setModules', project: 'DESK', modules: ['Wektor'] });
  await act(store, { action: 'setModules', project: 'CEZR', modules: ['Wektor'] });
  return store;
}

describe('specifications and their revisions', () => {
  it('gives Funkcja and Błąd the field from the template, any other type gets it on request, and each text is a numbered revision', async () => {
    let clock = 1000;
    const store = await seeded(createFilaStore({ now: () => clock++ }));
    for (const type of ['funkcja', 'blad', 'sprawa'] as const) await act(store, { action: 'createThread', project: 'DESK', type, title: type });
    expect((await store.registries()).types.map(t => t.spec)).toEqual([false, true, true, false, false, false, true]);
    expect((await store.thread('DESK-3')).spec).toEqual({ enabled: false, revision: 0 });
    await refused(spec(store, 'DESK-3', 'x', 0), 409, /addSpecField/);
    await refused(store.spec('DESK-3'), 404);
    await act(store, { action: 'addSpecField', thread: 'DESK-3' }, 'codex');
    expect((await spec(store, 'DESK-1', 'pierwsza', 0, 'claude-desktop')).specRevision).toBe(1);
    expect((await spec(store, 'DESK-1', 'druga', 1, 'codex')).specRevision).toBe(2);
    expect((await spec(store, 'DESK-3', 'trzecia', 0, 'wektor')).specRevision).toBe(1);
    expect(await store.spec('DESK-1', 1)).toMatchObject({ revision: 1, text: 'pierwsza', by: 'claude-desktop', latest: 2 });
    expect(await store.spec('DESK-1', 2)).toMatchObject({ revision: 2, text: 'druga', by: 'codex', latest: 2 });
    expect(await store.spec('DESK-1')).toMatchObject({ revision: 2, text: 'druga' });
    const t = await store.thread('DESK-1');
    expect(t.spec).toEqual({ enabled: true, revision: 2 });
    expect(t.history.filter(h => h.changes?.[0]?.field === 'Specyfikacja').map(h => `${h.by} ${h.changes![0]!.from}>${h.changes![0]!.to}`)).toEqual(['claude-desktop null>v1', 'codex v1>v2']);
    expect((await store.spec('DESK-1', 2)).at).toBeGreaterThan((await store.spec('DESK-1', 1)).at!);
  });

  it('tells apart no revision, an empty revision and a number that does not exist', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'F' });
    expect(await store.spec('DESK-1')).toMatchObject({ revision: 0, text: null, latest: 0 });
    expect((await spec(store, 'DESK-1', '', 0)).specRevision).toBe(0); // a first empty write is a no-op
    expect((await store.thread('DESK-1')).revision).toBe(1);
    await refused(store.spec('DESK-1', 1), 404, /najnowsza: 0/);
    await spec(store, 'DESK-1', 'treść', 0);
    await refused(store.spec('DESK-1', 2), 404);
    await refused(store.spec('DESK-1', 0), 400);
    await refused(store.spec('DESK-1', Number.NaN), 400);
    expect((await spec(store, 'DESK-1', '', 1)).specRevision).toBe(2); // clearing is a new, empty revision
    expect(await store.spec('DESK-1')).toMatchObject({ revision: 2, text: '' });
    expect(await store.spec('DESK-1', 1)).toMatchObject({ text: 'treść' });
  });

  it('refuses a stale base without changing anything, and a repeat of the same text adds no revision', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'B' });
    await spec(store, 'DESK-1', 'a', 0);
    const before = await store.thread('DESK-1');
    await refused(spec(store, 'DESK-1', 'inna', 0), 409, /aktualna 1/);
    await refused(spec(store, 'DESK-1', 'inna', 5), 409);
    expect(await store.thread('DESK-1')).toEqual(before);
    expect((await spec(store, 'DESK-1', 'a', 0)).specRevision).toBe(1); // a retry, even with the old base
    expect((await spec(store, 'DESK-1', 'a', 1)).specRevision).toBe(1);
    expect(await store.thread('DESK-1')).toEqual(before);
    await refused(spec(store, 'DESK-1', 'x'.repeat(50_001), 1), 400);
    expect((await spec(store, 'DESK-1', 'x'.repeat(50_000), 1)).specRevision).toBe(2);
  });

  it('writes only for the AI, and the body cannot name an author', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'F' });
    await refused(spec(store, 'DESK-1', 'x', 0, 'user'), 403);
    await refused(act(store, { action: 'addSpecField', thread: 'DESK-1' }, 'user'), 403);
    await refused(act(store, { action: 'removeSpecField', thread: 'DESK-1' }, 'user'), 403);
    await refused(act(store, { action: 'setSpec', thread: 'DESK-1', text: 'x', baseRevision: 0, by: 'user' } as never), 400);
    expect((await store.spec('DESK-1')).latest).toBe(0);
  });

  it('keeps old revisions when the field is removed, refuses writes then, and restores the last text and numbering when it returns', async () => {
    const file = join(tmp(), 'fila.json');
    const store = await seeded(createFilaStore({ file }));
    await act(store, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'F' });
    await spec(store, 'DESK-1', 'v1 text', 0);
    await spec(store, 'DESK-1', 'v2 text', 1);
    await act(store, { action: 'removeSpecField', thread: 'DESK-1' });
    expect((await store.thread('DESK-1')).spec).toEqual({ enabled: false, revision: 2 });
    expect(await store.spec('DESK-1', 1)).toMatchObject({ text: 'v1 text', enabled: false });
    await refused(store.spec('DESK-1'), 404);
    await refused(spec(store, 'DESK-1', 'nowa', 2), 409);
    const revision = (await store.thread('DESK-1')).revision;
    await act(store, { action: 'removeSpecField', thread: 'DESK-1' }); // already off: nothing happens
    expect((await store.thread('DESK-1')).revision).toBe(revision);
    await act(store, { action: 'addSpecField', thread: 'DESK-1' });
    expect(await store.spec('DESK-1')).toMatchObject({ revision: 2, text: 'v2 text', enabled: true });
    expect((await spec(store, 'DESK-1', 'v3 text', 2)).specRevision).toBe(3);
    await store.drain();
    const reopened = createFilaStore({ file });
    expect(await reopened.spec('DESK-1', 1)).toMatchObject({ text: 'v1 text', by: 'claude-code' });
    expect(await reopened.spec('DESK-1')).toMatchObject({ revision: 3, text: 'v3 text' });
  });

  it('keeps the revisions when the thread is moved, and drops them with a permanent delete', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'funkcja', title: 'F', module: 'Wektor' });
    await spec(store, 'DESK-1', 'treść', 0);
    const moved = await act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZR' });
    expect(moved.thread!.id).toBe('CEZR-1');
    expect(await store.spec('CEZR-1')).toMatchObject({ revision: 1, text: 'treść' });
    await refused(store.spec('DESK-1'), 404);
    await act(store, { action: 'archiveThread', thread: 'CEZR-1' });
    await act(store, { action: 'deleteThread', thread: 'CEZR-1' }, 'user');
    await refused(store.spec('CEZR-1', 1), 404);
  });

  it('reads a thread stored before 1.1b with the template default and no revisions', async () => {
    const file = join(tmp(), 'fila.json');
    const first = await seeded(createFilaStore({ file }));
    await act(first, { action: 'createThread', project: 'DESK', type: 'blad', title: 'B' });
    await first.drain();
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    delete saved.data.threads[0].spec;
    writeFileSync(file, JSON.stringify(saved));
    const store = createFilaStore({ file });
    expect((await store.thread('DESK-1')).spec).toEqual({ enabled: true, revision: 0 });
    expect((await spec(store, 'DESK-1', 'ok', 0)).specRevision).toBe(1);
  });
});
