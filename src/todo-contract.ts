import { z } from 'zod';

/** To-do lists of the user: the panel's own data (not a provider's), kept by the server and changed by small actions. */
export const TODO_LIMITS = { lists: 50, tasksPerList: 500, name: 80, title: 200, note: 2000, blocked: 300, links: 20, history: 200, comment: 2000 } as const;
export const TODO_STATUSES = {
  pomysl: 'Pomysł', przygotowanie: 'Do przygotowania', gotowe: 'Gotowe do realizacji', realizacja: 'W realizacji',
  sprawdzenie: 'Do sprawdzenia', zakonczone: 'Zakończone', porzucone: 'Porzucone',
} as const;
export const todoStatusSchema = z.enum(Object.keys(TODO_STATUSES) as [keyof typeof TODO_STATUSES, ...(keyof typeof TODO_STATUSES)[]]);
const actor = z.enum(['user', 'agent', 'panel']);
const linkKind = z.enum(['chat', 'cezar', 'pr']);
const linkId = z.string().trim().min(1).max(500);
const validLink = (link: { kind: string; id: string }) => link.kind !== 'pr' || /^https:\/\/github\.com\/[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?\/(?!\.{1,2}\/)[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/.test(link.id);
const linkSchema = z.object({ kind: linkKind, id: linkId, title: z.string().trim().min(1).max(200).optional(), at: z.number().finite() }).refine(validLink, 'Invalid GitHub pull request URL');
const historySchema = z.object({ at: z.number().finite(), by: actor, kind: z.enum(['status', 'comment', 'link', 'blocked']), text: z.string().max(2000).optional(), from: todoStatusSchema.optional(), to: todoStatusSchema.optional() });
export const todoIsDone = (status: keyof typeof TODO_STATUSES) => status === 'zakonczone' || status === 'porzucone';

export const todoListId = z.string().regex(/^l-[0-9a-f]{8}$/);
export const todoTaskId = z.string().regex(/^t-[0-9a-f]{8}$/);
const name = z.string().trim().min(1).max(TODO_LIMITS.name);
const title = z.string().trim().min(1).max(TODO_LIMITS.title);
const note = z.string().max(TODO_LIMITS.note);

export const todoTaskSchema = z.object({
  id: todoTaskId, title, note, done: z.boolean(),
  createdAt: z.number().finite(),
  /** When it was ticked; null while it is open. */
  completedAt: z.number().finite().nullable(),
  /** Who added it, so what the agent put on a list can be told from what the user did. */
  by: z.enum(['user', 'agent']),
  status: todoStatusSchema.optional(),
  blocked: z.string().max(TODO_LIMITS.blocked).nullable().default(null),
  links: z.array(linkSchema).max(TODO_LIMITS.links).default([]).refine(links => new Set(links.map(l => `${l.kind}:${l.id}`)).size === links.length, 'Duplicate link'),
  history: z.array(historySchema).max(TODO_LIMITS.history).default([]),
}).transform(task => {
  const status = task.status ?? (task.done ? 'zakonczone' : 'pomysl');
  return { ...task, status, done: todoIsDone(status), completedAt: todoIsDone(status) ? task.completedAt : null };
});
export const todoListSchema = z.object({
  id: todoListId, name, createdAt: z.number().finite(),
  /** The list's own setting, so every tile and screen shows it the same way: done tasks stay on the list but are not shown. */
  hideDone: z.boolean().default(false),
  /** Also a setting of the list: mark the tasks the agent added (off unless the user wants to see it). */
  showAgent: z.boolean().default(false),
  /** In the order they were added; showing open ones first is the view's business. */
  tasks: z.array(todoTaskSchema).max(TODO_LIMITS.tasksPerList),
});
export const todoDataSchema = z.object({ lists: z.array(todoListSchema).max(TODO_LIMITS.lists) });

export const todoSourceSchema = z.object({
  live: z.literal(true), name: z.literal('Zadania'),
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(), message: z.string().optional(),
  data: todoDataSchema.nullable(),
});
export type TodoTask = z.infer<typeof todoTaskSchema>;
export const todoOpenStatus = (task: TodoTask): TodoTask['status'] =>
  [...task.history].reverse().flatMap(h => h.kind === 'status' ? [h.to, h.from] : []).find(s => s !== undefined && !todoIsDone(s)) ?? 'pomysl';
export type TodoList = z.infer<typeof todoListSchema>;
export type TodoData = z.infer<typeof todoDataSchema>;
export type TodoSource = z.infer<typeof todoSourceSchema>;

/**
 * Every change is one small action, so the screen and the agent can both write without overwriting each other.
 * `by` on `addTask` says who adds the task; the screen leaves it out (the user), the agent says `agent`.
 */
export const todoActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('createList'), name }).strict(),
  z.object({ action: z.literal('renameList'), list: todoListId, name }).strict(),
  z.object({ action: z.literal('setListOptions'), list: todoListId, hideDone: z.boolean().optional(), showAgent: z.boolean().optional() }).strict()
    .refine(a => a.hideDone !== undefined || a.showAgent !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('deleteList'), list: todoListId }).strict(),
  z.object({ action: z.literal('addTask'), list: todoListId, title, note: note.optional(), by: z.enum(['user', 'agent']).optional() }).strict(),
  z.object({ action: z.literal('updateTask'), task: todoTaskId, title: title.optional(), note: note.optional(), done: z.boolean().optional(), by: actor.optional() }).strict()
    .refine(a => a.title !== undefined || a.note !== undefined || a.done !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('moveTask'), task: todoTaskId, list: todoListId }).strict(),
  z.object({ action: z.literal('deleteTask'), task: todoTaskId }).strict(),
  z.object({ action: z.literal('clearDone'), list: todoListId }).strict(),
  z.object({ action: z.literal('setStatus'), task: todoTaskId, status: todoStatusSchema, by: actor.optional() }).strict(),
  z.object({ action: z.literal('setBlocked'), task: todoTaskId, reason: z.string().trim().min(1).max(TODO_LIMITS.blocked).nullable(), by: actor.optional() }).strict(),
  z.object({ action: z.literal('addComment'), task: todoTaskId, text: z.string().trim().min(1).max(TODO_LIMITS.comment), by: actor.optional() }).strict(),
  z.object({ action: z.literal('link'), task: todoTaskId, kind: linkKind, id: linkId, title: z.string().trim().min(1).max(200).optional(), by: actor.optional() }).strict().refine(validLink, 'Invalid GitHub pull request URL'),
  z.object({ action: z.literal('unlink'), task: todoTaskId, kind: linkKind, id: linkId, by: actor.optional() }).strict().refine(validLink, 'Invalid GitHub pull request URL'),
]);
export type TodoAction = z.infer<typeof todoActionSchema>;

/** What an action answers: the ids it made or touched, so a caller can go on without reading the lists again. */
export interface TodoResult { ok: true; list?: { id: string; name: string; created?: boolean }; task?: { id: string }; removed?: number }
