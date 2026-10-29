import { describe, expect, it } from 'vitest';
import { bankShow, bankShowSummary, BankShowError } from './bank-show';
import type { BankLedger } from './bank-labels';

const op = (day: string, amount: number, name: string, currency = 'PLN') => ({ at: Date.parse(`${day}T12:00:00Z`), amount, currency, name, method: 'card' as const, merchant: null, keys: [] });
const entry = (tx: string, day: string, amount: number, name: string, category: string | null, extra: { currency?: string; move?: 'spend' | 'income'; tags?: string[] } = {}) => ({
  tx, op: op(day, amount, name, extra.currency), known: null, suggestion: null, pending: false, inReading: true,
  label: category ? { move: extra.move ?? 'spend' as const, category, tags: extra.tags ?? [], party: null, recurring: false, comment: '' } : null,
});
const ledger: BankLedger = {
  observedAt: 1, since: '2026-01-01', parties: [], balances: [],
  categories: [
    { id: 'c-1', name: 'Psycholog', move: 'spend', color: 'violet', icon: 'brain' }, { id: 'c-2', name: 'Podolog', move: 'spend', color: 'brown', icon: 'tag' },
    { id: 'c-3', name: 'Apteka', move: 'spend', color: 'red', icon: 'heartPulse' }, { id: 'c-4', name: 'Pensja', move: 'income', color: 'green', icon: 'banknote' },
  ] as BankLedger['categories'],
  entries: [
    entry('a', '2026-10-20', -150, 'Gabinet Anna K. 48123456789', 'c-1', { tags: ['terapia'] }), entry('b', '2026-09-20', -150, 'Gabinet Anna K.', 'c-1'),
    entry('c', '2026-10-01', -120, 'Podolog Kowalski', 'c-2'), entry('d', '2026-10-05', -45.5, 'Apteka Gemini', 'c-3'),
    entry('e', '2026-10-10', 30, 'Zwrot', 'c-1'), entry('f', '2026-10-11', -100, 'Gabinet EUR', 'c-1', { currency: 'EUR' }), entry('g', '2026-10-02', 9000, 'Wypłata', 'c-4', { move: 'income' }),
  ],
};

describe('bank card data', () => {
  it('matches categories by a part of the name, sums spending (a refund lowers it) and leaves other moves and currencies out', () => {
    const data = bankShow(ledger, { widok: 'tabela', kategorie: ['psych', 'podo', 'lekarz'] }, '2026-10-29');
    expect(data.categories.map(c => [c.name, c.count, c.spent])).toEqual([['Psycholog', 3, 270], ['Podolog', 1, 120]]);
    expect(data.unknown).toEqual(['lekarz']);
    expect(data.total).toEqual({ count: 4, spent: 390 });
    expect(data.rows).toHaveLength(4);
  });

  it('masks long digit runs, keeps the range and says how many rows were not shown', () => {
    const data = bankShow(ledger, { widok: 'słupki', kategorie: ['Psycholog'], from: '2026-10-01', to: '2026-10-29' }, '2026-10-29');
    expect(JSON.stringify(data)).not.toMatch(/48123456789/);
    expect(data).toMatchObject({ view: 'słupki', from: '2026-10-01', to: '2026-10-29', hidden: 0, total: { count: 2 } });
  });

  it('refuses a question that matches nothing with the names there are, and a range that is not one', () => {
    expect(() => bankShow(ledger, { widok: 'tabela', kategorie: ['lekarz'] }, '2026-10-29')).toThrow(/Psycholog, Podolog, Apteka/);
    expect(() => bankShow(ledger, { widok: 'tabela', kategorie: ['psych'], from: '2026-10-29', to: '2026-10-01' }, '2026-10-29')).toThrow(BankShowError);
    expect(() => bankShow(ledger, { widok: 'tabela', kategorie: ['psych'], from: '2024-01-01', to: '2026-10-29' }, '2026-10-29')).toThrow(/najwyżej/);
  });

  it('tells the model only a summary, with the other spending categories so it can notice a related one itself', () => {
    const data = bankShow(ledger, { widok: 'tabela', kategorie: ['psych', 'podo'] }, '2026-10-29');
    const summary = bankShowSummary(ledger, data);
    expect(summary).toContain('Razem 4 operacji');
    expect(summary).toContain('Inne kategorie wydatków w tym zakresie: Apteka 1 op. 45,50 zł');
    expect(summary).not.toContain('Gabinet');
  });
});
