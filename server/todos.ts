import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TODO_LIMITS, todoDataSchema, type TodoAction, type TodoData, type TodoList, type TodoResult, type TodoSource, type TodoTask } from '../src/todo-contract';
import { SourceError } from './sources';

/** A refused action, with a sentence the caller (the screen, the agent) can read. */
export class TodoError extends SourceError {
  constructor(status: number, message: string) { super(status); this.message = message; }
}

export interface TodoStore {
  read(): Promise<TodoSource>;
  apply(action: TodoAction): Promise<TodoResult>;
  /** Resolves once every change made so far is on disk. */
  drain(): Promise<void>;
}

export interface TodoStoreOptions {
  /** Where the lists live (`~/.desk-panel/todos.json`); without it they live in memory only, starting from `initial`. */
  file?: string;
  initial?: TodoData;
  now?: () => number;
}

const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

/**
 * The to-do lists. Changes are small actions applied one after another to the lists in memory and written out whole
 * (to a temporary file, then renamed), so a crash never leaves half a file and two writers never overwrite each other:
 * the screen and the agent each add to what the other left. An action that is refused changes nothing.
 */
export function createTodoStore(options: TodoStoreOptions = {}): TodoStore {
  const now = options.now ?? Date.now;
  const lists: TodoList[] = [];
  let message: string | undefined;
  let loaded: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const load = () => loaded ??= (async () => {
    const { file } = options;
    if (!file) { lists.push(...structuredClone(options.initial?.lists ?? [])); return; }
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') message = 'Nie udało się odczytać pliku z listami zadań.';
      return;
    }
    const parsed = todoDataSchema.safeParse(safeJson(raw));
    if (parsed.success) { lists.push(...parsed.data.lists); return; }
    // Never write over what cannot be read: keep it aside and start again, and say so.
    const aside = `${file}.corrupt-${now()}`;
    await rename(file, aside).catch(() => { /* the next write replaces it anyway; the message stays */ });
    message = `Plik z listami zadań był uszkodzony (zachowany jako ${path.basename(aside)}); zaczynasz od pustych list.`;
  })();

  const persist = async () => {
    const { file } = options;
    if (!file) return;
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, lists }), 'utf8');
    await rename(temp, file);
  };

  const id = (prefix: 'l' | 't') => {
    const taken = new Set(lists.flatMap(l => [l.id, ...l.tasks.map(t => t.id)]));
    for (;;) { const candidate = `${prefix}-${randomUUID().slice(0, 8)}`; if (!taken.has(candidate)) return candidate; }
  };
  const listOf = (listId: string) => lists.find(l => l.id === listId) ?? (() => { throw new TodoError(404, 'Nie ma takiej listy.'); })();
  const taskOf = (taskId: string) => {
    for (const list of lists) { const task = list.tasks.find(t => t.id === taskId); if (task) return { list, task }; }
    throw new TodoError(404, 'Nie ma takiego zadania.');
  };
  const room = (list: TodoList) => { if (list.tasks.length >= TODO_LIMITS.tasksPerList) throw new TodoError(409, `Na liście może być najwyżej ${TODO_LIMITS.tasksPerList} zadań.`); };

  /** Validates, then changes; a refusal is thrown before anything is touched. */
  const mutate = (action: TodoAction): TodoResult => {
    switch (action.action) {
      case 'createList': {
        const existing = lists.find(l => same(l.name, action.name));
        if (existing) return { ok: true, list: { id: existing.id, name: existing.name, created: false } };
        if (lists.length >= TODO_LIMITS.lists) throw new TodoError(409, `Może być najwyżej ${TODO_LIMITS.lists} list.`);
        const list: TodoList = { id: id('l'), name: action.name, createdAt: now(), hideDone: false, tasks: [] };
        lists.push(list);
        return { ok: true, list: { id: list.id, name: list.name, created: true } };
      }
      case 'renameList': {
        const list = listOf(action.list);
        if (lists.some(l => l !== list && same(l.name, action.name))) throw new TodoError(409, 'Lista o takiej nazwie już jest.');
        list.name = action.name;
        return { ok: true, list: { id: list.id, name: list.name } };
      }
      case 'setHideDone': {
        const list = listOf(action.list);
        list.hideDone = action.hideDone;
        return { ok: true, list: { id: list.id, name: list.name } };
      }
      case 'deleteList': {
        const list = listOf(action.list);
        lists.splice(lists.indexOf(list), 1);
        return { ok: true, removed: list.tasks.length };
      }
      case 'addTask': {
        const list = listOf(action.list);
        room(list);
        const task: TodoTask = { id: id('t'), title: action.title, note: action.note ?? '', done: false, createdAt: now(), completedAt: null, by: action.by ?? 'user' };
        list.tasks.push(task);
        return { ok: true, list: { id: list.id, name: list.name }, task: { id: task.id } };
      }
      case 'updateTask': {
        const { list, task } = taskOf(action.task);
        if (action.title !== undefined) task.title = action.title;
        if (action.note !== undefined) task.note = action.note;
        if (action.done !== undefined && action.done !== task.done) { task.done = action.done; task.completedAt = action.done ? now() : null; }
        return { ok: true, list: { id: list.id, name: list.name }, task: { id: task.id } };
      }
      case 'moveTask': {
        const { list, task } = taskOf(action.task);
        const target = listOf(action.list);
        if (target !== list) { room(target); list.tasks.splice(list.tasks.indexOf(task), 1); target.tasks.push(task); }
        return { ok: true, list: { id: target.id, name: target.name }, task: { id: task.id } };
      }
      case 'deleteTask': {
        const { list, task } = taskOf(action.task);
        list.tasks.splice(list.tasks.indexOf(task), 1);
        return { ok: true, list: { id: list.id, name: list.name }, removed: 1 };
      }
      case 'clearDone': {
        const list = listOf(action.list);
        const before = list.tasks.length;
        list.tasks = list.tasks.filter(t => !t.done);
        return { ok: true, list: { id: list.id, name: list.name }, removed: before - list.tasks.length };
      }
    }
  };

  return {
    async read() {
      await tail;
      await load();
      return { live: true, name: 'Zadania', status: 'connected', observedAt: now(), ...(message ? { message } : {}), data: { lists: structuredClone(lists) } };
    },
    apply(action) {
      const run = tail.then(async () => {
        await load();
        const before = structuredClone(lists);
        try {
          const result = mutate(action);
          await persist();
          return result;
        } catch (error) {
          // Memory must not get ahead of the disk: whatever was changed is taken back.
          lists.splice(0, lists.length, ...before);
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async drain() { await tail; },
  };
}

function safeJson(raw: string): unknown {
  try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? { lists: (value as { lists?: unknown }).lists } : null; }
  catch { return null; }
}
