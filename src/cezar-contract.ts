import { z } from 'zod';

const count = z.number().int().nonnegative();
export const taskSchema = z.object({
  id: z.string(), title: z.string(), project: z.string(),
  status: z.enum(['needs-input', 'review', 'running', 'queue', 'done']),
  checkedAt: z.number().finite(), startedAt: z.number().finite().optional(),
  completedAt: z.number().finite().optional(), description: z.string(),
  sourceUrl: z.url(), activity: z.string().optional(),
});
export const cezarSchema = z.object({
  observedAt: z.number().finite(), tasks: z.array(taskSchema),
  counts: z.object({ running: count, queue: count, 'needs-input': count, review: count }),
  partial: z.boolean(), scheduled: count,
});
export type CezarSnapshot = z.infer<typeof cezarSchema>;
