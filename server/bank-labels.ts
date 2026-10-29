import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { rename } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import type { BankAccount, BankTransaction } from '../src/bank-contract';
import {
  BANK_COLORS, BANK_ICONS, BANK_LABEL_LIMITS, BANK_MOVES, bankCategorySchema, bankCategoryId, bankLabelActionSchema, bankPartyId, isDone,
  type BankBalance, type BankCategory, type BankMove, type BankLabel, type BankOption, type BankLabelAction, type BankLabelActionParsed, type BankLabelResult, type BankLabelsSource, type BankSuggestion,
} from '../src/bank-labels-contract';
import { partiesOf, type Party } from './bank-parties';
import { featuresOf, suggest, type Marked, type OpFeatures, type Proposal, type Rejection } from './bank-suggest';
import { SourceError } from './sources';

/** A refused action, with a sentence the screen can show. */
export class BankLabelError extends SourceError {
  constructor(status: number, message: string) { super(status); this.message = message; }
}

/**
 * Where the marks are kept. In the service it is one file encrypted with DPAPI for the Windows user (`bank-labels.dpapi`), like
 * the bank's reading: a mark keeps a copy of its operation (day, amount, name), so together with the descriptions and the other
 * sides it is bank data, readable only by this user. `read` resolves to null when there is no file yet and throws when the file
 * cannot be read now (it is then left alone and nothing is written); `aside` moves an unreadable file out of the way.
 */
export interface BankLabelPersistence { read(): Promise<unknown | null>; write(value: unknown): Promise<void>; aside?(): Promise<string | null> }

/** What the reading of the bank gives, numbers whole; never a call to the bank (`Bank.cached`). */
export type BankOperations = () => Promise<{ observedAt: number; accounts: BankAccount[]; transactions: BankTransaction[] } | null>;

const opSchema = z.object({
  at: z.number().finite(), amount: z.number().finite(), currency: z.string().length(3), name: z.string().max(200), detail: z.string().max(200).optional(),
  method: z.enum(['card', 'phone', 'blik', 'cardTransfer', 'atm', 'transfer', 'other']), merchant: z.string().max(200).nullable(), keys: z.array(z.string().max(250)).max(12),
});
const tagText = z.string().min(1).max(BANK_LABEL_LIMITS.tag);
const storedLabelSchema = z.object({
  move: z.enum(BANK_MOVES).nullable(), category: bankCategoryId.nullable(), tags: z.array(tagText).max(BANK_LABEL_LIMITS.tagsPerMark), party: bankPartyId.nullable(),
  recurring: z.boolean(), comment: z.string().max(BANK_LABEL_LIMITS.comment), labeledAt: z.number().finite(), op: opSchema,
});
/**
 * An identifier is `kind:hash`: an HMAC (SHA-256) of the whole account or phone number, or of the bank's name for the other side,
 * under a key that exists only in this file. Telling two operations' sides apart needs only equality, so the number itself is
 * never stored, and a phone number (a small space) cannot be guessed back without the key. A merchant's text from a card payment
 * is not secret and is kept as `merchant:<text>`. `hint` is what the bank shows anyway ("··4245", "··938", the name).
 */
const identifierSchema = z.object({ key: z.string().max(250), kind: z.enum(['account', 'phone', 'phoneTail', 'name', 'merchant']), hint: z.string().max(80), addedAt: z.number().finite() });
const storedPartySchema = z.object({
  id: bankPartyId, name: z.string().max(BANK_LABEL_LIMITS.partyName), createdAt: z.number().finite(),
  identifiers: z.array(identifierSchema).max(BANK_LABEL_LIMITS.identifiers),
});
const rejectionSchema = z.object({ tx: z.string().max(200), basis: z.string().max(300), signature: z.string().max(2000), at: z.number().finite() });
export const bankLabelFileSchema = z.object({
  version: z.literal(4),
  secret: z.string().min(32),
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  categories: z.array(bankCategorySchema).max(BANK_LABEL_LIMITS.categories),
  tags: z.array(tagText).max(BANK_LABEL_LIMITS.tags),
  parties: z.array(storedPartySchema).max(BANK_LABEL_LIMITS.parties),
  labels: z.record(z.string().max(200), storedLabelSchema),
  rejections: z.array(rejectionSchema),
});
export type BankLabelFile = z.infer<typeof bankLabelFileSchema>;

/** What a scenario file may start with: no key and no hashes (they are made from the scenario's own numbers). */
export const bankLabelSeedSchema = z.object({
  since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  categories: z.array(bankCategorySchema.extend({ move: bankCategorySchema.shape.move.default('spend') })).max(BANK_LABEL_LIMITS.categories).default([]),
  parties: z.array(z.object({ id: bankPartyId, name: z.string().max(BANK_LABEL_LIMITS.partyName) })).max(BANK_LABEL_LIMITS.parties).default([]),
  /** Marks of operations of the scenario's bank reading; the sides learn their identifiers from them as from a gesture. */
  labels: z.record(z.string(), z.object({
    move: z.enum(BANK_MOVES).nullable().default(null), category: bankCategoryId.nullable().default(null), tags: z.array(tagText).default([]),
    party: bankPartyId.nullable().default(null), recurring: z.boolean().default(false), comment: z.string().max(BANK_LABEL_LIMITS.comment).default(''),
  })).default({}),
});
export type BankLabelSeed = z.infer<typeof bankLabelSeedSchema>;

/** The marks as the agent's view reads them: every kept operation (the reading's and the marked ones), no identifiers. */
export interface BankLedger {
  observedAt: number | null; since: string;
  categories: BankCategory[]; parties: { id: string; name: string }[]; balances: BankBalance[];
  /** The tags the user has (the list a new tag is added to), so a plan can tell a new tag from one that exists. */
  tags: string[];
  entries: { tx: string; op: OpFeatures; label: BankLabel | null; known: string | null; suggestion: BankSuggestion | null; pending: boolean; inReading: boolean }[];
}

export interface BankLabelStore {
  read(): Promise<BankLabelsSource>;
  apply(action: BankLabelAction): Promise<BankLabelResult>;
  ledger(): Promise<BankLedger>;
  drain(): Promise<void>;
}

export interface BankLabelStoreOptions {
  operations: BankOperations;
  /** Without it the marks live in memory only, starting from `seed` (scenario mode). */
  persistence?: BankLabelPersistence;
  seed?: BankLabelSeed;
  now?: () => number;
  /** The local day (`YYYY-MM-DD`) the store is first made on: "to be marked" counts from it unless the user picks another. */
  today?: () => string;
}

type StoredLabel = BankLabelFile['labels'][string];
type StoredParty = BankLabelFile['parties'][number];
type MarkFields = Omit<StoredLabel, 'labeledAt' | 'op'>;
const MAX_LABELS = 20_000;
const MAX_REJECTIONS = 3_000;
const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;
const localDay = (at: number) => { const d = new Date(at); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A booking day is kept as noon UTC of that date. */
const bookedOn = (at: number) => new Date(at).toISOString().slice(0, 10);
const publicId = (key: string) => key.startsWith('merchant:') ? `m${createHmac('sha256', 'id').update(key).digest('hex').slice(0, 11)}` : key.slice(key.indexOf(':') + 1, key.indexOf(':') + 13);
const isEmpty = (l: MarkFields) => !l.move && !l.category && !l.tags.length && !l.party && !l.recurring && !l.comment.trim();
const MOVE_OF_CATEGORY = { spend: 'wydatków', income: 'przychodów', move: 'przełożeń' } as const;

/** What is open with each side over every kept settlement: positive when it owes the user. Even sides are left out. */
function balancesOf(file: BankLabelFile): BankBalance[] {
  const by = new Map<string, BankBalance>();
  for (const l of Object.values(file.labels)) {
    if (l.move !== 'settle' || !l.party || !file.parties.some(p => p.id === l.party)) continue;
    const key = `${l.party} ${l.op.currency}`;
    const balance = by.get(key) ?? { party: l.party, currency: l.op.currency, amount: 0 };
    balance.amount -= l.op.amount;
    by.set(key, balance);
  }
  return [...by.values()].map(b => ({ ...b, amount: Math.round(b.amount * 100) / 100 })).filter(b => b.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
}
/** Who the bank names for sure: a masked phone number only hints, so it never fills the dialog by itself. */
const SURE_KINDS = ['merchant', 'account', 'phone', 'name'];

/**
 * The user's marks on bank operations. Like the to-do lists, changes are small actions applied one after another in memory and
 * written out whole (atomically, see `privateFile`); an action that is refused or cannot be saved changes nothing.
 */
export function createBankLabelStore(options: BankLabelStoreOptions): BankLabelStore {
  const now = options.now ?? Date.now;
  let data: BankLabelFile | undefined;
  let message: string | undefined;
  let loading: Promise<BankLabelFile> | undefined;
  let tail: Promise<unknown> = Promise.resolve();

  const fresh = (): BankLabelFile => ({ version: 4, secret: randomBytes(32).toString('base64url'), since: options.today?.() ?? localDay(now()), categories: [], tags: [], parties: [], labels: {}, rejections: [] });
  const hash = (secret: string, party: Party) => `${party.kind}:${createHmac('sha256', secret).update(`${party.kind}:${party.value}`).digest('base64url').slice(0, 24)}`;

  async function load(): Promise<BankLabelFile> {
    if (data) return data;
    return loading ??= (async () => {
      try {
        if (!options.persistence) { data = await fromSeed(options.seed); return data; }
        let raw: unknown | null;
        try { raw = await options.persistence.read(); }
        catch {
          // Unreadable now (DPAPI busy, file locked): keep it and try again later; writing now would replace it.
          message = 'Nie udało się odczytać zapisanych oznaczeń; spróbuję ponownie.';
          throw new BankLabelError(503, message);
        }
        if (raw === null) { data = fresh(); await options.persistence.write(data); message = undefined; return data; }
        const parsed = bankLabelFileSchema.safeParse(raw);
        if (parsed.success) { data = parsed.data; message = undefined; return data; }
        // Never write over what cannot be read: keep it aside and start again, and say so.
        const aside = await options.persistence.aside?.().catch(() => null);
        message = `Plik z oznaczeniami operacji był uszkodzony${aside ? ` (zachowany jako ${path.basename(aside)})` : ''}; zaczynasz od pustych oznaczeń.`;
        data = fresh();
        await options.persistence.write(data);
        return data;
      } finally { loading = undefined; }
    })();
  }

  /** The keys of the other side: the hashed numbers and name, and a card payment's merchant text as it is. */
  const read = (file: BankLabelFile, t: BankTransaction, accounts: BankAccount[]) => {
    const parties = partiesOf(t, accounts);
    const plain = featuresOf(t, []);
    const keys = [...parties.map(p => hash(file.secret, p)), ...(plain.merchant && plain.method !== 'transfer' ? [`merchant:${plain.merchant}`] : [])];
    return { t, parties, op: { ...plain, keys } };
  };
  type Read = ReturnType<typeof read>;

  /** A scenario's marks are applied as the user would make them, so its sides learn their identifiers the same way. */
  async function fromSeed(seed: BankLabelSeed | undefined): Promise<BankLabelFile> {
    const file = fresh();
    if (!seed) return file;
    file.since = seed.since ?? file.since;
    file.categories = structuredClone(seed.categories);
    file.parties = seed.parties.map(p => ({ ...p, createdAt: now(), identifiers: [] }));
    const reading = await options.operations();
    for (const [tx, label] of Object.entries(seed.labels)) {
      const t = reading?.transactions.find(x => x.id === tx);
      if (!t) continue;
      const r = read(file, t, reading!.accounts);
      file.labels[tx] = { ...label, labeledAt: now(), op: r.op };
      keepWords(file, label.tags);
      learn(file, file.labels[tx], r);
    }
    return file;
  }

  /** Tags are a list of the user's own words, kept once each however they were written. */
  function keepWords(file: BankLabelFile, tags: string[]) {
    for (const tag of tags) if (!file.tags.some(t => same(t, tag))) file.tags.push(tag);
    if (file.tags.length > BANK_LABEL_LIMITS.tags) throw new BankLabelError(409, `Może być najwyżej ${BANK_LABEL_LIMITS.tags} etykiet.`);
  }

  /** What the bank showed for the other side now belongs to the side the user said, and to no other (the latest word counts). */
  function learn(file: BankLabelFile, mark: StoredLabel, r: Read) {
    const owner = mark.party ? file.parties.find(p => p.id === mark.party) : undefined;
    if (!owner) return;
    const give = (key: string, kind: z.infer<typeof identifierSchema>['kind'], hint: string) => {
      for (const other of file.parties) if (other !== owner) other.identifiers = other.identifiers.filter(i => i.key !== key);
      if (owner.identifiers.some(i => i.key === key)) return;
      owner.identifiers.push({ key, kind, hint, addedAt: now() });
      if (owner.identifiers.length > BANK_LABEL_LIMITS.identifiers) owner.identifiers.shift();
    };
    for (const party of r.parties) give(hash(file.secret, party), party.kind, party.hint);
    const text = r.op.keys.find(k => k.startsWith('merchant:'));
    if (text) give(text, 'merchant', r.op.name);
  }

  /** The reading, each operation with its features (hashed identifiers), whom it is known to be from or to, and suggestions. */
  async function view(file: BankLabelFile) {
    const reading = await options.operations();
    const ops = (reading?.transactions ?? []).map(t => read(file, t, reading!.accounts));
    const marked: Marked[] = Object.entries(file.labels).map(([tx, l]) => ({ tx, op: l.op, move: l.move, category: l.category, tags: l.tags, party: l.party, recurring: l.recurring }));
    const owners = file.parties.map(p => ({ id: p.id, name: p.name, identifiers: p.identifiers }));
    const ctx = { marked, categories: file.categories, owners, rejections: file.rejections };
    const known = new Map<string, string>();
    for (const o of ops) {
      const key = o.op.keys.find(k => SURE_KINDS.includes(k.slice(0, k.indexOf(':'))) && owners.some(w => w.identifiers.some(i => i.key === k)));
      if (key) known.set(o.t.id, owners.find(w => w.identifiers.some(i => i.key === key))!.id);
    }
    // Done is an operation whose move is said, with its category or source where the move has one.
    const done = (tx: string) => isDone(file.labels[tx]);
    const pending = ops.filter(o => bookedOn(o.t.at) >= file.since && !done(o.t.id)).map(o => o.t.id);
    const proposals = new Map<string, Proposal>();
    // Every operation not done gets its suggestion, also one older than "to be marked" counts from: it is not asked for,
    // but the panel says what it knows.
    for (const o of ops) {
      if (done(o.t.id)) continue;
      const proposal = suggest(o.t.id, o.op, ctx);
      if (proposal) proposals.set(o.t.id, proposal);
    }
    // The habit of each side: what its earlier marks with money going the same way said the money did.
    const habits = new Map<string, Partial<Record<BankMove, number>>>();
    for (const o of ops) {
      const party = file.labels[o.t.id]?.party ?? known.get(o.t.id);
      if (!party || done(o.t.id)) continue;
      const counts: Partial<Record<BankMove, number>> = {};
      for (const m of marked) if (m.tx !== o.t.id && m.party === party && m.move && Math.sign(m.op.amount) === Math.sign(o.op.amount)) counts[m.move] = (counts[m.move] ?? 0) + 1;
      if (Object.keys(counts).length) habits.set(o.t.id, counts);
    }
    return { reading, ops, pending, proposals, known, habits };
  }

  const label = (l: StoredLabel): BankLabel => ({ move: l.move, category: l.category, tags: [...l.tags], party: l.party, recurring: l.recurring, comment: l.comment });
  const id = (prefix: 'c' | 'k', taken: string[]) => { for (;;) { const c = `${prefix}-${randomUUID().slice(0, 8)}`; if (!taken.includes(c)) return c; } };
  const missing = (what: string): never => { throw new BankLabelError(404, what); };
  const categoryOf = (file: BankLabelFile, categoryId: string) => file.categories.find(c => c.id === categoryId) ?? missing('Nie ma takiej kategorii.');
  const partyOf = (file: BankLabelFile, partyId: string) => file.parties.find(p => p.id === partyId) ?? missing('Nie ma takiej drugiej strony.');
  /** A mark with nothing left on it is no mark. */
  const dropEmpty = (file: BankLabelFile) => { for (const [tx, l] of Object.entries(file.labels)) if (isEmpty(l)) delete file.labels[tx]; };
  const remember = (file: BankLabelFile, rejection: Rejection) => {
    file.rejections.push(rejection);
    if (file.rejections.length > MAX_REJECTIONS) file.rejections.splice(0, file.rejections.length - MAX_REJECTIONS);
  };
  /** The same word written another way ("Zakupy" for "zakupy") is the one already kept. */
  const canonical = (list: string[], words: string[]) => words.map(t => list.find(k => same(k, t)) ?? t);
  /** Renames a tag in the list and in every mark; renaming onto an existing tag merges the two. */
  function renameTag(file: BankLabelFile, from: string, to: string) {
    const old = file.tags.find(t => same(t, from)) ?? missing('Nie ma takiej etykiety.');
    const target = file.tags.find(t => same(t, to) && t !== old) ?? to;
    file.tags = [...file.tags.filter(t => t !== old && t !== target), target];
    for (const l of Object.values(file.labels)) if (l.tags.includes(old)) l.tags = [...new Set(l.tags.map(t => t === old ? target : t))];
  }
  /**
   * A mark holds together: a category belongs to the move it is of (a spend's category, an income's source, a move's pocket), and
   * is taken as the move when none is said; a settlement has none and needs the side it is with.
   */
  function checked(file: BankLabelFile, next: MarkFields): MarkFields {
    const category = next.category ? categoryOf(file, next.category) : null;
    const move = next.move ?? category?.move ?? null;
    if (category && move !== category.move) {
      if (move === 'settle') throw new BankLabelError(409, 'Rozliczenie nie ma kategorii.');
      throw new BankLabelError(409, `„${category.name}” należy do ${MOVE_OF_CATEGORY[category.move]}, nie do ${MOVE_OF_CATEGORY[move!]}.`);
    }
    if (move === 'settle' && !next.party) throw new BankLabelError(409, 'Rozliczenie potrzebuje drugiej strony: wybierz, z kim.');
    if (next.party) partyOf(file, next.party);
    return { ...next, move };
  }

  /** What the option does not say stays as it was, unless the option's move leaves no room for it. */
  const withOption = (before: StoredLabel | undefined, option: BankOption): MarkFields => {
    const move = option.move ?? before?.move ?? null;
    const category = option.category ?? (option.move && option.move !== before?.move ? null : before?.category ?? null);
    return {
      move, category, tags: option.tags ?? before?.tags ?? [], party: option.party ?? before?.party ?? null,
      recurring: option.recurring ?? before?.recurring ?? false, comment: before?.comment ?? '',
    };
  };

  /** Validates, then changes; a refusal is thrown before anything is touched. */
  async function mutate(file: BankLabelFile, action: BankLabelActionParsed): Promise<BankLabelResult> {
    switch (action.action) {
      case 'label': case 'accept': case 'reject': case 'clear': {
        const { ops, proposals } = await view(file);
        const found = ops.find(o => o.t.id === action.tx);
        if (!found && !(action.action === 'clear' && file.labels[action.tx])) throw new BankLabelError(404, 'Nie ma takiej operacji w ostatnim odczycie banku.');
        if (action.action === 'clear') { const had = !!file.labels[action.tx]; delete file.labels[action.tx]; return { ok: true, removed: had ? 1 : 0 }; }
        const proposal = proposals.get(action.tx);
        if ((action.action === 'accept' || action.action === 'reject') && !proposal) throw new BankLabelError(409, 'Ta operacja nie ma już podpowiedzi.');
        if (action.action === 'reject') {
          for (const signature of proposal!.signatures) remember(file, { tx: action.tx, basis: proposal!.basis, signature, at: now() });
          return { ok: true };
        }
        const before = file.labels[action.tx];
        let next: MarkFields;
        if (action.action === 'accept') {
          next = withOption(before, proposal!.suggestion.options[action.option] ?? missing('Nie ma takiej możliwości.'));
        } else {
          next = {
            move: action.move, category: action.category, tags: canonical(file.tags, action.tags), party: action.party,
            recurring: action.recurring, comment: (action.comment ?? before?.comment ?? '').trim(),
          };
        }
        next = checked(file, next);
        if (action.action === 'label') {
          // Saving something else than a sure suggestion puts it in doubt: next time it is a choice, not a suggestion.
          const first = proposal?.suggestion.options[0];
          if (proposal?.suggestion.sure && first && (next.move !== (first.move ?? null) || next.category !== (first.category ?? null) || [...next.tags].sort().join() !== [...(first.tags ?? [])].sort().join()))
            remember(file, { tx: action.tx, basis: proposal.basis, signature: proposal.signatures[0], at: now() });
        }
        if (isEmpty(next)) { delete file.labels[action.tx]; return { ok: true, removed: before ? 1 : 0 }; }
        if (!before && Object.keys(file.labels).length >= MAX_LABELS) throw new BankLabelError(409, `Może być najwyżej ${MAX_LABELS} oznaczeń.`);
        keepWords(file, next.tags);
        file.labels[action.tx] = { ...next, labeledAt: now(), op: found!.op };
        learn(file, file.labels[action.tx], found!);
        return { ok: true };
      }
      case 'acceptMany': {
        // Every sure suggestion of these operations as it is now, or none: a suggestion that is gone or became a choice refuses all.
        const { ops, proposals } = await view(file);
        let assigned = 0;
        for (const tx of action.txs) {
          const found = ops.find(o => o.t.id === tx) ?? missing('Nie ma takiej operacji w ostatnim odczycie banku.');
          const proposal = proposals.get(tx);
          if (!proposal?.suggestion.sure) throw new BankLabelError(409, 'Ta operacja nie ma już pewnej podpowiedzi.');
          const before = file.labels[tx];
          const next = checked(file, withOption(before, proposal.suggestion.options[0]));
          if (isEmpty(next)) continue;
          if (!before && Object.keys(file.labels).length >= MAX_LABELS) throw new BankLabelError(409, `Może być najwyżej ${MAX_LABELS} oznaczeń.`);
          keepWords(file, next.tags);
          file.labels[tx] = { ...next, labeledAt: now(), op: found.op };
          learn(file, file.labels[tx], found);
          assigned++;
        }
        return { ok: true, assigned };
      }
      case 'createCategory': {
        // A spending category and an income source may share a name ("Zwroty"); within one list a name is one.
        const existing = file.categories.find(c => c.move === action.move && same(c.name, action.name));
        if (existing) return { ok: true, category: { id: existing.id, created: false } };
        if (file.categories.length >= BANK_LABEL_LIMITS.categories) throw new BankLabelError(409, `Może być najwyżej ${BANK_LABEL_LIMITS.categories} kategorii i źródeł.`);
        const used = new Set(file.categories.map(c => c.color));
        const category: BankCategory = {
          id: id('c', file.categories.map(c => c.id)), name: action.name, move: action.move,
          color: action.color ?? BANK_COLORS.find(c => !used.has(c)) ?? BANK_COLORS[file.categories.length % BANK_COLORS.length], icon: action.icon ?? BANK_ICONS[0],
        };
        file.categories.push(category);
        return { ok: true, category: { id: category.id, created: true } };
      }
      case 'updateCategory': {
        const category = categoryOf(file, action.category);
        if (action.name !== undefined && file.categories.some(c => c !== category && c.move === category.move && same(c.name, action.name!)))
          throw new BankLabelError(409, category.move === 'income' ? 'Źródło o takiej nazwie już jest.' : 'Kategoria o takiej nazwie już jest.');
        Object.assign(category, { ...(action.name !== undefined ? { name: action.name } : {}), ...(action.color ? { color: action.color } : {}), ...(action.icon ? { icon: action.icon } : {}) });
        return { ok: true, category: { id: category.id, created: false } };
      }
      case 'deleteCategory': {
        const category = categoryOf(file, action.category);
        file.categories.splice(file.categories.indexOf(category), 1);
        let removed = 0;
        for (const l of Object.values(file.labels)) if (l.category === category.id) { l.category = null; removed++; }
        dropEmpty(file);
        return { ok: true, removed };
      }
      case 'mergeCategory': {
        const from = categoryOf(file, action.category), into = categoryOf(file, action.into);
        if (from.move !== into.move) throw new BankLabelError(409, 'Można scalić tylko z pozycją tej samej listy.');
        const tag = action.tag ? file.tags.find(t => same(t, action.tag!)) ?? action.tag : undefined;
        let moved = 0;
        for (const l of Object.values(file.labels)) {
          if (l.category !== from.id) continue;
          l.category = into.id;
          if (tag && !l.tags.some(t => same(t, tag)) && l.tags.length < BANK_LABEL_LIMITS.tagsPerMark) l.tags.push(tag);
          moved++;
        }
        if (tag && moved) keepWords(file, [tag]);
        file.categories.splice(file.categories.indexOf(from), 1);
        return { ok: true, category: { id: into.id, created: false }, removed: moved };
      }
      case 'mergeInto': {
        const sources = [...new Set(action.from)].map(id => categoryOf(file, id));
        if (sources.some(c => c.move !== 'spend')) throw new BankLabelError(409, 'Scalać można tylko kategorie wydatków.');
        let target = file.categories.find(c => c.move === 'spend' && same(c.name, action.into));
        const created = !target;
        if (!target) {
          if (file.categories.length >= BANK_LABEL_LIMITS.categories) throw new BankLabelError(409, `Może być najwyżej ${BANK_LABEL_LIMITS.categories} kategorii i źródeł.`);
          const used = new Set(file.categories.map(c => c.color));
          target = {
            id: id('c', file.categories.map(c => c.id)), name: action.into, move: 'spend',
            color: BANK_COLORS.find(c => !used.has(c)) ?? BANK_COLORS[file.categories.length % BANK_COLORS.length], icon: BANK_ICONS[0],
          };
          file.categories.push(target);
        }
        const folded = sources.filter(c => c !== target);
        if (!folded.length) throw new BankLabelError(409, 'Nie ma czego scalić.');
        let moved = 0;
        const words = new Set<string>();
        for (const l of Object.values(file.labels)) {
          const from = folded.find(c => c.id === l.category);
          if (!from) continue;
          l.category = target.id;
          moved++;
          if (!action.tags) continue;
          const word = from.name.replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, BANK_LABEL_LIMITS.tag);
          const tag = file.tags.find(t => same(t, word)) ?? word;
          if (word && !l.tags.some(t => same(t, tag)) && l.tags.length < BANK_LABEL_LIMITS.tagsPerMark) { l.tags.push(tag); words.add(tag); }
        }
        if (words.size) keepWords(file, [...words]);
        file.categories = file.categories.filter(c => !folded.includes(c));
        return { ok: true, category: { id: target.id, created }, removed: moved };
      }
      case 'renameTag': { renameTag(file, action.tag, action.name); return { ok: true }; }
      case 'deleteTag': {
        const tag = file.tags.find(t => same(t, action.tag)) ?? missing('Nie ma takiej etykiety.');
        file.tags = file.tags.filter(t => t !== tag);
        let removed = 0;
        for (const l of Object.values(file.labels)) if (l.tags.includes(tag)) { l.tags = l.tags.filter(t => t !== tag); removed++; }
        dropEmpty(file);
        return { ok: true, removed };
      }
      case 'createParty': {
        // Always a new one: two sides may share a name, and the screen offers an existing one before making another.
        if (file.parties.length >= BANK_LABEL_LIMITS.parties) throw new BankLabelError(409, `Może być najwyżej ${BANK_LABEL_LIMITS.parties} drugich stron.`);
        const party: StoredParty = { id: id('k', file.parties.map(p => p.id)), name: action.name, createdAt: now(), identifiers: [] };
        file.parties.push(party);
        return { ok: true, party: { id: party.id, created: true } };
      }
      case 'updateParty': {
        const party = partyOf(file, action.party);
        party.name = action.name;
        return { ok: true, party: { id: party.id, created: false } };
      }
      case 'deleteParty': {
        const party = partyOf(file, action.party);
        file.parties.splice(file.parties.indexOf(party), 1);
        let removed = 0;
        for (const l of Object.values(file.labels)) if (l.party === party.id) { l.party = null; removed++; }
        dropEmpty(file);
        return { ok: true, removed };
      }
      case 'forgetIdentifier': {
        const party = partyOf(file, action.party);
        const before = party.identifiers.length;
        party.identifiers = party.identifiers.filter(i => publicId(i.key) !== action.identifier);
        if (party.identifiers.length === before) throw new BankLabelError(404, 'Nie ma takiego identyfikatora.');
        return { ok: true, removed: 1 };
      }
      case 'setSince': {
        file.since = action.since;
        return { ok: true };
      }
    }
  }

  const unavailable = (status: 'unavailable' | 'offline', text: string): BankLabelsSource => ({ live: true, name: 'Oznaczenia', status, observedAt: null, message: text, data: null });
  const byUse = (words: string[], uses: Map<string, number>) => [...words].sort((a, b) => (uses.get(b) ?? 0) - (uses.get(a) ?? 0) || a.localeCompare(b, 'pl'));

  return {
    async read() {
      await tail;
      let file: BankLabelFile;
      try { file = await load(); } catch (error) { return unavailable('offline', error instanceof BankLabelError ? error.message : 'Nie udało się odczytać oznaczeń.'); }
      const { reading, ops, pending, proposals, known, habits } = await view(file);
      const labels =Object.fromEntries(ops.filter(o => file.labels[o.t.id]).map(o => [o.t.id, label(file.labels[o.t.id])]));
      const uses = new Map<string, number>();
      for (const l of Object.values(file.labels)) for (const w of l.tags) uses.set(w, (uses.get(w) ?? 0) + 1);
      return {
        live: true, name: 'Oznaczenia', status: 'connected', observedAt: reading?.observedAt ?? null, ...(message ? { message } : {}),
        data: {
          since: file.since, categories: structuredClone(file.categories), tags: byUse(file.tags, uses),
          parties: file.parties.map(p => ({ id: p.id, name: p.name, identifiers: p.identifiers.map(i => ({ id: publicId(i.key), kind: i.kind, hint: i.hint })) })),
          labels, suggestions: Object.fromEntries([...proposals].map(([tx, p]) => [tx, p.suggestion])), known: Object.fromEntries(known), pending,
          balances: balancesOf(file), habits: Object.fromEntries(habits),
        },
      };
    },
    apply(input) {
      const run = tail.then(async () => {
        const parsed = bankLabelActionSchema.safeParse(input);
        if (!parsed.success) throw new BankLabelError(400, 'Niepoprawna akcja oznaczenia.');
        const file = await load();
        const before = structuredClone(file);
        try {
          const result = await mutate(file, parsed.data);
          await options.persistence?.write(file);
          return result;
        } catch (error) {
          // Memory must not get ahead of the disk: whatever was changed is taken back.
          data = before;
          if (error instanceof SourceError) throw error;
          throw new BankLabelError(503, 'Nie udało się zapisać oznaczenia.');
        }
      });
      tail = run.catch(() => undefined);
      return run;
    },
    async ledger() {
      await tail;
      const file = await load();
      const { reading, ops, pending, proposals, known } = await view(file);
      const inReading = new Set(ops.map(o => o.t.id));
      const entries = [
        ...ops.map(o => ({ tx: o.t.id, op: o.op, inReading: true })),
        ...Object.entries(file.labels).filter(([tx]) => !inReading.has(tx)).map(([tx, l]) => ({ tx, op: l.op, inReading: false })),
      ].sort((a, b) => b.op.at - a.op.at).map(e => ({
        ...e, label: file.labels[e.tx] ? label(file.labels[e.tx]) : null, known: known.get(e.tx) ?? null,
        suggestion: proposals.get(e.tx)?.suggestion ?? null, pending: pending.includes(e.tx),
      }));
      return {
        observedAt: reading?.observedAt ?? null, since: file.since, categories: structuredClone(file.categories),
        parties: file.parties.map(p => ({ id: p.id, name: p.name })), balances: balancesOf(file), tags: [...file.tags], entries,
      };
    },
    async drain() { await tail; },
  };
}

/** The service's file: DPAPI for the Windows user, written to a temporary file and renamed (private-store.ts). */
export function privateFile(file: string, io: { read(path: string): Promise<unknown>; write(path: string, value: unknown): Promise<void> }, now = Date.now): BankLabelPersistence {
  return {
    async read() {
      try { return await io.read(file); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        // Decrypted but not JSON is a broken file, not a busy one: say so with an empty object, which fails the schema.
        if (error instanceof SyntaxError) return {};
        throw error;
      }
    },
    write: value => io.write(file, value),
    async aside() { const target = `${file}.corrupt-${now()}`; await rename(file, target); return target; },
  };
}
