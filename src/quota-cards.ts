import type { Provider, QuotaAccount, QuotaSnapshot } from './model';
import { normalizeQuotaWindow, sortSnapshots } from './quota-pace';
import { breakdownPieces } from './UsageBreakdownCard';
import type { UsageBreakdownState } from './useUsageBreakdown';

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

const BREAKDOWN_RESET_SLACK_MS = 10 * 60_000;
/** The 5h usage in source colours when the breakdown describes the same window; otherwise it stays one colour. */
export function splitFor(snapshot: QuotaSnapshot, card: QuotaCardItem, usage: UsageBreakdownState) {
  const name = card.provider === 'AGY' ? (card.title === 'Gemini' ? 'Gemini' : null) : card.provider;
  const provider = usage.status === 'offline' ? undefined : usage.providers.find(p => p.provider === name);
  if (!provider || provider.usedPercent === null || normalizeQuotaWindow(snapshot.window) !== '5h' || !provider.segments.length) return undefined;
  if (snapshot.resetAt && provider.resetAt && Math.abs(snapshot.resetAt - provider.resetAt) > BREAKDOWN_RESET_SLACK_MS) return undefined;
  return breakdownPieces(provider);
}
