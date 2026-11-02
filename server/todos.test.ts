import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TODO_LIMITS, todoActionSchema, todoSourceSchema, type TodoData } from '../src/todo-contract';
import { agentViews } from './agent-views';
import { createPanelServer } from './app';
import { createScenarioSources } from './scenario';
import { SourceError } from './sources';
import { TodoError, createTodoStore } from './todos';

let dir: string;
beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), 'desk-todos-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

const LIST = /^l-[0-9a-f]{8}$/, TASK = /^t-[0-9a-f]{8}$/;
const data = async (store: ReturnType<typeof createTodoStore>) => (await store.read()).data!.lists;

describe('listy zadań: sklep', () => {
  it('stan jest niezależny od blokady; done jest pochodne, a odznaczenie wraca do ostatniego otwartego stanu', async () => {
    const store = createTodoStore({ now: () => 123 });
    const list = (await store.apply({ action: 'createList', name: 'L' })).list!.id;
    const task = (await store.apply({ action: 'addTask', list, title: 'Praca' })).task!.id;
    await store.apply({ action: 'setStatus', task, status: 'gotowe', by: 'wektor' });
    await store.apply({ action: 'setBlocked', task, reason: 'Czekamy', by: 'user' });
    expect((await data(store))[0].tasks[0]).toMatchObject({ status: 'gotowe', done: false, completedAt: null, blocked: 'Czekamy' });
    await store.apply({ action: 'setStatus', task, status: 'porzucone' });
    expect((await data(store))[0].tasks[0]).toMatchObject({ status: 'porzucone', done: true, completedAt: 123 });
    await store.apply({ action: 'updateTask', task, done: true });
    expect((await data(store))[0].tasks[0].status).toBe('zakonczone');
    await store.apply({ action: 'updateTask', task, done: false, by: 'wektor' });
    const open = (await data(store))[0].tasks[0];
    expect(open).toMatchObject({ status: 'gotowe', done: false, completedAt: null, blocked: 'Czekamy' });
    expect(open.history).toEqual([
      { at: 123, kind: 'status', from: 'pomysl', to: 'gotowe', by: 'wektor' },
      { at: 123, kind: 'blocked', text: 'Czekamy', by: 'user' },
      { at: 123, kind: 'status', from: 'gotowe', to: 'porzucone', by: 'user' },
      { at: 123, kind: 'status', from: 'porzucone', to: 'zakonczone', by: 'user' },
      { at: 123, kind: 'status', from: 'zakonczone', to: 'gotowe', by: 'wektor' },
    ]);
    await store.apply({ action: 'setBlocked', task, reason: null });
    await store.apply({ action: 'setBlocked', task, reason: null });
    expect((await data(store))[0].tasks[0].history).toHaveLength(6);
  });

  it('powiązania są unikalne i ograniczone, komentarze Markdown zostają w ograniczonej historii', async () => {
    const store = createTodoStore();
    const list = (await store.apply({ action: 'createList', name: 'L' })).list!.id;
    const task = (await store.apply({ action: 'addTask', list, title: 'Praca' })).task!.id;
    const link = { action: 'link' as const, task, kind: 'pr' as const, id: 'https://github.com/owner/repo/pull/1', title: 'PR', by: 'wektor' as const };
    await store.apply(link);
    await store.apply(link);
    expect((await data(store))[0].tasks[0].history).toHaveLength(1);
    for (let i = 1; i < TODO_LIMITS.links; i++) await store.apply({ action: 'link', task, kind: 'chat', id: `chat-${i}` });
    const before = (await data(store))[0].tasks[0];
    await expect(store.apply({ action: 'link', task, kind: 'cezar', id: 'overflow' })).rejects.toMatchObject({ status: 409 });
    expect((await data(store))[0].tasks[0]).toEqual(before);
    await store.apply({ action: 'unlink', task, kind: link.kind, id: link.id });
    await store.apply({ action: 'unlink', task, kind: link.kind, id: link.id });
    expect((await data(store))[0].tasks[0].history.at(-1)).toMatchObject({ kind: 'link', text: `- pr ${link.id}` });
    for (let i = 0; i <= TODO_LIMITS.history; i++) await store.apply({ action: 'addComment', task, text: `**Ustalenie ${i}**`, by: 'wektor' });
    const final = (await data(store))[0].tasks[0];
    expect(final.links).toHaveLength(19);
    expect(final.history).toHaveLength(TODO_LIMITS.history);
    expect(final.history[0]).toMatchObject({ kind: 'comment', text: '**Ustalenie 1**', by: 'wektor' });
    expect(final.history.at(-1)?.text).toBe('**Ustalenie 200**');
  });

  it('v1 migruje tylko w pamięci, pierwszy zapis v2 zachowuje oryginał i nie nadpisuje kopii', async () => {
    const file = path.join(dir, 'v1.json');
    const legacyTask = { id: 't-00000001', title: 'Dawne', note: '', done: false, createdAt: 1, completedAt: null, by: 'user' };
    const original = JSON.stringify({ version: 1, lists: [{ id: 'l-00000001', name: 'Stara', createdAt: 1, tasks: [legacyTask, { ...legacyTask, id: 't-00000002', done: true, completedAt: 10 }] }] });
    await writeFile(file, original);
    const store = createTodoStore({ file });
    const tasks = (await data(store))[0].tasks;
    expect(tasks[0]).toMatchObject({ status: 'pomysl', blocked: null, links: [], history: [], executor: null, repo: null, mode: null });
    expect(tasks[1]).toMatchObject({ status: 'zakonczone', done: true, completedAt: 10 });
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(await readdir(dir)).toEqual(['v1.json']);
    await mkdir(`${file}.tmp`); // a real write failure after making the backup
    await expect(store.apply({ action: 'setStatus', task: tasks[0].id, status: 'gotowe' })).rejects.toBeDefined();
    expect((await data(store))[0].tasks[0]).toMatchObject({ status: 'pomysl', history: [] });
    expect(await readFile(file, 'utf8')).toBe(original);
    await rm(`${file}.tmp`, { recursive: true });
    await store.apply({ action: 'updateTask', task: tasks[1].id, done: false });
    expect((await data(store))[0].tasks[1]).toMatchObject({ status: 'pomysl', done: false });
    expect(await readFile(`${file}.v1-backup`, 'utf8')).toBe(original);
    expect(JSON.parse(await readFile(file, 'utf8')).version).toBe(2);
    // Simulate restoring a v1 file while the backup is already present.
    await writeFile(file, original.replace('Stara', 'Przywrócona'));
    await createTodoStore({ file }).apply({ action: 'setStatus', task: tasks[0].id, status: 'realizacja' });
    expect(await readFile(`${file}.v1-backup`, 'utf8')).toBe(original);
    expect((await data(createTodoStore({ file })))[0].tasks[0].status).toBe('realizacja');
  });
  it('tworzy listę raz (ta sama nazwa, także inną wielkością liter, zwraca istniejącą) i nie przekracza limitu list', async () => {
    const store = createTodoStore();
    const first = await store.apply({ action: 'createList', name: 'Do poprawy - Chat Agy' });
    expect(first.list).toMatchObject({ name: 'Do poprawy - Chat Agy', created: true });
    expect(first.list!.id).toMatch(LIST);
    const again = await store.apply({ action: 'createList', name: 'do poprawy - chat agy' });
    expect(again.list).toEqual({ id: first.list!.id, name: 'Do poprawy - Chat Agy', created: false });
    expect(await data(store)).toHaveLength(1);
    for (let i = 1; i < TODO_LIMITS.lists; i++) await store.apply({ action: 'createList', name: `Lista ${i}` });
    await expect(store.apply({ action: 'createList', name: 'Za dużo' })).rejects.toMatchObject({ status: 409 });
    expect(await data(store)).toHaveLength(TODO_LIMITS.lists);
  });

  it('dodaje zadania na koniec, z autorem (domyślnie użytkownik), czasem i pustą notatką', async () => {
    let at = 1_000;
    const store = createTodoStore({ now: () => at++ });
    const { list } = await store.apply({ action: 'createList', name: 'Dom' });
    const a = await store.apply({ action: 'addTask', list: list!.id, title: 'Żarówki' });
    const b = await store.apply({ action: 'addTask', list: list!.id, title: 'Rachunki', note: 'do piątku', by: 'wektor' });
    expect(a.task!.id).toMatch(TASK);
    const [only] = await data(store);
    expect(only.tasks.map(t => t.title)).toEqual(['Żarówki', 'Rachunki']);
    expect(only.tasks[0]).toMatchObject({ note: '', done: false, completedAt: null, by: 'user' });
    expect(only.tasks[1]).toMatchObject({ id: b.task!.id, note: 'do piątku', by: 'wektor' });
    expect(only.tasks[1].createdAt).toBeGreaterThan(only.tasks[0].createdAt);
  });

  it('zaznaczenie ustawia czas ukończenia, odznaczenie go czyści, a edycja zmienia tylko podane pola', async () => {
    let at = 5_000;
    const store = createTodoStore({ now: () => at++ });
    const { list } = await store.apply({ action: 'createList', name: 'L' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Stary tytuł', note: 'notatka' });
    await store.apply({ action: 'updateTask', task: task!.id, done: true });
    const done = (await data(store))[0].tasks[0];
    expect(done).toMatchObject({ done: true, title: 'Stary tytuł', note: 'notatka' });
    expect(done.completedAt).toBeGreaterThan(done.createdAt);
    const completedAt = done.completedAt;
    await store.apply({ action: 'updateTask', task: task!.id, done: true });
    expect((await data(store))[0].tasks[0].completedAt).toBe(completedAt); // ticking again changes nothing
    await store.apply({ action: 'updateTask', task: task!.id, done: false, title: 'Nowy tytuł' });
    expect((await data(store))[0].tasks[0]).toMatchObject({ done: false, completedAt: null, title: 'Nowy tytuł', note: 'notatka' });
  });

  it('metadane wykonania: ustawienie i wyczyszczenie samych pól przeżywa restart, bez historii; zły enum i konflikt spec odrzucają całą akcję', async () => {
    const file = path.join(dir, 'meta.json');
    let at = 100;
    const store = createTodoStore({ file, now: () => at++ });
    const { list } = await store.apply({ action: 'createList', name: 'Meta' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Zadanie' });
    const id = task!.id;
    expect((await data(store))[0].tasks[0]).toMatchObject({ executor: null, repo: null, mode: null });
    await store.apply({ action: 'updateTask', task: id, executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    const set = (await data(store))[0].tasks[0];
    expect(set).toMatchObject({ executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    expect(set.history).toEqual([]);
    expect(JSON.parse(await readFile(file, 'utf8')).lists[0].tasks[0]).toMatchObject({ executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    await store.apply({ action: 'updateTask', task: id, executor: null });
    const restarted = (await data(createTodoStore({ file })))[0].tasks[0];
    expect(restarted).toMatchObject({ executor: null, repo: 'desk-panel', mode: 'implementacja' });
    expect(restarted.history).toEqual([]);
    // A spec conflict rejects the whole action, metadata included.
    await store.apply({ action: 'updateTask', task: id, spec: 'v1', specRevision: 0 });
    await expect(store.apply({ action: 'updateTask', task: id, spec: 'v2', specRevision: 0, mode: 'analiza' })).rejects.toMatchObject({ status: 409 });
    expect((await data(store))[0].tasks[0]).toMatchObject({ spec: 'v1', specRevision: 1, mode: 'implementacja' });
    // An unknown enum is refused by the schema before anything is touched.
    const before = (await data(store))[0].tasks[0];
    await expect(store.apply({ action: 'updateTask', task: id, executor: 'agent' } as never)).rejects.toMatchObject({ status: 400 });
    expect((await data(store))[0].tasks[0]).toEqual(before);
  });

  it('przenosi zadanie między listami, a pełna lista docelowa odmawia bez żadnej zmiany', async () => {
    const store = createTodoStore();
    const a = (await store.apply({ action: 'createList', name: 'A' })).list!.id;
    const b = (await store.apply({ action: 'createList', name: 'B' })).list!.id;
    const { task } = await store.apply({ action: 'addTask', list: a, title: 'X' });
    await store.apply({ action: 'moveTask', task: task!.id, list: b });
    expect((await data(store)).map(l => l.tasks.length)).toEqual([0, 1]);
    await store.apply({ action: 'moveTask', task: task!.id, list: b }); // already there
    expect((await data(store)).map(l => l.tasks.length)).toEqual([0, 1]);
    for (let i = 0; i < TODO_LIMITS.tasksPerList; i++) await store.apply({ action: 'addTask', list: a, title: `t${i}` });
    await expect(store.apply({ action: 'moveTask', task: task!.id, list: a })).rejects.toMatchObject({ status: 409 });
    await expect(store.apply({ action: 'addTask', list: a, title: 'jeszcze' })).rejects.toMatchObject({ status: 409 });
    expect((await data(store)).map(l => l.tasks.length)).toEqual([TODO_LIMITS.tasksPerList, 1]);
  });

  it('usuwa zadanie, czyści ukończone i usuwa listę, podając ile zadań zniknęło', async () => {
    const store = createTodoStore();
    const list = (await store.apply({ action: 'createList', name: 'L' })).list!.id;
    const ids: string[] = [];
    for (const title of ['a', 'b', 'c']) ids.push((await store.apply({ action: 'addTask', list, title })).task!.id);
    await store.apply({ action: 'updateTask', task: ids[0], done: true });
    await store.apply({ action: 'updateTask', task: ids[1], done: true });
    expect((await store.apply({ action: 'deleteTask', task: ids[2] })).removed).toBe(1);
    expect((await store.apply({ action: 'clearDone', list })).removed).toBe(2);
    expect((await data(store))[0].tasks).toEqual([]);
    await store.apply({ action: 'addTask', list, title: 'd' });
    expect((await store.apply({ action: 'deleteList', list })).removed).toBe(1);
    expect(await data(store)).toEqual([]);
  });

  it('ukrywanie ukończonych i znak agenta to ustawienia listy: domyślnie wyłączone, zapisywane w pliku, a lista bez tego pola (stary plik) też się wczytuje', async () => {
    const store = createTodoStore({ file: path.join(dir, 'hide.json') });
    const a = (await store.apply({ action: 'createList', name: 'A' })).list!.id;
    await store.apply({ action: 'createList', name: 'B' });
    expect((await data(store)).map(l => l.hideDone)).toEqual([false, false]);
    expect(await store.apply({ action: 'setListOptions', list: a, hideDone: true })).toMatchObject({ ok: true, list: { id: a } });
    expect((await data(store)).map(l => l.hideDone)).toEqual([true, false]); // only that list
    await expect(store.apply({ action: 'setListOptions', list: 'l-00000000', hideDone: true })).rejects.toThrow('Nie ma takiej listy.');
    await store.apply({ action: 'setListOptions', list: a, showAgent: true });
    expect((await data(store)).map(l => [l.hideDone, l.showAgent])).toEqual([[true, true], [false, false]]); // each option on its own
    expect(todoActionSchema.safeParse({ action: 'setListOptions', list: a }).success).toBe(false); // nothing to change
    await store.drain();
    expect((await data(createTodoStore({ file: path.join(dir, 'hide.json') }))).map(l => l.hideDone)).toEqual([true, false]);
    await writeFile(path.join(dir, 'old.json'), JSON.stringify({ version: 1, lists: [{ id: 'l-22222222', name: 'Stara', createdAt: 1, tasks: [] }] }), 'utf8');
    expect((await data(createTodoStore({ file: path.join(dir, 'old.json') })))[0]).toMatchObject({ name: 'Stara', hideDone: false, showAgent: false });
  });

  it('macierz zapisu specyfikacji: pierwszy pusty zapis to no-op, zgodny numer tworzy wersję, identyczna treść to sukces bez nowej wersji, niezgodny daje 409, wyczyszczenie tworzy pustą wersję, retencja trzyma 10 ostatnich', async () => {
    let at = 10_000;
    const store = createTodoStore({ now: () => at++ });
    const { list } = await store.apply({ action: 'createList', name: 'L' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Zadanie' });
    const id = task!.id;

    // 1. Początkowo brak rewizji
    let current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('');
    expect(current.specRevision).toBe(0);
    expect(current.specRevisions).toEqual([]);

    // 2. Pierwszy pusty zapis nie tworzy wersji (no-op)
    await store.apply({ action: 'updateTask', task: id, spec: '', specRevision: 0 });
    current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('');
    expect(current.specRevision).toBe(0);
    expect(current.specRevisions).toEqual([]);

    // 3. Treść różna i numer zgodny (0) -> tworzy wersję v1
    await store.apply({ action: 'updateTask', task: id, spec: 'Spec v1', specRevision: 0, by: 'user' });
    current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('Spec v1');
    expect(current.specRevision).toBe(1);
    expect(current.specRevisions).toHaveLength(1);
    expect(current.specRevisions[0]).toMatchObject({ revision: 1, spec: 'Spec v1', by: 'user' });
    expect(current.history.at(-1)).toMatchObject({ kind: 'spec', text: 'v1', by: 'user' });

    // 4. Identyczna treść z dowolnym oczekiwanym numerem -> sukces bez nowej rewizji (bezpieczne ponowienie)
    for (const rev of [0, 1, 99]) {
      await store.apply({ action: 'updateTask', task: id, spec: 'Spec v1', specRevision: rev });
      current = (await data(store))[0].tasks[0];
      expect(current.specRevision).toBe(1);
      expect(current.specRevisions).toHaveLength(1);
    }

    // 5. Treść różna i niezgodny numer -> 409 i brak zmian
    await expect(store.apply({ action: 'updateTask', task: id, spec: 'Spec v2', specRevision: 0 })).rejects.toMatchObject({ status: 409 });
    await expect(store.apply({ action: 'updateTask', task: id, spec: 'Spec v2', specRevision: 2 })).rejects.toMatchObject({ status: 409 });
    current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('Spec v1');
    expect(current.specRevision).toBe(1);

    // 6. Treść różna i zgodny numer (1) -> tworzy v2
    await store.apply({ action: 'updateTask', task: id, spec: 'Spec v2', specRevision: 1, by: 'wektor' });
    current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('Spec v2');
    expect(current.specRevision).toBe(2);
    expect(current.specRevisions).toHaveLength(2);

    // 7. Wyczyszczenie niepustej specyfikacji tworzy pustą rewizję v3; następny zapis bazuje na 3
    await store.apply({ action: 'updateTask', task: id, spec: '', specRevision: 2 });
    current = (await data(store))[0].tasks[0];
    expect(current.spec).toBe('');
    expect(current.specRevision).toBe(3);
    expect(current.specRevisions).toHaveLength(3);
    expect(current.specRevisions.at(-1)).toMatchObject({ revision: 3, spec: '' });

    // 8. Kolejny zapis oczekuje 3 i tworzy v4
    await store.apply({ action: 'updateTask', task: id, spec: 'Spec v4', specRevision: 3 });
    current = (await data(store))[0].tasks[0];
    expect(current.specRevision).toBe(4);

    // 9. Zapisy aż do 12: numery rosną, po 12 zapisach zostają v3–v12 (10 ostatnich), v1 i v2 wypadają z retencji
    for (let r = 4; r < 12; r++) {
      await store.apply({ action: 'updateTask', task: id, spec: `Spec v${r + 1}`, specRevision: r });
    }
    current = (await data(store))[0].tasks[0];
    expect(current.specRevision).toBe(12);
    expect(current.specRevisions).toHaveLength(10);
    expect(current.specRevisions.map(r => r.revision)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  });

  it('updateTask jest atomowy: błąd 409 na spec nie zapisuje jednocześnie przesłanego tytułu ani notatki', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'L' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Oryginalny tytuł', note: 'Oryginalna notatka' });
    await store.apply({ action: 'updateTask', task: task!.id, spec: 'Spec v1', specRevision: 0 });

    await expect(store.apply({
      action: 'updateTask',
      task: task!.id,
      title: 'Zmieniony tytuł',
      note: 'Zmieniona notatka',
      spec: 'Nowa specyfikacja',
      specRevision: 999,
    })).rejects.toMatchObject({ status: 409 });

    const current = (await data(store))[0].tasks[0];
    expect(current.title).toBe('Oryginalny tytuł');
    expect(current.note).toBe('Oryginalna notatka');
    expect(current.spec).toBe('Spec v1');
    expect(current.specRevision).toBe(1);
  });

  it('odmowa nic nie zmienia: nieznana lista i zadanie to 404 z powodem, zajęta nazwa przy zmianie nazwy to 409', async () => {
    const store = createTodoStore();
    const a = (await store.apply({ action: 'createList', name: 'A' })).list!.id;
    await store.apply({ action: 'createList', name: 'B' });
    const before = JSON.stringify(await data(store));
    await expect(store.apply({ action: 'addTask', list: 'l-00000000', title: 'x' })).rejects.toThrow('Nie ma takiej listy.');
    await expect(store.apply({ action: 'updateTask', task: 't-00000000', done: true })).rejects.toThrow('Nie ma takiego zadania.');
    await expect(store.apply({ action: 'renameList', list: a, name: 'b' })).rejects.toMatchObject({ status: 409, message: 'Lista o takiej nazwie już jest.' });
    await store.apply({ action: 'renameList', list: a, name: 'a' }); // only the case changes: allowed, it is the same list
    expect(JSON.stringify(await data(store))).toBe(before.replace('"name":"A"', '"name":"a"'));
    await expect(store.apply({ action: 'deleteList', list: 'l-ffffffff' })).rejects.toBeInstanceOf(TodoError);
    await expect(store.apply({ action: 'deleteList', list: 'l-ffffffff' })).rejects.toBeInstanceOf(SourceError);
  });

  it('zaczyna od danych początkowych i zwraca kopie, których zmiana nie rusza stanu', async () => {
    const initial: TodoData = { lists: [{ id: 'l-11111111', name: 'Start', createdAt: 1, hideDone: false, showAgent: false, tasks: [] }] };
    const store = createTodoStore({ initial });
    (await store.read()).data!.lists[0].name = 'zmienione z zewnątrz';
    expect((await data(store))[0].name).toBe('Start');
    expect(initial.lists[0].name).toBe('Start');
  });
});

describe('listy zadań: plik', () => {
  const file = () => path.join(dir, 'sub', 'todos.json');

  it('zapisuje całość atomowo (bez pliku tymczasowego) i po restarcie odczytuje to samo', async () => {
    const store = createTodoStore({ file: file() });
    const list = (await store.apply({ action: 'createList', name: 'Zapisana' })).list!.id;
    await store.apply({ action: 'addTask', list, title: 'Przetrwa restart', by: 'wektor' });
    await store.drain();
    expect(await readdir(path.join(dir, 'sub'))).toEqual(['todos.json']);
    const raw = JSON.parse(await readFile(file(), 'utf8'));
    expect(raw.version).toBe(2);
    const restarted = createTodoStore({ file: file() });
    const source = await restarted.read();
    expect(todoSourceSchema.safeParse(source).success).toBe(true);
    expect(source.data!.lists[0].tasks[0]).toMatchObject({ title: 'Przetrwa restart', by: 'wektor' });
    expect(source.message).toBeUndefined();
  });

  it('wiele zmian naraz nie gubi żadnej: wszystkie są w kolejności i w pliku', async () => {
    const store = createTodoStore({ file: file() });
    const list = (await store.apply({ action: 'createList', name: 'Równolegle' })).list!.id;
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.apply({ action: 'addTask', list, title: `zadanie ${i}`, by: i % 2 ? 'wektor' : 'user' })));
    const titles = (await data(store))[0].tasks.map(t => t.title);
    expect(titles).toEqual(Array.from({ length: 25 }, (_, i) => `zadanie ${i}`));
    expect(JSON.parse(await readFile(file(), 'utf8')).lists[0].tasks).toHaveLength(25);
  });

  it('uszkodzony plik jest odkładany na bok, a panel zaczyna od pustych list i mówi o tym', async () => {
    await writeFile(path.join(dir, 'todos.json'), '{"version":1,"lists":[{"id":"zły"}]}', 'utf8');
    const store = createTodoStore({ file: path.join(dir, 'todos.json'), now: () => 42 });
    const source = await store.read();
    expect(source.data!.lists).toEqual([]);
    expect(source.message).toContain('todos.json.corrupt-42');
    expect(await readFile(path.join(dir, 'todos.json.corrupt-42'), 'utf8')).toContain('zły');
    await store.apply({ action: 'createList', name: 'Od nowa' });
    expect(JSON.parse(await readFile(path.join(dir, 'todos.json'), 'utf8')).lists).toHaveLength(1);
  });

  it('gdy zapis się nie uda, zmiana jest wycofana z pamięci i następne akcje działają', async () => {
    await writeFile(path.join(dir, 'zajete'), 'to jest plik, nie katalog', 'utf8');
    const store = createTodoStore({ file: path.join(dir, 'zajete', 'todos.json') });
    await expect(store.apply({ action: 'createList', name: 'Nie zapisze się' })).rejects.toBeDefined();
    expect(await data(store)).toEqual([]);
    await expect(store.apply({ action: 'createList', name: 'Nadal nie' })).rejects.toBeDefined();
    expect(await data(store)).toEqual([]);
  });

  it('brak pliku to puste listy bez komunikatu', async () => {
    const source = await createTodoStore({ file: path.join(dir, 'nie-ma.json') }).read();
    expect(source).toMatchObject({ status: 'connected', data: { lists: [] } });
    expect(source.message).toBeUndefined();
  });

  it('specyfikacja 50 000 jednostek UTF-16 z polskimi znakami, emoji i nowymi liniami zapisuje się bez zmian i przeżywa restart', async () => {
    const file = path.join(dir, 'spec-50k.json');
    const store = createTodoStore({ file });
    const { list } = await store.apply({ action: 'createList', name: 'L' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Duża specyfikacja' });
    const segment = 'Zażółć gęślą jaźń 🚀\n';
    const text = segment.repeat(Math.ceil(50_000 / segment.length)).slice(0, 50_000);
    expect(text.length).toBe(50_000);

    await store.apply({ action: 'updateTask', task: task!.id, spec: text, specRevision: 0 });
    await store.drain();

    const restarted = createTodoStore({ file });
    const source = await restarted.read();
    const saved = source.data!.lists[0].tasks[0];
    expect(saved.spec).toBe(text);
    expect(saved.specRevision).toBe(1);
    expect(saved.specRevisions).toHaveLength(1);
    expect(saved.specRevisions[0].spec).toBe(text);
  });

  it('błąd zapisu pliku przy updateTask ze specyfikacją wycofuje całą zmianę z pamięci (atomowość plikowa)', async () => {
    const file = path.join(dir, 'atom.json');
    const store = createTodoStore({ file });
    const { list } = await store.apply({ action: 'createList', name: 'L' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'T', note: 'N' });
    await store.apply({ action: 'updateTask', task: task!.id, spec: 'v1', specRevision: 0 });
    await store.drain();

    // Blokujemy zapis (zastępujemy plik katalogiem, więc rename temp -> file rzuci błąd)
    await rm(file);
    await mkdir(file);

    await expect(store.apply({ action: 'updateTask', task: task!.id, title: 'Nowy', note: 'Nowa', spec: 'v2', specRevision: 1 })).rejects.toBeDefined();
    const current = (await data(store))[0].tasks[0];
    expect(current.title).toBe('T');
    expect(current.note).toBe('N');
    expect(current.spec).toBe('v1');
    expect(current.specRevision).toBe(1);
  });

  it('plik v1 i v2 bez specyfikacji wczytuje się bez utraty danych (z aliasem autora agent -> wektor) i bez tworzenia rewizji', async () => {
    const file1 = path.join(dir, 'legacy-v1.json');
    await writeFile(file1, JSON.stringify({
      version: 1,
      lists: [{
        id: 'l-11111111', name: 'Stara V1', createdAt: 100, hideDone: false, showAgent: false,
        tasks: [{ id: 't-11111111', title: 'Zadanie V1', note: 'Notatka V1', done: false, createdAt: 100, completedAt: null, by: 'agent' }]
      }]
    }), 'utf8');
    const store1 = createTodoStore({ file: file1 });
    const s1 = await store1.read();
    expect(s1.data!.lists[0].tasks[0]).toMatchObject({
      title: 'Zadanie V1', note: 'Notatka V1', by: 'wektor', spec: '', specRevision: 0, specRevisions: []
    });

    const file2 = path.join(dir, 'legacy-v2.json');
    await writeFile(file2, JSON.stringify({
      version: 2,
      lists: [{
        id: 'l-22222222', name: 'Stara V2', createdAt: 200, hideDone: true, showAgent: true,
        tasks: [{ id: 't-22222222', title: 'Zadanie V2', note: 'Notatka V2', done: true, createdAt: 200, completedAt: 250, by: 'user', status: 'zakonczone', blocked: null, links: [], history: [] }]
      }]
    }), 'utf8');
    const store2 = createTodoStore({ file: file2 });
    const s2 = await store2.read();
    expect(s2.data!.lists[0].tasks[0]).toMatchObject({
      title: 'Zadanie V2', note: 'Notatka V2', spec: '', specRevision: 0, specRevisions: []
    });
  });

  it('retencja historii (200 wpisów) nie usuwa zapisanych pełnych rewizji specyfikacji', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'Retencja' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Task' });
    await store.apply({ action: 'updateTask', task: task!.id, spec: 'Pełna treść specyfikacji', specRevision: 0 });

    for (let i = 0; i <= TODO_LIMITS.history + 10; i++) {
      await store.apply({ action: 'addComment', task: task!.id, text: `Komentarz ${i}` });
    }

    const current = (await data(store))[0].tasks[0];
    expect(current.history).toHaveLength(TODO_LIMITS.history);
    expect(current.spec).toBe('Pełna treść specyfikacji');
    expect(current.specRevision).toBe(1);
    expect(current.specRevisions).toHaveLength(1);
    expect(current.specRevisions[0].spec).toBe('Pełna treść specyfikacji');
  });
});

describe('akcje: schemat', () => {
  it.each<[string, unknown]>([
    ['nieznana akcja', { action: 'nuke' }],
    ['dodatkowe pole', { action: 'createList', name: 'x', extra: 1 }],
    ['złe id listy', { action: 'addTask', list: 'abc', title: 'x' }],
    ['id zadania zamiast listy', { action: 'deleteList', list: 't-aaaaaaaa' }],
    ['pusty tytuł', { action: 'addTask', list: 'l-aaaaaaaa', title: '   ' }],
    ['zbyt długi tytuł', { action: 'addTask', list: 'l-aaaaaaaa', title: 'x'.repeat(TODO_LIMITS.title + 1) }],
    ['zła wartość by', { action: 'addTask', list: 'l-aaaaaaaa', title: 'x', by: 'ktoś' }],
    ['updateTask bez zmiany', { action: 'updateTask', task: 't-aaaaaaaa' }],
    ['updateTask ze spec bez specRevision', { action: 'updateTask', task: 't-aaaaaaaa', spec: 'x' }],
    ['updateTask ze specRevision bez spec', { action: 'updateTask', task: 't-aaaaaaaa', specRevision: 1 }],
    ['zły executor', { action: 'updateTask', task: 't-aaaaaaaa', executor: 'agent' }],
    ['złe repo', { action: 'updateTask', task: 't-aaaaaaaa', repo: 'cezar' }],
    ['zły tryb', { action: 'updateTask', task: 't-aaaaaaaa', mode: 'wdrożenie' }],
    ['zbyt długa specyfikacja (>50k)', { action: 'updateTask', task: 't-aaaaaaaa', spec: 'x'.repeat(TODO_LIMITS.spec + 1), specRevision: 0 }],
    ['nieznany stan', { action: 'setStatus', task: 't-aaaaaaaa', status: 'done' }],
    ['długa blokada', { action: 'setBlocked', task: 't-aaaaaaaa', reason: 'x'.repeat(301) }],
    ['długi komentarz', { action: 'addComment', task: 't-aaaaaaaa', text: 'x'.repeat(2001) }],
    ['pusty komentarz', { action: 'addComment', task: 't-aaaaaaaa', text: ' ' }],
    ...['http://github.com/o/r/pull/1', 'https://evil.com/o/r/pull/1', 'https://github.com/o/r/issues/1', 'https://github.com/o/r/pull/1?x=1', 'https://github.com/o/r/pull/0', 'https://github.com/o/../pull/1', 'https://github.com/o/./pull/1', 'https://github.com/invalid_owner/r/pull/1'].map<[string, unknown]>(id => ['zły PR', { action: 'link', task: 't-aaaaaaaa', kind: 'pr', id }]),
  ])('odrzuca %s', (_, body) => { expect(todoActionSchema.safeParse(body).success).toBe(false); });
  it('same metadane wykonania wystarczą, by updateTask miał co zmienić', () => {
    expect(todoActionSchema.safeParse({ action: 'updateTask', task: 't-aaaaaaaa', executor: 'cezar' }).success).toBe(true);
    expect(todoActionSchema.safeParse({ action: 'updateTask', task: 't-aaaaaaaa', repo: 'desk-panel' }).success).toBe(true);
    expect(todoActionSchema.safeParse({ action: 'updateTask', task: 't-aaaaaaaa', mode: null }).success).toBe(true);
  });

  it('przycina spacje z nazw i tytułów', () => {
    expect(todoActionSchema.parse({ action: 'createList', name: '  Dom  ' })).toEqual({ action: 'createList', name: 'Dom' });
  });

  it('specyfikacja 50 000 jednostek UTF-16 z polskimi znakami i emoji przechodzi schemat', () => {
    const segment = 'Zażółć gęślą jaźń 🚀\n';
    const text = segment.repeat(Math.ceil(50_000 / segment.length)).slice(0, 50_000);
    expect(text.length).toBe(50_000);
    const parsed = todoActionSchema.safeParse({ action: 'updateTask', task: 't-aaaaaaaa', spec: text, specRevision: 0 });
    expect(parsed.success).toBe(true);
  });
});

describe('trasa /api/todos (scenariusz standardowy)', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  const start = async (scenario = 'standard') => {
    const sources = createScenarioSources(path.join(process.cwd(), 'scenarios', `${scenario}.json`));
    server = createPanelServer(sources, dir).listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (body: unknown, origin: string | null = base) => fetch(`${base}/api/todos/action`, {
      method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
    });
    const get = async () => todoSourceSchema.parse(await (await fetch(`${base}/api/todos`)).json());
    return { base, post, get };
  };

  it('GET oddaje listy ze scenariusza zgodne z kontraktem', async () => {
    const { get } = await start();
    const source = await get();
    expect(source.data!.lists.map(l => l.name)).toEqual(['Do poprawy - Chat Agy', 'Dom']);
    expect(source.data!.lists[0].tasks.filter(t => t.done)).toHaveLength(1);
  });

  it('zapis wymaga Origin panelu, błędne ciało to 400 z wyjaśnieniem, a odmowa niesie powód', async () => {
    const { post } = await start();
    const body = { action: 'createList', name: 'Nowa' };
    expect((await post(body, null)).status).toBe(403);
    expect((await post(body, 'http://evil.example')).status).toBe(403);
    const bad = await post({ action: 'nuke' });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toContain('l-…');
    expect((await post('{nie json')).status).toBe(400);
    const missing = await post({ action: 'addTask', list: 'l-00000000', title: 'x' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'Nie ma takiej listy.' });
    for (const action of [
      { action: 'setStatus', status: 'gotowe' }, { action: 'setBlocked', reason: 'Blokada' },
      { action: 'addComment', text: 'Ustalenie' }, { action: 'link', kind: 'chat', id: 'c' }, { action: 'unlink', kind: 'chat', id: 'c' },
    ]) {
      const body = { ...action, task: 't-a0000001' };
      expect((await post(body, null)).status).toBe(403);
      expect((await post(body, 'http://evil.example')).status).toBe(403);
      expect((await post(body)).status).toBe(200);
    }
    expect((await post(JSON.stringify({ action: 'addComment', task: 't-a0000001', text: 'x'.repeat(4100) }))).status).toBe(413);
  });

  it('dodane zadanie jest od razu w liście, z id w odpowiedzi, i znika z widoku po zaznaczeniu', async () => {
    const { post, get } = await start();
    const target = (await get()).data!.lists[1].id;
    const added = await post({ action: 'addTask', list: target, title: 'Zadzwonić do hydraulika', by: 'agent' });
    expect(added.status).toBe(200);
    const { ok, task } = await added.json();
    expect(ok).toBe(true);
    expect(task.id).toMatch(TASK);
    const mine = (await get()).data!.lists[1].tasks.find(t => t.id === task.id);
    expect(mine).toMatchObject({ title: 'Zadzwonić do hydraulika', by: 'wektor', done: false });
    expect((await post({ action: 'updateTask', task: task.id, done: true })).status).toBe(200);
    expect((await get()).data!.lists[1].tasks.find(t => t.id === task.id)!.done).toBe(true);
  });

  it('polskie znaki w tytule i notatce przechodzą przez HTTP bez zmian, także w dużym ciele', async () => {
    const { post, get } = await start();
    const list = (await get()).data!.lists[1].id;
    const title = 'Kupić mleko, żółć i łyżkę ćwikły';
    const note = 'zażółć gęślą jaźń '.repeat(100);
    expect((await post({ action: 'addTask', list, title, note })).status).toBe(200);
    const added = (await get()).data!.lists[1].tasks.at(-1)!;
    expect(added.title).toBe(title);
    expect(added.note).toBe(note);
  });

  it('scenariusz bez pola todos ma puste, połączone listy, a z $error odpowiada tym błędem', async () => {
    const { get } = await start('empty');
    expect((await get()).data).toEqual({ lists: [] });
    server!.close();
    const sources = createScenarioSources(path.join(dir, 'scenario.json'));
    const scenario = JSON.parse(await readFile(path.join(process.cwd(), 'scenarios', 'empty.json'), 'utf8'));
    await writeFile(path.join(dir, 'scenario.json'), JSON.stringify({ ...scenario, todos: { $error: 502 } }), 'utf8');
    await expect(sources.todos()).rejects.toMatchObject({ status: 502 });
  });

  it('limit ciała wynosi 512 KiB dla updateTask ze spec i 4096 B dla reszty, zły Origin to 403, a dane nie ulegają zmianie', async () => {
    const { post, get } = await start();
    const task = (await get()).data!.lists[0].tasks[0].id;

    // updateTask ze specyfikacją do 512 KiB przechodzi
    const bigSpec = 'Zażółć gęślą jaźń 🚀\n'.repeat(2000);
    const okRes = await post({ action: 'updateTask', task, spec: bigSpec, specRevision: 0 });
    expect(okRes.status).toBe(200);

    // updateTask ze spec przekraczający 512 KiB daje 413
    const tooBigBody = JSON.stringify({ action: 'updateTask', task, spec: 'x'.repeat(50_000), specRevision: 0, padding: 'x'.repeat(500_000) });
    expect(Buffer.byteLength(tooBigBody, 'utf8')).toBeGreaterThan(512 * 1024);
    expect((await post(tooBigBody)).status).toBe(413);

    // Inna akcja (np. addComment) powyżej 4096 B daje 413
    const oversizedComment = JSON.stringify({ action: 'addComment', task, text: 'x'.repeat(4100) });
    expect((await post(oversizedComment)).status).toBe(413);

    // updateTask bez specyfikacji powyżej 4096 B daje 413
    const oversizedUpdate = JSON.stringify({ action: 'updateTask', task, note: 'x'.repeat(100), padding: 'x'.repeat(4000) });
    expect((await post(oversizedUpdate)).status).toBe(413);

    // Zły Origin lub brak Origin zwraca 403 i nie zmienia danych
    const evilRes = await post({ action: 'updateTask', task, spec: 'Evil', specRevision: 1 }, 'http://evil.example');
    expect(evilRes.status).toBe(403);
    const noOriginRes = await post({ action: 'updateTask', task, spec: 'NoOrigin', specRevision: 1 }, null);
    expect(noOriginRes.status).toBe(403);

    // Sprawdzenie, że stan zadania nie zmienił się pod wpływem 403/413
    const current = (await get()).data!.lists[0].tasks[0];
    expect(current.spec).toBe(bigSpec);
    expect(current.specRevision).toBe(1);
  });
});

describe('widok dla agenta: zadania', () => {
  const sources = createScenarioSources(path.join(process.cwd(), 'scenarios/standard.json'));
  const view = (query = '') => agentViews(sources).todos(new URL(`http://x/api/agent/todos${query}`), Date.now());

  it('pokazuje listy z id, zadania do zrobienia z id, autorem i notatką, a ukończone tylko liczy', async () => {
    const text = await view();
    expect(text.split('\n')[0]).toContain('nie zadania Cezara');
    expect(text).toContain('Lista „Do poprawy - Chat Agy” (id=l-1a2b3c4d): do zrobienia 2, ukończonych 1');
    expect(text).toMatch(/\[ \] t-a0000001  Agent nie wie, ile ma limitu na dziś \(dodał wektor, \d{4}-\d{2}-\d{2}\) — Dodać limity AI/);
    expect(text).toContain('Lista „Dom” (id=l-5e6f7a8b): do zrobienia 1, ukończonych 0');
    expect(text).not.toContain('t-a0000003');
    expect(text).not.toMatch(/\d{12,}/);
  });

  it('ukonczone=1 dodaje ukończone z czasem ukończenia', async () => {
    expect(await view('?ukonczone=1')).toMatch(/\[x\] t-a0000003  Komunikat o pustej odpowiedzi \(\d{4}-\d{2}-\d{2}, ukończone \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
  });

  it('zachowuje skrót listy, a pojedyncze zadanie czyta w całości także poza filtrami; błędne id i stan odrzuca', async () => {
    const text = await view('?stan=przygotowanie');
    expect(text).toContain('Stan: Do przygotowania (przygotowanie); Blokada: Czekam na ustalenie zakresu');
    expect(text).toContain('Powiązanie: chat scenario-todo-chat — Ustalenia');
    expect(text).toContain('Najpierw ustalmy zakres zmian.');
    expect(text).not.toContain('t-a0000002');
    expect(await view('?stan=zakonczone')).toContain('t-a0000003');
    await expect(view('?stan=unknown')).rejects.toMatchObject({ status: 400 });
    const note = 'Pełna notatka. '.repeat(90) + '\nKoniec notatki';
    await sources.todoAction({ action: 'updateTask', task: 't-a0000001', note });
    for (let i = 0; i < 6; i++) await sources.todoAction({ action: 'addComment', task: 't-a0000001', text: `Komentarz ${i}\n${'Długi warunek odbioru. '.repeat(70)}\nKoniec ${i}` });
    const comments = await view('?stan=przygotowanie');
    expect(comments).not.toContain('Komentarz 2');
    expect(comments).toContain('Komentarz 3');
    expect(comments).toContain('Komentarz 5');
    expect(comments).not.toContain('Koniec notatki');
    const full = await view('?zadanie=t-a0000001&list=l-5e6f7a8b&stan=zakonczone');
    expect(full).toContain(note);
    expect(full).toContain('Stan: Do przygotowania (przygotowanie); Blokada: Czekam na ustalenie zakresu');
    expect(full).toContain('Powiązanie: chat scenario-todo-chat — Ustalenia');
    expect(full).not.toContain('t-a0000002');
    expect(full).not.toContain('Lista „Dom”');
    const task = (await sources.todos()).data!.lists.flatMap(l => l.tasks).find(t => t.id === 't-a0000001')!;
    const expected = task.history.filter(h => h.kind === 'comment').map(h => h.text!);
    expect(expected).toHaveLength(7);
    expect(full.match(/    Komentarz \(/g)).toHaveLength(7);
    let position = -1;
    for (const comment of expected) {
      expect(full).toContain(comment);
      const next = full.indexOf(comment);
      expect(next).toBeGreaterThan(position);
      position = next;
    }
    expect(await view('?zadanie=t-a0000003')).toContain('Stan: Zakończone (zakonczone)');
    await expect(view('?zadanie=t-00000000')).rejects.toMatchObject({ status: 404, message: 'Nie ma zadania o id t-00000000.' });
    await expect(view('?zadanie=invalid')).rejects.toMatchObject({ status: 400 });
  });

  it('list= wybiera listę po id albo po fragmencie nazwy, a nieznana wymienia istniejące', async () => {
    const byId = await view('?list=l-5e6f7a8b');
    expect(byId).toContain('Lista „Dom”');
    expect(byId).not.toContain('Do poprawy');
    expect(await view('?list=chat')).toContain('Lista „Do poprawy - Chat Agy”');
    const none = await view('?list=praca');
    expect(none).toContain('Nie ma listy „praca”.');
    expect(none).toContain('„Dom” (l-5e6f7a8b)');
  });

  it('bez list podpowiada createList, a niedostępne źródło mówi to wprost', async () => {
    const empty = createScenarioSources(path.join(process.cwd(), 'scenarios/empty.json'));
    expect(await agentViews(empty).todos(new URL('http://x/api/agent/todos'), Date.now())).toContain('Brak list. Utwórz listę akcją createList.');
    const broken = { todos: async () => ({ live: true, name: 'Zadania', status: 'unavailable', observedAt: null, message: 'Plik nie do odczytu', data: null }) } as never;
    expect(await agentViews(broken).todos(new URL('http://x/api/agent/todos'), Date.now())).toContain('brak danych (status: unavailable, Plik nie do odczytu)');
  });

  it('odczyt wersji: wersja=N zwraca zachowaną rewizję, a wersja usunięta z retencji (np. v2 po 12 zapisach) daje 404', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'Wersje' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Wielowariantowe' });
    const id = task!.id;
    for (let i = 0; i < 12; i++) {
      await store.apply({ action: 'updateTask', task: id, spec: `Treść rewizji ${i + 1}`, specRevision: i });
    }
    const dynamicSources = {
      todos: async () => store.read(),
    } as unknown as Parameters<typeof agentViews>[0];
    const dynView = (query: string) => agentViews(dynamicSources).todos(new URL(`http://x/api/agent/todos${query}`), Date.now());

    // v12 (aktualna domyślna) jest w pełnym odczycie bez wersja=
    const current = await dynView(`?zadanie=${id}`);
    expect(current).toContain('Specyfikacja (v12');
    expect(current).toContain('Treść rewizji 12');

    // v3 (najstarsza w 10-elementowej retencji) jest dostępna przez wersja=3
    const v3 = await dynView(`?zadanie=${id}&wersja=3`);
    expect(v3).toContain('Specyfikacja (v3');
    expect(v3).toContain('Treść rewizji 3');

    // v2 wypadła z retencji -> 404
    await expect(dynView(`?zadanie=${id}&wersja=2`)).rejects.toMatchObject({
      status: 404,
      message: 'wersja 2 niedostępna; przechowujemy 10 ostatnich.',
    });
  });

  it('pełny widok pokazuje przed specyfikacją metadane wykonania i gotowość, bez kopii promptu', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'Gotowe' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Gotowe zadanie' });
    const id = task!.id;
    const spec = ['CEL:', 'Zbudować.', '', 'ZAKRES:', 'x', '', 'POZA ZAKRESEM:', 'y', '', 'WARUNKI ODBIORU:', '1. Test.'].join('\n');
    await store.apply({ action: 'updateTask', task: id, spec, specRevision: 0, executor: 'cezar', repo: 'desk-panel', mode: 'implementacja' });
    await store.apply({ action: 'setStatus', task: id, status: 'gotowe' });
    await store.apply({ action: 'addComment', task: id, text: 'Komentarz po specyfikacji.' });
    const sources = { todos: async () => store.read() } as unknown as Parameters<typeof agentViews>[0];
    const text = await agentViews(sources).todos(new URL(`http://x/api/agent/todos?zadanie=${id}`), Date.now());
    expect(text).toContain('Wykonanie: executor=cezar, repo=desk-panel, mode=implementacja');
    expect(text).toContain('Gotowość bieżącej rewizji (v1): gotowe — projekt desk-panel, workflow desk-panel-task, rewizja 1.');
    expect(text).toContain('Specyfikacja (v1');
    expect(text.indexOf('Wykonanie:')).toBeLessThan(text.indexOf('Specyfikacja (v1'));
    expect(text).not.toContain('Przygotowane zadanie Desk Panel');
    expect(text.indexOf(spec)).toBeLessThan(text.indexOf('Komentarz po specyfikacji.'));
    expect(text.slice(text.indexOf(spec) + spec.length)).not.toContain('Gotowość');
  });

  it('brakujące pola pokazuje jako „brak”, a listę braków także przed „Brak specyfikacji”', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'Puste' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Puste zadanie' });
    const sources = { todos: async () => store.read() } as unknown as Parameters<typeof agentViews>[0];
    const text = await agentViews(sources).todos(new URL(`http://x/api/agent/todos?zadanie=${task!.id}`), Date.now());
    expect(text).toContain('Wykonanie: executor=brak, repo=brak, mode=brak');
    expect(text).toContain('Gotowość bieżącej rewizji (v0): niegotowe, brakuje 9:');
    expect(text).toContain('Brak wymaganej sekcji CEL:');
    expect(text).toContain('Specyfikacja: Brak specyfikacji');
    expect(text.indexOf('Gotowość bieżącej rewizji')).toBeLessThan(text.indexOf('Specyfikacja: Brak specyfikacji'));
  });

  it('przy wersja=N gotowość dotyczy bieżącej rewizji, a pokazana jest wybrana historyczna', async () => {
    const store = createTodoStore();
    const { list } = await store.apply({ action: 'createList', name: 'Historia' });
    const { task } = await store.apply({ action: 'addTask', list: list!.id, title: 'Historyczne' });
    const id = task!.id;
    const v1 = ['CEL:', 'Stary cel.', '', 'ZAKRES:', 'x', '', 'POZA ZAKRESEM:', 'y'].join('\n');
    const v2 = ['CEL:', 'Nowy cel.', '', 'ZAKRES:', 'x', '', 'POZA ZAKRESEM:', 'y', '', 'WARUNKI ODBIORU:', '1. Test.'].join('\n');
    await store.apply({ action: 'updateTask', task: id, spec: v1, specRevision: 0 });
    await store.apply({ action: 'updateTask', task: id, spec: v2, specRevision: 1, executor: 'cezar', repo: 'desk-panel', mode: 'analiza' });
    await store.apply({ action: 'setStatus', task: id, status: 'gotowe' });
    const sources = { todos: async () => store.read() } as unknown as Parameters<typeof agentViews>[0];
    const text = await agentViews(sources).todos(new URL(`http://x/api/agent/todos?zadanie=${id}&wersja=1`), Date.now());
    expect(text).toContain('Specyfikacja (v1');
    expect(text).toContain('Stary cel.');
    expect(text).toContain('Gotowość bieżącej rewizji (v2): gotowe — projekt desk-panel, workflow analysis, rewizja 2.');
  });
});
