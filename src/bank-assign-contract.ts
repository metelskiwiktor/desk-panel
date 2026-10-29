import { z } from 'zod';
import type { BankColor, BankIcon, BankMove } from './bank-labels-contract';
import { bankCategoryId, bankTxId } from './bank-labels-contract';

/**
 * Marking many operations at once with the panel's own suggestions (`panel_bank_assign`, the consent card). Wektor names only a
 * range of days. The panel finds who each operation is from or to (the same shop or person, by what the bank shows) and groups
 * the unmarked operations by that recipient, not by the mark: one recipient's operations need not all be marked alike (the same
 * fuel station sells fuel and a hot dog). For each recipient the card offers templates, the marks its earlier operations got,
 * most frequent first. Where the earlier operations all agree (at least two of them) the template is ticked by default; where
 * they differ, the user picks a template for the group or one for each operation, or any category of their own. Nothing is
 * marked until the user clicks „Wykonaj”, and nothing the panel works out is trusted from the request: the request names
 * recipients, operations, template keys and category ids, and the panel resolves them again against what it keeps now.
 */
export const BANK_ASSIGN_LIMITS = { items: 40, skip: 60, skipOps: 300, groupPicks: 60, picks: 300, templates: 4 } as const;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const bankAssignSchema = z.object({
  /** First and last day of the operations to look at (both included); none: every operation kept. */
  from: day.optional(),
  to: day.optional(),
});
export type BankAssign = z.infer<typeof bankAssignSchema>;

export const bankRecipientKey = z.string().regex(/^r-[0-9a-f]{8}$/);
export const bankTemplateKey = z.string().regex(/^t-[0-9a-f]{8}$/);

/** What a mark says in words for the card. */
export interface BankAssignMark {
  move: BankMove;
  /** The category or source (none for a settlement or a move between own accounts). */
  category: { id: string; name: string; color: BankColor; icon: BankIcon } | null;
  tags: string[];
  recurring: boolean;
}

/** A mark the recipient's earlier operations got, and how many did. */
export interface BankAssignTemplate { key: string; mark: BankAssignMark; count: number }

export interface BankAssignItem { tx: string; day: string; name: string; amount: number }

/** The unmarked operations of one recipient. */
export interface BankAssignRecipient {
  key: string;
  /** The recipient as the user named it, or the operation's own name when the panel does not know who it is. */
  name: string;
  count: number;
  /** Signed sum in PLN: money in is positive. */
  total: number;
  /** The earlier operations of this recipient all got one mark (at least two of them): its template is ticked by default. */
  certain: boolean;
  /** Most frequent first. */
  templates: BankAssignTemplate[];
  /** Newest first; at most `BANK_ASSIGN_LIMITS.items`, the rest is `hidden` (they follow the group's template). */
  items: BankAssignItem[];
  hidden: number;
}

export interface BankAssignCategory { id: string; name: string; move: BankMove; color: BankColor; icon: BankIcon }

export interface BankAssignPreview {
  /** What was asked (null: no limit) and the days the operations on the card really span (null: none). */
  range: { from: string | null; to: string | null; first: string | null; last: string | null };
  recipients: BankAssignRecipient[];
  /** The user's own categories, spending first: any of them can be picked for an operation. */
  categories: BankAssignCategory[];
  problems: string[];
}

/** What the user chose on the card; every part can only be narrower or equal to what the panel works out again. */
export const bankAssignChoiceSchema = z.object({
  /** Recipients unticked. */
  skip: z.array(bankRecipientKey).max(BANK_ASSIGN_LIMITS.skip).optional(),
  /** Single operations unticked. */
  skipOps: z.array(bankTxId).max(BANK_ASSIGN_LIMITS.skipOps).optional(),
  /** The template chosen for a whole recipient (the default for a certain one is its only template). */
  groupPicks: z.array(z.object({ group: bankRecipientKey, template: bankTemplateKey }).strict()).max(BANK_ASSIGN_LIMITS.groupPicks).optional(),
  /** The mark chosen for one operation: one of its recipient's templates, or one of the user's categories. */
  picks: z.array(z.object({ tx: bankTxId, template: bankTemplateKey.optional(), category: bankCategoryId.optional() }).strict()
    .refine(p => (p.template === undefined) !== (p.category === undefined), { message: 'Exactly one of template and category' })).max(BANK_ASSIGN_LIMITS.picks).optional(),
});
export type BankAssignChoice = z.infer<typeof bankAssignChoiceSchema>;

/** What the user's answer left behind, kept with the conversation. */
export type BankAssignOutcome =
  | { decision: 'applied'; at: number; assigned: number; choice: BankAssignChoice; preview?: BankAssignPreview }
  | { decision: 'rejected'; at: number; preview?: BankAssignPreview };
