import { describe, expect, it } from 'vitest';
import type { WidgetId } from './layout';
import type { QuotaCardItem } from './quota-cards';
import { defaultQuotaVisibility } from './quota-visibility';
import { kindAvailable, kindOfCard, limitKinds, pickable } from './workspace-kinds';

const allOn = (_: WidgetId) => true;
const card = (id: string): QuotaCardItem => ({ id, provider: id.startsWith('agy:') ? 'AGY' : id as 'Claude', title: id, snapshots: [] });

describe('which kinds the settings allow', () => {
  const hidden = { hiddenProviders: ['Codex' as const], hiddenAgyGroups: ['Gemini 4 Argon'] };
  it('follows the section switches of the dashboard', () => {
    const only = (...ids: WidgetId[]) => (id: WidgetId) => ids.includes(id);
    expect(kindAvailable('cezar', only('mail'), defaultQuotaVisibility())).toBe(false);
    expect(kindAvailable('mail', only('mail'), defaultQuotaVisibility())).toBe(true);
    expect(kindAvailable('system', only('mail'), defaultQuotaVisibility())).toBe(false);
    expect(kindAvailable('quota:Claude', only('mail'), defaultQuotaVisibility())).toBe(false);
    expect(kindAvailable('quota:Claude', only('quotas'), defaultQuotaVisibility())).toBe(true);
  });
  it('follows the limits the quota settings hide, one by one', () => {
    expect(kindAvailable('quota:Claude', allOn, hidden)).toBe(true);
    expect(kindAvailable('quota:Codex', allOn, hidden)).toBe(false);
    expect(kindAvailable('quota:agy:Gemini 4 Argon', allOn, hidden)).toBe(false);
    expect(kindAvailable('quota:agy:Claude and GPT models', allOn, hidden)).toBe(true);
    expect(kindAvailable('quota:agy:Gemini Models', allOn, hidden)).toBe(true);
  });
  it('does not know a kind it was not made for', () => {
    expect(kindAvailable('github', allOn, defaultQuotaVisibility())).toBe(false);
  });
});

describe('what an empty tile offers', () => {
  const cards = [card('Claude'), card('Codex'), card('agy:Gemini Models'), card('agy:Gemini 4 Argon')];
  it('is every limit first (Claude and Codex even before the first reading), then Cezar, mail and the computer', () => {
    expect(limitKinds([])).toEqual(['quota:Claude', 'quota:Codex']);
    expect(pickable(cards, [], () => true)).toEqual([
      'quota:Claude', 'quota:Codex', 'quota:agy:Gemini Models', 'quota:agy:Gemini 4 Argon', 'cezar', 'mail', 'system']);
    expect(kindOfCard(cards[2])).toBe('quota:agy:Gemini Models');
  });
  it('leaves out what is already on the grid and what the settings switched off', () => {
    expect(pickable(cards, ['quota:Claude', 'mail'], kind => kind !== 'system' && kind !== 'quota:agy:Gemini 4 Argon'))
      .toEqual(['quota:Codex', 'quota:agy:Gemini Models', 'cezar']);
  });
});
