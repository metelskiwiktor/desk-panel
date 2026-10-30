import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailThread } from '../src/mail-contract';
import type { BankSource } from '../src/bank-contract';
import type { BankLabelsSource } from '../src/bank-labels-contract';
import type { SmartRule } from '../src/smart-rules-contract';
import { alertsOf, buttonLink, createSmartRuleStore, defaultQuery, rulePreview, SEED_RULES, SmartRuleError, smartView } from './smart-rules';

const thread = (over: Partial<MailThread>): MailThread => ({
  id: 'me@x.pl:a1', account: 'me@x.pl', threadId: 'a1', from: 'Nadawca', address: 'nadawca@x.pl', subject: 'Temat', snippet: '',
  body: '', receivedAt: 1_000, messages: 1, sourceUrl: 'https://mail.google.com/mail/u/0/#inbox/a1', ...over,
});
const bill = thread({ id: 'me@x.pl:b1', threadId: 'b1', from: 'INEA', address: 'e-rachunek@inea.com.pl', subject: 'Twój rachunek',
  body: 'Faktura do zapłaty.\nZapłać teraz (https://fakturowanie.inea.com.pl/pay?id=7)\nRegulamin (https://www.inea.com.pl/regulamin)\nKliknij (https://evil.example/inea.com.pl)' });
const offer = thread({ id: 'me@x.pl:b2', threadId: 'b2', from: 'INEA', address: 'oferty@inea.com.pl', subject: 'Nowa oferta światłowodu', receivedAt: 2_000 });
const inea: SmartRule = { id: 'inea-rachunek', name: 'Inea – rachunek', source: 'mail', enabled: true, category: 'payment', priority: 'high', badge: 'Inea',
  match: { from: ['e-rachunek@inea.com.pl'], subject: ['rachunek'] }, button: { label: 'Zapłać rachunek', domain: 'inea.com.pl', contains: 'zapłać' } };

describe('Smart Actions rules', () => {
  it('a mail rule needs every list it has and none of its exclusions', () => {
    const visit = thread({ address: 'noreply@znanylekarz.pl', subject: '❗Ważne: sprawdź, czy szczegóły wizyty się zgadzają' });
    const [seed] = SEED_RULES;
    // The seed is the rule the panel had in code: it catches this mail too (the bug the user asked Wektor to fix).
    expect(alertsOf(SEED_RULES, [{ ...visit, body: 'Szczegóły (https://d.znanylekarz.pl/a)' }])).toHaveLength(1);
    const fixed = { ...seed, match: { ...(seed as Extract<SmartRule, { source: 'mail' }>).match, subjectNot: ['sprawdź, czy szczegóły'] } } as SmartRule;
    expect(alertsOf([fixed], [visit])).toEqual([]);
    // Only what can be done: a mail that matches but has no link for the button gives no alert.
    expect(alertsOf([inea], [{ ...bill, body: 'Termin płatności mija jutro. Numer konta 12 3456.' }])).toEqual([]);
    expect(alertsOf([inea], [bill, offer]).map(a => a.id)).toEqual(['mail:me@x.pl:b1']);
    expect(alertsOf([{ ...inea, enabled: false }], [bill])).toEqual([]);
  });

  it('a button opens only a link of its own domain, the one naming its word first', () => {
    expect(buttonLink(inea.source === 'mail' ? inea.button! : null!, bill)).toEqual({ url: 'https://fakturowanie.inea.com.pl/pay?id=7' });
    // A link that only names the domain in its path is not on it.
    expect(buttonLink({ label: 'X', domain: 'example.com' }, thread({ body: 'Tu (https://example.com.evil.pl/a)' }))).toEqual({ noLink: 'w mailu nie ma linku z domeny example.com' });
    const alert = alertsOf([inea], [bill])[0];
    expect(alert).toMatchObject({ url: 'https://fakturowanie.inea.com.pl/pay?id=7', label: 'Zapłać rachunek', badge: 'Inea', mail: { account: 'me@x.pl', threadId: 'b1' } });
  });

  it('a bank rule shows each operation not done that has a suggestion, every option as a button', () => {
    const bank = { data: { accounts: [], transactions: [
      { id: 't1', accountId: 'a', at: 5_000, amount: -42, currency: 'PLN', title: 'Żabka' },
      { id: 't2', accountId: 'a', at: 4_000, amount: -120, currency: 'PLN', title: 'A. Nowak' },
      { id: 't3', accountId: 'a', at: 3_000, amount: -10, currency: 'PLN', title: 'Bez podpowiedzi' },
    ] } } as unknown as BankSource;
    const labels = { data: {
      categories: [{ id: 'c-food', name: 'Jedzenie' }, { id: 'c-gift', name: 'Prezenty' }], parties: [{ id: 'p-ania', name: 'Ania', identifiers: [] }], labels: {},
      suggestions: {
        t1: { sure: true, options: [{ move: 'spend', category: 'c-food', reasons: ['ten sam tekst w banku'] }] },
        t2: { sure: false, options: [{ move: 'settle', party: 'p-ania', reasons: ['r'] }, { move: 'spend', category: 'c-gift', reasons: ['r'] }] },
      },
    } } as unknown as BankLabelsSource;
    const rule: SmartRule = { id: 'przelewy', name: 'Przelewy', source: 'bank', suggestion: 'dowolna', enabled: true, category: 'payment', priority: 'medium', badge: 'Konto' };
    const alerts = alertsOf([rule], null, { bank, labels });
    expect(alerts.map(a => [a.id, a.bank?.options.map(o => `${o.label}${o.sure ? '!' : ''}`)])).toEqual([
      ['bank:t1', ['Jedzenie!']], ['bank:t2', ['Rozliczenie: Ania', 'Prezenty']],
    ]);
    expect(alertsOf([{ ...rule, suggestion: 'pewna' }], null, { bank, labels }).map(a => a.id)).toEqual(['bank:t1']);
  });

  it('a preview tells what the change does to each test mail, compared with the rule saved now', () => {
    const before = { ...inea, match: { from: ['inea.com.pl'] } } as SmartRule;
    const offerWithLink = { ...offer, body: 'Oferta (https://moja.inea.com.pl/oferta)' };
    const reminder = thread({ threadId: 'b3', address: 'e-rachunek@inea.com.pl', subject: 'Przypomnienie: rachunek', body: 'Numer konta 12 3456.' });
    const preview = rulePreview([before], { rule: inea }, { query: defaultQuery(inea), threads: [bill, offerWithLink, reminder] });
    expect(preview.kind).toBe('change');
    expect(preview.query).toBe('(from:e-rachunek@inea.com.pl) newer_than:180d');
    expect(preview.rows.map(r => [r.threadId, r.caught, r.caughtNow, r.noLink])).toEqual([
      ['b1', true, true, undefined], ['b2', false, true, undefined], ['b3', false, false, 'pasuje, ale w mailu nie ma linku z domeny inea.com.pl'],
    ]);
    expect(rulePreview([], { remove: 'nope' }, null).problems[0]).toMatch(/Nie ma reguły nope/);
  });

  it('the store saves a plan in one write and keeps rules across restarts', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'smart-')), 'smart-rules.json');
    const store = createSmartRuleStore(file);
    expect(store.list().map(r => r.id)).toEqual(['znanylekarz-confirm']);
    store.apply({ rule: inea });
    store.toggle('znanylekarz-confirm', false);
    expect(createSmartRuleStore(file).list().map(r => [r.id, r.enabled])).toEqual([['znanylekarz-confirm', false], ['inea-rachunek', true]]);
    store.apply({ remove: 'inea-rachunek' });
    expect(JSON.parse(readFileSync(file, 'utf8')).rules).toHaveLength(1);
    expect(() => store.apply({ rule: { ...inea, id: 'znanylekarz-confirm', source: 'bank', suggestion: 'dowolna' } as SmartRule })).toThrow(SmartRuleError);
  });
});


it('expires automation alerts after 30 days and removes cancelled automations immediately', async () => {
  const now = Date.parse('2026-10-30T12:00:00Z');
  const time = vi.spyOn(Date, 'now').mockReturnValue(now);
  const action = { kind: 'smartAction', result: 'ok', ref: 'recent', at: now, title: 'Recent' };
  const sources = { mail: async () => ({ data: [] }), automations: async () => ({ automations: [
    { id: 'active', name: 'A', status: 'active', runs: [{ actions: [action, { ...action, ref: 'old', at: now - 30 * 24 * 60 * 60_000 - 1 }] }] },
    { id: 'cancelled', name: 'B', status: 'cancelled', runs: [{ actions: [{ ...action, ref: 'cancelled' }] }] },
  ] }) } as unknown as import('./sources').PanelSources;
  try { expect((await smartView(sources)).alerts.map(x => x.id)).toEqual(['recent']); }
  finally { time.mockRestore(); }
});
