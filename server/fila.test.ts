// @vitest-environment node
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { FilaAction, FilaActor } from '../src/fila-contract';
import { createFilaStore, FilaError, type FilaStore } from './fila';

const dirs: string[] = [];
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }); });
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'fila-')); dirs.push(d); return d; };

const act = (store: FilaStore, action: FilaAction, actor: FilaActor = 'claude-code') => store.apply(action, actor);
const refused = async (promise: Promise<unknown>, status: number, text?: RegExp) => {
  const error = await promise.then(() => null, e => e);
  expect(error).toBeInstanceOf(FilaError);
  expect(error.status).toBe(status);
  if (text) expect(error.message).toMatch(text);
};
/** Two projects with modules, so a move has something to match. */
async function seeded(store = createFilaStore()) {
  await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
  await act(store, { action: 'createProject', key: 'CEZR', name: 'Cezar' });
  await act(store, { action: 'setModules', project: 'DESK', modules: ['Wektor', 'Bank'] });
  await act(store, { action: 'setModules', project: 'CEZR', modules: ['Wektor', 'Silnik'] });
  return store;
}

describe('registries and templates', () => {
  it('starts with the workflow Praca (the states of the to-do lists, two closing) and the five type templates', async () => {
    const reg = await createFilaStore().registries();
    expect(reg.projects).toEqual([]);
    expect(reg.workflows[0]!.states.map(s => s.name)).toEqual(['Pomysł', 'Do przygotowania', 'Gotowe do realizacji', 'W realizacji', 'Do sprawdzenia', 'Zakończone', 'Porzucone']);
    expect(reg.workflows[0]!.states.filter(s => s.closing).map(s => s.name)).toEqual(['Zakończone', 'Porzucone']);
    expect(reg.types.map(t => t.label)).toEqual(['Sprawa', 'Funkcja', 'Błąd', 'Notatka', 'Spotkanie']);
    expect(reg.types.every(t => t.workflow === 'w-praca' && t.fields.join() === 'Tagi')).toBe(true);
  });

  it('keeps a project key of four capital letters, unique', async () => {
    const store = createFilaStore();
    await refused(act(store, { action: 'createProject', key: 'desk', name: 'x' }), 400);
    await refused(act(store, { action: 'createProject', key: 'DES', name: 'x' }), 400);
    await act(store, { action: 'createProject', key: 'DESK', name: 'DeskPanel' });
    await refused(act(store, { action: 'createProject', key: 'DESK', name: 'Inny' }), 409);
    expect((await store.registries()).projects.map(p => p.key)).toEqual(['DESK']);
  });
});

describe('threads', () => {
  it('creates a thread with the first state, the type fields and a history entry by the caller', async () => {
    const store = await seeded();
    const made = await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Wektor gubi kontekst', module: 'Wektor' }, 'claude-desktop');
    expect(made.thread).toEqual({ id: 'DESK-1', revision: 1 });
    const t = await store.thread('desk-1');
    expect(t).toMatchObject({ id: 'DESK-1', type: { key: 'blad' }, state: 'Pomysł', closed: false, module: 'Wektor', fields: { Tagi: [] }, createdBy: 'claude-desktop', archived: false });
    expect(t.history).toMatchObject([{ by: 'claude-desktop', kind: 'created' }]);
    await refused(act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'x', module: 'Nie ma' }), 409);
    await refused(act(store, { action: 'createThread', project: 'ZZZZ', type: 'sprawa', title: 'x' }), 404);
  });

  it('closes by state alone and records every change with its author', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Filtr' });
    await act(store, { action: 'updateThread', thread: 'DESK-1', state: 'Zakończone', title: 'Wymienić filtr' }, 'user');
    const t = await store.thread('DESK-1');
    expect(t).toMatchObject({ state: 'Zakończone', closed: true, title: 'Wymienić filtr', revision: 2 });
    expect(t.history.at(-1)).toMatchObject({ by: 'user', kind: 'changed', changes: [{ field: 'Tytuł', from: 'Filtr', to: 'Wymienić filtr' }, { field: 'Stan', from: 'Pomysł', to: 'Zakończone' }] });
    await act(store, { action: 'updateThread', thread: 'DESK-1', state: 'W realizacji' });
    expect((await store.thread('DESK-1')).closed).toBe(false);
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', state: 'Nie ma' }), 409);
  });

  it('refuses a stale expected revision and changes nothing', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'A' });
    await act(store, { action: 'updateThread', thread: 'DESK-1', title: 'B' });
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', title: 'C', expectedRevision: 1 }), 409, /rewizja 1, aktualna 2/);
    expect((await store.thread('DESK-1')).title).toBe('B');
    await act(store, { action: 'updateThread', thread: 'DESK-1', title: 'C', expectedRevision: 2 });
  });

  it('keeps parents across projects, refuses cycles and orphans the children of a deleted parent', async () => {
    const store = await seeded();
    for (const project of ['DESK', 'CEZR', 'DESK'] as const) await act(store, { action: 'createThread', project, type: 'funkcja', title: project });
    await act(store, { action: 'updateThread', thread: 'CEZR-1', parent: 'DESK-1' });
    await act(store, { action: 'updateThread', thread: 'DESK-2', parent: 'CEZR-1' });
    expect(await store.thread('DESK-1')).toMatchObject({ children: ['CEZR-1'], parent: null });
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', parent: 'DESK-2' }), 409, /przodkiem/);
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', parent: 'DESK-1' }), 409);
    await act(store, { action: 'archiveThread', thread: 'DESK-1' });
    await act(store, { action: 'deleteThread', thread: 'DESK-1' }, 'user');
    expect(await store.thread('CEZR-1')).toMatchObject({ parent: null });
    expect((await store.thread('CEZR-1')).history.at(-1)!.changes).toEqual([{ field: 'Rodzic', from: 'DESK-1', to: null }]);
  });
});

describe('moving a thread and changing the workflow', () => {
  it('moves only the named thread: a new ID, the old one in Dawne ID, relations kept, no redirect, numbers not reused', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Rodzic' });
    await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Dziecko', parent: 'DESK-1', module: 'Wektor' });
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'Tagi', value: ['a', 'b'] });
    await act(store, { action: 'createThread', project: 'CEZR', type: 'sprawa', title: 'Inny' });
    const moved = await act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZR' });
    expect(moved.thread).toEqual({ id: 'CEZR-2', revision: 3, previousId: 'DESK-1' });
    await refused(store.thread('DESK-1'), 404);
    const parent = await store.thread('CEZR-2');
    expect(parent).toMatchObject({ fields: { Tagi: ['a', 'b'], 'Dawne ID': ['DESK-1'] }, children: ['DESK-2'], title: 'Rodzic' });
    expect(parent.history.at(-1)).toMatchObject({ kind: 'moved', changes: [{ field: 'ID', from: 'DESK-1', to: 'CEZR-2' }] });
    // The child stays in its project and still points at the moved parent.
    expect(await store.thread('DESK-2')).toMatchObject({ project: 'DESK', parent: 'CEZR-2' });
    // A fresh thread in the source project gets a new number, not the vacated one.
    expect((await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Nowy' })).thread!.id).toBe('DESK-3');
    expect((await store.registries()).fieldDefs).toContainEqual({ name: 'Dawne ID', kind: 'multi' });
  });

  it('keeps a fitting Moduł and refuses the whole move without an explicit choice for one that does not fit', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Bank', module: 'Bank' });
    await act(store, { action: 'createThread', project: 'DESK', type: 'blad', title: 'Wektor', module: 'Wektor' });
    const before = JSON.stringify(await store.thread('DESK-1'));
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZR' }), 409, /Moduł „Bank” nie pasuje/);
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZR', module: 'Nie ma' }), 409);
    expect(JSON.stringify(await store.thread('DESK-1'))).toBe(before);
    expect((await store.registries()).projects.find(p => p.key === 'CEZR')!.nextNumber).toBe(1);
    await act(store, { action: 'updateThread', thread: 'DESK-1', project: 'CEZR', module: null });
    expect(await store.thread('CEZR-1')).toMatchObject({ module: null });
    await act(store, { action: 'updateThread', thread: 'DESK-2', project: 'CEZR' });
    expect(await store.thread('CEZR-2')).toMatchObject({ module: 'Wektor' });
    // A target project with no Moduł values never drops one silently either.
    await act(store, { action: 'createProject', key: 'TABL', name: 'Tabularium' });
    await refused(act(store, { action: 'updateThread', thread: 'CEZR-2', project: 'TABL' }), 409, /module: null/);
  });

  it('asks for a new Stan when the new workflow lacks the current one, and lets the user pick an existing workflow', async () => {
    const store = await seeded();
    const flow = await act(store, { action: 'createWorkflow', name: 'Notatki', states: [{ name: 'Szkic', closing: false }, { name: 'Gotowa', closing: true }] });
    await act(store, { action: 'createThread', project: 'DESK', type: 'notatka', title: 'N' });
    await refused(act(store, { action: 'updateThread', thread: 'DESK-1', workflow: flow.workflow }, 'user'), 409, /podaj nowy Stan/);
    await act(store, { action: 'updateThread', thread: 'DESK-1', workflow: flow.workflow, state: 'Gotowa' }, 'user');
    expect(await store.thread('DESK-1')).toMatchObject({ workflow: { name: 'Notatki' }, state: 'Gotowa', closed: true });
    await act(store, { action: 'updateThread', thread: 'DESK-1', workflow: 'w-praca', state: 'Zakończone' });
    expect((await store.thread('DESK-1')).workflow.id).toBe('w-praca');
  });
});

describe('fields', () => {
  it('adds a custom field with its kind once, checks values by kind, refuses a kind change and reserved names', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'S' });
    await refused(act(store, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 5 }), 400, /rodzaj/);
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 5.5, kind: 'number' });
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'koszt', value: 7 });
    expect((await store.thread('DESK-1')).fields.Koszt).toBe(7);
    await refused(act(store, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 'x' }), 400);
    await refused(act(store, { action: 'setField', thread: 'DESK-1', field: 'Koszt', value: 'x', kind: 'text' }), 409, /odłożona/);
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'Do', value: '2026-11-30', kind: 'date' });
    await refused(act(store, { action: 'setField', thread: 'DESK-1', field: 'Do', value: '2026-02-30' }), 400);
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'Gotowe', value: true, kind: 'bool' });
    await act(store, { action: 'setField', thread: 'DESK-1', field: 'Tagi', value: ['x', 'x', 'y'] });
    expect((await store.thread('DESK-1')).fields.Tagi).toEqual(['x', 'y']);
    for (const field of ['Stan', 'moduł', 'Specyfikacja', 'Kiedy', 'Opis']) await refused(act(store, { action: 'setField', thread: 'DESK-1', field, value: 'x', kind: 'text' }), 400);
    await act(store, { action: 'removeField', thread: 'DESK-1', field: 'Tagi' });
    await refused(act(store, { action: 'removeField', thread: 'DESK-1', field: 'Tagi' }), 404);
    const t = await store.thread('DESK-1');
    expect(Object.keys(t.fields)).toEqual(['Koszt', 'Do', 'Gotowe']);
    expect(t.history.at(-1)!.changes).toEqual([{ field: 'Tagi', from: 'x, y', to: null }]);
  });
});

describe('roles', () => {
  it('lets only the AI edit workflows and Moduł values, only the user delete, and a refusal writes nothing', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'S', module: 'Bank' });
    const snapshot = async () => JSON.stringify([await store.registries(), await store.thread('DESK-1')]);
    const before = await snapshot();
    await refused(act(store, { action: 'setModules', project: 'DESK', modules: ['X'] }, 'user'), 403);
    await refused(act(store, { action: 'createWorkflow', name: 'Nowy', states: [{ name: 'A', closing: false }] }, 'user'), 403);
    await refused(act(store, { action: 'updateWorkflow', workflow: 'w-praca', name: 'Inna' }, 'user'), 403);
    expect(await snapshot()).toBe(before);
    await act(store, { action: 'archiveThread', thread: 'DESK-1' }, 'codex');
    await refused(act(store, { action: 'deleteThread', thread: 'DESK-1' }, 'codex'), 403);
    await refused(act(store, { action: 'deleteThread', thread: 'DESK-1' }, 'wektor'), 403);
    expect((await store.thread('DESK-1')).archived).toBe(true);
    await act(store, { action: 'restoreThread', thread: 'DESK-1' }, 'user');
    await refused(act(store, { action: 'deleteThread', thread: 'DESK-1' }, 'user'), 409, /archiwum/);
    // Definitions in use cannot lose a value, so no thread is left with a state or Moduł that is gone.
    await refused(act(store, { action: 'setModules', project: 'DESK', modules: ['Wektor'] }), 409, /Bank/);
    await refused(act(store, { action: 'updateWorkflow', workflow: 'w-praca', states: [{ name: 'Tylko', closing: false }] }), 409, /Pomysł/);
    await act(store, { action: 'updateWorkflow', workflow: 'w-praca', name: 'Praca nad rzeczami' });
  });

  it('refuses an author, unknown fields and bad ids inside the action', async () => {
    const store = await seeded();
    await refused(store.apply({ action: 'createThread', project: 'DESK', type: 'sprawa', title: 'x', by: 'user' } as never, 'wektor'), 400);
    await refused(store.apply({ action: 'createThread', project: 'DESK', type: 'epik', title: 'x' } as never, 'wektor'), 400);
    await refused(store.apply({ action: 'archiveThread', thread: '1' } as never, 'wektor'), 400);
  });
});

describe('storage', () => {
  it('keeps history, archive and the counters after reopening, and never reuses a number', async () => {
    const file = join(tmp(), 'fila.json');
    const first = await seeded(createFilaStore({ file }));
    await act(first, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Jeden' }, 'claude-desktop');
    await act(first, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Dwa' });
    await act(first, { action: 'comment', thread: 'DESK-2', text: 'Uwaga' }, 'user');
    await act(first, { action: 'archiveThread', thread: 'DESK-2' });
    await act(first, { action: 'deleteThread', thread: 'DESK-2' }, 'user');
    await act(first, { action: 'archiveThread', thread: 'DESK-1' });
    await first.drain();
    const second = createFilaStore({ file });
    const t = await second.thread('DESK-1');
    expect(t).toMatchObject({ archived: true, createdBy: 'claude-desktop' });
    expect(t.history.map(h => h.kind)).toEqual(['created', 'archived']);
    await refused(second.thread('DESK-2'), 404);
    expect((await act(second, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Trzy' })).thread!.id).toBe('DESK-3');
    expect((JSON.parse(readFileSync(file, 'utf8')) as { version: number }).version).toBe(1);
  });

  it('keeps comments in the history with their author, without changing the revision', async () => {
    const store = await seeded();
    await act(store, { action: 'createThread', project: 'DESK', type: 'spotkanie', title: 'S' });
    await act(store, { action: 'comment', thread: 'DESK-1', text: 'Jest ok' }, 'codex');
    const t = await store.thread('DESK-1');
    expect(t.history.at(-1)).toMatchObject({ by: 'codex', kind: 'comment', text: 'Jest ok' });
    expect(t.revision).toBe(1);
  });

  it('loses nothing under 30 concurrent actions: every number once, in order', async () => {
    const file = join(tmp(), 'fila.json');
    const store = await seeded(createFilaStore({ file }));
    const results = await Promise.all(Array.from({ length: 30 }, (_, i) => act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: `W${i}` }, i % 2 ? 'wektor' : 'user')));
    expect(results.map(r => r.thread!.id)).toEqual(Array.from({ length: 30 }, (_, i) => `DESK-${i + 1}`));
    await Promise.all(Array.from({ length: 30 }, (_, i) => act(store, { action: 'comment', thread: `DESK-${i + 1}`, text: 'k' })));
    const reopened = createFilaStore({ file });
    for (const i of [1, 15, 30]) expect((await reopened.thread(`DESK-${i}`)).history).toHaveLength(2);
  }, 30_000);

  it('leaves memory and disk as they were when the write fails', async () => {
    const file = join(tmp(), 'fila.json');
    const store = await seeded(createFilaStore({ file }));
    await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Jeden' });
    const onDisk = readFileSync(file, 'utf8');
    mkdirSync(`${file}.tmp`); // the temporary file cannot be written now
    const error = await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Dwa' }).then(() => null, e => e);
    expect(error).not.toBeNull();
    await refused(store.thread('DESK-2'), 404);
    expect((await store.registries()).projects.find(p => p.key === 'DESK')!.nextNumber).toBe(2);
    expect(readFileSync(file, 'utf8')).toBe(onDisk);
    rmSync(`${file}.tmp`, { recursive: true });
    expect((await act(store, { action: 'createThread', project: 'DESK', type: 'sprawa', title: 'Dwa' })).thread!.id).toBe('DESK-2');
  });

  it('keeps a damaged file aside, says so and starts empty', async () => {
    const dir = tmp();
    const file = join(dir, 'fila.json');
    writeFileSync(file, '{ nie json');
    const store = createFilaStore({ file, now: () => 123 });
    expect((await store.registries()).projects).toEqual([]);
    expect(await store.notice()).toMatch(/uszkodzony/);
    expect(readdirSync(dir)).toEqual(['fila.json.corrupt-123']);
  });
});
