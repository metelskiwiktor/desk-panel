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
  status: z.enum(['needs-input', 'review', 'running', 'queue', 'done']),
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
});
export const cezarSchema = z.object({
  observedAt: z.number().finite(), tasks: z.array(taskSchema),
  counts: z.object({ running: count, queue: count, 'needs-input': count, review: count }),
  partial: z.boolean().default(false), scheduled: count.default(0),
});
export type CezarSnapshot = z.infer<typeof cezarSchema>;
