import { BANK_LABEL_LIMITS } from '../src/bank-labels-contract';
import type { BankPlan, BankPlanPreview } from '../src/bank-plan-contract';
import type { BankLedger } from './bank-labels';
import { SourceError } from './sources';

/** A refused plan, with a sentence the card shows. */
export class BankPlanError extends SourceError {
  constructor(status: number, message: string) { super(status); this.message = message; }
}

const same = (a: string, b: string) => a.localeCompare(b, 'pl', { sensitivity: 'accent' }) === 0;
/** The tag a folded category's name leaves: lower case, as a tag is written. */
export const tagOf = (name: string) => name.replace(/^#+/, '').replace(/\s+/g, ' ').trim().toLowerCase().slice(0, BANK_LABEL_LIMITS.tag);

/**
 * What a merge would do to the marks kept now (all of them, not a range), before anything is changed. Names are matched
 * exactly (not by a part, as a card of data does): a change must not land on a category the user did not mean. A plan that
 * cannot be carried out says why in `problems`, and the card offers no „Wykonaj” then.
 */
export function planPreview(ledger: BankLedger, plan: BankPlan): BankPlanPreview {
  const spend = ledger.categories.filter(c => c.move === 'spend');
  const problems: string[] = [];
  const sources: BankPlanPreview['sources'] = [];
  const target = spend.find(c => same(c.name, plan.into));
  const spentOf = (id: string) => {
    const own = ledger.entries.filter(e => e.label?.category === id && e.label.move === 'spend' && e.op.currency === 'PLN');
    return { count: own.length, spent: -own.reduce((sum, e) => sum + e.op.amount, 0) };
  };
  for (const name of plan.merge) {
    const found = spend.find(c => same(c.name, name));
    if (!found) { problems.push(`Nie ma kategorii wydatków „${name}”. Kategorie wydatków: ${spend.map(c => c.name).join(', ') || '(brak)'}.`); continue; }
    if (target && found.id === target.id) { problems.push(`„${found.name}” jest kategorią docelową, nie można jej scalić z samą sobą.`); continue; }
    if (sources.some(s => s.id === found.id)) continue;
    sources.push({ id: found.id, name: found.name, ...spentOf(found.id), tag: plan.tags ? tagOf(found.name) : null });
  }
  if (!sources.length && !problems.length) problems.push('Nie ma czego scalić.');
  const into = target ? spentOf(target.id) : { count: 0, spent: 0 };
  const moved = sources.reduce((sum, s) => sum + s.count, 0);
  const movedSpent = sources.reduce((sum, s) => sum + s.spent, 0);
  // A mark keeps at most so many tags: the rest of the plan still goes through without the tag.
  const ids = new Set(sources.map(s => s.id));
  const tagged = plan.tags ? ledger.entries.filter(e => e.label?.category && ids.has(e.label.category) && e.label.tags.length < BANK_LABEL_LIMITS.tagsPerMark).length : 0;
  return {
    into: {
      name: target?.name ?? plan.into, created: !target, color: target?.color ?? 'teal',
      before: into, after: { count: into.count + moved, spent: into.spent + movedSpent },
    },
    sources, moved, tagged, problems,
  };
}
