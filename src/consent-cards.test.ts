import { describe, expect, it } from 'vitest';
import { supersededConsentCards, type ConsentProposal } from './consent-cards';

const proposal = (id: string, name: string, args: unknown): ConsentProposal => ({ id, name, args });

const rule = (id: string, name: string) => ({
  tytul: 'Reguła',
  rule: { id, name, source: 'mail', enabled: true, category: 'payment', priority: 'high', badge: 'X',
    match: { from: ['x@example.com'] }, button: { label: 'Otwórz', domain: 'example.com' } },
  q: 'from:example.com',
});

const automation = (name: string) => ({
  name, goal: 'Sprawdź.', trigger: { kind: 'daily', time: '07:00' }, actions: [{ kind: 'message' }], learn: false,
});

describe('superseded consent cards', () => {
  it('identifies a Smart Actions rule by its id, not by a display name two rules can share', () => {
    const calls = [
      proposal('m1:s1', 'panel_smart_rule_propose', rule('rule-a', 'Ta sama nazwa')),
      proposal('m2:s2', 'panel_smart_rule_propose', rule('rule-b', 'Ta sama nazwa')),
    ];
    expect(supersededConsentCards(calls)).toEqual(new Set());
  });

  it('replaces a new automation only with another proposal of the same name', () => {
    const same = [
      proposal('m1:a1', 'panel_automation_propose', automation('Ceny')),
      proposal('m2:a2', 'panel_automation_propose', automation('  ceny ')),
    ];
    expect(supersededConsentCards(same)).toEqual(new Set(['m1:a1']));
    const different = [
      proposal('m1:a1', 'panel_automation_propose', automation('Ceny')),
      proposal('m2:a2', 'panel_automation_propose', automation('Pogoda')),
    ];
    expect(supersededConsentCards(different)).toEqual(new Set());
  });

  it('keeps A when the same card appears again after B (A -> B -> A)', () => {
    const calls = [
      proposal('m1:a1', 'panel_bank_propose', { tytul: 'A' }),
      proposal('m2:b1', 'panel_bank_propose', { tytul: 'B' }),
      proposal('m1:a1', 'panel_bank_propose', { tytul: 'A' }),
    ];
    expect(supersededConsentCards(calls)).toEqual(new Set(['m2:b1']));
  });
});
