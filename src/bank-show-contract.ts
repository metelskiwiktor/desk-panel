import { z } from 'zod';
import type { BankColor } from './bank-labels-contract';

/**
 * The data card of the chat (`panel_show`, `GET /api/bank/show`): Hermes names what to show with a few small fields, each
 * from a short list or a short text, and the card reads the rows itself, so they never pass through the model. The
 * choices that are not Hermes's to make (sorting, currency, how many rows, what the columns are) are the panel's.
 */
export const BANK_SHOW_VIEWS = ['tabela', 'słupki'] as const;
export const BANK_SHOW_LIMITS = { categories: 8, rows: 60, days: 400, defaultDays: 365 } as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** What is shown: spending categories of the user's marks, by name (a part of it is enough), in a range of days. */
export const bankShowObject = z.object({
  view: z.enum(BANK_SHOW_VIEWS).default('tabela'),
  kategorie: z.array(z.string().trim().min(1).max(60)).max(BANK_SHOW_LIMITS.categories).default([]),
  /** The spending nothing has marked yet, as one more row: what is left to sort. */
  nieoznaczone: z.boolean().default(false),
  from: day.optional(),
  to: day.optional(),
});
export const bankShowQuerySchema = bankShowObject.refine(q => q.kategorie.length > 0 || q.nieoznaczone, { message: 'Podaj kategorie albo nieoznaczone' });
export type BankShowQuery = z.infer<typeof bankShowQuerySchema>;

export interface BankShowData {
  view: (typeof BANK_SHOW_VIEWS)[number];
  from: string;
  to: string;
  /** What was asked that matched no category. */
  unknown: string[];
  /** Per category: how many operations and what went on it (positive; a refund lowers it). */
  categories: { id: string; name: string; color: BankColor; count: number; spent: number }[];
  /** Newest first, at most `BANK_SHOW_LIMITS.rows`. */
  rows: { day: string; amount: number; name: string; category: string; tags: string[] }[];
  total: { count: number; spent: number };
  /** The oldest and the newest operation shown (null: none in the range); the range asked for may be far wider. */
  span: { first: string; last: string } | null;
  /** Operations beyond the rows shown. */
  hidden: number;
  observedAt: number | null;
}
