import { z } from 'zod';

/**
 * Smart Actions rules as data (`~/.desk-panel/smart-rules.json`, outside Git): what a rule catches and what its button
 * does. The panel works the alerts out on the server (`GET /api/smart-actions`), the same for the tile and for Wektor.
 * Wektor reads and tests rules, and proposes a change with a card (`panel_smart_rule_propose`); only the user's click on
 * the card writes it (`POST /api/chats/:id/smart-rule`). The tile's own switch turns a rule on and off.
 *
 * A mail rule looks at unread inbox conversations: every list it has must match (any of its words, case-insensitive
 * substrings), and no word of a `…Not` list may. A button opens a link from the mail itself, only one whose host is the
 * rule's `domain` (or its subdomain): a mail cannot send the user anywhere else. A bank rule shows operations the panel
 * has a suggestion for, with the suggestions as buttons.
 *
 * Smart Actions are only what can be done: a mail rule always has a button, and a mail it matches without a link for that
 * button gives no alert (the test shows it as skipped, with the reason).
 */

export const SMART_CATEGORIES = ['appointment', 'payment', 'task_alert', 'pr_review', 'other'] as const;
export const SMART_PRIORITIES = ['high', 'medium', 'low'] as const;
export type SmartCategory = typeof SMART_CATEGORIES[number];
export type SmartPriority = typeof SMART_PRIORITIES[number];
export const SMART_LIMITS = { rules: 40, words: 12, word: 80 } as const;

const words = z.array(z.string().trim().min(1).max(SMART_LIMITS.word)).max(SMART_LIMITS.words);
const domain = z.string().trim().toLowerCase().regex(/^(?=.{3,100}$)([a-z0-9-]+\.)+[a-z]{2,}$/, 'domena, np. inea.com.pl');

export const smartMailMatchSchema = z.object({
  /** Sender's address or name contains one of these (e.g. `e-rachunek@inea.com.pl`, `znanylekarz.pl`). */
  from: words.optional(),
  subject: words.optional(),
  subjectNot: words.optional(),
  body: words.optional(),
  bodyNot: words.optional(),
}).strict().refine(m => !!(m.from?.length || m.subject?.length || m.body?.length), { message: 'reguła poczty potrzebuje from, subject albo body' });
export type SmartMailMatch = z.infer<typeof smartMailMatchSchema>;

export const smartButtonSchema = z.object({
  label: z.string().trim().min(1).max(30),
  /** The link's host must be this domain or its subdomain. */
  domain,
  /** Of the mail's links on that domain, prefer the one whose text or address contains this (e.g. „zapłać”, „potwierdz”). */
  contains: z.string().trim().min(1).max(80).optional(),
}).strict();
export type SmartButton = z.infer<typeof smartButtonSchema>;

export const SMART_SUGGESTION = ['dowolna', 'pewna'] as const;
const base = {
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'id: małe litery, cyfry i myślniki'),
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(200).optional(),
  enabled: z.boolean().default(true),
  category: z.enum(SMART_CATEGORIES).default('other'),
  priority: z.enum(SMART_PRIORITIES).default('medium'),
  /** The short label on the alert, e.g. „Inea”. */
  badge: z.string().trim().min(1).max(24),
};
export const smartRuleSchema = z.discriminatedUnion('source', [
  z.object({ ...base, source: z.literal('mail'), match: smartMailMatchSchema, button: smartButtonSchema }).strict(),
  /** Operations of the account with a suggestion: any (`dowolna`) or only a sure one (`pewna`). */
  z.object({ ...base, source: z.literal('bank'), suggestion: z.enum(SMART_SUGGESTION).default('dowolna') }).strict(),
]);
export type SmartRule = z.infer<typeof smartRuleSchema>;

/** A change Wektor proposes: a rule to save (new, or the same id changed), or one to remove. */
export const smartRulePlanSchema = z.union([
  z.object({ rule: smartRuleSchema, q: z.string().trim().min(1).max(300).optional() }).strict(),
  z.object({ remove: base.id }).strict(),
]);
export type SmartRulePlan = z.infer<typeof smartRulePlanSchema>;
/** The plan of a `panel_smart_rule_propose` call as the model wrote it (the card's title left out), or null. */
export function smartRulePlanOf(input: string): SmartRulePlan | null {
  try {
    const { tytul: _title, ...args } = JSON.parse(input) as Record<string, unknown>;
    const parsed = smartRulePlanSchema.safeParse(args);
    return parsed.success ? parsed.data : null;
  } catch { return null; }
}

/** The tile's own switch: the only change of a rule without a card. */
export const smartRuleToggleSchema = z.object({ id: base.id, enabled: z.boolean() }).strict();

export interface SmartBankOption { index: number; label: string; sure: boolean; reason?: string }
export interface SmartAlert {
  /** `mail:<thread id>` or `bank:<operation id>`: what the tile hides when dismissed. */
  id: string;
  ruleId: string;
  source: 'mail' | 'bank' | 'automation';
  badge: string;
  title: string;
  snippet: string;
  category: SmartCategory;
  priority: SmartPriority;
  at: number;
  /** The button: a checked link from the mail. */
  url?: string;
  label?: string;
  mail?: { account: string; threadId: string; sourceUrl: string };
  bank?: { tx: string; amount: number; currency: string; options: SmartBankOption[] };
}
export interface SmartActionsView {
  rules: SmartRule[];
  alerts: SmartAlert[];
  /** Sources that could not be read now, in Polish: their alerts are missing, not settled. */
  problems: string[];
}

/** A mail as a test or a search shows it. */
export interface SmartMailRow {
  id: string;
  account: string;
  threadId: string;
  from: string;
  address: string;
  subject: string;
  at: number;
  unread: boolean;
  sourceUrl: string;
}
export interface SmartTestRow extends SmartMailRow {
  /** Whether the proposed rule gives an alert for it, and whether the rule saved now does. */
  caught: boolean;
  caughtNow?: boolean;
  url?: string;
  /** The conditions hold but the mail has no link for the button: no alert, and this says why. */
  noLink?: string;
}
export interface SmartRulePreview {
  kind: 'new' | 'change' | 'remove';
  before: SmartRule | null;
  after: SmartRule | null;
  /** The Gmail query the test ran on, and the mails it found. */
  query: string | null;
  rows: SmartTestRow[];
  /** Operations a bank rule would show now. */
  bankCount?: number;
  problems: string[];
}
export type SmartRuleOutcome =
  | { decision: 'applied'; at: number; preview?: SmartRulePreview }
  | { decision: 'rejected'; at: number; preview?: SmartRulePreview };
