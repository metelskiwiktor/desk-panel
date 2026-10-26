import { z } from 'zod';

const count = z.number().int().nonnegative();

export const taskActivityDetailSchema = z.object({
  state: z.enum(['executing_tool', 'thinking', 'waiting_for_input', 'completed', 'queued']),
  activeTool: z.string().optional(),
  activeToolInput: z.string().optional(),
  elapsedMs: z.number().optional(),
  message: z.string().optional(),
});

export const taskCheckItemSchema = z.object({
  command: z.string(),
  status: z.enum(['passed', 'failed', 'running', 'unknown']),
  exitCode: z.number().optional(),
  outputExcerpt: z.string().optional(),
});

export const taskChecksSchema = z.object({
  executed: z.boolean(),
  total: z.number(),
  passed: z.number(),
  failed: z.number(),
  items: z.array(taskCheckItemSchema).optional(),
});

export const taskDiffStatSchema = z.object({
  adds: z.number(),
  dels: z.number(),
  files: z.number(),
});

export const taskCurrentStepSchema = z.object({
  id: z.string(),
  name: z.string().optional(),
  status: z.string(),
});

export const taskSchema = z.object({
  id: z.string(), title: z.string(), project: z.string(),
  status: z.enum(['needs-input', 'review', 'running', 'queue', 'done', 'failed']),
  checkedAt: z.number().finite(), startedAt: z.number().finite().optional(),
  completedAt: z.number().finite().optional(), description: z.string(),
  sourceUrl: z.url(), activity: z.string().optional(),
  branch: z.string().optional(),
  workflow: z.string().optional(),
  runner: z.string().optional(),
  model: z.string().optional(),
  currentStep: taskCurrentStepSchema.nullable().optional(),
  activityDetail: taskActivityDetailSchema.optional(),
  checks: taskChecksSchema.optional(),
  diffStat: taskDiffStatSchema.optional(),
  question: z.string().nullable().optional(),
  lastMessage: z.string().optional(),
  /** Finished tasks only: Cezar has no read receipt for it yet. */
  unread: z.boolean().optional(),
  pullRequestUrl: z.string().optional(),
});
/** A task that ended and is not archived yet; it stays on the dashboard until it is archived. */
export const finishedTaskSchema = taskSchema.extend({ status: z.enum(['done', 'failed']) });
export type FinishedTask = z.infer<typeof finishedTaskSchema>;
/** The only writes to Cezar: archive or restore a task, mark it read or unread. */
export const cezarActions = ['archive', 'unarchive', 'read', 'unread'] as const;
export type CezarAction = typeof cezarActions[number];
export const cezarActionSchema = z.object({ id: z.string().regex(/^[^/\s]{1,128}\/[0-9A-Za-z-]{1,128}$/), action: z.enum(cezarActions) }).strict();
export const cezarCreateRunSchema = z.object({
  task: z.string().trim().min(1).max(32_000),
  title: z.string().trim().min(1).max(120).optional(),
  project: z.string().trim().min(1).max(64).default('desk-panel'),
  workflow: z.string().trim().min(1).max(64).default('desk-panel-task'),
  runner: z.string().trim().min(1).max(32).default('agy'),
  model: z.string().trim().min(1).max(128).default('gemini-3.8-flash-medium'),
  todoId: z.string().trim().min(1).max(64).optional(),
}).strict();
export type CezarCreateRunInput = z.input<typeof cezarCreateRunSchema>;
export interface CezarCreatedRun {
  ok: true;
  id: string;
  project: string;
  url: string;
  workflow: string;
  runner: string;
  model: string;
}
export const cezarSchema = z.object({
  observedAt: z.number().finite(), tasks: z.array(taskSchema), finished: z.array(finishedTaskSchema).default([]),
  counts: z.object({ running: count, queue: count, 'needs-input': count, review: count }),
  partial: z.boolean().default(false), scheduled: count.default(0),
});
export type CezarSnapshot = z.infer<typeof cezarSchema>;
