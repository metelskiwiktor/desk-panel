import { z } from 'zod';

const percent = z.number().min(0).max(100);
export const usageSegmentSchema = z.object({
  kind: z.enum(['task', 'session', 'tasks_rest', 'other', 'unobserved']), id: z.string().optional(), title: z.string().max(200).optional(),
  origin: z.enum(['cezar', 'claude-app', 'claude-cli', 'codex-app', 'codex-cli', 'antigravity-app', 'antigravity-cli', 'warmup', 'unknown']).optional(),
  percent, shared: z.boolean().optional(),
});
export const usageProviderSchema = z.object({
  provider: z.enum(['Claude', 'Codex', 'Gemini']), usedPercent: percent.nullable(),
  observedAt: z.number().nullable(), resetAt: z.number().nullable(), segments: z.array(usageSegmentSchema).max(10),
  /** Same parts in time order; `key` is a segment's id, or its kind for tasks_rest, other and unobserved. */
  timeline: z.array(z.object({ key: z.string(), percent })).max(150).optional(),
});
/** What filled each provider's current 5h window: Cezar tasks, other sources, or usage seen before the first reading. */
export const usageBreakdownSchema = z.object({
  status: z.enum(['connected', 'unavailable', 'offline']), observedAt: z.number().nullable(),
  providers: z.array(usageProviderSchema).max(3),
});
export type UsageSegment = z.infer<typeof usageSegmentSchema>;
export type UsageProvider = z.infer<typeof usageProviderSchema>;
export type UsageBreakdown = z.infer<typeof usageBreakdownSchema>;
