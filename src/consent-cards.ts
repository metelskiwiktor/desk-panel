import { automationPlanSchema } from './automation-contract';
import { panelToolName } from './cockpit-contract';
import { smartRulePlanSchema } from './smart-rules-contract';

/**
 * Consent cards of a conversation and which of them were replaced: Wektor may propose the same change again in one
 * conversation (an Inea rule revised a few times), and the older card must not stay actionable. The same rule decides here
 * for the window (its cards) and for the server (the routes that apply a card), so they cannot drift apart.
 */

/** One proposal card of a conversation, in the order it appeared: its tool call, its tool's name and its arguments. */
export interface ConsentProposal {
  id: string;
  name: string;
  /** The arguments as the model wrote them: parsed, or the JSON text a stored tool call keeps. */
  args: unknown;
  /** False when the panel refused the call: a card it never accepted replaces nothing. */
  accepted?: boolean;
}

type Kind = 'smartRule' | 'bankPlan' | 'bankAssign' | 'automation';

/** The card kinds by their tool names, as the panel tools are called and as the window names their cards. */
const KINDS: Record<string, Kind> = {
  panel_smart_rule_propose: 'smartRule',
  panel_bank_propose: 'bankPlan',
  panel_bank_assign: 'bankAssign',
  panel_automation_propose: 'automation',
  smart_rule: 'smartRule',
  bank_plan: 'bankPlan',
  bank_assign: 'bankAssign',
  automation: 'automation',
};

const objectOf = (args: unknown): Record<string, unknown> | null => {
  let value = args;
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
};

/**
 * What a proposal is about. A later proposal replaces an earlier one that shares a target: the same Smart Actions rule
 * (its id when it has one, otherwise its name), the same automation (the one `replaces` updates, or a new automation of
 * the same name), or any later bank card of the same kind. Null: not a proposal this rule covers.
 */
function targets(kind: Kind, args: Record<string, unknown>): string[] | null {
  if (kind === 'bankPlan' || kind === 'bankAssign') return ['*'];
  if (kind === 'smartRule') {
    const { tytul: _title, refused: _refused, ...rest } = args;
    const plan = smartRulePlanSchema.safeParse(rest);
    if (!plan.success) return null;
    if ('remove' in plan.data) return [`id:${plan.data.remove}`];
    const rule = plan.data.rule;
    return [rule.id ? `id:${rule.id}` : `name:${rule.name.trim().toLowerCase()}`];
  }
  const plan = automationPlanSchema.safeParse(args);
  if (!plan.success) return null;
  return plan.data.replaces ? [`id:${plan.data.replaces}`] : [`name:${plan.data.name.trim().toLowerCase()}`];
}

/**
 * The ids of the conversation's consent cards that a later proposal of the same kind and target replaced. Only cards the
 * user could answer count: not one the panel refused, not one with arguments of another shape, not one still without
 * the chat's own id (`pending:`, or Hermes's raw call id).
 */
export function supersededConsentCards(calls: readonly ConsentProposal[]): Set<string> {
  const proposals = calls.flatMap(call => {
    const kind = KINDS[panelToolName(call.name)] as Kind | undefined;
    const args = kind ? objectOf(call.args) : null;
    // A card the panel refused says so in its arguments; a stored tool call carries the same refusal as `accepted: false`.
    const refused = !!args && 'refused' in args && !!args.refused;
    const target = kind && args && call.accepted !== false && !refused && !call.id.startsWith('pending:') && call.id.includes(':') ? targets(kind, args) : null;
    return kind && target ? [{ id: call.id, kind, target }] : [];
  });
  // One card per id: its last occurrence is where it stands. A card is replaced only by a different card of the same
  // target that comes later, so A -> B -> A keeps A and replaces B.
  const last = new Map<string, { card: typeof proposals[number]; at: number }>();
  proposals.forEach((card, at) => {
    const known = last.get(card.id);
    if (known) known.at = at;
    else last.set(card.id, { card, at });
  });
  const cards = [...last.values()];
  const out = new Set<string>();
  for (const card of cards) {
    if (cards.some(later => later.card.id !== card.card.id && later.at > card.at && later.card.kind === card.card.kind && later.card.target.some(t => card.card.target.includes(t)))) out.add(card.card.id);
  }
  return out;
}
