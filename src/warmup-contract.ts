import { z } from 'zod';

export const warmupProviderSchema=z.enum(['Claude','Codex','Gemini']);
/** Gemini Models group only: not Argon, not the Claude/GPT models that AGY also serves. */
export const geminiModelAllowed=(model?:string)=>!!model && /^gemini-[a-z0-9.-]{1,80}$/.test(model) && !/argon/.test(model);
export type WarmupProvider=z.infer<typeof warmupProviderSchema>;
export const warmupSettingsSchema=z.object({enabled:z.boolean(),
  model:z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/).optional(),configurationError:z.string().optional()});
export const warmupEditSchema=warmupSettingsSchema.omit({configurationError:true}).strict();
export const warmupEditFor=(provider:WarmupProvider)=>warmupEditSchema.refine(value=>provider==='Claude' ? value.model==='haiku' : provider==='Gemini' ? !value.enabled || geminiModelAllowed(value.model) : !value.enabled || !!value.model,'Nieprawidłowy model warmupu');
export type WarmupSettings=z.infer<typeof warmupSettingsSchema>;
const quotaPointSchema=z.object({usedPercent:z.number().nullable(),resetAt:z.string().nullable()});
/** One prompt the adapter sent (or tried to send). Optional: older adapters do not keep history. */
export const warmupHistoryEntrySchema=z.object({id:z.string(),provider:warmupProviderSchema,trigger:z.enum(['auto','manual']),
  startedAt:z.string(),finishedAt:z.string(),durationMs:z.number().nonnegative(),model:z.string().nullable(),result:z.string(),reason:z.string().optional(),
  prompt:z.string().optional(),response:z.string().optional(),
  usage:z.object({inputTokens:z.number(),cachedInputTokens:z.number().nullable(),outputTokens:z.number()}).optional(),
  quotaBefore:quotaPointSchema.optional(),quotaAfter:quotaPointSchema.optional(),windowEffect:z.enum(['started','already_active']).optional()});
export type WarmupHistoryEntry=z.infer<typeof warmupHistoryEntrySchema>;
export const warmupStatusSchema=z.object({mode:z.literal('on_reset'),pollIntervalSeconds:z.literal(30),settings:z.object({Claude:warmupSettingsSchema,Codex:warmupSettingsSchema,Gemini:warmupSettingsSchema.optional()}),
  last:z.record(z.string(),z.object({at:z.string(),result:z.string(),reason:z.string().optional()}).optional()),
  history:z.array(warmupHistoryEntrySchema).optional(),warning:z.string()});
export type WarmupStatus=z.infer<typeof warmupStatusSchema>;
