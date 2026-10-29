import { z } from 'zod';
import type { BankColor, BankIcon, BankMove } from './bank-labels-contract';

/**
 * Marking many operations at once with the panel's own suggestions (`panel_bank_assign`, the consent card). Wektor names only a
 * range of days; the panel takes the operations it has a sure suggestion for, groups them by what the suggestion says (one
 * mark, one group) and shows the groups (`GET /api/bank/assign`). Nothing is marked until the user clicks „Wykonaj”, and the
 * user may untick a group (`skip`, group keys the panel made): the request can only narrow what the panel works out again.
 * A suggestion that is only a choice is never taken for the user.
 */
export const BANK_ASSIGN_LIMITS = { items: 6, skip: 40 } as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const bankAssignSchema = z.object({
  /** First and last day of the operations to look at (both included); none: every operation kept. */
  from: day.optional(),
  to: day.optional(),
});
export type BankAssign = z.infer<typeof bankAssignSchema>;

export const bankGroupKey = z.string().regex(/^g-[0-9a-f]{8}$/);

/** The operations that share one suggested mark. */
export interface BankAssignGroup {
  key: string;
  move: BankMove;
  /** The category or source the mark has (none for a settlement or a move between own accounts). */
  category: { name: string; color: BankColor; icon: BankIcon } | null;
  /** The other side by name, when the mark names one. */
  party: string | null;
  tags: string[];
  count: number;
  /** Signed sum in PLN: money in is positive. */
  total: number;
  /** Why the panel suggests it, as it says it in the operation's dialog. */
  why: string;
  /** Newest first; at most `BANK_ASSIGN_LIMITS.items`, the rest is `hidden`. */
  items: { day: string; name: string; amount: number }[];
  hidden: number;
}

export interface BankAssignPreview {
  groups: BankAssignGroup[];
  /** Operations the panel only has a choice for: left alone, the user marks them one by one. */
  choices: { count: number; total: number };
  problems: string[];
}

/** What the user's answer left behind, kept with the conversation (`skipped`: group keys the user unticked). */
export type BankAssignOutcome =
  | { decision: 'applied'; at: number; assigned: number; skipped: string[]; preview?: BankAssignPreview }
  | { decision: 'rejected'; at: number; preview?: BankAssignPreview };
