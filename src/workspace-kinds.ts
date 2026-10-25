import type { WidgetId } from './layout';
import type { QuotaCardItem } from './quota-cards';
import type { QuotaVisibility } from './quota-visibility';

/** What a tile can show: 'cezar', 'mail', 'system', or one AI limit as `quota:<card id>` (Claude, Codex, agy:<model group>). */
export const kindOfCard = (card: QuotaCardItem) => `quota:${card.id}`;

/** Whether the settings let the tile exist at all; a tile of a switched-off kind leaves the layout and is not offered. */
export function kindAvailable(kind: string, visible: (id: WidgetId) => boolean, hidden: QuotaVisibility): boolean {
  if (kind === 'cezar') return visible('cezar');
  if (kind === 'mail') return visible('mail');
  if (kind === 'system') return visible('system');
  if (!kind.startsWith('quota:') || !visible('quotas')) return false;
  const id = kind.slice('quota:'.length);
  if (id === 'Claude' || id === 'Codex') return !hidden.hiddenProviders.includes(id);
  return !(id.startsWith('agy:') && hidden.hiddenAgyGroups.includes(id.slice('agy:'.length)));
}

/** Claude and Codex are always on offer; the Antigravity groups only once the account has reported them. */
const LIMITS_OF_EVERY_ACCOUNT = ['quota:Claude', 'quota:Codex'];
export const limitKinds = (cards: QuotaCardItem[]) => [...new Set([...LIMITS_OF_EVERY_ACCOUNT, ...cards.map(kindOfCard)])];

/**
 * Widgets that can stand on the grid several times, each tile with its own settings (its own id, see tile-grid.ts).
 * Every other widget is one thing and stands once. None yet: the to-do lists will be the first.
 */
export const MULTI_KINDS: readonly string[] = [];

/**
 * What an empty tile offers, in this order: the limits, then Cezar, mail and the computer, then the widgets that may
 * repeat. A widget that stands once is offered only while it is not placed; one that may repeat is always offered.
 */
export function pickable(cards: QuotaCardItem[], placed: string[], available: (kind: string) => boolean, multi: readonly string[] = MULTI_KINDS): string[] {
  const kinds = [...new Set([...limitKinds(cards), 'cezar', 'mail', 'system', ...multi])];
  return kinds.filter(kind => (multi.includes(kind) || !placed.includes(kind)) && available(kind));
}
