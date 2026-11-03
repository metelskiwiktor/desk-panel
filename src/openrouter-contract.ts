import { z } from 'zod';

export const openrouterUsageSchema = z.object({
  dailyUsd: z.number().min(0),
  weeklyUsd: z.number().min(0),
  monthlyUsd: z.number().min(0),
  allTimeUsd: z.number().min(0),
  balanceUsd: z.number(),
  limitUsd: z.number().min(0).nullable(),
  limitRemainingUsd: z.number().nullable(),
  observedAt: z.number(),
});

export type OpenRouterUsage = z.infer<typeof openrouterUsageSchema>;
