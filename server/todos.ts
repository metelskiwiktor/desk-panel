import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { TODO_LIMITS, todoActionSchema, todoIsDone, todoOpenStatus, todoDataSchema, type TodoAction, type TodoData, type TodoList, type TodoResult, type TodoSource, type TodoTask } from '../src/todo-contract';
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
  let needsBackup = false;
  let unsafeFile = false;

  const load = () => loaded ??= (async () => {
    const { file } = options;
    if (!file) { lists.push(...todoDataSchema.parse(options.initial ?? { lists: [] }).lists); return; }
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { unsafeFile = true; message = 'Nie udało się odczytać pliku z listami zadań.'; }
      return;
    }
    const value = safeJson(raw);
    const parsed = todoDataSchema.safeParse(value);
    if (parsed.success) { needsBackup = (value as { version: number }).version === 1; lists.push(...parsed.data.lists); return; }
    // Never write over what cannot be read: keep it aside and start again, and say so.
    const aside = `${file}.corrupt-${now()}`;
    await rename(file, aside).catch(() => { unsafeFile = true; });
    message = `Plik z listami zadań był uszkodzony (zachowany jako ${path.basename(aside)}); zaczynasz od pustych list.`;
  })();

  const persist = async () => {
    const { file } = options;
    if (!file) return;
    if (unsafeFile) throw new TodoError(500, 'Nie można bezpiecznie zastąpić pliku z zadaniami.');
    await mkdir(path.dirname(file), { recursive: true });
    if (needsBackup) {
      await copyFile(file, `${file}.v1-backup`, constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
    }
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 2, lists }), 'utf8');
    await rename(temp, file);
    needsBackup = false;
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
  const history = (task: TodoTask, entry: Omit<TodoTask['history'][number], 'at'>) => {
    task.history.push({ ...entry, at: now() });
    task.history = task.history.slice(-TODO_LIMITS.history);
  };
  const setStatus = (task: TodoTask, status: TodoTask['status'], by: 'user' | 'agent' | 'panel') => {
    if (task.status === status) return;
    history(task, { kind: 'status', from: task.status, to: status, by });
    const wasDone = task.done;
    task.status = status;
    task.done = todoIsDone(status);
    task.completedAt = task.done ? (wasDone ? task.completedAt : now()) : null;
  };

  /** Validates, then changes; a refusal is thrown before anything is touched. */
  const mutate = (action: TodoAction): TodoResult => {
    switch (action.action) {
      case 'createList': {
        const existing = lists.find(l => same(l.name, action.name));
        if (existing) return { ok: true, list: { id: existing.id, name: existing.name, created: false } };
        if (lists.length >= TODO_LIMITS.lists) throw new TodoError(409, `Może być najwyżej ${TODO_LIMITS.lists} list.`);
        const list: TodoList = { id: id('l'), name: action.name, createdAt: now(), hideDone: false, showAgent: false, tasks: [] };
        lists.push(list);
        return { ok: true, list: { id: list.id, name: list.name, created: true } };
      }
      case 'renameList': {
        const list = listOf(action.list);
        if (lists.some(l => l !== list && same(l.name, action.name))) throw new TodoError(409, 'Lista o takiej nazwie już jest.');
        list.name = action.name;
        return { ok: true, list: { id: list.id, name: list.name } };
      }
      case 'setListOptions': {
        const list = listOf(action.list);
        if (action.hideDone !== undefined) list.hideDone = action.hideDone;
        if (action.showAgent !== undefined) list.showAgent = action.showAgent;
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
        const task: TodoTask = { id: id('t'), title: action.title, note: action.note ?? '', done: false, createdAt: now(), completedAt: null, by: action.by ?? 'user', status: 'pomysl', blocked: null, links: [], history: [] };
        list.tasks.push(task);
        return { ok: true, list: { id: list.id, name: list.name }, task: { id: task.id } };
      }
      case 'updateTask': {
        const { list, task } = taskOf(action.task);
        if (action.title !== undefined) task.title = action.title;
        if (action.note !== undefined) task.note = action.note;
        if (action.done === true) setStatus(task, 'zakonczone', action.by ?? 'user');
        if (action.done === false && task.done) {
          setStatus(task, todoOpenStatus(task), action.by ?? 'user');
        }
        return { ok: true, list: { id: list.id, name: list.name }, task: { id: task.id } };
      }
      case 'setStatus': case 'setBlocked': case 'addComment': case 'link': case 'unlink': {
        const { list, task } = taskOf(action.task);
        const by = action.by ?? 'user';
        if (action.action === 'setStatus') setStatus(task, action.status, by);
        if (action.action === 'setBlocked' && task.blocked !== action.reason) {
          task.blocked = action.reason;
          history(task, { kind: 'blocked', text: action.reason ?? '', by });
        }
        if (action.action === 'addComment') history(task, { kind: 'comment', text: action.text, by });
        if (action.action === 'link' || action.action === 'unlink') {
          const index = task.links.findIndex(l => l.kind === action.kind && l.id === action.id);
          if (action.action === 'link' && index < 0) {
            if (task.links.length >= TODO_LIMITS.links) throw new TodoError(409, 'Zadanie może mieć najwyżej 20 powiązań.');
            task.links.push({ kind: action.kind, id: action.id, ...(action.title ? { title: action.title } : {}), at: now() });
            history(task, { kind: 'link', text: `+ ${action.kind} ${action.id}${action.title ? ` — ${action.title}` : ''}`, by });
          }
          if (action.action === 'unlink' && index >= 0) {
            task.links.splice(index, 1);
            history(task, { kind: 'link', text: `- ${action.kind} ${action.id}`, by });
          }
        }
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
          const parsed = todoActionSchema.safeParse(action);
          if (!parsed.success) throw new TodoError(400, 'Nieprawidłowa akcja lub pola zadania.');
          const result = mutate(parsed.data);
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
  try { const value = JSON.parse(raw); return value && (value.version === 1 || value.version === 2) ? value : null; }
  catch { return null; }
}
