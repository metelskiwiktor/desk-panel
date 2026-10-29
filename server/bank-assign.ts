import { createHash } from 'node:crypto';
import { isDone, type BankMove } from '../src/bank-labels-contract';
import {
  BANK_ASSIGN_LIMITS, type BankAssign, type BankAssignChoice, type BankAssignMark, type BankAssignPreview, type BankAssignRecipient, type BankAssignTemplate,
} from '../src/bank-assign-contract';
import type { BankLedger } from './bank-labels';
import { dayIn } from './bank-show';

const ZONE = 'Europe/Warsaw';
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 8);

type Entry = BankLedger['entries'][number];
/** A mark as the panel keeps it: ids, and the other side the template belongs to. */
interface Template { key: string; move: BankMove; category: string | null; tags: string[]; recurring: boolean; party: string | null; count: number; last: number }
interface Recipient { key: string; name: string; party: string | null; amount: number | null; certain: boolean; templates: Template[]; entries: Entry[] }

/** One mark's identity: the same kind, category, tags and repeat are the same template, however many earlier operations carry it. */
const templateKey = (t: Pick<Template, 'move' | 'category' | 'tags' | 'recurring'>) => `t-${hash([t.move, t.category, [...t.tags].map(x => x.toLowerCase()).sort(), t.recurring])}`;

/** A phone or BLIK payment names no shop: only the same amount links it to earlier ones (as in the panel's suggestions). */
const nameless = (e: Entry) => e.op.merchant === null && (e.op.method === 'phone' || e.op.method === 'blik');
const cents = (amount: number) => Math.round(amount * 100);

/**
 * The unmarked operations of the range grouped by recipient: whom the bank text, account, phone or name says it is (the same
 * side the user already named). A payment with no name from the bank is grouped by its amount instead, with the earlier payments of
 * the same amount. A recipient is listed only when it has something to offer: the marks its earlier operations got, most frequent first.
 */
function recipients(ledger: BankLedger, plan: BankAssign): Recipient[] {
  const inRange = (at: number) => { const d = dayIn(at, ZONE); return (!plan.from || d >= plan.from) && (!plan.to || d <= plan.to); };
  const history = ledger.entries.filter(e => e.label && isDone(e.label));
  const byKey = new Map<string, Recipient>();
  for (const e of [...ledger.entries].sort((a, b) => b.op.at - a.op.at)) {
    if (isDone(e.label) || !inRange(e.op.at)) continue;
    const sign = Math.sign(e.op.amount);
    const party = e.known ?? null;
    if (!party && !nameless(e)) continue;
    const name = party ? ledger.parties.find(p => p.id === party)?.name ?? e.op.name : e.op.name;
    const key = `r-${hash(party ? ['p', party, sign] : ['n', e.op.name.toLowerCase(), cents(e.op.amount)])}`;
    let r = byKey.get(key);
    if (!r) { r = { key, name, party, amount: party ? null : e.op.amount, certain: false, templates: [], entries: [] }; byKey.set(key, r); }
    r.entries.push(e);
  }
  const out: Recipient[] = [];
  for (const r of byKey.values()) {
    const counts = new Map<string, Template>();
    const add = (t: Omit<Template, 'key' | 'count' | 'last'>, at: number, count = 1) => {
      const key = templateKey(t);
      const have = counts.get(key);
      if (have) { have.count += count; have.last = Math.max(have.last, at); } else counts.set(key, { ...t, key, count, last: at });
    };
    if (r.party) {
      const sign = Math.sign(r.entries[0].op.amount);
      for (const h of history) if (h.label!.party === r.party && Math.sign(h.op.amount) === sign && h.label!.move)
        add({ move: h.label!.move, category: h.label!.category, tags: h.label!.tags, recurring: h.label!.recurring, party: r.party }, h.op.at);
    } else {
      // No name from the bank: the earlier payments of the same kind and the very same amount, with the side the user gave them.
      for (const h of history) if (nameless(h) && h.label!.move && cents(h.op.amount) === cents(r.amount!))
        add({ move: h.label!.move, category: h.label!.category, tags: h.label!.tags, recurring: h.label!.recurring, party: h.label!.party }, h.op.at);
    }
    r.templates = [...counts.values()].sort((a, b) => b.count - a.count || b.last - a.last).slice(0, BANK_ASSIGN_LIMITS.templates);
    if (!r.templates.length) continue;
    // Certain also for a same-amount payment: the very same amount, always the same mark (at least twice).
    r.certain = r.templates.length === 1 && r.templates[0].count >= 2;
    out.push(r);
  }
  // Certain ones first, then the biggest.
  return out.sort((a, b) => Number(b.certain) - Number(a.certain) || b.entries.length - a.entries.length || a.key.localeCompare(b.key));
}

const markOf = (ledger: BankLedger, t: Template): BankAssignMark => {
  const category = t.category ? ledger.categories.find(c => c.id === t.category) : undefined;
  return { move: t.move, category: category ? { id: category.id, name: category.name, color: category.color, icon: category.icon } : null, tags: t.tags, recurring: t.recurring };
};

/** What the card shows. */
export function assignPreview(ledger: BankLedger, plan: BankAssign): BankAssignPreview {
  const found = recipients(ledger, plan);
  const days = found.flatMap(r => r.entries.map(e => dayIn(e.op.at, ZONE))).sort();
  const list: BankAssignRecipient[] = found.map(r => ({
    key: r.key, name: r.name, amount: r.amount, count: r.entries.length, certain: r.certain,
    total: Math.round(r.entries.reduce((sum, e) => sum + (e.op.currency === 'PLN' ? e.op.amount : 0), 0) * 100) / 100,
    templates: r.templates.map((t): BankAssignTemplate => ({ key: t.key, mark: markOf(ledger, t), count: t.count })),
    items: r.entries.slice(0, BANK_ASSIGN_LIMITS.items).map(e => ({ tx: e.tx, day: dayIn(e.op.at, ZONE), name: e.op.name, amount: e.op.amount })),
    hidden: Math.max(0, r.entries.length - BANK_ASSIGN_LIMITS.items),
  }));
  return {
    range: { from: plan.from ?? null, to: plan.to ?? null, first: days[0] ?? null, last: days.at(-1) ?? null },
    recipients: list,
    categories: ledger.categories.map(c => ({ id: c.id, name: c.name, move: c.move, color: c.color, icon: c.icon })),
    problems: list.length ? [] : ['Nie ma nieoznaczonych operacji, dla których panel zna wcześniejsze oznaczenia odbiorcy, w tym zakresie.'],
  };
}

/** One operation's mark, as the labels store takes it. */
export interface MarkItem { tx: string; move: BankMove; category: string | null; tags: string[]; party: string | null; recurring: boolean }

/**
 * What to mark, worked out again from what is kept now: every operation of a ticked recipient that has a mark, by its own pick,
 * else its recipient's pick, else (for a certain recipient) the only template. A pick that is not there any more (a template
 * the recipient no longer has, a category deleted meanwhile) is dropped, never replaced by a guess.
 */
export function assignMarks(ledger: BankLedger, plan: BankAssign, choice: BankAssignChoice = {}): MarkItem[] {
  const items: MarkItem[] = [];
  for (const r of recipients(ledger, plan)) {
    if (choice.skip?.includes(r.key)) continue;
    const groupKey = choice.groupPicks?.find(g => g.group === r.key)?.template;
    const groupTemplate = r.templates.find(t => t.key === groupKey) ?? (r.certain ? r.templates[0] : undefined);
    for (const e of r.entries) {
      if (choice.skipOps?.includes(e.tx)) continue;
      const pick = choice.picks?.find(p => p.tx === e.tx);
      if (pick?.category) {
        const category = ledger.categories.find(c => c.id === pick.category);
        if (category) items.push({ tx: e.tx, move: category.move, category: category.id, tags: [], party: r.party, recurring: false });
        continue;
      }
      const t = pick?.template ? r.templates.find(x => x.key === pick.template) : groupTemplate;
      if (t) items.push({ tx: e.tx, move: t.move, category: t.category, tags: t.tags, party: t.party ?? r.party, recurring: t.recurring });
    }
  }
  return items;
}
