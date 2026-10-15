import { z } from 'zod';

const observation = z.object({ window: z.enum(['5h','7d']), usedPercent: z.number().min(0).max(100).nullable(),
  observedAt: z.number().finite().nullable(), resetAt: z.number().finite().nullable(), stale: z.boolean(), source: z.string().nullable(), freshForMs:z.number().int().positive().max(120000).optional() });
export const quotaSourceSchema = z.object({ live: z.literal(true), name: z.enum(['Zapisane limity AI','Limity AI']), mode:z.enum(['live','historical']).optional(),
  status: z.enum(['connected','offline','loading','unavailable']), observedAt: z.number().finite().nullable(), message: z.string().optional(),
  data: z.array(z.object({ provider: z.enum(['Claude','Codex']), snapshots: z.array(observation).length(2), history: z.array(observation).max(100) })).nullable(),
});
export type QuotaSource = z.infer<typeof quotaSourceSchema>;
