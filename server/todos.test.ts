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
    await store.apply({ action: 'setStatus', task, status: 'gotowe', by: 'agent' });
    await store.apply({ action: 'setBlocked', task, reason: 'Czekamy', by: 'user' });
    expect((await data(store))[0].tasks[0]).toMatchObject({ status: 'gotowe', done: false, completedAt: null, blocked: 'Czekamy' });
    await store.apply({ action: 'setStatus', task, status: 'porzucone' });
    expect((await data(store))[0].tasks[0]).toMatchObject({ status: 'porzucone', done: true, completedAt: 123 });
    await store.apply({ action: 'updateTask', task, done: true });
    expect((await data(store))[0].tasks[0].status).toBe('zakonczone');
    await store.apply({ action: 'updateTask', task, done: false, by: 'agent' });
    const open = (await data(store))[0].tasks[0];
    expect(open).toMatchObject({ status: 'gotowe', done: false, completedAt: null, blocked: 'Czekamy' });
    expect(open.history).toEqual([
      { at: 123, kind: 'status', from: 'pomysl', to: 'gotowe', by: 'agent' },
      { at: 123, kind: 'blocked', text: 'Czekamy', by: 'user' },
      { at: 123, kind: 'status', from: 'gotowe', to: 'porzucone', by: 'user' },
      { at: 123, kind: 'status', from: 'porzucone', to: 'zakonczone', by: 'user' },
      { at: 123, kind: 'status', from: 'zakonczone', to: 'gotowe', by: 'agent' },
    ]);
    await store.apply({ action: 'setBlocked', task, reason: null });
    await store.apply({ action: 'setBlocked', task, reason: null });
    expect((await data(store))[0].tasks[0].history).toHaveLength(6);
  });

  it('powiązania są unikalne i ograniczone, komentarze Markdown zostają w ograniczonej historii', async () => {
    const store = createTodoStore();
    const list = (await store.apply({ action: 'createList', name: 'L' })).list!.id;
    const task = (await store.apply({ action: 'addTask', list, title: 'Praca' })).task!.id;
    const link = { action: 'link' as const, task, kind: 'pr' as const, id: 'https://github.com/owner/repo/pull/1', title: 'PR', by: 'agent' as const };
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
    for (let i = 0; i <= TODO_LIMITS.history; i++) await store.apply({ action: 'addComment', task, text: `**Ustalenie ${i}**`, by: 'agent' });
    const final = (await data(store))[0].tasks[0];
    expect(final.links).toHaveLength(19);
    expect(final.history).toHaveLength(TODO_LIMITS.history);
    expect(final.history[0]).toMatchObject({ kind: 'comment', text: '**Ustalenie 1**', by: 'agent' });
    expect(final.history.at(-1)?.text).toBe('**Ustalenie 200**');
  });

  it('v1 migruje tylko w pamięci, pierwszy zapis v2 zachowuje oryginał i nie nadpisuje kopii', async () => {
    const file = path.join(dir, 'v1.json');
    const legacyTask = { id: 't-00000001', title: 'Dawne', note: '', done: false, createdAt: 1, completedAt: null, by: 'user' };
    const original = JSON.stringify({ version: 1, lists: [{ id: 'l-00000001', name: 'Stara', createdAt: 1, tasks: [legacyTask, { ...legacyTask, id: 't-00000002', done: true, completedAt: 10 }] }] });
    await writeFile(file, original);
    const store = createTodoStore({ file });
    const tasks = (await data(store))[0].tasks;
    expect(tasks[0]).toMatchObject({ status: 'pomysl', blocked: null, links: [], history: [] });
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
    const b = await store.apply({ action: 'addTask', list: list!.id, title: 'Rachunki', note: 'do piątku', by: 'agent' });
    expect(a.task!.id).toMatch(TASK);
    const [only] = await data(store);
    expect(only.tasks.map(t => t.title)).toEqual(['Żarówki', 'Rachunki']);
    expect(only.tasks[0]).toMatchObject({ note: '', done: false, completedAt: null, by: 'user' });
    expect(only.tasks[1]).toMatchObject({ id: b.task!.id, note: 'do piątku', by: 'agent' });
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
    await store.apply({ action: 'addTask', list, title: 'Przetrwa restart', by: 'agent' });
    await store.drain();
    expect(await readdir(path.join(dir, 'sub'))).toEqual(['todos.json']);
    const raw = JSON.parse(await readFile(file(), 'utf8'));
    expect(raw.version).toBe(2);
    const restarted = createTodoStore({ file: file() });
    const source = await restarted.read();
    expect(todoSourceSchema.safeParse(source).success).toBe(true);
    expect(source.data!.lists[0].tasks[0]).toMatchObject({ title: 'Przetrwa restart', by: 'agent' });
    expect(source.message).toBeUndefined();
  });

  it('wiele zmian naraz nie gubi żadnej: wszystkie są w kolejności i w pliku', async () => {
    const store = createTodoStore({ file: file() });
    const list = (await store.apply({ action: 'createList', name: 'Równolegle' })).list!.id;
    await Promise.all(Array.from({ length: 25 }, (_, i) => store.apply({ action: 'addTask', list, title: `zadanie ${i}`, by: i % 2 ? 'agent' : 'user' })));
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
    ['nieznany stan', { action: 'setStatus', task: 't-aaaaaaaa', status: 'done' }],
    ['długa blokada', { action: 'setBlocked', task: 't-aaaaaaaa', reason: 'x'.repeat(301) }],
    ['długi komentarz', { action: 'addComment', task: 't-aaaaaaaa', text: 'x'.repeat(2001) }],
    ['pusty komentarz', { action: 'addComment', task: 't-aaaaaaaa', text: ' ' }],
    ...['http://github.com/o/r/pull/1', 'https://evil.com/o/r/pull/1', 'https://github.com/o/r/issues/1', 'https://github.com/o/r/pull/1?x=1', 'https://github.com/o/r/pull/0', 'https://github.com/o/../pull/1', 'https://github.com/o/./pull/1', 'https://github.com/invalid_owner/r/pull/1'].map<[string, unknown]>(id => ['zły PR', { action: 'link', task: 't-aaaaaaaa', kind: 'pr', id }]),
  ])('odrzuca %s', (_, body) => { expect(todoActionSchema.safeParse(body).success).toBe(false); });
  it('przycina spacje z nazw i tytułów', () => {
    expect(todoActionSchema.parse({ action: 'createList', name: '  Dom  ' })).toEqual({ action: 'createList', name: 'Dom' });
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
    expect(mine).toMatchObject({ title: 'Zadzwonić do hydraulika', by: 'agent', done: false });
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
});

describe('widok dla agenta: zadania', () => {
  const sources = createScenarioSources(path.join(process.cwd(), 'scenarios/standard.json'));
  const view = (query = '') => agentViews(sources).todos(new URL(`http://x/api/agent/todos${query}`), Date.now());

  it('pokazuje listy z id, zadania do zrobienia z id, autorem i notatką, a ukończone tylko liczy', async () => {
    const text = await view();
    expect(text.split('\n')[0]).toContain('nie zadania Cezara');
    expect(text).toContain('Lista „Do poprawy - Chat Agy” (id=l-1a2b3c4d): do zrobienia 2, ukończonych 1');
    expect(text).toMatch(/\[ \] t-a0000001  Agent nie wie, ile ma limitu na dziś \(dodał agent, \d{4}-\d{2}-\d{2}\) — Dodać limity AI/);
    expect(text).toContain('Lista „Dom” (id=l-5e6f7a8b): do zrobienia 1, ukończonych 0');
    expect(text).not.toContain('t-a0000003');
    expect(text).not.toMatch(/\d{12,}/);
  });

  it('ukonczone=1 dodaje ukończone z czasem ukończenia', async () => {
    expect(await view('?ukonczone=1')).toMatch(/\[x\] t-a0000003  Komunikat o pustej odpowiedzi \(\d{4}-\d{2}-\d{2}, ukończone \d{4}-\d{2}-\d{2} \d{2}:\d{2}\)/);
  });

  it('pokazuje nowe pola, wybiera stan także terminalny, a błędny filtr odrzuca', async () => {
    const text = await view('?stan=przygotowanie');
    expect(text).toContain('Stan: Do przygotowania (przygotowanie); Blokada: Czekam na ustalenie zakresu');
    expect(text).toContain('Powiązanie: chat scenario-todo-chat — Ustalenia');
    expect(text).toContain('Najpierw ustalmy zakres zmian.');
    expect(text).not.toContain('t-a0000002');
    expect(await view('?stan=zakonczone')).toContain('t-a0000003');
    await expect(view('?stan=unknown')).rejects.toMatchObject({ status: 400 });
    for (let i = 0; i < 5; i++) await sources.todoAction({ action: 'addComment', task: 't-a0000001', text: `Komentarz ${i}` });
    const comments = await view('?stan=przygotowanie');
    expect(comments).not.toContain('Komentarz 1');
    expect(comments).toContain('Komentarz 2');
    expect(comments).toContain('Komentarz 4');
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
});
