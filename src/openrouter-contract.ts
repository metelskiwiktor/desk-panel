import { z } from 'zod';

export const openrouterModelUsageSchema = z.object({
  id: z.string(),
  label: z.string(),
  usd: z.number().min(0),
});

export const openrouterDayUsageSchema = z.object({
  day: z.string(),
  totalUsd: z.number().min(0),
  models: z.array(openrouterModelUsageSchema),
});

export const openrouterTotalsSchema = z.object({
  windowUsd: z.number().min(0),
  allTimeUsd: z.number().min(0),
});

export const openrouterCreditsSchema = z.object({
  totalUsd: z.number().min(0).nullable(),
  usedUsd: z.number().min(0).nullable(),
  remainingUsd: z.number().nullable(),
});

export const openrouterUsageSchema = z.object({
  days: z.array(openrouterDayUsageSchema),
  totals: openrouterTotalsSchema,
  credits: openrouterCreditsSchema,
  observedAt: z.number().nullable(),
});

export type OpenRouterModelUsage = z.infer<typeof openrouterModelUsageSchema>;
export type OpenRouterDayUsage = z.infer<typeof openrouterDayUsageSchema>;
export type OpenRouterTotals = z.infer<typeof openrouterTotalsSchema>;
export type OpenRouterCredits = z.infer<typeof openrouterCreditsSchema>;
export type OpenRouterUsage = z.infer<typeof openrouterUsageSchema>;
