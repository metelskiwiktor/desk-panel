import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { TODO_STATUSES, todoIsDone } from '../src/todo-contract';
import {
  FILA_DEFAULT_WORKFLOW, FILA_LIMITS, FILA_RESERVED_FIELDS, FILA_TYPES,
  filaActionSchema, filaDataSchema,
  type FilaAction, type FilaActor, type FilaData, type FilaFieldKind, type FilaFieldValue, type FilaProject, type FilaResult, type FilaThread, type FilaWorkflow,
} from '../src/fila-contract';
import { SourceError } from './sources';

/** A refused action, with a sentence the caller (the screen, the agent) can read. */
export class FilaError extends SourceError {
  constructor(status: number, message: string) { super(status); this.message = message; }
}

export interface FilaThreadView {
  id: string; project: string; number: number;
  type: { key: string; label: string };
  workflow: { id: string; name: string };
  state: string;
  /** Derived from the state (D-018); there is no checkbox. */
  closed: boolean;
  title: string; description: string;
  parent: string | null; children: string[];
  module: string | null;
  fields: Record<string, FilaFieldValue>;
  archived: boolean; revision: number;
  createdAt: number; updatedAt: number; createdBy: string;
  history: FilaThread['history'];
}
export interface FilaRegistries {
  projects: (FilaProject & { counts: { open: number; closed: number; archived: number } })[];
  workflows: FilaWorkflow[];
  types: { key: string; label: string; workflow: string; fields: string[] }[];
  fieldDefs: FilaData['fieldDefs'];
}
export interface FilaStore {
  registries(): Promise<FilaRegistries>;
  thread(id: string): Promise<FilaThreadView>;
  /** The actor comes from the caller's authentication, never from the action. */
  apply(action: FilaAction, actor: FilaActor): Promise<FilaResult>;
  /** Text for the caller when the stored file could not be used as it was. */
  notice(): Promise<string | undefined>;
  /** Resolves once every change made so far is on disk. */
  drain(): Promise<void>;
}
export interface FilaStoreOptions {
  /** Where the data live (`~/.desk-panel/fila.json`); without it they live in memory only, starting from `initial`. */
  file?: string;
  initial?: FilaData;
  now?: () => number;
}

/** The workflow "Praca": today's states of the to-do lists (D-005); the closing ones are Zakończone and Porzucone. */
export function defaultFilaData(): FilaData {
  return {
    projects: [],
    workflows: [{ id: FILA_DEFAULT_WORKFLOW, name: 'Praca', states: Object.entries(TODO_STATUSES).map(([key, label]) => ({ name: label, closing: todoIsDone(key as keyof typeof TODO_STATUSES) })) }],
    fieldDefs: [{ name: 'Tagi', kind: 'multi' }],
    threads: [],
  };
}

const aiOnly = new Set<FilaAction['action']>(['setModules', 'createWorkflow', 'updateWorkflow']);
const userOnly = new Set<FilaAction['action']>(['deleteThread']);
const reserved = new Set<string>(FILA_RESERVED_FIELDS);
const lower = (s: string) => s.toLocaleLowerCase('pl');
const cut = (s: string) => (s.length > 200 ? `${s.slice(0, 200)}…` : s);
const show = (value: FilaFieldValue | null | undefined) => value === null || value === undefined ? null : cut(Array.isArray(value) ? value.join(', ') : String(value));
const idOf = (t: Pick<FilaThread, 'project' | 'number'>) => `${t.project}-${t.number}`;

/**
 * The Fila store. Changes are small actions applied one after another to the data in memory and written out whole
 * (to a temporary file, then renamed), so a crash never leaves half a file and concurrent callers never overwrite each
 * other: one process, one queue. An action that is refused, or whose write fails, changes nothing, in memory or on disk.
 */
export function createFilaStore(options: FilaStoreOptions = {}): FilaStore {
  const now = options.now ?? Date.now;
  let data: FilaData = defaultFilaData();
  let message: string | undefined;
  let loaded: Promise<void> | undefined;
  let tail: Promise<unknown> = Promise.resolve();
  let unsafeFile = false;

  const load = () => loaded ??= (async () => {
    const { file } = options;
    if (!file) { data = filaDataSchema.parse(options.initial ?? defaultFilaData()); return; }
    let raw: string;
    try { raw = await readFile(file, 'utf8'); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { unsafeFile = true; message = 'Nie udało się odczytać pliku Fili.'; }
      return;
    }
    let parsed: ReturnType<typeof filaDataSchema.safeParse> | undefined;
    try { const value = JSON.parse(raw); if (value?.version === 1) parsed = filaDataSchema.safeParse(value.data); } catch { /* corrupt, handled below */ }
    if (parsed?.success) { data = parsed.data; return; }
    // Never write over what cannot be read: keep it aside and start again, and say so.
    const aside = `${file}.corrupt-${now()}`;
    await rename(file, aside).catch(() => { unsafeFile = true; });
    message = `Plik Fili był uszkodzony (zachowany jako ${path.basename(aside)}); zaczynasz od pustej Fili.`;
  })();

  const persist = async () => {
    const { file } = options;
    if (!file) return;
    if (unsafeFile) throw new FilaError(500, 'Nie można bezpiecznie zastąpić pliku Fili.');
    await mkdir(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    await writeFile(temp, JSON.stringify({ version: 1, data }), { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
  };

  const projectOf = (key: string) => data.projects.find(p => p.key === key) ?? (() => { throw new FilaError(404, `Nie ma projektu ${key}.`); })();
  const workflowOf = (id: string) => data.workflows.find(w => w.id === id) ?? (() => { throw new FilaError(404, `Nie ma workflow ${id}.`); })();
  const find = (id: string) => {
    const [key = '', number = ''] = id.toUpperCase().split('-');
    return data.threads.find(t => t.project === key && String(t.number) === number);
  };
  const threadOf = (id: string) => find(id) ?? (() => { throw new FilaError(404, `Nie ma wątku ${id}.`); })();
  const byUid = (uid: string) => data.threads.find(t => t.uid === uid);
  const uid = () => {
    for (;;) { const candidate = `f-${randomUUID().slice(0, 8)}`; if (!byUid(candidate)) return candidate; }
  };
  const record = (t: FilaThread, by: FilaActor, entry: Omit<FilaThread['history'][number], 'at' | 'by'>) => { t.history.push({ at: now(), by, ...entry }); t.updatedAt = now(); };
  const expect = (t: FilaThread, revision: number | undefined) => {
    if (revision !== undefined && revision !== t.revision) throw new FilaError(409, `Konflikt: oczekiwana rewizja ${revision}, aktualna ${t.revision}. Przeczytaj wątek i spróbuj ponownie.`);
  };
  const fieldName = (name: string) => data.fieldDefs.find(d => lower(d.name) === lower(name));
  const validateValue = (kind: FilaFieldKind, value: FilaFieldValue): FilaFieldValue => {
    const bad = () => new FilaError(400, `Wartość nie pasuje do rodzaju pola (${kind}).`);
    switch (kind) {
      case 'text': if (typeof value !== 'string') throw bad(); return value;
      case 'number': if (typeof value !== 'number') throw bad(); return value;
      case 'bool': if (typeof value !== 'boolean') throw bad(); return value;
      case 'date': {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new FilaError(400, 'Data ma postać RRRR-MM-DD.');
        return value;
      }
      case 'multi': if (!Array.isArray(value)) throw bad(); return [...new Set(value)];
    }
  };
  const setThreadField = (t: FilaThread, name: string, value: FilaFieldValue) => {
    if (!(name in t.fields) && Object.keys(t.fields).length >= FILA_LIMITS.fieldsPerThread) throw new FilaError(409, `Wątek może mieć najwyżej ${FILA_LIMITS.fieldsPerThread} pól.`);
    t.fields[name] = value;
  };
  const ancestors = (t: FilaThread) => {
    const chain = new Set<string>();
    for (let up = t.parent ? byUid(t.parent) : undefined; up && !chain.has(up.uid); up = up.parent ? byUid(up.parent) : undefined) chain.add(up.uid);
    return chain;
  };

  const view = (t: FilaThread): FilaThreadView => {
    const workflow = workflowOf(t.workflow);
    const parent = t.parent ? byUid(t.parent) : undefined;
    return {
      id: idOf(t), project: t.project, number: t.number,
      type: { key: t.type, label: FILA_TYPES[t.type].label },
      workflow: { id: workflow.id, name: workflow.name },
      state: t.state, closed: workflow.states.find(s => s.name === t.state)?.closing ?? false,
      title: t.title, description: t.description,
      parent: parent ? idOf(parent) : null,
      children: data.threads.filter(c => c.parent === t.uid).map(idOf),
      module: t.module, fields: structuredClone(t.fields), archived: t.archived, revision: t.revision,
      createdAt: t.createdAt, updatedAt: t.updatedAt, createdBy: t.history[0]?.by ?? 'user',
      history: structuredClone(t.history),
    };
  };

  /** Validates, then changes; a refusal is thrown before anything is touched (and memory is restored if one comes late). */
  const mutate = (action: FilaAction, actor: FilaActor): FilaResult => {
    if (aiOnly.has(action.action) && actor === 'user') throw new FilaError(403, 'Definicje workflow i wartości Modułu zmienia tylko AI (D-033).');
    if (userOnly.has(action.action) && actor !== 'user') throw new FilaError(403, 'Trwale usuwa wątek tylko użytkownik, z archiwum (D-038); AI może go zarchiwizować.');
    const done = (t: FilaThread, extra: Partial<FilaResult> = {}): FilaResult => ({ ok: true, thread: { id: idOf(t), revision: t.revision }, ...extra });
    switch (action.action) {
      case 'createProject': {
        if (data.projects.some(p => p.key === action.key)) throw new FilaError(409, `Projekt ${action.key} już jest.`);
        if (data.projects.length >= FILA_LIMITS.projects) throw new FilaError(409, `Może być najwyżej ${FILA_LIMITS.projects} projektów.`);
        data.projects.push({ key: action.key, name: action.name, createdAt: now(), modules: [], nextNumber: 1 });
        return { ok: true, project: action.key };
      }
      case 'setModules': {
        const project = projectOf(action.project);
        const used = [...new Set(data.threads.filter(t => t.project === project.key && t.module && !action.modules.includes(t.module)).map(t => t.module))];
        if (used.length) throw new FilaError(409, `Wartość Modułu jest w użyciu: ${used.join(', ')}. Najpierw zmień Moduł tych wątków.`);
        project.modules = action.modules;
        return { ok: true, project: project.key };
      }
      case 'createWorkflow': {
        if (data.workflows.some(w => lower(w.name) === lower(action.name))) throw new FilaError(409, 'Workflow o takiej nazwie już jest.');
        if (data.workflows.length >= FILA_LIMITS.workflows) throw new FilaError(409, `Może być najwyżej ${FILA_LIMITS.workflows} workflow.`);
        let id: string;
        do { id = `w-${randomUUID().slice(0, 8)}`; } while (data.workflows.some(w => w.id === id));
        data.workflows.push({ id, name: action.name, states: action.states });
        return { ok: true, workflow: id };
      }
      case 'updateWorkflow': {
        const workflow = workflowOf(action.workflow);
        if (action.name !== undefined && data.workflows.some(w => w !== workflow && lower(w.name) === lower(action.name!))) throw new FilaError(409, 'Workflow o takiej nazwie już jest.');
        if (action.states) {
          const gone = [...new Set(data.threads.filter(t => t.workflow === workflow.id && !action.states!.some(s => s.name === t.state)).map(t => t.state))];
          if (gone.length) throw new FilaError(409, `Stan jest w użyciu: ${gone.join(', ')}. Najpierw zmień Stan tych wątków.`);
          workflow.states = action.states;
        }
        if (action.name !== undefined) workflow.name = action.name;
        return { ok: true, workflow: workflow.id };
      }
      case 'createThread': {
        const project = projectOf(action.project);
        if (data.threads.length >= FILA_LIMITS.threads) throw new FilaError(409, `Może być najwyżej ${FILA_LIMITS.threads} wątków.`);
        const parent = action.parent ? threadOf(action.parent) : undefined;
        if (action.module !== undefined && !project.modules.includes(action.module)) throw new FilaError(409, `Projekt ${project.key} nie ma wartości Modułu „${action.module}”.`);
        const workflow = workflowOf(FILA_DEFAULT_WORKFLOW);
        const fields: Record<string, FilaFieldValue> = {};
        for (const name of FILA_TYPES[action.type].fields) fields[name] = fieldName(name)?.kind === 'multi' ? [] : '';
        const t: FilaThread = {
          uid: uid(), project: project.key, number: project.nextNumber++, type: action.type, workflow: workflow.id, state: workflow.states[0]!.name,
          title: action.title, description: action.description ?? '', parent: parent?.uid ?? null, module: action.module ?? null,
          fields, archived: false, revision: 1, createdAt: now(), updatedAt: now(), history: [],
        };
        data.threads.push(t);
        record(t, actor, { kind: 'created', text: FILA_TYPES[action.type].label });
        return done(t);
      }
      case 'updateThread': {
        const t = threadOf(action.thread);
        expect(t, action.expectedRevision);
        const targetProject = action.project !== undefined ? projectOf(action.project) : projectOf(t.project);
        const workflow = workflowOf(action.workflow ?? t.workflow);
        const state = action.state ?? t.state;
        const module = action.module !== undefined ? action.module : t.module;
        // What does not fit the new project or workflow is never dropped silently: the same operation must name the new value.
        if (!workflow.states.some(s => s.name === state)) {
          throw new FilaError(409, action.state !== undefined ? `Workflow „${workflow.name}” nie ma Stanu „${state}”.` : `Stan „${t.state}” nie pasuje do workflow „${workflow.name}”: podaj nowy Stan w tej samej operacji.`);
        }
        if (module !== null && !targetProject.modules.includes(module)) {
          throw new FilaError(409, action.module !== undefined ? `Projekt ${targetProject.key} nie ma wartości Modułu „${module}”.` : `Moduł „${module}” nie pasuje do projektu ${targetProject.key}: podaj nowy Moduł albo module: null w tej samej operacji.`);
        }
        let parent = t.parent;
        if (action.parent !== undefined) {
          const wanted = action.parent === null ? null : threadOf(action.parent);
          if (wanted && (wanted.uid === t.uid || ancestors(wanted).has(t.uid))) throw new FilaError(409, 'Wątek nie może być własnym przodkiem.');
          parent = wanted?.uid ?? null;
        }
        const previousId = idOf(t);
        const moving = targetProject.key !== t.project;
        if (moving) {
          const def = fieldName('Dawne ID');
          if (def && def.kind !== 'multi') throw new FilaError(409, 'Pole „Dawne ID” ma inny rodzaj niż wiele wartości.');
          if (!def) {
            if (data.fieldDefs.length >= FILA_LIMITS.fieldDefs) throw new FilaError(409, 'Za dużo definicji pól.');
            data.fieldDefs.push({ name: 'Dawne ID', kind: 'multi' });
          }
          const old = t.fields['Dawne ID'];
          setThreadField(t, 'Dawne ID', [...(Array.isArray(old) ? old : []), previousId]);
        }
        const changes: { field: string; from: string | null; to: string | null }[] = [];
        const change = (field: string, from: string | null, to: string | null) => { if (from !== to) changes.push({ field, from, to }); };
        change('Tytuł', cut(t.title), cut(action.title ?? t.title));
        change('Opis', cut(t.description), cut(action.description ?? t.description));
        change('Stan', t.state, state);
        change('Moduł', t.module, module);
        change('Workflow', workflowOf(t.workflow).name, workflow.name);
        change('Rodzic', t.parent ? idOf(byUid(t.parent)!) : null, parent ? idOf(byUid(parent)!) : null);
        if (action.title !== undefined) t.title = action.title;
        if (action.description !== undefined) t.description = action.description;
        t.state = state; t.module = module; t.workflow = workflow.id; t.parent = parent;
        if (moving) { t.project = targetProject.key; t.number = targetProject.nextNumber++; change('ID', previousId, idOf(t)); }
        if (!changes.length) return done(t);
        t.revision += 1;
        record(t, actor, { kind: moving ? 'moved' : 'changed', changes });
        return done(t, moving ? { thread: { id: idOf(t), revision: t.revision, previousId } } : {});
      }
      case 'setField': {
        const t = threadOf(action.thread);
        expect(t, action.expectedRevision);
        if (reserved.has(lower(action.field))) throw new FilaError(400, `„${action.field}” nie jest polem własnym. Stan, Moduł, rodzica, tytuł i opis zmienia updateThread.`);
        let def = fieldName(action.field);
        if (def && action.kind && def.kind !== action.kind) throw new FilaError(409, `Pole „${def.name}” ma rodzaj ${def.kind}; zmiana rodzaju jest odłożona (Q-032).`);
        if (!def) {
          if (!action.kind) throw new FilaError(400, `Pole „${action.field}” jest nowe: podaj jego rodzaj (text, number, date, bool, multi).`);
          if (data.fieldDefs.length >= FILA_LIMITS.fieldDefs) throw new FilaError(409, 'Za dużo definicji pól.');
          def = { name: action.field, kind: action.kind };
          data.fieldDefs.push(def);
        }
        const value = validateValue(def.kind, action.value);
        const before = t.fields[def.name];
        if (before !== undefined && JSON.stringify(before) === JSON.stringify(value)) return done(t);
        setThreadField(t, def.name, value);
        t.revision += 1;
        record(t, actor, { kind: 'changed', changes: [{ field: def.name, from: show(before), to: show(value) }] });
        return done(t);
      }
      case 'removeField': {
        const t = threadOf(action.thread);
        expect(t, action.expectedRevision);
        if (lower(action.field) === 'moduł' || lower(action.field) === 'modul') throw new FilaError(400, 'Moduł czyści updateThread z module: null.');
        const name = Object.keys(t.fields).find(key => lower(key) === lower(action.field));
        if (!name) throw new FilaError(404, `Wątek nie ma pola „${action.field}”.`);
        const before = t.fields[name];
        delete t.fields[name];
        t.revision += 1;
        record(t, actor, { kind: 'changed', changes: [{ field: name, from: show(before), to: null }] });
        return done(t);
      }
      case 'comment': {
        const t = threadOf(action.thread);
        record(t, actor, { kind: 'comment', text: action.text });
        return done(t);
      }
      case 'archiveThread': case 'restoreThread': {
        const t = threadOf(action.thread);
        const archive = action.action === 'archiveThread';
        if (t.archived === archive) return done(t);
        t.archived = archive;
        t.revision += 1;
        record(t, actor, { kind: archive ? 'archived' : 'restored' });
        return done(t);
      }
      case 'deleteThread': {
        const t = threadOf(action.thread);
        if (!t.archived) throw new FilaError(409, 'Trwale usunąć można tylko wątek z archiwum.');
        data.threads.splice(data.threads.indexOf(t), 1);
        for (const child of data.threads.filter(c => c.parent === t.uid)) {
          child.parent = null; child.revision += 1;
          record(child, actor, { kind: 'changed', changes: [{ field: 'Rodzic', from: idOf(t), to: null }] });
        }
        // The project's counter is untouched: the number is never used again (D-044).
        return { ok: true, removed: 1 };
      }
    }
  };

  return {
    async registries() {
      await tail; await load();
      const types = Object.entries(FILA_TYPES).map(([key, type]) => ({ key, label: type.label, workflow: FILA_DEFAULT_WORKFLOW, fields: [...type.fields] }));
      const projects = data.projects.map(p => {
        const own = data.threads.filter(t => t.project === p.key);
        const closed = (t: FilaThread) => workflowOf(t.workflow).states.find(s => s.name === t.state)?.closing ?? false;
        return { ...structuredClone(p), counts: { open: own.filter(t => !t.archived && !closed(t)).length, closed: own.filter(t => !t.archived && closed(t)).length, archived: own.filter(t => t.archived).length } };
      });
      return { projects, workflows: structuredClone(data.workflows), types, fieldDefs: structuredClone(data.fieldDefs) };
    },
    async thread(id) { await tail; await load(); return view(threadOf(id)); },
    apply(action, actor) {
      const run = tail.then(async () => {
        await load();
        const before = structuredClone(data);
        try {
          const parsed = filaActionSchema.safeParse(action);
          if (!parsed.success) {
            const issue = parsed.error.issues[0];
            throw new FilaError(400, `Niepoprawna akcja${issue ? ` (${issue.path.join('.') || 'akcja'}: ${issue.message})` : ''}.`);
          }
          const result = mutate(parsed.data, actor);
          await persist();
          return result;
        } catch (error) {
          // Memory must not get ahead of the disk: whatever was changed is taken back.
          data = before;
          throw error;
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async notice() { await tail; await load(); return message; },
    async drain() { await tail; },
  };
}
