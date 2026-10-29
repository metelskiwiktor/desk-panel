import { z } from 'zod';

/**
 * The user's marks on bank operations. First the move: what the money did, which decides the one sum it counts in. A spend
 * (what it went on: a category, a slice of the bar; money back from a shop is a spend with a plus), an income (where it came
 * from: a source), a settlement with someone (lent, borrowed or given back: it counts only in the balance with that side) or a
 * move between the user's own accounts (counts nowhere). Each move has exactly one axis, so every chart reads one field; a new
 * question becomes a tag, never another axis. Then who the other side is (a name recognised by what the bank shows), tags the
 * details to find it by, whether it repeats, and a description. How it was paid comes from the bank and is not marked. The
 * panel's own data, kept by the server and changed by small actions; nothing here goes to the bank. Suggestions are computed
 * by the server from earlier marks and only shown: nothing is marked without a gesture of the user.
 */
export const BANK_LABEL_LIMITS = {
  categories: 60, parties: 700, tags: 200, tagsPerMark: 10, tag: 30, name: 40, partyName: 60, comment: 300, identifiers: 30,
} as const;

/** The colours and icons a category can take; the screen maps them to its palette and to Lucide icons. */
export const BANK_COLORS = ['green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'brown', 'slate'] as const;
export const BANK_ICONS = [
  'tag', 'cart', 'utensils', 'coffee', 'fuel', 'car', 'bus', 'home', 'zap', 'heart', 'brain', 'dumbbell', 'repeat', 'handCoins', 'piggyBank',
  'gift', 'shirt', 'plane', 'book', 'graduation', 'gamepad', 'film', 'music', 'paw', 'baby', 'wrench', 'receipt', 'smartphone', 'banknote', 'user',
] as const;
export type BankColor = (typeof BANK_COLORS)[number];
export type BankIcon = (typeof BANK_ICONS)[number];
/**
 * What the money did: `spend` (Wydatek, on a category), `income` (Przychód, from a source), `settle` (Rozliczenie: lent, borrowed
 * or given back, with the other side as its axis) and `move` (Przełożenie, between the user's own accounts).
 */
export const BANK_MOVES = ['spend', 'income', 'settle', 'move'] as const;
export type BankMove = (typeof BANK_MOVES)[number];
/**
 * The moves with a list of their own: spending categories, income sources and pockets (the user's own places money is moved
 * to or from: Oszczędności, Revolut) are one collection, told apart by this. A pocket is optional; a category and a source are not.
 */
export const BANK_CATEGORY_MOVES = ['spend', 'income', 'move'] as const;
export type BankCategoryMove = (typeof BANK_CATEGORY_MOVES)[number];

export const bankCategoryId = z.string().regex(/^c-[0-9a-f]{8}$/);
/** `p-` and `m-` are people and merchants of earlier versions, kept so their marks still point at them; new ones are `k-`. */
export const bankPartyId = z.string().regex(/^[pmk]-[0-9a-f]{8}$/);
/** The operation's id as the bank contract has it (`<account>:<entry_reference>`). */
export const bankTxId = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Not a day');
const categoryName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.name);
const partyName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.partyName);
const comment = z.string().max(BANK_LABEL_LIMITS.comment);
/** A tag as the user writes it ("zakupy-spozywcze"), without a leading # and with single spaces. */
export const cleanTag = (value: string) => value.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
export const bankTag = z.string().transform(cleanTag).pipe(z.string().min(1).max(BANK_LABEL_LIMITS.tag));
const tags = z.array(bankTag).max(BANK_LABEL_LIMITS.tagsPerMark)
  .transform(list => list.filter((t, i) => list.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i));

/** A spending category or, with `move` 'income' or 'move', a source of income or a pocket. */
export const bankCategorySchema = z.object({ id: bankCategoryId, name: categoryName, move: z.enum(BANK_CATEGORY_MOVES), color: z.enum(BANK_COLORS), icon: z.enum(BANK_ICONS) });
/**
 * What the bank showed for the other side, cut the way the bank cuts it ("··4245" for an account, "··938" for a phone number,
 * the name as the bank writes it, the merchant's text from a card payment). The whole numbers never leave the server.
 */
export const bankIdentifierSchema = z.object({ id: z.string().min(1).max(40), kind: z.enum(['account', 'phone', 'phoneTail', 'name', 'merchant']), hint: z.string().max(80) });
/**
 * The other side: a name and what the bank showed for it. Whether it is a person or a shop does not matter, the move says what
 * the money did. Two sides may share a name ("Daniel" twice): they are told apart by their identifiers.
 */
export const bankPartySchema = z.object({ id: bankPartyId, name: partyName, identifiers: z.array(bankIdentifierSchema).max(BANK_LABEL_LIMITS.identifiers) });
export const bankLabelSchema = z.object({
  /** Null while the user has only said who, or added a tag or a description. */
  move: z.enum(BANK_MOVES).nullable(),
  /** The spending category, the income source or the pocket, of the same move; none for a settlement. */
  category: bankCategoryId.nullable(),
  tags: z.array(z.string().min(1).max(BANK_LABEL_LIMITS.tag)).max(BANK_LABEL_LIMITS.tagsPerMark),
  party: bankPartyId.nullable(),
  /** Repeats (a subscription, rent, a standing transfer); later a view of what repeats reads it. */
  recurring: z.boolean(),
  comment,
});
/** One mark the panel proposes (only the fields it has a reason for), with the sentences that say why. */
export const bankOptionSchema = z.object({
  move: z.enum(BANK_MOVES).optional(),
  category: bankCategoryId.optional(),
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tagsPerMark).optional(),
  party: bankPartyId.optional(),
  recurring: z.literal(true).optional(),
  reasons: z.array(z.string().max(160)).min(1).max(4),
});
/**
 * What the panel proposes for an operation not yet marked. `sure` when a reliable link (the merchant's text, an account, a
 * whole phone number, the bank's name) leads to earlier marks that all agree; otherwise the options are a choice, never a guess.
 */
export const bankSuggestionSchema = z.object({ sure: z.boolean(), options: z.array(bankOptionSchema).min(1).max(3) });
export const bankLabelsDataSchema = z.object({
  /** Operations booked on this day or later and not done (`isDone`) are "to be marked"; older ones are simply unmarked. */
  since: day,
  /** Spending categories and income sources (`move`), in the order the user made them. */
  categories: z.array(bankCategorySchema).max(BANK_LABEL_LIMITS.categories),
  /** Every tag in use or kept, most used first. */
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tags),
  parties: z.array(bankPartySchema).max(BANK_LABEL_LIMITS.parties),
  /** Marks of the operations in the bank's last reading, by operation id. */
  labels: z.record(bankTxId, bankLabelSchema),
  suggestions: z.record(bankTxId, bankSuggestionSchema),
  /** Who an operation of the reading is from or to when its identifiers say so, before any mark (so the dialog shows it). */
  known: z.record(bankTxId, bankPartyId),
  /** Operations of the last reading still to be marked, newest first. */
  pending: z.array(bankTxId),
  /**
   * What is open with each side over every kept settlement, not only the reading's: positive when the side owes the user,
   * negative when the user owes it; sides that are even are left out. Largest first.
   */
  balances: z.array(z.object({ party: bankPartyId, currency: z.string().length(3), amount: z.number().finite() })),
  /**
   * The habit of an operation's other side, for one not done: how many earlier marks with it (money going the same way) were
   * each move. Shown beside the move buttons; only operations whose side is known.
   */
  habits: z.record(bankTxId, z.object({ spend: z.number().int().optional(), income: z.number().int().optional(), settle: z.number().int().optional(), move: z.number().int().optional() })),
});
export const bankLabelsSourceSchema = z.object({
  live: z.literal(true), name: z.literal('Oznaczenia'),
  status: z.enum(['connected', 'offline', 'unavailable', 'loading']),
  observedAt: z.number().finite().nullable(), message: z.string().optional(),
  data: bankLabelsDataSchema.nullable(),
});
export type BankCategory = z.infer<typeof bankCategorySchema>;
export type BankParty = z.infer<typeof bankPartySchema>;
export type BankLabel = z.infer<typeof bankLabelSchema>;
export type BankOption = z.infer<typeof bankOptionSchema>;
export type BankSuggestion = z.infer<typeof bankSuggestionSchema>;
export type BankLabelsData = z.infer<typeof bankLabelsDataSchema>;
export type BankBalance = BankLabelsData['balances'][number];
export type BankLabelsSource = z.infer<typeof bankLabelsSourceSchema>;

/**
 * An operation is done (no longer "to be marked") when its move is said: a spend or an income with its category or source, a
 * settlement, or a move between own accounts, which need none.
 */
export const isDone = (label: Pick<BankLabel, 'move' | 'category'> | null | undefined) =>
  !!label?.move && (label.move === 'settle' || label.move === 'move' || !!label.category);

/**
 * Every change is one small action. `label` writes the whole mark of one operation (what the dialog shows); `accept` takes one
 * of the options the server shows for it now, `reject` remembers that none of them fits. Categories and sources, tags and the
 * other sides are made on the fly.
 */
export const bankLabelActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('label'), tx: bankTxId, move: z.enum(BANK_MOVES).nullable().default(null), category: bankCategoryId.nullable(), tags: tags.default([]),
    party: bankPartyId.nullable().default(null), recurring: z.boolean(), comment: comment.optional(),
  }).strict(),
  z.object({ action: z.literal('clear'), tx: bankTxId }).strict(),
  z.object({ action: z.literal('accept'), tx: bankTxId, option: z.number().int().min(0).max(2).default(0) }).strict(),
  z.object({ action: z.literal('reject'), tx: bankTxId }).strict(),
  /** Many operations marked in one write (the bulk card): each with its whole mark, as the panel worked it out for the user's choice. An operation already done refuses the lot. */
  z.object({
    action: z.literal('markMany'),
    items: z.array(z.object({
      tx: bankTxId, move: z.enum(BANK_MOVES), category: bankCategoryId.nullable(), tags: tags.default([]), party: bankPartyId.nullable(), recurring: z.boolean(),
    }).strict()).min(1).max(300),
  }).strict(),
  z.object({ action: z.literal('createCategory'), name: categoryName, move: z.enum(BANK_CATEGORY_MOVES).default('spend'), color: z.enum(BANK_COLORS).optional(), icon: z.enum(BANK_ICONS).optional() }).strict(),
  z.object({ action: z.literal('updateCategory'), category: bankCategoryId, name: categoryName.optional(), color: z.enum(BANK_COLORS).optional(), icon: z.enum(BANK_ICONS).optional() }).strict()
    .refine(a => a.name !== undefined || a.color !== undefined || a.icon !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('deleteCategory'), category: bankCategoryId }).strict(),
  /** Every mark of `category` goes to `into` (of the same move) and `category` is gone; `tag` is added to those marks to keep what it said. */
  z.object({ action: z.literal('mergeCategory'), category: bankCategoryId, into: bankCategoryId, tag: bankTag.optional() }).strict()
    .refine(a => a.category !== a.into, { message: 'Cannot merge a category into itself' }),
  /** A whole merge in one write (the consent card): these spending categories go to the one of this name, made when missing. */
  z.object({ action: z.literal('mergeInto'), from: z.array(bankCategoryId).min(1).max(6), into: categoryName, tags: z.boolean() }).strict(),
  z.object({ action: z.literal('renameTag'), tag: bankTag, name: bankTag }).strict(),
  z.object({ action: z.literal('deleteTag'), tag: bankTag }).strict(),
  z.object({ action: z.literal('createParty'), name: partyName }).strict(),
  z.object({ action: z.literal('updateParty'), party: bankPartyId, name: partyName }).strict(),
  z.object({ action: z.literal('deleteParty'), party: bankPartyId }).strict(),
  z.object({ action: z.literal('forgetIdentifier'), party: bankPartyId, identifier: z.string().min(1).max(40) }).strict(),
  z.object({ action: z.literal('setSince'), since: day }).strict(),
]);
export type BankLabelAction = z.input<typeof bankLabelActionSchema>;
export type BankLabelActionParsed = z.infer<typeof bankLabelActionSchema>;

/** What an action answers: the id it made, so the screen can go on (create a category or a side, then mark with it). */
export interface BankLabelResult { ok: true; category?: { id: string; created: boolean }; party?: { id: string; created: boolean }; removed?: number; assigned?: number }
