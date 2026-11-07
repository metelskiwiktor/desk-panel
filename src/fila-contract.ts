import { z } from 'zod';

/**
 * Fila: threads (sprawy, funkcje, błędy, notatki, spotkania) in projects. The panel's own data, kept by the server and
 * changed by small actions (docs/fila.md). This is the core of stage 1.1a; boards and queries come later.
 */
export const FILA_LIMITS = {
  projects: 100, workflows: 50, states: 30, modules: 100, fieldDefs: 200, threads: 50_000,
  name: 80, state: 60, module: 60, fieldName: 60, title: 200, description: 20_000, comment: 5000,
  text: 2000, multi: 50, multiItem: 200, fieldsPerThread: 60, spec: 50_000,
} as const;

/** The clients of D-057. Each has its own token on the backend; none of them is ever the user (D-006). */
export const FILA_CLIENTS = ['claude-desktop', 'claude-code', 'codex', 'wektor'] as const;
export const filaActorSchema = z.enum(['user', ...FILA_CLIENTS]);
export type FilaActor = z.infer<typeof filaActorSchema>;

/** Types are templates in code (D-025): the base fields and the default workflow. Nothing here can be edited. */
export const FILA_DEFAULT_WORKFLOW = 'w-praca';
export const FILA_TYPES = {
  sprawa: { label: 'Sprawa', fields: ['Tagi'], spec: false },
  funkcja: { label: 'Funkcja', fields: ['Tagi'], spec: true },
  blad: { label: 'Błąd', fields: ['Tagi'], spec: true },
  notatka: { label: 'Notatka', fields: ['Tagi'], spec: false },
  spotkanie: { label: 'Spotkanie', fields: ['Tagi'], spec: false },
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
  at: z.number().finite(), by: filaActorSchema,
  kind: z.enum(['created', 'changed', 'comment', 'archived', 'restored', 'moved']),
  text: z.string().max(FILA_LIMITS.comment).optional(),
  changes: z.array(changeSchema).max(20).optional(),
});
/** One revision of the Specyfikacja (D-061): the whole text, who wrote it (a client, D-006) and when. Numbers start at 1 and never repeat. */
export const filaSpecRevisionSchema = z.object({
  number: z.number().int().min(1), text: z.string().max(FILA_LIMITS.spec), by: filaActorSchema, at: z.number().finite(),
});
export type FilaSpecRevision = z.infer<typeof filaSpecRevisionSchema>;
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
  archived: z.boolean(),
  revision: z.number().int().min(1),
  createdAt: z.number().finite(), updatedAt: z.number().finite(),
  history: z.array(filaHistorySchema),
});
export const filaDataSchema = z.object({
  projects: z.array(filaProjectSchema).max(FILA_LIMITS.projects),
  workflows: z.array(filaWorkflowSchema).max(FILA_LIMITS.workflows),
  fieldDefs: z.array(filaFieldDefSchema).max(FILA_LIMITS.fieldDefs),
  threads: z.array(filaThreadSchema).max(FILA_LIMITS.threads),
});
export type FilaData = z.infer<typeof filaDataSchema>;
export type FilaProject = z.infer<typeof filaProjectSchema>;
export type FilaWorkflow = z.infer<typeof filaWorkflowSchema>;
export type FilaThread = z.infer<typeof filaThreadSchema>;

/**
 * Every change is one small action. The author is never in the action: the server takes it from the caller's
 * authentication (a client token, or the panel's own page for the user), see docs/fila.md.
 */
export const filaActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('createProject'), key: projectKey, name }).strict(),
  z.object({ action: z.literal('setModules'), project: projectKey, modules: z.array(moduleName).max(FILA_LIMITS.modules).refine(unique, 'Duplicate module') }).strict(),
  z.object({ action: z.literal('createWorkflow'), name, states: filaWorkflowSchema.shape.states }).strict(),
  z.object({ action: z.literal('updateWorkflow'), workflow: workflowId, name: name.optional(), states: filaWorkflowSchema.shape.states.optional() }).strict()
    .refine(a => a.name !== undefined || a.states !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('createThread'), project: projectKey, type: filaTypeSchema, title, description: description.optional(), parent: threadId.optional(), module: moduleName.optional() }).strict(),
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
  z.object({ action: z.literal('comment'), thread: threadId, text: z.string().trim().min(1).max(FILA_LIMITS.comment) }).strict(),
  z.object({ action: z.literal('archiveThread'), thread: threadId }).strict(),
  z.object({ action: z.literal('restoreThread'), thread: threadId }).strict(),
  z.object({ action: z.literal('deleteThread'), thread: threadId }).strict(),
]);
export type FilaAction = z.infer<typeof filaActionSchema>;

/** What an action answers: the ids it made or touched. */
export interface FilaResult { ok: true; project?: string; workflow?: string; thread?: { id: string; revision: number; previousId?: string }; specRevision?: number; removed?: number }
