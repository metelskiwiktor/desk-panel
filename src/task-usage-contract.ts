import { z } from 'zod';

const count = z.number().int().nonnegative();
export const taskUsageStepSchema = z.object({ name: z.string().max(200), provider: z.string().nullable(), tokensUsed: count, costUsd: z.number().nonnegative().nullable() });
export const taskUsageEntrySchema = z.object({
  id: z.string().min(1), title: z.string().max(200), provider: z.string().nullable(), status: z.string(),
  startedAt: z.number().nullable(), finishedAt: z.number().nullable(),
  tokensUsed: count, inputTokens: count, outputTokens: count, costUsd: z.number().nonnegative().nullable(),
  /** Percentage points of the provider limit the account moved during the task; null when it cannot be told. */
  quota: z.object({ fiveHour: z.number().min(0).max(100).nullable(), sevenDay: z.number().min(0).max(100).nullable(),
    note: z.enum(['overlap', 'window_reset', 'no_samples', 'unsupported']).nullable() }),
  steps: z.array(taskUsageStepSchema).max(50),
});
/** `observedAt` is the adapter's read time; `status` says whether the numbers are current. */
export const taskUsageSchema = z.object({
  status: z.enum(['connected', 'unavailable', 'offline']), observedAt: z.number().nullable(),
  tasks: z.array(taskUsageEntrySchema).max(50),
});
export type TaskUsageEntry = z.infer<typeof taskUsageEntrySchema>;
export type TaskUsage = z.infer<typeof taskUsageSchema>;
