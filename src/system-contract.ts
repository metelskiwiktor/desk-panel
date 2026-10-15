import { z } from 'zod';

export const systemSampleSchema = z.object({
  at: z.number().finite(), cpuPercent: z.number().min(0).max(100),
  ramUsedGb: z.number().nonnegative(), ramTotalGb: z.number().positive(),
}).refine(s => s.ramUsedGb <= s.ramTotalGb);
export const systemSourceSchema = z.object({
  live: z.literal(true), name: z.literal('Komputer'),
  status: z.enum(['connected', 'loading', 'offline', 'unavailable']),
  observedAt: z.number().finite().nullable(), data: z.array(systemSampleSchema).max(150).nullable(),
  message: z.string().optional(),
}).refine(s => !s.data || s.data.every((v, i, all) => i === 0 || v.at > all[i - 1].at));
export type SystemSource = z.infer<typeof systemSourceSchema>;
