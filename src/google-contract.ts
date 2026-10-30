import { z } from 'zod';

const service = z.enum(['calendar', 'mail']);
/** A Google account the panel signs in to, and which of its services still need consent. */
export const googleAccountSchema = z.object({
  email: z.string(), status: z.enum(['connected', 'unavailable']), reason: z.string().optional(),
  services: z.array(service), missing: z.array(service),
  canCreateEvents: z.boolean().optional(),
});
export const googleAccountsSchema = z.array(googleAccountSchema);
export type GoogleAccountStatus = z.infer<typeof googleAccountSchema>;
