import type { BankTransaction } from '../src/bank-contract';
import type { BankCategory, BankOption, BankSuggestion } from '../src/bank-labels-contract';
import { describe, humanNote } from '../src/bank-merchants';
import { maskPhones, plainName } from './bank-parties';

/**
 * Suggestions for an operation, from the user's own earlier marks only, and only through links that hold: the merchant's text
 * in the bank, the other side's account, whole phone number or the bank's name for it. What these lead to is counted; when the
 * earlier marks all agree the suggestion is sure, when they differ the options are a choice. A payment with no name at all
 * (phone, BLIK) is linked only by the exact amount, and that is always a choice. No ranges of amounts, no time of day, no
 * guessing: without a link there is no suggestion. A suggestion is never a mark; the user takes one option or rejects them.
 */
export type Method = 'card' | 'phone' | 'blik' | 'cardTransfer' | 'atm' | 'transfer' | 'other';
/** What the rules need of one operation; kept with a mark, so marks teach after the operation leaves the bank's reading. */
export interface OpFeatures {
  at: number; amount: number; currency: string;
  /** The clean name shown in the tile, and the person-written part of a transfer title (numbers masked). */
  name: string; detail?: string;
  method: Method;
  /** The merchant or the other side's name, as one plain key; null for a payment with no name. */
  merchant: string | null;
  /** The other side's identifiers, as `kind:hash` keys (and `merchant:<text>` for a card payment; bank-labels.ts makes them). */
  keys: string[];
}

export function methodOf(t: BankTransaction): Method {
  if (t.title === 'Płatność telefonem') return 'phone';
  if (t.title === 'Płatność BLIK') return 'blik';
  if (t.title === 'Przelew z karty') return 'cardTransfer';
  const d = describe(t);
  if (d.category === 'atm') return 'atm';
  if (t.note === 'Płatność kartą') return 'card';
  if (t.note === 'Płatność telefonem' || t.note === 'Płatność BLIK') return 'other';
  return t.note !== undefined || d.category === 'income' ? 'transfer' : 'other';
}

export function featuresOf(t: BankTransaction, keys: string[]): OpFeatures {
  const d = describe(t);
  const method = methodOf(t);
  const nameless = method === 'phone' || method === 'blik' || method === 'cardTransfer';
  // How it was paid is `method`; only what a person wrote in a transfer title is detail.
  const detail = /^(Płatność|Przelew z karty)/.test(t.note ?? '') ? null : humanNote(t.note);
  return {
    at: t.at, amount: t.amount, currency: t.currency, name: maskPhones(d.name), ...(detail ? { detail: maskPhones(detail) } : {}), method,
    merchant: nameless ? null : plainName(d.name) || null, keys,
  };
}

/** A mark as the rules see it. */
export interface Marked { tx: string; op: OpFeatures; category: string | null; tags: string[]; merchant: string | null; person: string | null; recurring: boolean }
/** "None of these" for one operation: the options shown then, by what they were based on. */
export interface Rejection { tx: string; basis: string; signature: string; at: number }
/** A person or a merchant, with the keys of what the bank showed for them. */
export interface Owner { id: string; name: string; kind: 'person' | 'merchant'; identifiers: { key: string; kind: string; hint: string }[] }
export interface SuggestContext { marked: Marked[]; categories: BankCategory[]; owners: Owner[]; rejections: Rejection[] }
/** The suggestion with what it was based on and each option's signature, so a rejection is remembered against both. */
export interface Proposal { suggestion: BankSuggestion; basis: string; signatures: string[] }

/** The order identifiers are looked up in; all but a masked phone number name one side for sure. */
const KIND_ORDER = ['merchant', 'account', 'phone', 'name', 'phoneTail'] as const;
const LINK_REASON: Record<(typeof KIND_ORDER)[number], (hint: string, name: string) => string> = {
  merchant: (_, name) => `ten sam sprzedawca w banku: ${name}`,
  account: (hint, name) => `ten sam rachunek ${hint}: ${name}`,
  phone: (hint, name) => `ten sam numer telefonu ${hint}: ${name}`,
  name: (hint, name) => `ta sama nazwa w banku („${hint}”): ${name}`,
  phoneTail: (hint, name) => `numer z tą samą końcówką ${hint}: ${name} (bank maskuje resztę, sprawdź)`,
};
export const OPTIONS = 3;

const money = (amount: number, currency: string) => Math.abs(amount).toLocaleString('pl-PL', { style: 'currency', currency });
const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;
/** Phone and BLIK are both "a payment without a name": the same amount means the same in either. */
const group = (m: Method) => m === 'phone' || m === 'blik' ? 'nameless' : m;
const times = (n: number) => n === 1 ? 'raz' : 'razy';

export function suggest(tx: string, op: OpFeatures, ctx: SuggestContext): Proposal | null {
  const categories = new Map(ctx.categories.map(c => [c.id, c]));
  const owners = new Map(ctx.owners.map(o => [o.id, o]));

  // Who it is, by the first identifier that belongs to someone: a merchant and a person are looked for apart.
  const found: Partial<Record<Owner['kind'], { owner: Owner; reason: string; reliable: boolean }>> = {};
  for (const kind of KIND_ORDER) {
    for (const key of op.keys.filter(k => k.startsWith(`${kind}:`))) {
      const owner = ctx.owners.find(o => o.identifiers.some(i => i.key === key));
      if (!owner || found[owner.kind]) continue;
      found[owner.kind] = { owner, reason: LINK_REASON[kind](owner.identifiers.find(i => i.key === key)!.hint, owner.name), reliable: kind !== 'phoneTail' };
    }
  }
  const link = found.merchant ?? found.person;
  const sign = Math.sign(op.amount);
  // A mark that only says who (no category, tags or recurring) says nothing about what it was.
  const marks = ctx.marked.filter(m => m.tx !== tx && (m.category || m.tags.length || m.recurring));

  // What it was the other times: the merchant's or person's earlier marks; without a name, only the very same amount.
  let basis: string, history: Marked[], reliable: boolean, linkReason: string | undefined;
  if (link) {
    basis = `${link.owner.kind}:${link.owner.id}`;
    history = marks.filter(m => link.owner.kind === 'merchant' ? m.merchant === link.owner.id && Math.sign(m.op.amount) === sign : m.person === link.owner.id);
    reliable = link.reliable;
    linkReason = [found.merchant?.reason, found.person?.reason].filter(Boolean).join('; ');
  } else if (op.merchant === null) {
    basis = `amount:${group(op.method)}:${Math.round(op.amount * 100)}`;
    history = marks.filter(m => m.op.merchant === null && group(m.op.method) === group(op.method) && Math.sign(m.op.amount) === sign && sameAmount(m.op.amount, op.amount));
    reliable = false;
  } else return null;

  // Earlier marks grouped by what they said (category, tags, recurring, and the merchant when only the amount links them).
  const signature = (m: Marked) => JSON.stringify({
    c: m.category && categories.has(m.category) ? m.category : null, t: [...m.tags].sort(), r: m.recurring,
    m: !link && m.merchant && owners.has(m.merchant) ? m.merchant : null,
  });
  const groups = new Map<string, { marks: Marked[]; last: number }>();
  for (const m of history) {
    const s = signature(m);
    const g = groups.get(s) ?? { marks: [], last: 0 };
    g.marks.push(m); g.last = Math.max(g.last, m.op.at);
    groups.set(s, g);
  }
  const shownBefore = new Set(ctx.rejections.filter(r => r.tx === tx).map(r => r.signature));
  const ranked = [...groups].filter(([s]) => !shownBefore.has(s)).sort((a, b) => b[1].marks.length - a[1].marks.length || b[1].last - a[1].last).slice(0, OPTIONS);
  const total = history.length;

  const options: BankOption[] = [];
  const signatures: string[] = [];
  for (const [s, g] of ranked) {
    const first = g.marks[0];
    const category = first.category && categories.has(first.category) ? first.category : undefined;
    const merchant = found.merchant?.owner.id ?? (!link && first.merchant && owners.has(first.merchant) ? first.merchant : undefined);
    const words = [merchant && !found.merchant ? owners.get(merchant)!.name : null, category && categories.get(category)!.name, ...first.tags.map(t => `#${t}`), first.recurring ? 'cykliczne' : null].filter(Boolean).join(' · ') || 'bez kategorii';
    const count = `${words}: ${g.marks.length} z ${total} ${times(total)}`;
    options.push({
      ...(category ? { category } : {}), ...(first.tags.length ? { tags: [...first.tags] } : {}), ...(merchant ? { merchant } : {}),
      ...(found.person ? { person: found.person.owner.id } : {}), ...(first.recurring ? { recurring: true as const } : {}),
      reasons: link ? [linkReason!, count] : [`ta sama kwota ${money(op.amount, op.currency)}, bez nazwy sklepu`, count],
    });
    signatures.push(s);
  }
  // A known side with nothing marked before still says who it is.
  if (!options.length && link && !shownBefore.has('who') && !groups.size) {
    options.push({ ...(found.merchant ? { merchant: found.merchant.owner.id } : {}), ...(found.person ? { person: found.person.owner.id } : {}), reasons: [linkReason!] });
    signatures.push('who');
  }
  if (!options.length) return null;
  // Sure only when a reliable link leads to marks that all agree and that no one rejected on this basis.
  const doubted = ctx.rejections.some(r => r.tx !== tx && r.basis === basis && r.signature === signatures[0]);
  return { suggestion: { sure: reliable && groups.size <= 1 && options.length === 1 && !doubted, options }, basis, signatures };
}
