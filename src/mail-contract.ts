import { z } from 'zod';

const status = z.enum(['connected', 'offline', 'unavailable', 'loading']);
/** One unread inbox conversation; `id` is unique across accounts. */
export const mailThreadSchema = z.object({
  id: z.string(), account: z.string(), threadId: z.string().regex(/^[0-9a-f]+$/i),
  from: z.string(), subject: z.string(), snippet: z.string(),
  receivedAt: z.number().finite(), messages: z.number().int().positive(), sourceUrl: z.url(),
});
export const mailAccountSchema = z.object({
  email: z.string(), status, observedAt: z.number().finite().nullable(),
  /** Loaded unread inbox conversations from the last 30 days, before UI pagination (up to 200 per account). */
  unread: z.number().int().nonnegative().nullable(), message: z.string().optional(),
});
export const mailSourceSchema = z.object({
  live: z.literal(true), name: z.literal('Gmail'), status,
  observedAt: z.number().finite().nullable(), message: z.string().optional(),
  data: z.array(mailThreadSchema).nullable(), accounts: z.array(mailAccountSchema),
  /** Listed conversations available in total; `data` holds the first `limit` of them. */
  total: z.number().int().nonnegative(), partial: z.boolean().optional(),
});
export type MailThread = z.infer<typeof mailThreadSchema>;
export type MailSource = z.infer<typeof mailSourceSchema>;
/** Conversations requested per scroll step. */
export const MAIL_PAGE = 30;
export const mailActions = ['read', 'unread', 'trash', 'untrash'] as const;
export type MailAction = typeof mailActions[number];
export const mailActionSchema = z.object({ account: z.string(), threadId: z.string().regex(/^[0-9a-f]+$/i), action: z.enum(mailActions) }).strict();
