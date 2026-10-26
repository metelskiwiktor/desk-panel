import { z } from 'zod';

/**
 * The user's own marks on bank operations. Each field answers one question: who the other side is (a person, a company or
 * the user themself, recognised by what the bank shows), the category what the money went on (one, a slice of the bar), tags
 * the details to find it by, the purpose why money went to or came from a person (a loan, its return, a contribution; the
 * user's own list), whether it repeats, and a description. How it was paid comes from the bank and is not marked. The panel's
 * own data, kept by the server and changed by small actions; nothing here goes to the bank. Suggestions are computed by the
 * server from earlier marks and only shown: nothing is marked without a gesture of the user.
 */
export const BANK_LABEL_LIMITS = {
  categories: 60, parties: 700, tags: 200, purposes: 40, tagsPerMark: 10, tag: 30, name: 40, partyName: 60, comment: 300, identifiers: 30,
} as const;

/** The colours and icons a category can take; the screen maps them to its palette and to Lucide icons. */
export const BANK_COLORS = ['green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'brown', 'slate'] as const;
export const BANK_ICONS = [
  'tag', 'cart', 'utensils', 'coffee', 'fuel', 'car', 'bus', 'home', 'zap', 'heart', 'brain', 'dumbbell', 'repeat', 'handCoins', 'piggyBank',
  'gift', 'shirt', 'plane', 'book', 'graduation', 'gamepad', 'film', 'music', 'paw', 'baby', 'wrench', 'receipt', 'smartphone', 'banknote', 'user',
] as const;
export type BankColor = (typeof BANK_COLORS)[number];
export type BankIcon = (typeof BANK_ICONS)[number];
/** Who the other side is: a person (loans, returns, contributions), a company or shop, or the user themself (own company, own accounts). */
export const BANK_PARTY_KINDS = ['person', 'company', 'self'] as const;
export type BankPartyKind = (typeof BANK_PARTY_KINDS)[number];

export const bankCategoryId = z.string().regex(/^c-[0-9a-f]{8}$/);
/** `p-` and `m-` are people and merchants of earlier versions, kept so their marks still point at them; new ones are `k-`. */
export const bankPartyId = z.string().regex(/^[pmk]-[0-9a-f]{8}$/);
/** The operation's id as the bank contract has it (`<account>:<entry_reference>`). */
export const bankTxId = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Not a day');
const categoryName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.name);
const partyName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.partyName);
const comment = z.string().max(BANK_LABEL_LIMITS.comment);
/** A tag or a purpose as the user writes it ("zakupy-spozywcze"), without a leading # and with single spaces. */
export const cleanTag = (value: string) => value.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
export const bankTag = z.string().transform(cleanTag).pipe(z.string().min(1).max(BANK_LABEL_LIMITS.tag));
const tags = z.array(bankTag).max(BANK_LABEL_LIMITS.tagsPerMark)
  .transform(list => list.filter((t, i) => list.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i));

export const bankCategorySchema = z.object({ id: bankCategoryId, name: categoryName, color: z.enum(BANK_COLORS), icon: z.enum(BANK_ICONS) });
/**
 * What the bank showed for the other side, cut the way the bank cuts it ("··4245" for an account, "··938" for a phone number,
 * the name as the bank writes it, the merchant's text from a card payment). The whole numbers never leave the server.
 */
export const bankIdentifierSchema = z.object({ id: z.string().min(1).max(40), kind: z.enum(['account', 'phone', 'phoneTail', 'name', 'merchant']), hint: z.string().max(80) });
/** Two sides may share a name ("Daniel" twice): they are told apart by their identifiers. */
export const bankPartySchema = z.object({ id: bankPartyId, name: partyName, kind: z.enum(BANK_PARTY_KINDS), identifiers: z.array(bankIdentifierSchema).max(BANK_LABEL_LIMITS.identifiers) });
export const bankLabelSchema = z.object({
  category: bankCategoryId.nullable(),
  tags: z.array(z.string().min(1).max(BANK_LABEL_LIMITS.tag)).max(BANK_LABEL_LIMITS.tagsPerMark),
  party: bankPartyId.nullable(),
  /** Why money went to or came from the other side ("pożyczka", "zwrot", "dokładka"): the settlement with a person sums by it. */
  purpose: z.string().min(1).max(BANK_LABEL_LIMITS.tag).nullable(),
  /** Repeats (a subscription, rent, a standing transfer); later a view of what repeats reads it. */
  recurring: z.boolean(),
  comment,
});
/** One mark the panel proposes (only the fields it has a reason for), with the sentences that say why. */
export const bankOptionSchema = z.object({
  category: bankCategoryId.optional(),
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tagsPerMark).optional(),
  party: bankPartyId.optional(),
  purpose: z.string().optional(),
  recurring: z.literal(true).optional(),
  reasons: z.array(z.string().max(160)).min(1).max(4),
});
/**
 * What the panel proposes for an operation not yet marked. `sure` when a reliable link (the merchant's text, an account, a
 * whole phone number, the bank's name) leads to earlier marks that all agree; otherwise the options are a choice, never a guess.
 */
export const bankSuggestionSchema = z.object({ sure: z.boolean(), options: z.array(bankOptionSchema).min(1).max(3) });
export const bankLabelsDataSchema = z.object({
  /** Operations booked on this day or later, without a category and not the user's own, are "to be marked"; older ones are simply uncategorised. */
  since: day,
  categories: z.array(bankCategorySchema).max(BANK_LABEL_LIMITS.categories),
  /** Every tag in use or kept, most used first. */
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tags),
  /** Every purpose in use or kept, most used first. */
  purposes: z.array(z.string()).max(BANK_LABEL_LIMITS.purposes),
  parties: z.array(bankPartySchema).max(BANK_LABEL_LIMITS.parties),
  /** Marks of the operations in the bank's last reading, by operation id. */
  labels: z.record(bankTxId, bankLabelSchema),
  suggestions: z.record(bankTxId, bankSuggestionSchema),
  /** Who an operation of the reading is from or to when its identifiers say so, before any mark (so the dialog shows it). */
  known: z.record(bankTxId, bankPartyId),
  /** Operations of the last reading still to be marked, newest first. */
  pending: z.array(bankTxId),
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
export type BankLabelsSource = z.infer<typeof bankLabelsSourceSchema>;

/**
 * Every change is one small action. `label` writes the whole mark of one operation (what the dialog shows); `accept` takes one
 * of the options the server shows for it now, `reject` remembers that none of them fits. Categories, tags, purposes and the
 * other sides are made on the fly.
 */
export const bankLabelActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('label'), tx: bankTxId, category: bankCategoryId.nullable(), tags: tags.default([]), party: bankPartyId.nullable().default(null),
    purpose: bankTag.nullable().default(null), recurring: z.boolean(), comment: comment.optional(),
  }).strict(),
  z.object({ action: z.literal('clear'), tx: bankTxId }).strict(),
  z.object({ action: z.literal('accept'), tx: bankTxId, option: z.number().int().min(0).max(2).default(0) }).strict(),
  z.object({ action: z.literal('reject'), tx: bankTxId }).strict(),
  z.object({ action: z.literal('createCategory'), name: categoryName, color: z.enum(BANK_COLORS).optional(), icon: z.enum(BANK_ICONS).optional() }).strict(),
  z.object({ action: z.literal('updateCategory'), category: bankCategoryId, name: categoryName.optional(), color: z.enum(BANK_COLORS).optional(), icon: z.enum(BANK_ICONS).optional() }).strict()
    .refine(a => a.name !== undefined || a.color !== undefined || a.icon !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('deleteCategory'), category: bankCategoryId }).strict(),
  z.object({ action: z.literal('renameTag'), tag: bankTag, name: bankTag }).strict(),
  z.object({ action: z.literal('deleteTag'), tag: bankTag }).strict(),
  z.object({ action: z.literal('renamePurpose'), purpose: bankTag, name: bankTag }).strict(),
  z.object({ action: z.literal('deletePurpose'), purpose: bankTag }).strict(),
  z.object({ action: z.literal('createParty'), name: partyName, kind: z.enum(BANK_PARTY_KINDS) }).strict(),
  z.object({ action: z.literal('updateParty'), party: bankPartyId, name: partyName.optional(), kind: z.enum(BANK_PARTY_KINDS).optional() }).strict()
    .refine(a => a.name !== undefined || a.kind !== undefined, { message: 'Nothing to change' }),
  z.object({ action: z.literal('deleteParty'), party: bankPartyId }).strict(),
  z.object({ action: z.literal('forgetIdentifier'), party: bankPartyId, identifier: z.string().min(1).max(40) }).strict(),
  z.object({ action: z.literal('setSince'), since: day }).strict(),
]);
export type BankLabelAction = z.input<typeof bankLabelActionSchema>;
export type BankLabelActionParsed = z.infer<typeof bankLabelActionSchema>;

/** What an action answers: the id it made, so the screen can go on (create a category or a side, then mark with it). */
export interface BankLabelResult { ok: true; category?: { id: string; created: boolean }; party?: { id: string; created: boolean }; removed?: number }
