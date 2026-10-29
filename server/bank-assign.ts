import { createHash } from 'node:crypto';
import { isDone, type BankOption } from '../src/bank-labels-contract';
import { BANK_ASSIGN_LIMITS, type BankAssign, type BankAssignChoice, type BankAssignGroup, type BankAssignMark, type BankAssignPreview } from '../src/bank-assign-contract';
import type { BankLedger } from './bank-labels';
import { dayIn } from './bank-show';

const ZONE = 'Europe/Warsaw';

/** One group's identity is the mark it suggests, so a key stays the same while the operations in it change. */
const keyOf = (o: BankOption) => `g-${createHash('sha256').update(JSON.stringify([o.move ?? null, o.category ?? null, [...(o.tags ?? [])].map(t => t.toLowerCase()).sort(), o.party ?? null])).digest('hex').slice(0, 8)}`;

const markOf = (ledger: BankLedger, o: BankOption): BankAssignMark => {
  const category = o.category ? ledger.categories.find(c => c.id === o.category) : undefined;
  return {
    move: o.move ?? 'spend', category: category ? { name: category.name, color: category.color, icon: category.icon } : null,
    party: o.party ? ledger.parties.find(p => p.id === o.party)?.name ?? null : null, tags: o.tags ?? [],
  };
};

interface Worked {
  groups: (BankAssignGroup & { txs: string[] })[];
  choices: BankAssignChoice[];
  choiceTotal: number;
  span: { first: string | null; last: string | null };
}

/**
 * The operations not yet marked that have a suggestion in the range: the sure ones grouped by what the suggestion says, the
 * others apart as choices. `txs` is every operation of a group; the apply step takes them from here, worked out again from
 * what is kept now.
 */
function work(ledger: BankLedger, plan: BankAssign): Worked {
  const inRange = (at: number) => { const d = dayIn(at, ZONE); return (!plan.from || d >= plan.from) && (!plan.to || d <= plan.to); };
  const byKey = new Map<string, BankAssignGroup & { txs: string[] }>();
  const choices: BankAssignChoice[] = [];
  let choiceTotal = 0;
  const days: string[] = [];
  for (const e of [...ledger.entries].sort((a, b) => b.op.at - a.op.at)) {
    if (isDone(e.label) || !e.suggestion || !inRange(e.op.at)) continue;
    const pln = e.op.currency === 'PLN' ? e.op.amount : 0;
    const item = { tx: e.tx, day: dayIn(e.op.at, ZONE), name: e.op.name, amount: e.op.amount };
    days.push(item.day);
    if (!e.suggestion.sure) {
      choiceTotal += pln;
      choices.push({ ...item, why: e.suggestion.options[0].reasons.at(-1) ?? '', options: e.suggestion.options.map(o => markOf(ledger, o)) });
      continue;
    }
    const option = e.suggestion.options[0];
    const key = keyOf(option);
    let group = byKey.get(key);
    if (!group) {
      group = { key, ...markOf(ledger, option), count: 0, total: 0, why: option.reasons[0] ?? '', items: [], hidden: 0, txs: [] };
      byKey.set(key, group);
    }
    group.count++; group.total += pln; group.txs.push(e.tx);
    if (group.items.length < BANK_ASSIGN_LIMITS.items) group.items.push(item); else group.hidden++;
  }
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  for (const g of groups) g.total = Math.round(g.total * 100) / 100;
  days.sort();
  return { groups, choices, choiceTotal: Math.round(choiceTotal * 100) / 100, span: { first: days[0] ?? null, last: days.at(-1) ?? null } };
}

/** What the card shows: the groups without the full lists of operations. */
export function assignPreview(ledger: BankLedger, plan: BankAssign): BankAssignPreview {
  const { groups, choices, choiceTotal, span } = work(ledger, plan);
  return {
    range: { from: plan.from ?? null, to: plan.to ?? null, ...span },
    groups: groups.map(({ txs: _txs, ...g }) => g),
    choices: { count: choices.length, total: choiceTotal, items: choices.slice(0, BANK_ASSIGN_LIMITS.choices) },
    problems: groups.length || choices.length ? [] : ['Nie ma nieoznaczonych operacji z podpowiedzią w tym zakresie.'],
  };
}

export interface AssignChoice { skip?: readonly string[]; skipOps?: readonly string[]; picks?: readonly { tx: string; option: number }[] }

/**
 * What to mark: every sure suggestion in the range except the groups and operations the user unticked, and the options the
 * user picked for operations that are choices now (a pick of an option that is not there any more is dropped).
 */
export function assignTxs(ledger: BankLedger, plan: BankAssign, choice: AssignChoice = {}): { txs: string[]; picks: { tx: string; option: number }[]; groups: number } {
  const worked = work(ledger, plan);
  const chosen = worked.groups.filter(g => !choice.skip?.includes(g.key));
  const txs = chosen.flatMap(g => g.txs).filter(tx => !choice.skipOps?.includes(tx));
  const picks = (choice.picks ?? []).filter(p => worked.choices.some(c => c.tx === p.tx && p.option < c.options.length));
  return { txs, picks: [...picks], groups: chosen.length };
}
