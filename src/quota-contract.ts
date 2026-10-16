import { z } from 'zod';

const observation = z.object({ window: z.string().min(1).max(120), model:z.string().max(160).optional(), label:z.string().max(200).optional(), state:z.enum(['fresh','stale','unavailable','auth_required']).optional(), reason:z.string().nullable().optional(), attemptedAt:z.number().finite().optional(), usedPercent: z.number().min(0).max(100).nullable(),
  observedAt: z.number().finite().nullable(), resetAt: z.number().finite().nullable(), stale: z.boolean(), source: z.string().nullable(), freshForMs:z.number().int().positive().max(120000).optional() });
export const quotaSourceSchema = z.object({ live: z.literal(true), name: z.enum(['Zapisane limity AI','Limity AI']), mode:z.enum(['live','historical']).optional(),
  status: z.enum(['connected','offline','loading','unavailable']), observedAt: z.number().finite().nullable(), message: z.string().optional(),
  data: z.array(z.object({ provider: z.enum(['Claude','Codex','AGY']), accountId:z.string().nullable().optional(), reason:z.string().nullable().optional(), attemptedAt:z.number().finite().optional(), snapshots: z.array(observation).max(200), history: z.array(observation).max(100) }).refine(a=>a.provider==='AGY' || a.snapshots.length===2)).nullable(),
});
export type QuotaSource = z.infer<typeof quotaSourceSchema>;
