import { z } from 'zod';

const percent = z.number().min(0).max(100);
export const usageSegmentSchema = z.object({
  kind: z.enum(['task', 'session', 'tasks_rest', 'other', 'unobserved']), id: z.string().optional(), title: z.string().max(200).optional(),
  percent, shared: z.boolean().optional(),
});
export const usageProviderSchema = z.object({
  provider: z.enum(['Claude', 'Codex', 'Gemini']), usedPercent: percent.nullable(),
  observedAt: z.number().nullable(), resetAt: z.number().nullable(), segments: z.array(usageSegmentSchema).max(10),
});
/** What filled each provider's current 5h window: Cezar tasks, other sources, or usage seen before the first reading. */
export const usageBreakdownSchema = z.object({
  status: z.enum(['connected', 'unavailable', 'offline']), observedAt: z.number().nullable(),
  providers: z.array(usageProviderSchema).max(3),
});
export type UsageSegment = z.infer<typeof usageSegmentSchema>;
export type UsageProvider = z.infer<typeof usageProviderSchema>;
export type UsageBreakdown = z.infer<typeof usageBreakdownSchema>;
