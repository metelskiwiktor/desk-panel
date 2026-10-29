import { createHash } from 'node:crypto';
import { isDone, type BankOption } from '../src/bank-labels-contract';
import { BANK_ASSIGN_LIMITS, type BankAssign, type BankAssignGroup, type BankAssignPreview } from '../src/bank-assign-contract';
import type { BankLedger } from './bank-labels';
import { dayIn } from './bank-show';

const ZONE = 'Europe/Warsaw';

/** One group's identity is the mark it suggests, so a key stays the same while the operations in it change. */
const keyOf = (o: BankOption) => `g-${createHash('sha256').update(JSON.stringify([o.move ?? null, o.category ?? null, [...(o.tags ?? [])].map(t => t.toLowerCase()).sort(), o.party ?? null])).digest('hex').slice(0, 8)}`;

/**
 * The operations not yet marked that have a sure suggestion in the range, grouped by what it says. `txs` is every operation of
 * the group (the preview shows a few); the apply step takes them from here, worked out again from what is kept now.
 */
export function assignGroups(ledger: BankLedger, plan: BankAssign): { groups: (BankAssignGroup & { txs: string[] })[]; choices: BankAssignPreview['choices'] } {
  const inRange = (at: number) => { const d = dayIn(at, ZONE); return (!plan.from || d >= plan.from) && (!plan.to || d <= plan.to); };
  const byKey = new Map<string, BankAssignGroup & { txs: string[] }>();
  const choices = { count: 0, total: 0 };
  const entries = [...ledger.entries].sort((a, b) => b.op.at - a.op.at);
  for (const e of entries) {
    if (isDone(e.label) || !e.suggestion || !inRange(e.op.at)) continue;
    const pln = e.op.currency === 'PLN' ? e.op.amount : 0;
    if (!e.suggestion.sure) { choices.count++; choices.total += pln; continue; }
    const option = e.suggestion.options[0];
    const key = keyOf(option);
    let group = byKey.get(key);
    if (!group) {
      const category = option.category ? ledger.categories.find(c => c.id === option.category) : undefined;
      group = {
        key, move: option.move ?? 'spend', category: category ? { name: category.name, color: category.color, icon: category.icon } : null,
        party: option.party ? ledger.parties.find(p => p.id === option.party)?.name ?? null : null,
        tags: option.tags ?? [], count: 0, total: 0, why: option.reasons[0] ?? '', items: [], hidden: 0, txs: [],
      };
      byKey.set(key, group);
    }
    group.count++; group.total += pln; group.txs.push(e.tx);
    if (group.items.length < BANK_ASSIGN_LIMITS.items) group.items.push({ day: dayIn(e.op.at, ZONE), name: e.op.name, amount: e.op.amount });
    else group.hidden++;
  }
  const groups = [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  for (const g of groups) g.total = Math.round(g.total * 100) / 100;
  choices.total = Math.round(choices.total * 100) / 100;
  return { groups, choices };
}

/** What the card shows: the groups without the full lists of operations. */
export function assignPreview(ledger: BankLedger, plan: BankAssign): BankAssignPreview {
  const { groups, choices } = assignGroups(ledger, plan);
  const problems = groups.length ? [] : [choices.count
    ? `Nie ma operacji z pewną podpowiedzią w tym zakresie; ${choices.count} ma tylko propozycje do wyboru, które użytkownik wybiera sam.`
    : 'Nie ma nieoznaczonych operacji z podpowiedzią w tym zakresie.'];
  return { groups: groups.map(({ txs: _txs, ...g }) => g), choices, problems };
}

/** The operations to mark: every sure suggestion in the range, except the groups the user unticked. */
export function assignTxs(ledger: BankLedger, plan: BankAssign, skip: readonly string[] = []): { txs: string[]; groups: number } {
  const chosen = assignGroups(ledger, plan).groups.filter(g => !skip.includes(g.key));
  return { txs: chosen.flatMap(g => g.txs), groups: chosen.length };
}
