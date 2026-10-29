import type { Provider, QuotaAccount, QuotaSnapshot } from './model';
import { sortSnapshots } from './quota-pace';

/** One limit as the dashboard shows it: a provider, or one of the model groups of Antigravity. */
export interface QuotaCardItem {
  id: string;
  provider: Provider;
  title: string;
  badge?: string;
  snapshots: QuotaSnapshot[];
  reason?: string | null;
}

export function getQuotaCards(accounts: QuotaAccount[] | null): QuotaCardItem[] {
  if (!accounts) return [];
  const cards: QuotaCardItem[] = [];
  for (const account of accounts) {
    if (account.provider !== 'AGY') {
      cards.push({ id: account.provider, provider: account.provider, title: account.provider, snapshots: sortSnapshots(account.snapshots), reason: account.reason });
      continue;
    }
    const groups = new Map<string, QuotaSnapshot[]>();
    for (const s of account.snapshots) {
      const groupName = s.model || 'Gemini Models';
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName)!.push(s);
    }
    if (groups.size === 0) {
      cards.push({ id: 'agy-empty', provider: 'AGY', title: 'Gemini', snapshots: [], reason: account.reason });
      continue;
    }
    for (const [model, snapshots] of groups.entries()) {
      let title = model;
      let badge: string | undefined;
      if (model === 'Gemini Models' || model === 'Gemini') title = 'Gemini';
      else if (model === 'Claude and GPT models' || model === 'Claude & GPT') title = 'Agy: Claude & GPT';
      else if (model.includes('Argon')) { title = 'Gemini 4 Argon'; badge = 'frontier'; }
      cards.push({ id: `agy:${model}`, provider: 'AGY', title, badge, snapshots: sortSnapshots(snapshots) });
    }
  }
  return cards;
}
