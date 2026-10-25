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

/** What an empty tile offers, in this order: the limits, then Cezar, mail and the computer; nothing that is already placed. */
export function pickable(cards: QuotaCardItem[], placed: string[], available: (kind: string) => boolean): string[] {
  return [...limitKinds(cards), 'cezar', 'mail', 'system'].filter(kind => !placed.includes(kind) && available(kind));
}
