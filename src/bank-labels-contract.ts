import { z } from 'zod';

/**
 * The user's own marks on bank operations. Each field answers one question: the category what the money went on (one, a slice
 * of the bar), tags the details to find it by (any number), the merchant where (recognised from the bank's text or account),
 * the person to or from whom (transfers), whether it repeats, and a comment. How it was paid comes from the bank and is not
 * marked. The panel's own data, kept by the server and changed by small actions; nothing here goes to the bank. Suggestions are
 * computed by the server from earlier marks and only shown: nothing is marked without a gesture of the user.
 */
export const BANK_LABEL_LIMITS = {
  categories: 60, people: 200, merchants: 500, tags: 200, tagsPerMark: 10, tag: 30, name: 40, personName: 60, comment: 300, identifiers: 30,
} as const;

/** The colours and icons a category can take; the screen maps them to its palette and to Lucide icons. */
export const BANK_COLORS = ['green', 'teal', 'blue', 'indigo', 'violet', 'pink', 'red', 'orange', 'amber', 'brown', 'slate'] as const;
export const BANK_ICONS = [
  'tag', 'cart', 'utensils', 'coffee', 'fuel', 'car', 'bus', 'home', 'zap', 'heart', 'brain', 'dumbbell', 'repeat', 'handCoins', 'piggyBank',
  'gift', 'shirt', 'plane', 'book', 'graduation', 'gamepad', 'film', 'music', 'paw', 'baby', 'wrench', 'receipt', 'smartphone', 'banknote', 'user',
] as const;
export type BankColor = (typeof BANK_COLORS)[number];
export type BankIcon = (typeof BANK_ICONS)[number];

export const bankCategoryId = z.string().regex(/^c-[0-9a-f]{8}$/);
export const bankPersonId = z.string().regex(/^p-[0-9a-f]{8}$/);
export const bankMerchantId = z.string().regex(/^m-[0-9a-f]{8}$/);
/** The operation's id as the bank contract has it (`<account>:<entry_reference>`). */
export const bankTxId = z.string().min(1).max(200);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'Not a day');
const categoryName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.name);
const personName = z.string().trim().min(1).max(BANK_LABEL_LIMITS.personName);
const comment = z.string().max(BANK_LABEL_LIMITS.comment);
/** A tag as the user writes it ("zakupy-spozywcze"), without a leading # and with single spaces. */
export const cleanTag = (value: string) => value.replace(/^#+/, '').replace(/\s+/g, ' ').trim();
export const bankTag = z.string().transform(cleanTag).pipe(z.string().min(1).max(BANK_LABEL_LIMITS.tag));
const tags = z.array(bankTag).max(BANK_LABEL_LIMITS.tagsPerMark)
  .transform(list => list.filter((t, i) => list.findIndex(o => o.toLowerCase() === t.toLowerCase()) === i));

export const bankCategorySchema = z.object({ id: bankCategoryId, name: categoryName, color: z.enum(BANK_COLORS), icon: z.enum(BANK_ICONS) });
/**
 * What the bank showed for a person or merchant, cut the way the bank cuts it ("··4245" for an account, "··938" for a phone
 * number, the name as the bank writes it, the merchant's text from a card payment). The whole numbers never leave the server.
 */
export const bankIdentifierSchema = z.object({ id: z.string().min(1).max(40), kind: z.enum(['account', 'phone', 'phoneTail', 'name', 'merchant']), hint: z.string().max(80) });
/** People may share a name ("Daniel" twice): they are told apart by their identifiers. */
export const bankPersonSchema = z.object({ id: bankPersonId, name: personName, identifiers: z.array(bankIdentifierSchema).max(BANK_LABEL_LIMITS.identifiers) });
export const bankMerchantSchema = z.object({ id: bankMerchantId, name: categoryName, identifiers: z.array(bankIdentifierSchema).max(BANK_LABEL_LIMITS.identifiers) });
export const bankLabelSchema = z.object({
  category: bankCategoryId.nullable(),
  tags: z.array(z.string().min(1).max(BANK_LABEL_LIMITS.tag)).max(BANK_LABEL_LIMITS.tagsPerMark),
  merchant: bankMerchantId.nullable(),
  person: bankPersonId.nullable(),
  /** Repeats (a subscription, rent, a standing transfer); later a view of what repeats reads it. */
  recurring: z.boolean(),
  comment,
});
/** One mark the panel proposes (only the fields it has a reason for), with the sentences that say why. */
export const bankOptionSchema = z.object({
  category: bankCategoryId.optional(),
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tagsPerMark).optional(),
  merchant: bankMerchantId.optional(),
  person: bankPersonId.optional(),
  recurring: z.literal(true).optional(),
  reasons: z.array(z.string().max(160)).min(1).max(4),
});
/**
 * What the panel proposes for an operation not yet marked. `sure` when a reliable link (the merchant's text, an account, a
 * whole phone number, the bank's name) leads to earlier marks that all agree; otherwise the options are a choice, never a guess.
 */
export const bankSuggestionSchema = z.object({ sure: z.boolean(), options: z.array(bankOptionSchema).min(1).max(3) });
export const bankLabelsDataSchema = z.object({
  /** Operations booked on this day or later and without a category are "to be marked"; older ones are simply uncategorised. */
  since: day,
  categories: z.array(bankCategorySchema).max(BANK_LABEL_LIMITS.categories),
  /** Every tag in use or kept, most used first. */
  tags: z.array(z.string()).max(BANK_LABEL_LIMITS.tags),
  merchants: z.array(bankMerchantSchema).max(BANK_LABEL_LIMITS.merchants),
  people: z.array(bankPersonSchema).max(BANK_LABEL_LIMITS.people),
  /** Marks of the operations in the bank's last reading, by operation id. */
  labels: z.record(bankTxId, bankLabelSchema),
  suggestions: z.record(bankTxId, bankSuggestionSchema),
  /** Who an operation of the reading is from or to when its identifiers say so, before any mark (so the dialog shows it). */
  known: z.record(bankTxId, z.object({ merchant: bankMerchantId.optional(), person: bankPersonId.optional() })),
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
export type BankPerson = z.infer<typeof bankPersonSchema>;
export type BankMerchant = z.infer<typeof bankMerchantSchema>;
export type BankLabel = z.infer<typeof bankLabelSchema>;
export type BankOption = z.infer<typeof bankOptionSchema>;
export type BankSuggestion = z.infer<typeof bankSuggestionSchema>;
export type BankLabelsData = z.infer<typeof bankLabelsDataSchema>;
export type BankLabelsSource = z.infer<typeof bankLabelsSourceSchema>;

const owner = z.union([bankPersonId, bankMerchantId]);
/**
 * Every change is one small action. `label` writes the whole mark of one operation (what the dialog shows); `accept` takes one
 * of the options the server shows for it now, `reject` remembers that none of them fits. Categories, tags, merchants and
 * people are made on the fly.
 */
export const bankLabelActionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('label'), tx: bankTxId, category: bankCategoryId.nullable(), tags: tags.default([]), merchant: bankMerchantId.nullable().default(null),
    person: bankPersonId.nullable(), recurring: z.boolean(), comment: comment.optional(),
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
  z.object({ action: z.literal('createMerchant'), name: categoryName }).strict(),
  z.object({ action: z.literal('renameMerchant'), merchant: bankMerchantId, name: categoryName }).strict(),
  z.object({ action: z.literal('deleteMerchant'), merchant: bankMerchantId }).strict(),
  z.object({ action: z.literal('createPerson'), name: personName }).strict(),
  z.object({ action: z.literal('renamePerson'), person: bankPersonId, name: personName }).strict(),
  z.object({ action: z.literal('deletePerson'), person: bankPersonId }).strict(),
  z.object({ action: z.literal('forgetIdentifier'), owner, identifier: z.string().min(1).max(40) }).strict(),
  z.object({ action: z.literal('setSince'), since: day }).strict(),
]);
export type BankLabelAction = z.input<typeof bankLabelActionSchema>;
export type BankLabelActionParsed = z.infer<typeof bankLabelActionSchema>;

/** What an action answers: the id it made, so the screen can go on (create a category or merchant, then mark with it). */
export interface BankLabelResult { ok: true; category?: { id: string; created: boolean }; person?: { id: string; created: boolean }; merchant?: { id: string; created: boolean }; removed?: number }
