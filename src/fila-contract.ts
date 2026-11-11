import { z } from 'zod';
import { TODO_LIMITS, todoExecutorSchema, todoModeSchema, todoRepoSchema, todoTaskSchema } from './todo-contract';

/**
 * Fila: threads (sprawy, funkcje, błędy, notatki, spotkania) in projects. The panel's own data, kept by the server and
 * changed by small actions (docs/fila.md). This is the core of stage 1.1a; boards and queries come later.
 */
export const FILA_LIMITS = {
  projects: 100, workflows: 50, states: 30, modules: 100, fieldDefs: 200, threads: 50_000,
  name: 80, state: 60, module: 60, fieldName: 60, title: 200, description: 20_000, comment: 5000,
  text: 2000, multi: 50, multiItem: 200, fieldsPerThread: 60, spec: 50_000,
  boards: 200, views: 30, sections: 30, columns: 30, query: 2000, results: 5000,
  blockers: 20, blockerReason: 300,
} as const;

/** The clients of D-057. Each has its own token on the backend; none of them is ever the user (D-006). */
export const FILA_CLIENTS = ['claude-desktop', 'claude-code', 'codex', 'wektor', 'antigravity'] as const;
export const filaActorSchema = z.enum(['user', ...FILA_CLIENTS]);
export type FilaActor = z.infer<typeof filaActorSchema>;

/** Types are templates in code (D-025): the base fields and the default workflow. Nothing here can be edited. */
export const FILA_DEFAULT_WORKFLOW = 'w-praca';
export const FILA_TYPES = {
  sprawa: { label: 'Sprawa', fields: ['Tagi'], spec: false, cezar: false },
  funkcja: { label: 'Funkcja', fields: ['Tagi'], spec: true, cezar: false },
  blad: { label: 'Błąd', fields: ['Tagi'], spec: true, cezar: false },
  notatka: { label: 'Notatka', fields: ['Tagi'], spec: false, cezar: false },
  spotkanie: { label: 'Spotkanie', fields: ['Tagi'], spec: false, cezar: false },
  /** Stage 2.1 (D-107): a thread made to be handed to Cezar, so it starts with the Specyfikacja and the Cezar kit (values unset). */
  'implementacja-cezara': { label: 'Implementacja Cezara', fields: ['Tagi'], spec: true, cezar: true },
} as const;
export const filaTypeSchema = z.enum(Object.keys(FILA_TYPES) as [keyof typeof FILA_TYPES, ...(keyof typeof FILA_TYPES)[]]);

/** Names of the properties and of the fields kept in code; a custom field can never take one of them (D-003, D-047). */
export const FILA_RESERVED_FIELDS = ['stan', 'moduł', 'modul', 'tytuł', 'tytul', 'opis', 'typ', 'projekt', 'workflow', 'rodzic', 'specyfikacja', 'kiedy', 'termin', 'zablokowane', 'implementacja cezara', 'id'] as const;

export const filaFieldKindSchema = z.enum(['text', 'number', 'date', 'bool', 'multi']);
export type FilaFieldKind = z.infer<typeof filaFieldKindSchema>;
export const filaFieldValueSchema = z.union([
  z.string().max(FILA_LIMITS.text), z.number().finite(), z.boolean(),
  z.array(z.string().trim().min(1).max(FILA_LIMITS.multiItem)).max(FILA_LIMITS.multi),
]);
export type FilaFieldValue = z.infer<typeof filaFieldValueSchema>;

const projectKey = z.string().regex(/^[A-Z]{4}$/);
const name = z.string().trim().min(1).max(FILA_LIMITS.name);
const fieldName = z.string().trim().min(1).max(FILA_LIMITS.fieldName);
const stateName = z.string().trim().min(1).max(FILA_LIMITS.state);
const moduleName = z.string().trim().min(1).max(FILA_LIMITS.module);
const threadId = z.string().trim().regex(/^[A-Za-z]{4}-[1-9][0-9]*$/);
const workflowId = z.string().regex(/^w-[a-z0-9]{1,16}$/);
const title = z.string().trim().min(1).max(FILA_LIMITS.title);
const description = z.string().max(FILA_LIMITS.description);
/** The value of the field Tagi at creation: the rules of a `multi` field. */
const tags = z.array(z.string().trim().min(1).max(FILA_LIMITS.multiItem)).max(FILA_LIMITS.multi);
const unique = (items: string[]) => new Set(items.map(item => item.toLowerCase())).size === items.length;

export const filaProjectSchema = z.object({
  key: projectKey, name, createdAt: z.number().finite(),
  /** The values of the project's choice field Moduł (D-017); only the AI changes them (D-033). */
  modules: z.array(moduleName).max(FILA_LIMITS.modules).refine(unique, 'Duplicate module'),
  /** The next thread number; it only grows, so a number is never used twice, whatever happens to the thread (D-044). */
  nextNumber: z.number().int().min(1),
});
export const filaWorkflowStateSchema = z.object({ name: stateName, closing: z.boolean() });
export const filaWorkflowSchema = z.object({
  id: workflowId, name,
  states: z.array(filaWorkflowStateSchema).min(1).max(FILA_LIMITS.states).refine(states => unique(states.map(s => s.name)), 'Duplicate state'),
});
export const filaFieldDefSchema = z.object({ name: fieldName, kind: filaFieldKindSchema });
const changeSchema = z.object({ field: z.string().max(100), from: z.string().max(FILA_LIMITS.text).nullable(), to: z.string().max(FILA_LIMITS.text).nullable() });
export const filaHistorySchema = z.object({
  at: z.number().finite(), by: z.enum([...filaActorSchema.options, 'panel']),
  kind: z.enum(['created', 'changed', 'comment', 'archived', 'restored', 'moved']),
  text: z.string().max(FILA_LIMITS.comment).optional(),
  changes: z.array(changeSchema).max(20).optional(),
});
/** One revision of the Specyfikacja (D-061): the whole text, who wrote it (a client, D-006) and when. Numbers start at 1 and never repeat. */
export const filaSpecRevisionSchema = z.object({
  number: z.number().int().min(1), text: z.string().max(FILA_LIMITS.spec), by: z.enum([...filaActorSchema.options, 'panel']), at: z.number().finite(),
});
export type FilaSpecRevision = z.infer<typeof filaSpecRevisionSchema>;
/**
 * The Cezar kit of a thread (1.4a): executor, repo and mode with today's vocabulary and `null` = not chosen, and the
 * task / PR links (unique by kind+id, at most 20). Added to any type like the Specyfikacja; the data
 * outlive removing the kit, so the links and the dispatch register keep their meaning.
 */
const filaCezarLinkKind = z.enum(['cezar', 'pr']);
const filaCezarLinkId = z.string().trim().min(1).max(500);
const validPrUrl = (link: { kind: string; id: string }) => link.kind !== 'pr' || /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(link.id);
export const filaCezarLinkSchema = z.object({ kind: filaCezarLinkKind, id: filaCezarLinkId, title: z.string().trim().min(1).max(200).optional(), at: z.number().finite() }).refine(validPrUrl, 'Invalid GitHub pull request URL');
export const filaCezarSchema = z.object({
  enabled: z.boolean(),
  executor: todoExecutorSchema.nullable(), repo: todoRepoSchema.nullable(), mode: todoModeSchema.nullable(),
  links: z.array(filaCezarLinkSchema).max(TODO_LIMITS.links).refine(links => new Set(links.map(l => `${l.kind}:${l.id}`)).size === links.length, 'Duplicate link'),
});
export type FilaCezar = z.infer<typeof filaCezarSchema>;
export const emptyFilaCezar = (): FilaCezar => ({ enabled: false, executor: null, repo: null, mode: null, links: [] });

/**
 * One entry of a thread's „Zablokowane” (2.3a, D-104): the field belongs to the thread, not to Cezar, and only informs.
 * A thread is blocked while it has an entry. `origin` says where the entry came from: written by hand (the user or an AI;
 * also the old `cezar.blocked` text, converted once with the author `panel`), or made by the panel from a failed Cezar
 * task it dispatched from the thread (2.3b): the task, its mode, the Specyfikacja revision and the task's address.
 */
const blockerId = z.string().regex(/^k-[0-9a-f]{8}$/);
const blockerReason = z.string().trim().min(1).max(FILA_LIMITS.blockerReason);
const blockerTaskOrigin = z.object({
  kind: z.literal('task'), taskId: z.string().trim().min(1).max(200), mode: todoModeSchema,
  specRevision: z.number().int().nonnegative(), url: z.string().trim().min(1).max(500),
}).strict();
export const filaBlockerSchema = z.object({
  id: blockerId, reason: blockerReason,
  origin: z.discriminatedUnion('kind', [z.object({ kind: z.literal('ręczne') }).strict(), blockerTaskOrigin]),
  at: z.number().finite(), by: z.enum([...filaActorSchema.options, 'panel']),
});
export type FilaBlocker = z.infer<typeof filaBlockerSchema>;

/** Stage 2.1: the states a thread may be dispatched to Cezar from (D-039), as workflow id + state name. Only the AI edits the list. */
export const FILA_READY_STATES_MAX = 20;
export const filaReadyStateSchema = z.object({ workflow: workflowId, state: stateName }).strict();
export type FilaReadyState = z.infer<typeof filaReadyStateSchema>;
const readyStates = z.array(filaReadyStateSchema).min(1).max(FILA_READY_STATES_MAX)
  .refine(pairs => new Set(pairs.map(p => `${p.workflow}|${p.state}`)).size === pairs.length, 'Duplicate ready state');
export const filaCezarSettingsSchema = z.object({ readyStates });
export type FilaCezarSettings = z.infer<typeof filaCezarSettingsSchema>;
/** Without stored settings: the workflow Praca's „Gotowe do realizacji”, what stage 1 had in code. */
export const defaultFilaCezarSettings = (): FilaCezarSettings => ({ readyStates: [{ workflow: FILA_DEFAULT_WORKFLOW, state: 'Gotowe do realizacji' }] });

export const filaThreadSchema = z.object({
  /** Internal and permanent: parents point at it, so a move (a new display ID) keeps every relation. */
  uid: z.string().regex(/^f-[0-9a-f]{8}$/),
  project: projectKey, number: z.number().int().min(1),
  type: filaTypeSchema, workflow: workflowId, state: stateName,
  title, description,
  parent: z.string().regex(/^f-[0-9a-f]{8}$/).nullable(),
  module: moduleName.nullable(),
  fields: z.record(fieldName, filaFieldValueSchema),
  /** Specyfikacja: `enabled` = the field is on the thread now; revisions outlive removing the field. Absent = the type's template, no revisions. */
  spec: z.object({ enabled: z.boolean(), revisions: z.array(filaSpecRevisionSchema) }).optional(),
  /** The Cezar kit; absent = not added. */
  cezar: filaCezarSchema.optional(),
  /** „Zablokowane”: the thread's blocks, oldest first; any thread may have them, with or without the Cezar kit. */
  blockers: z.array(filaBlockerSchema).max(FILA_LIMITS.blockers).refine(list => new Set(list.map(b => b.id)).size === list.length, 'Duplicate blocker').default([]),
  archived: z.boolean(),
  revision: z.number().int().min(1),
  createdAt: z.number().finite(), updatedAt: z.number().finite(),
  history: z.array(filaHistorySchema),
  /** Read-only provenance of migration 1.4b; preserves data without a native Fila counterpart and original authors. */
  migratedTodo: z.object({ list: z.string(), listName: z.string(), original: todoTaskSchema }).optional(),
});

const boardId = z.string().regex(/^b-[0-9a-f]{8}$/);
const viewId = z.string().regex(/^v-[0-9a-f]{8}$/);
const sectionId = z.string().regex(/^s-[0-9a-f]{8}$/);
const columnId = z.string().regex(/^c-[0-9a-f]{8}$/);
const queryText = z.string().max(FILA_LIMITS.query);
/** A board's history also knows the panel itself (the starter board made with a project, D-019). */
export const filaBoardActorSchema = z.enum([...filaActorSchema.options, 'panel']);
export type FilaBoardActor = z.infer<typeof filaBoardActorSchema>;
export const filaColumnSchema = z.object({ id: columnId, name, query: queryText });
/** A list shows the section's threads; a kanban splits them into columns, each a narrowing query (D-029). */
export const filaSectionSchema = z.object({ id: sectionId, name, kind: z.enum(['list', 'kanban']), query: queryText, columns: z.array(filaColumnSchema).max(FILA_LIMITS.columns) });
export const filaViewSchema = z.object({ id: viewId, name, sections: z.array(filaSectionSchema).min(1).max(FILA_LIMITS.sections) });
/** One entry per change of the board's structure or settings (D-062): who, when, what, with the old and new value. */
export const filaBoardHistorySchema = z.object({
  at: z.number().finite(), by: filaBoardActorSchema,
  kind: z.enum(['created', 'renamed', 'changed', 'moved', 'removed']),
  target: z.enum(['board', 'view', 'section', 'column']),
  name: z.string().max(FILA_LIMITS.name),
  /** The parent the target sits in (the view of a section, the section of a column). */
  in: z.string().max(FILA_LIMITS.name * 2 + 4).optional(),
  changes: z.array(changeSchema).max(20).optional(),
});
/** A board is only a name and its views: no scope of its own (D-013). */
export const filaBoardSchema = z.object({
  id: boardId, name, createdAt: z.number().finite(),
  views: z.array(filaViewSchema).min(1).max(FILA_LIMITS.views),
  history: z.array(filaBoardHistorySchema),
});
export const filaDataSchema = z.object({
  projects: z.array(filaProjectSchema).max(FILA_LIMITS.projects),
  workflows: z.array(filaWorkflowSchema).max(FILA_LIMITS.workflows),
  fieldDefs: z.array(filaFieldDefSchema).max(FILA_LIMITS.fieldDefs),
  threads: z.array(filaThreadSchema).max(FILA_LIMITS.threads),
  boards: z.array(filaBoardSchema).max(FILA_LIMITS.boards).default([]),
  /** Project → the board it got at the start. A record of its own, so a deleted starter board is not made again (D-019). */
  starterBoards: z.record(projectKey, boardId).default({}),
  /** The Cezar kit's global settings (2.1); absent = `defaultFilaCezarSettings()`. */
  cezarSettings: filaCezarSettingsSchema.optional(),
  /** Idempotency keys of batches already applied (1.3a): a retry with the same key and batch answers again without writing. */
  idempotency: z.array(z.object({
    actor: filaActorSchema, key: z.string().min(1).max(100), hash: z.string().max(64), at: z.number().finite(),
    outcome: z.object({ results: z.array(z.record(z.string(), z.unknown())), threads: z.array(z.record(z.string(), z.unknown())) }),
  })).max(200).optional(),
});
export type FilaData = z.infer<typeof filaDataSchema>;
export type FilaProject = z.infer<typeof filaProjectSchema>;
export type FilaWorkflow = z.infer<typeof filaWorkflowSchema>;
export type FilaThread = z.infer<typeof filaThreadSchema>;
export type FilaBoard = z.infer<typeof filaBoardSchema>;
export type FilaSection = z.infer<typeof filaSectionSchema>;

/**
 * Every change is one small action. The author is never in the action: the server takes it from the caller's
 * authentication (a client token, or the panel's own page for the user), see docs/fila.md.
 */
const sectionInput = z.object({
  name, kind: z.enum(['list', 'kanban']), query: queryText,
  columns: z.array(z.object({ name, query: queryText }).strict()).max(FILA_LIMITS.columns).optional(),
}).strict();
const position = z.number().int().min(0);
const atLeastOne = (keys: string[]) => (a: Record<string, unknown>) => keys.some(key => a[key] !== undefined);
/** Boards, views, sections and columns (1.2). The user and the AI change the structure by the same rules (D-032). */
const filaBoardActions = [
  z.object({ action: z.literal('createBoard'), name, view: name.optional(), section: sectionInput }).strict(),
  z.object({ action: z.literal('renameBoard'), board: boardId, name }).strict(),
  z.object({ action: z.literal('deleteBoard'), board: boardId }).strict(),
  z.object({ action: z.literal('createView'), board: boardId, name, section: sectionInput, position: position.optional() }).strict(),
  z.object({ action: z.literal('renameView'), view: viewId, name }).strict(),
  z.object({ action: z.literal('moveView'), view: viewId, position }).strict(),
  z.object({ action: z.literal('deleteView'), view: viewId }).strict(),
  z.object({ action: z.literal('createSection'), view: viewId, section: sectionInput, position: position.optional() }).strict(),
  z.object({ action: z.literal('updateSection'), section: sectionId, name: name.optional(), query: queryText.optional() }).strict().refine(atLeastOne(['name', 'query']), { message: 'Nothing to change' }),
  z.object({ action: z.literal('moveSection'), section: sectionId, position }).strict(),
  z.object({ action: z.literal('deleteSection'), section: sectionId }).strict(),
  z.object({ action: z.literal('createColumn'), section: sectionId, name, query: queryText, position: position.optional() }).strict(),
  z.object({ action: z.literal('updateColumn'), column: columnId, name: name.optional(), query: queryText.optional() }).strict().refine(atLeastOne(['name', 'query']), { message: 'Nothing to change' }),
  z.object({ action: z.literal('moveColumn'), column: columnId, position }).strict(),
  z.object({ action: z.literal('deleteColumn'), column: columnId }).strict(),
] as const;

export const filaActionSchema = z.discriminatedUnion('action', [
  ...filaBoardActions,
  z.object({ action: z.literal('createProject'), key: projectKey, name }).strict(),
  z.object({ action: z.literal('setModules'), project: projectKey, modules: z.array(moduleName).max(FILA_LIMITS.modules).refine(unique, 'Duplicate module') }).strict(),
  z.object({ action: z.literal('createWorkflow'), name, states: filaWorkflowSchema.shape.states }).strict(),
  z.object({ action: z.literal('updateWorkflow'), workflow: workflowId, name: name.optional(), states: filaWorkflowSchema.shape.states.optional() }).strict()
    .refine(a => a.name !== undefined || a.states !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('createThread'), project: projectKey, type: filaTypeSchema, title, description: description.optional(), parent: threadId.optional(), module: moduleName.optional(), tags: tags.optional() }).strict(),
  z.object({ action: z.literal('setCezarSettings'), readyStates }).strict(),
  z.object({
    action: z.literal('updateThread'), thread: threadId, expectedRevision: z.number().int().min(1).optional(),
    title: title.optional(), description: description.optional(), state: stateName.optional(),
    module: moduleName.nullable().optional(), parent: threadId.nullable().optional(),
    project: projectKey.optional(), workflow: workflowId.optional(),
  }).strict().refine(a => Object.entries(a).some(([key, value]) => !['action', 'thread', 'expectedRevision'].includes(key) && value !== undefined), { message: 'Nothing to change' }),
  z.object({ action: z.literal('setField'), thread: threadId, field: fieldName, value: filaFieldValueSchema, kind: filaFieldKindSchema.optional(), expectedRevision: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('removeField'), thread: threadId, field: fieldName, expectedRevision: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('setSpec'), thread: threadId, text: z.string().max(FILA_LIMITS.spec), baseRevision: z.number().int().min(0) }).strict(),
  z.object({ action: z.literal('addSpecField'), thread: threadId }).strict(),
  z.object({ action: z.literal('removeSpecField'), thread: threadId }).strict(),
  z.object({ action: z.literal('addCezarKit'), thread: threadId }).strict(),
  z.object({ action: z.literal('removeCezarKit'), thread: threadId }).strict(),
  z.object({
    action: z.literal('setCezar'), thread: threadId, expectedRevision: z.number().int().min(1).optional(),
    executor: todoExecutorSchema.nullable().optional(), repo: todoRepoSchema.nullable().optional(), mode: todoModeSchema.nullable().optional(),
  }).strict().refine(a => ['executor', 'repo', 'mode'].some(key => (a as Record<string, unknown>)[key] !== undefined), { message: 'Nothing to change' }),
  z.object({ action: z.literal('linkCezar'), thread: threadId, kind: filaCezarLinkKind, id: filaCezarLinkId, title: z.string().trim().min(1).max(200).optional() }).strict()
    .refine(validPrUrl, { message: 'Invalid GitHub pull request URL' }),
  z.object({ action: z.literal('unlinkCezar'), thread: threadId, kind: filaCezarLinkKind, id: filaCezarLinkId }).strict(),
  /** `origin` is the panel's alone (an entry from a task, 2.3b): the user and the AI write entries by hand and may not send it. */
  z.object({ action: z.literal('addBlocker'), thread: threadId, reason: blockerReason, origin: blockerTaskOrigin.optional(), expectedRevision: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('removeBlocker'), thread: threadId, blocker: blockerId, expectedRevision: z.number().int().min(1).optional() }).strict(),
  z.object({ action: z.literal('comment'), thread: threadId, text: z.string().trim().min(1).max(FILA_LIMITS.comment) }).strict(),
  z.object({ action: z.literal('archiveThread'), thread: threadId }).strict(),
  z.object({ action: z.literal('restoreThread'), thread: threadId }).strict(),
  z.object({ action: z.literal('deleteThread'), thread: threadId }).strict(),
]);
export type FilaAction = z.infer<typeof filaActionSchema>;
export type FilaBoardAction = z.infer<(typeof filaBoardActions)[number]>;
export type FilaSectionInput = z.infer<typeof sectionInput>;
const boardActionNames = new Set<string>(filaBoardActions.map(schema => schema.shape.action.value));
export const isFilaBoardAction = (action: FilaAction): action is FilaBoardAction => boardActionNames.has(action.action);

/** What an action answers: the ids it made or touched. */
export interface FilaResult { ok: true; board?: string; view?: string; section?: string; column?: string; project?: string; workflow?: string; thread?: { id: string; revision: number; previousId?: string }; specRevision?: number; /** The id of the entry `addBlocker` made. */ blocker?: string; removed?: number }
