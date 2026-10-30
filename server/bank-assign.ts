import { createHash } from 'node:crypto';
import { isDone, type BankMove } from '../src/bank-labels-contract';
import {
  BANK_ASSIGN_LIMITS, type BankAssign, type BankAssignChoice, type BankAssignPick, type BankAssignMark, type BankAssignPool, type BankAssignPreview, type BankAssignRecipient, type BankAssignTemplate,
} from '../src/bank-assign-contract';
import type { BankLedger } from './bank-labels';
import { dayIn } from './bank-show';

const ZONE = 'Europe/Warsaw';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8);
const cents = (amount: number) => Math.round(amount * 100);

type Entry = BankLedger['entries'][number];
/** A mark as the panel keeps it: ids, and the other side the user gave it (a note of theirs, not a key to anything). */
interface Template { key: string; move: BankMove; category: string | null; tags: string[]; recurring: boolean; party: string | null; count: number; last: number }
interface Recipient { key: string; name: string; party: string; certain: boolean; templates: Template[]; entries: Entry[] }

/** One mark's identity: the same kind, category, tags, repeat and note of a side are the same template, however many earlier operations carry it. */
const templateKey = (t: Pick<Template, 'move' | 'category' | 'tags' | 'recurring' | 'party'>) =>
  `t-${hash([t.move, t.category, [...t.tags].map(x => x.toLowerCase()).sort(), t.recurring, t.party])}`;

/** A payment the bank gives no shop for (phone, BLIK, from a card): nothing says whose it is, so it has no recipient. */
const nameless = (e: Entry) => e.op.merchant === null && !e.known && (e.op.method === 'phone' || e.op.method === 'blik' || e.op.method === 'cardTransfer');

const countTemplates = (marks: { op: Entry['op']; label: NonNullable<Entry['label']> }[]): Template[] => {
  const counts = new Map<string, Template>();
  for (const { op, label } of marks) {
    if (!label.move) continue;
    const t = { move: label.move, category: label.category, tags: label.tags, recurring: label.recurring, party: label.party };
    const key = templateKey(t);
    const have = counts.get(key);
    if (have) { have.count++; have.last = Math.max(have.last, op.at); } else counts.set(key, { ...t, key, count: 1, last: op.at });
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, BANK_ASSIGN_LIMITS.templates);
};

const inRangeOf = (plan: BankAssign) => (at: number) => { const d = dayIn(at, ZONE); return (!plan.from || d >= plan.from) && (!plan.to || d <= plan.to); };
const doneHistory = (ledger: BankLedger) => ledger.entries.filter((e): e is Entry & { label: NonNullable<Entry['label']> } => !!e.label && isDone(e.label));

/**
 * The unmarked operations of the range grouped by recipient: whom the bank text, account, phone or name says it is (the same
 * side the user already named). A recipient is listed only when it has something to offer: the marks its earlier operations
 * got, most frequent first. A payment with no name from the bank has no recipient and goes to the pool.
 */
function recipients(ledger: BankLedger, plan: BankAssign): Recipient[] {
  const inRange = inRangeOf(plan);
  const history = doneHistory(ledger);
  const byKey = new Map<string, Recipient>();
  for (const e of [...ledger.entries].sort((a, b) => b.op.at - a.op.at)) {
    if (isDone(e.label) || !inRange(e.op.at) || !e.known) continue;
    const sign = Math.sign(e.op.amount);
    const key = `r-${hash(['p', e.known, sign])}`;
    let r = byKey.get(key);
    if (!r) { r = { key, name: ledger.parties.find(p => p.id === e.known)?.name ?? e.op.name, party: e.known, certain: false, templates: [], entries: [] }; byKey.set(key, r); }
    r.entries.push(e);
  }
  const out: Recipient[] = [];
  for (const r of byKey.values()) {
    const sign = Math.sign(r.entries[0].op.amount);
    r.templates = countTemplates(history.filter(h => h.label.party === r.party && Math.sign(h.op.amount) === sign));
    if (!r.templates.length) continue;
    r.certain = r.templates.length === 1 && r.templates[0].count >= 2;
    out.push(r);
  }
  // Certain ones first, then the biggest.
  return out.sort((a, b) => Number(b.certain) - Number(a.certain) || b.entries.length - a.entries.length || a.key.localeCompare(b.key));
}

/**
 * The unmarked payments with no name from the bank in the range that have a lead, newest first, and the templates their earlier marks
 * give (all such payments together). A payment with no lead is left out (`rest` counts them): there is nothing to go on.
 */
function pool(ledger: BankLedger, plan: BankAssign): { entries: Entry[]; rest: number; templates: Template[]; hints: Map<string, { template: string; count: number }> } {
  const inRange = inRangeOf(plan);
  const all = ledger.entries.filter(e => !isDone(e.label) && inRange(e.op.at) && nameless(e)).sort((a, b) => b.op.at - a.op.at);
  const history = doneHistory(ledger).filter(nameless);
  const templates = countTemplates(history);
  // Only a hint, never a reason to tick: the very same amount marked the same way at least twice before.
  const hints = new Map<string, { template: string; count: number }>();
  for (const e of all) {
    const same = countTemplates(history.filter(h => cents(h.op.amount) === cents(e.op.amount)));
    if (same.length && same[0].count >= 2) hints.set(e.tx, { template: same[0].key, count: same[0].count });
  }
  const entries = all.filter(e => hints.has(e.tx));
  return { entries, rest: all.length - entries.length, templates, hints };
}

const markOf = (ledger: BankLedger, t: Template): BankAssignMark => {
  const category = t.category ? ledger.categories.find(c => c.id === t.category) : undefined;
  return { move: t.move, category: category ? { id: category.id, name: category.name, color: category.color, icon: category.icon } : null, tags: t.tags, recurring: t.recurring };
};
const templateOf = (ledger: BankLedger, t: Template): BankAssignTemplate => ({ key: t.key, mark: markOf(ledger, t), count: t.count, party: t.party ? ledger.parties.find(p => p.id === t.party)?.name ?? null : null });
const item = (e: Entry) => ({ tx: e.tx, day: dayIn(e.op.at, ZONE), name: e.op.name, amount: e.op.amount });
const plnTotal = (entries: Entry[]) => Math.round(entries.reduce((sum, e) => sum + (e.op.currency === 'PLN' ? e.op.amount : 0), 0) * 100) / 100;

/** What the card shows. */
export function assignPreview(ledger: BankLedger, plan: BankAssign): BankAssignPreview {
  const found = recipients(ledger, plan);
  const p = pool(ledger, plan);
  const days = [...found.flatMap(r => r.entries), ...p.entries].map(e => dayIn(e.op.at, ZONE)).sort();
  const list: BankAssignRecipient[] = found.map(r => ({
    key: r.key, name: r.name, count: r.entries.length, certain: r.certain, total: plnTotal(r.entries),
    templates: r.templates.map(t => templateOf(ledger, t)),
    items: r.entries.slice(0, BANK_ASSIGN_LIMITS.items).map(item),
    hidden: Math.max(0, r.entries.length - BANK_ASSIGN_LIMITS.items),
  }));
  const poolPreview: BankAssignPool | null = p.entries.length ? {
    rest: p.rest, count: p.entries.length, total: plnTotal(p.entries), templates: p.templates.map(t => templateOf(ledger, t)),
    items: p.entries.slice(0, BANK_ASSIGN_LIMITS.poolItems).map(e => ({ ...item(e), hint: p.hints.get(e.tx) ?? null })),
    hidden: Math.max(0, p.entries.length - BANK_ASSIGN_LIMITS.poolItems),
  } : null;
  return {
    range: { from: plan.from ?? null, to: plan.to ?? null, first: days[0] ?? null, last: days.at(-1) ?? null },
    recipients: list, pool: poolPreview,
    categories: ledger.categories.map(c => ({ id: c.id, name: c.name, move: c.move, color: c.color, icon: c.icon })),
    problems: list.length || poolPreview ? [] : ['Nie ma nieoznaczonych operacji, które panel umie rozpoznać albo które nie mają nazwy z banku, w tym zakresie.'],
  };
}

/** One operation's mark, as the labels store takes it (`newCategory`: a spending category the user made on the card, named). */
export interface MarkItem { tx: string; move: BankMove; category: string | null; newCategory?: string; tags: string[]; party: string | null; recurring: boolean }

const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;

/**
 * What to mark, worked out again from what is kept now, and the new categories it needs. A recipient's operations (when ticked) get
 * their own pick, else the recipient's pick, else (for a certain recipient) its only template. A payment of the pool is marked only by
 * its own pick: nothing is ever chosen for it. A pick that is not there any more (a template the list no longer has, a category
 * deleted meanwhile, a new category not declared) is dropped, never replaced by a guess.
 */
export function assignMarks(ledger: BankLedger, plan: BankAssign, choice: BankAssignChoice = {}): { items: MarkItem[]; create: string[] } {
  const items: MarkItem[] = [];
  const create: string[] = [];
  const pickOf = (tx: string) => choice.picks?.find(p => p.tx === tx);
  const byCategory = (e: Entry, party: string | null, id: string): MarkItem | null => {
    const category = ledger.categories.find(c => c.id === id);
    return category ? { tx: e.tx, move: category.move, category: category.id, tags: [], party, recurring: false } : null;
  };
  // A category made on the card: one the user declared; an existing spending category of that name is used instead of a second one.
  const byNew = (e: Entry, party: string | null, name: string): MarkItem | null => {
    const declared = choice.newCategories?.find(n => same(n, name));
    if (!declared) return null;
    const existing = ledger.categories.find(c => c.move === 'spend' && same(c.name, declared));
    if (existing) return { tx: e.tx, move: 'spend', category: existing.id, tags: [], party, recurring: false };
    if (!create.some(n => same(n, declared))) create.push(declared);
    return { tx: e.tx, move: 'spend', category: null, newCategory: declared, tags: [], party, recurring: false };
  };
  const byTemplate = (e: Entry, t: Template, party: string | null): MarkItem => ({ tx: e.tx, move: t.move, category: t.category, tags: t.tags, party: t.party ?? party, recurring: t.recurring });
  const resolve = (e: Entry, party: string | null, pick: BankAssignPick | undefined, templates: Template[]): MarkItem | null => {
    if (!pick) return null;
    if (pick.category) return byCategory(e, party, pick.category);
    if (pick.newCategory) return byNew(e, party, pick.newCategory);
    const t = templates.find(x => x.key === pick.template);
    return t ? byTemplate(e, t, party) : null;
  };
  for (const r of recipients(ledger, plan)) {
    if (choice.skip?.includes(r.key)) continue;
    const group: BankAssignPick | undefined = choice.groupPicks?.find(g => g.group === r.key) ?? (r.certain ? { template: r.templates[0].key } : undefined);
    for (const e of r.entries) {
      if (choice.skipOps?.includes(e.tx)) continue;
      const m = resolve(e, r.party, pickOf(e.tx) ?? group, r.templates);
      if (m) items.push(m);
    }
  }
  const p = pool(ledger, plan);
  for (const e of p.entries.slice(0, BANK_ASSIGN_LIMITS.poolItems)) {
    if (choice.skipOps?.includes(e.tx)) continue;
    const m = resolve(e, null, pickOf(e.tx), p.templates);
    if (m) items.push(m);
  }
  return { items, create };
}
