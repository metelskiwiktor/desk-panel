import { z } from 'zod';

export const warmupProviderSchema=z.enum(['Claude','Codex']);
export type WarmupProvider=z.infer<typeof warmupProviderSchema>;
export const warmupSettingsSchema=z.object({enabled:z.boolean(),time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  model:z.string().regex(/^[a-zA-Z0-9_.-]{1,100}$/).optional(),configurationError:z.string().optional()});
export const warmupEditSchema=warmupSettingsSchema.omit({configurationError:true}).strict();
export const warmupEditFor=(provider:WarmupProvider)=>warmupEditSchema.refine(value=>provider==='Claude' ? value.model==='haiku' : !value.enabled || !!value.model,'Nieprawidłowy model warmupu');
export type WarmupSettings=z.infer<typeof warmupSettingsSchema>;
export const warmupStatusSchema=z.object({settings:z.object({Claude:warmupSettingsSchema,Codex:warmupSettingsSchema}),
  last:z.record(z.string(),z.object({at:z.string(),result:z.string(),reason:z.string().optional()}).optional()),
  warning:z.string()});
export type WarmupStatus=z.infer<typeof warmupStatusSchema>;
