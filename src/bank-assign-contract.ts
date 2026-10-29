import { z } from 'zod';
import type { BankColor, BankIcon, BankMove } from './bank-labels-contract';

/**
 * Marking many operations at once with the panel's own suggestions (`panel_bank_assign`, the consent card). Wektor names only a
 * range of days; the panel takes the operations it has a sure suggestion for, groups them by what the suggestion says (one
 * mark, one group) and shows the groups (`GET /api/bank/assign`), then the operations it only has a choice for. Nothing is
 * marked until the user clicks „Wykonaj”. The user may untick a group or one operation (`skip`, `skipOps`) and pick one of the
 * options of a choice (`picks`): `skip` and `skipOps` can only narrow what the panel works out again, and a pick is only an
 * index into the options the panel works out itself. A choice is never taken for the user.
 */
export const BANK_ASSIGN_LIMITS = { items: 40, choices: 20, skip: 40, skipOps: 300, picks: 60 } as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const bankAssignSchema = z.object({
  /** First and last day of the operations to look at (both included); none: every operation kept. */
  from: day.optional(),
  to: day.optional(),
});
export type BankAssign = z.infer<typeof bankAssignSchema>;

export const bankGroupKey = z.string().regex(/^g-[0-9a-f]{8}$/);

/** What a suggestion would mark an operation with. */
export interface BankAssignMark {
  move: BankMove;
  /** The category or source (none for a settlement or a move between own accounts). */
  category: { name: string; color: BankColor; icon: BankIcon } | null;
  /** The other side by name, when the mark names one. */
  party: string | null;
  tags: string[];
}

export interface BankAssignItem { tx: string; day: string; name: string; amount: number }

/** The operations that share one suggested mark. */
export interface BankAssignGroup extends BankAssignMark {
  key: string;
  count: number;
  /** Signed sum in PLN: money in is positive. */
  total: number;
  /** Why the panel suggests it, as it says it in the operation's dialog. */
  why: string;
  /** Newest first; at most `BANK_ASSIGN_LIMITS.items`, the rest is `hidden` (always included). */
  items: BankAssignItem[];
  hidden: number;
}

/** An operation the panel has only a choice for, with its options (the first is the most frequent before). */
export interface BankAssignChoice extends BankAssignItem { why: string; options: BankAssignMark[] }

export interface BankAssignPreview {
  /** What was asked (null: no limit) and the days the operations on the card really span (null: none). */
  range: { from: string | null; to: string | null; first: string | null; last: string | null };
  groups: BankAssignGroup[];
  choices: { count: number; total: number; items: BankAssignChoice[] };
  problems: string[];
}

/** What the user's answer left behind, kept with the conversation. */
export type BankAssignOutcome =
  | { decision: 'applied'; at: number; assigned: number; skipped: string[]; skippedOps: string[]; picked: { tx: string; option: number }[]; preview?: BankAssignPreview }
  | { decision: 'rejected'; at: number; preview?: BankAssignPreview };
