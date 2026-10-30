import { describe, expect, it } from 'vitest';
import { bankShow, bankShowSummary, BankShowError } from './bank-show';
import type { BankLedger } from './bank-labels';

const op = (day: string, amount: number, name: string, currency = 'PLN') => ({ at: Date.parse(`${day}T12:00:00Z`), amount, currency, name, method: 'card' as const, merchant: null, keys: [] });
const entry = (tx: string, day: string, amount: number, name: string, category: string | null, extra: { currency?: string; move?: 'spend' | 'income'; tags?: string[] } = {}) => ({
  tx, op: op(day, amount, name, extra.currency), known: null, suggestion: null, pending: false, inReading: true,
  label: category ? { move: extra.move ?? 'spend' as const, category, tags: extra.tags ?? [], party: null, recurring: false, comment: '' } : null,
});
const ledger: BankLedger = {
  observedAt: 1, since: '2026-01-01', parties: [], balances: [], tags: [],
  categories: [
    { id: 'c-1', name: 'Psycholog', move: 'spend', color: 'violet', icon: 'brain' }, { id: 'c-2', name: 'Podolog', move: 'spend', color: 'brown', icon: 'tag' },
    { id: 'c-3', name: 'Apteka', move: 'spend', color: 'red', icon: 'heart' }, { id: 'c-4', name: 'Pensja', move: 'income', color: 'green', icon: 'banknote' },
  ] as BankLedger['categories'],
  entries: [
    entry('a', '2026-10-20', -150, 'Gabinet Anna K. 48123456789', 'c-1', { tags: ['terapia'] }), entry('b', '2026-09-20', -150, 'Gabinet Anna K.', 'c-1'),
    entry('c', '2026-10-01', -120, 'Podolog Kowalski', 'c-2'), entry('d', '2026-10-05', -45.5, 'Apteka Gemini', 'c-3'),
    entry('e', '2026-10-10', 30, 'Zwrot', 'c-1'), entry('f', '2026-10-11', -100, 'Gabinet EUR', 'c-1', { currency: 'EUR' }), entry('g', '2026-10-02', 9000, 'Wypłata', 'c-4', { move: 'income' }), entry('h', '2026-10-03', -60, 'Yatta', null),
  ],
};

describe('bank card data', () => {
  it('matches categories by a part of the name, sums spending (a refund lowers it) and leaves other moves and currencies out', () => {
    const data = bankShow(ledger, { view: 'tabela', nieoznaczone: false, kategorie: ['psych', 'podo', 'lekarz'] }, '2026-10-29');
    expect(data.categories.map(c => [c.name, c.count, c.spent])).toEqual([['Psycholog', 3, 270], ['Podolog', 1, 120]]);
    expect(data.unknown).toEqual(['lekarz']);
    expect(data.total).toEqual({ count: 4, spent: 390 });
    expect(data.rows).toHaveLength(4);
  });

  it('masks long digit runs, keeps the range and says how many rows were not shown', () => {
    const data = bankShow(ledger, { view: 'słupki', nieoznaczone: false, kategorie: ['Psycholog'], from: '2026-10-01', to: '2026-10-29' }, '2026-10-29');
    expect(JSON.stringify(data)).not.toMatch(/48123456789/);
    expect(data).toMatchObject({ view: 'słupki', from: '2026-10-01', to: '2026-10-29', hidden: 0, total: { count: 2 } });
  });

  it('adds the unmarked outflows as one more row of the card, alone or beside categories', () => {
    const only = bankShow(ledger, { view: 'tabela', kategorie: [], nieoznaczone: true }, '2026-10-29');
    expect(only.categories).toEqual([{ id: 'unmarked', name: 'Nieoznaczone', color: 'slate', count: 1, spent: 60 }]);
    expect(only.rows).toMatchObject([{ day: '2026-10-03', amount: -60, name: 'Yatta', category: 'Nieoznaczone' }]);
    const both = bankShow(ledger, { view: 'tabela', kategorie: ['podo'], nieoznaczone: true }, '2026-10-29');
    expect(both.categories.map(c => c.name)).toEqual(['Podolog', 'Nieoznaczone']);
    expect(both.rows.map(r => r.day)).toEqual(['2026-10-03', '2026-10-01']);
    expect(both.total).toEqual({ count: 2, spent: 180 });
  });

  it('refuses a question that matches nothing with the names there are, and a range that is not one', () => {
    expect(() => bankShow(ledger, { view: 'tabela', nieoznaczone: false, kategorie: ['lekarz'] }, '2026-10-29')).toThrow(/Psycholog, Podolog, Apteka/);
    expect(() => bankShow(ledger, { view: 'tabela', nieoznaczone: false, kategorie: ['psych'], from: '2026-10-29', to: '2026-10-01' }, '2026-10-29')).toThrow(BankShowError);
    expect(() => bankShow(ledger, { view: 'tabela', nieoznaczone: false, kategorie: ['psych'], from: '2024-01-01', to: '2026-10-29' }, '2026-10-29')).toThrow(/najwyżej/);
  });

  it('tells the model a summary with the names of what each category holds, not the rows, and with the other spending categories so it can notice a related one itself', () => {
    const data = bankShow(ledger, { view: 'tabela', nieoznaczone: false, kategorie: ['psych', 'podo'] }, '2026-10-29');
    const summary = bankShowSummary(ledger, data);
    expect(summary).toContain('Razem 4 operacji');
    expect(summary).toMatch(/Psycholog 3 op\. 270,00 zł \(Gabinet Anna K\./);
    expect(summary).toContain('Podolog 1 op. 120,00 zł (Podolog Kowalski)');
    expect(summary).toContain('Oznaczenia w tym zakresie zaczynają się 2026-09-20; nieoznaczonych wydatków: 1 op. 60,00 zł (od 2026-10-03 do 2026-10-03)');
    expect(summary).toContain('same operacje od 2026-09-20 do 2026-10-20');
    expect(summary).toContain('Inne kategorie wydatków w tym zakresie: Apteka 1 op. 45,50 zł (Apteka Gemini)');
    // names of what it holds, never the rows: no single operation's amount is told
    expect(summary).not.toContain('150,00');
  });
});
