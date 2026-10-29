import { BANK_SHOW_LIMITS, type BankShowData, type BankShowQuery } from '../src/bank-show-contract';
import type { BankLedger } from './bank-labels';

const DAY_MS = 24 * 60 * 60 * 1000;
const isDay = (value: string) => new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const addDays = (value: string, days: number) => new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
/** A booking day is noon UTC of that date. */
const bookedOn = (at: number) => new Date(at).toISOString().slice(0, 10);
const clip = (text: string, max: number) => { const flat = text.replace(/\s+/g, ' ').trim(); return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat; };
/** No long run of digits (an account or a phone number) leaves the panel in a card or its summary. */
const masked = (text: string) => text.replace(/\d{9,}/g, run => `${'*'.repeat(run.length - 3)}${run.slice(-3)}`);
export const money = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;

export class BankShowError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** The spending marks in the range, PLN only: a spend, or an unmarked outflow (counted as spending, like the agent's view does). */
function spending(ledger: BankLedger, from: string, to: string) {
  return ledger.entries.filter(e => e.op.currency === 'PLN' && bookedOn(e.op.at) >= from && bookedOn(e.op.at) <= to
    && (e.label?.move === 'spend'));
}

/**
 * The card's data from the ledger. A name matches a category by id or by a part of its name, among the spending categories
 * only; a name that matches none comes back in `unknown`, and no match at all is refused with the names there are.
 */
export function bankShow(ledger: BankLedger, query: BankShowQuery, today: string): BankShowData {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -BANK_SHOW_LIMITS.defaultDays);
  if (!isDay(from) || !isDay(to)) throw new BankShowError(400, 'from i to to daty RRRR-MM-DD.');
  if (to < from) throw new BankShowError(400, 'to nie może być przed from.');
  if (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`) >= BANK_SHOW_LIMITS.days * DAY_MS) throw new BankShowError(400, `Zakres to najwyżej ${BANK_SHOW_LIMITS.days} dni.`);

  const spend = ledger.categories.filter(c => c.move === 'spend');
  const matched = new Map<string, (typeof spend)[number]>();
  const unknown: string[] = [];
  for (const wanted of query.kategorie) {
    const w = wanted.trim().toLowerCase();
    const found = spend.filter(c => c.id === w || c.name.toLowerCase().includes(w));
    if (!found.length) unknown.push(wanted);
    for (const c of found) matched.set(c.id, c);
  }
  if (!matched.size) throw new BankShowError(404, `Żadna kategoria wydatków nie pasuje do: ${query.kategorie.join(', ')}. Kategorie wydatków: ${spend.map(c => c.name).join(', ') || '(brak)'}.`);

  const entries = spending(ledger, from, to).filter(e => e.label?.category && matched.has(e.label.category));
  const categories = [...matched.values()].map(c => {
    const own = entries.filter(e => e.label?.category === c.id);
    return { id: c.id, name: c.name, color: c.color, count: own.length, spent: -own.reduce((sum, e) => sum + e.op.amount, 0) };
  }).sort((a, b) => b.spent - a.spent);
  const rows = entries.slice(0, BANK_SHOW_LIMITS.rows).map(e => ({
    day: bookedOn(e.op.at), amount: e.op.amount, name: masked(clip(e.op.name, 60)),
    category: matched.get(e.label!.category!)!.name, tags: e.label!.tags.map(t => masked(clip(t, 30))),
  }));
  return {
    view: query.view, from, to, unknown, categories, rows,
    total: { count: entries.length, spent: categories.reduce((sum, c) => sum + c.spent, 0) },
    span: entries.length ? { first: bookedOn(Math.min(...entries.map(e => e.op.at))), last: bookedOn(Math.max(...entries.map(e => e.op.at))) } : null,
    hidden: Math.max(0, entries.length - rows.length), observedAt: ledger.observedAt,
  };
}

/**
 * Since when the user marks, and what in the range is still unmarked: a category's share or rhythm is only true of the marked
 * period, and the model cannot see that from the sums (marking may have started recently).
 */
function coverage(ledger: BankLedger, data: BankShowData): string {
  const inRange = ledger.entries.filter(e => e.op.currency === 'PLN' && bookedOn(e.op.at) >= data.from && bookedOn(e.op.at) <= data.to);
  const marked = inRange.filter(e => e.label?.move);
  if (!marked.length) return '';
  const first = bookedOn(Math.min(...marked.map(e => e.op.at)));
  const unmarked = inRange.filter(e => !e.label?.move && e.op.amount < 0);
  return `Oznaczenia w tym zakresie zaczynają się ${first}; nieoznaczonych wydatków: ${unmarked.length} op. ${money(-unmarked.reduce((sum, e) => sum + e.op.amount, 0))}${unmarked.length ? ` (od ${bookedOn(Math.min(...unmarked.map(e => e.op.at)))} do ${bookedOn(Math.max(...unmarked.map(e => e.op.at)))})` : ''}.`;
}

/**
 * What the model is told after a card: a short line it can comment on, not the rows. The spending categories beside the
 * asked ones come with their sums, so it can notice a related one itself (the model decides, the panel only lists).
 */
export function bankShowSummary(ledger: BankLedger, data: BankShowData): string {
  const shown = new Set(data.categories.map(c => c.id));
  const others = new Map<string, { count: number; spent: number }>();
  for (const e of spending(ledger, data.from, data.to)) {
    const id = e.label?.category;
    if (!id || shown.has(id)) continue;
    const entry = others.get(id) ?? { count: 0, spent: 0 };
    entry.count++; entry.spent -= e.op.amount;
    others.set(id, entry);
  }
  const names = new Map(ledger.categories.map(c => [c.id, c.name]));
  const rest = [...others].sort((a, b) => b[1].spent - a[1].spent).map(([id, o]) => `${names.get(id) ?? '?'} ${o.count} op. ${money(o.spent)}`);
  return [
    `Pokazano: ${data.categories.map(c => `${c.name} ${c.count} op. ${money(c.spent)}`).join('; ')}. Razem ${data.total.count} operacji, ${money(data.total.spent)}; zakres ${data.from} – ${data.to}${data.span ? `, same operacje od ${data.span.first} do ${data.span.last}` : ''}.`,
    coverage(ledger, data),
    data.unknown.length ? `Bez dopasowania: ${data.unknown.join(', ')}.` : '',
    `Inne kategorie wydatków w tym zakresie: ${rest.length ? rest.join('; ') : 'brak'}.`,
  ].filter(Boolean).join(' ');
}

/** Today's date in the user's zone, for the default range. */
export const dayIn = (now: number, zone: string) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
