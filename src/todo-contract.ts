import { z } from 'zod';

/** To-do lists of the user: the panel's own data (not a provider's), kept by the server and changed by small actions. */
export const TODO_LIMITS = { lists: 50, tasksPerList: 500, name: 80, title: 200, note: 2000 } as const;

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
});
export const todoListSchema = z.object({
  id: todoListId, name, createdAt: z.number().finite(),
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
  z.object({ action: z.literal('deleteList'), list: todoListId }).strict(),
  z.object({ action: z.literal('addTask'), list: todoListId, title, note: note.optional(), by: z.enum(['user', 'agent']).optional() }).strict(),
  z.object({ action: z.literal('updateTask'), task: todoTaskId, title: title.optional(), note: note.optional(), done: z.boolean().optional() }).strict()
    .refine(a => a.title !== undefined || a.note !== undefined || a.done !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('moveTask'), task: todoTaskId, list: todoListId }).strict(),
  z.object({ action: z.literal('deleteTask'), task: todoTaskId }).strict(),
  z.object({ action: z.literal('clearDone'), list: todoListId }).strict(),
]);
export type TodoAction = z.infer<typeof todoActionSchema>;

/** What an action answers: the ids it made or touched, so a caller can go on without reading the lists again. */
export interface TodoResult { ok: true; list?: { id: string; name: string; created?: boolean }; task?: { id: string }; removed?: number }
