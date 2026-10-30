import { BANK_COLORS, BANK_ICONS, BANK_LABEL_LIMITS } from '../src/bank-labels-contract';
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
    const tag = plan.tags ? tagOf(found.name) : null;
    const counts = new Map<string, number>();
    for (const e of ledger.entries) if (e.label?.category === found.id) for (const t of e.label.tags) if (!tag || !same(t, tag)) counts.set(t, (counts.get(t) ?? 0) + 1);
    sources.push({
      id: found.id, name: found.name, color: found.color, ...spentOf(found.id), tag,
      tagState: tag ? ledger.tags.some(t => same(t, tag)) ? 'exists' : 'new' : null,
      keeps: [...counts].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t]) => t),
    });
  }
  if (!sources.length && !problems.length) problems.push('Nie ma czego scalić.');
  const into = target ? spentOf(target.id) : { count: 0, spent: 0 };
  const moved = sources.reduce((sum, s) => sum + s.count, 0);
  const movedSpent = sources.reduce((sum, s) => sum + s.spent, 0);
  // A mark keeps at most so many tags: the rest of the plan still goes through without the tag.
  const byCategory = new Map(sources.map(s => [s.id, s]));
  let tagged = 0, noTag = 0;
  if (plan.tags) for (const e of ledger.entries) {
    const source = e.label?.category ? byCategory.get(e.label.category) : undefined;
    if (!source?.tag || e.label!.tags.some(t => same(t, source.tag!))) continue;
    if (e.label!.tags.length < BANK_LABEL_LIMITS.tagsPerMark) tagged++; else noTag++;
  }
  const used = new Set(ledger.categories.map(c => c.color));
  return {
    into: {
      name: target?.name ?? plan.into, created: !target,
      color: target?.color ?? BANK_COLORS.find(c => !used.has(c)) ?? BANK_COLORS[ledger.categories.length % BANK_COLORS.length],
      icon: target?.icon ?? BANK_ICONS[0],
      before: into, after: { count: into.count + moved, spent: into.spent + movedSpent },
    },
    sources, moved, tagged, noTag, problems,
  };
}
