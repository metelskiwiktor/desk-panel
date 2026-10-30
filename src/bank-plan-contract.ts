import { z } from 'zod';
import type { BankColor, BankIcon } from './bank-labels-contract';
import { bankAssignChoiceSchema } from './bank-assign-contract';

/**
 * A change Wektor proposes to the user's spending categories (`panel_bank_propose`, the consent card). Wektor names it with
 * a few exact category names; the panel works out what it would do (`GET /api/bank/plan`, the card's before and after) and
 * changes nothing until the user clicks „Wykonaj” (`POST /api/chats/:id/bank-plan`). Only a merge so far: the marks of some
 * spending categories go to one (made when it does not exist), and each folded category's name may stay on its marks as a tag.
 */
export const BANK_PLAN_LIMITS = { sources: 6, name: 40 } as const;

export const bankPlanSchema = z.object({
  /** Spending categories to fold, by name as the user's list has it (not a part of it). */
  merge: z.array(z.string().trim().min(1).max(BANK_PLAN_LIMITS.name)).min(1).max(BANK_PLAN_LIMITS.sources),
  /** The category they go to: an existing spending category of this name, or a new one. */
  into: z.string().trim().min(1).max(BANK_PLAN_LIMITS.name),
  /** Keep each folded category's name (lower case) as a tag on the marks that were in it. */
  tags: z.boolean().default(true),
});
export type BankPlan = z.infer<typeof bankPlanSchema>;

/** What the plan would do now, worked out from the user's marks. `problems` empty: it can be carried out. */
export interface BankPlanPreview {
  into: { name: string; created: boolean; color: BankColor; icon: BankIcon; before: { count: number; spent: number }; after: { count: number; spent: number } };
  sources: {
    id: string; name: string; count: number; spent: number; color: BankColor;
    /** The tag the folded category's name leaves on its marks (null: none asked), and whether the user has that tag already. */
    tag: string | null; tagState: 'new' | 'exists' | null;
    /** The tags its marks carry already (most used first, at most 4): they stay. */
    keeps: string[];
  }[];
  /** Marks that change category, the ones that get a new tag, and the ones that cannot (a mark holds only so many). */
  moved: number;
  tagged: number;
  noTag: number;
  problems: string[];
}

/**
 * What the user's answer on the card left behind, kept with the conversation so the card shows it again. `preview` is what
 * the card showed when the user answered: after a merge its categories are gone and it could not be worked out again, and
 * a rejected card should still show what was proposed (older answers have none; a rejected plan is then worked out anew).
 */
export type BankPlanOutcome =
  | { decision: 'applied'; at: number; into: string; created: boolean; moved: number; preview?: BankPlanPreview }
  | { decision: 'rejected'; at: number; preview?: BankPlanPreview };

/** The decision the card sends: only which card and yes or no; the plan is read from the conversation, never from the request. */
export const bankPlanDecisionSchema = z.object({
  toolCallId: z.string().min(1).max(200).regex(/^[A-Za-z0-9._:-]+$/),
  decision: z.enum(['apply', 'reject']),
  /** Only for a bulk-assign card: what the user ticked, unticked and picked (see bank-assign-contract). */
  ...bankAssignChoiceSchema.shape,
}).strict();
