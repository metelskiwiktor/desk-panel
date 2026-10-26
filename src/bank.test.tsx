import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankTile, dayHeading, dayLabel, signed, spending, sums } from './BankTile';
import type { BankSource, BankTransaction } from './bank-contract';
import type { BankLabelsData } from './bank-labels-contract';
import type { BankHook } from './useBank';
import type { BankLabelsHook } from './useBankLabels';

afterEach(cleanup);
const NOW = Date.parse('2026-10-25T10:00:00Z');
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
const tx = (id: string, day: string, amount: number, title = id, over: Partial<BankTransaction> = {}): BankTransaction => ({ id, accountId: 'a', at: at(day), amount, currency: 'PLN', title, ...over });
const connected = (over: Partial<BankSource> = {}): BankSource => ({
  live: true, name: 'PKO BP', status: 'connected', observedAt: NOW - 60_000, consentUntil: NOW + 100 * 86_400_000,
  data: {
    accounts: [{ id: 'a', name: 'Konto osobiste', last4: '4245', currency: 'PLN', balance: 8423.17, balanceAt: NOW }],
    transactions: [tx('t1', '2026-10-25', -43.9, 'LESZNOJMP S.A. BIEDRONKA 5133', { note: 'Płatność kartą' }), tx('t2', '2026-10-24', 4200, 'Acme', { note: 'Wynagrodzenie' }), tx('t3', '2026-10-01', -100, 'Czynsz'), tx('old', '2026-08-01', -999, 'Dawno temu')],
  }, ...over,
});
const marks = (data: Partial<BankLabelsData> = {}, act: BankLabelsHook['act'] = vi.fn(async () => ({ ok: true as const }))): BankLabelsHook => ({
  source: { live: true, name: 'Oznaczenia', status: 'connected', observedAt: NOW, data: { since: '2026-10-20', categories: [], tags: [], merchants: [], people: [], labels: {}, suggestions: {}, known: {}, pending: [], ...data } },
  error: '', clearError: vi.fn(), act,
});
const hook = (source: BankSource, over: Partial<BankHook> = {}): BankHook => ({ source, signIn: null, error: '', busy: false, connect: vi.fn(async () => {}), refresh: vi.fn(), labels: marks(), ...over });
const FOOD = { id: 'c-00000001', name: 'Jedzenie', color: 'orange', icon: 'utensils' } as const;
const SHRINK = { id: 'c-00000002', name: 'Psycholog', color: 'violet', icon: 'brain' } as const;
const ANNA = { id: 'p-00000001', name: 'Anna', identifiers: [{ id: 'abc', kind: 'account', hint: '··1234' }] } as const;

describe('bank helpers', () => {
  it('always shows the sign, with a real minus', () => {
    expect(signed(-43.9, 'PLN')).toMatch(/^−43,90/);
    expect(signed(4200, 'PLN')).toMatch(/^\+4\s?200,00/);
  });
  it('names the day of an operation in the local day of now', () => {
    expect(dayLabel(at('2026-10-25'), NOW)).toBe('dziś');
    expect(dayLabel(at('2026-10-24'), NOW)).toBe('wczoraj');
    expect(dayLabel(at('2026-10-01'), NOW)).toMatch(/1\s+paź/);
  });
  it('heads a day by its name, then by weekday and date', () => {
    expect(dayHeading(at('2026-10-25'), NOW)).toBe('Dziś');
    expect(dayHeading(at('2026-10-24'), NOW)).toBe('Wczoraj');
    expect(dayHeading(at('2026-10-23'), NOW)).toMatch(/^Pt, 23 paź/);
  });
  it('splits the last 30 days of spending by the user’s own categories, the rest as one uncategorised share, without income', () => {
    const list = [tx('a', '2026-10-24', -100, 'Płatność telefonem'), tx('b', '2026-10-23', -40, 'LESZNOJMP S.A. BIEDRONKA 5133', { note: 'Płatność kartą' }), tx('e', '2026-10-23', -15, 'x'), tx('c', '2026-10-22', 900, 'Pensja'), tx('d', '2026-08-01', -999, 'Płatność telefonem')];
    const mark = { tags: [], merchant: null, recurring: false, person: null, comment: '' };
    const labels = { b: { ...mark, category: FOOD.id }, e: { ...mark, category: 'c-0000dead' } };
    expect(spending(list, NOW, 'PLN', labels, [FOOD])).toEqual([{ category: null, sum: 115 }, { category: FOOD, sum: 40 }]);
    expect(spending(list, NOW, 'PLN')).toEqual([{ category: null, sum: 155 }]);
  });
  it('adds up the last 30 days of one currency, in and out apart', () => {
    const list = [...connected().data!.transactions, tx('usd', '2026-10-20', -5, 'x', { currency: 'USD' })];
    expect(sums(list, NOW, 'PLN')).toEqual({ income: 4200, spent: 143.9 });
  });
});

describe('Konto tile', () => {
  it('shows the balance, the 30-day sums, the categories and the operations by day with a clean name, an icon and the sign', () => {
    render(<BankTile bank={hook(connected())} now={NOW} />);
    expect(screen.getByLabelText('Saldo').textContent).toMatch(/8\s?423,17/);
    expect(screen.getByText('30 dni')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Wydatki z 30 dni/ })).toBeTruthy();
    const days = screen.getByLabelText('Operacje według dni');
    expect(within(days).getAllByRole('heading').map(h => h.firstChild?.textContent)).toEqual(['Dziś', 'Wczoraj', expect.stringMatching(/czw, 1 paź/i), expect.stringMatching(/sob, 1 sie/i)]);
    const rows = within(days).getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0].textContent).toContain('Biedronka');
    expect(rows[0].textContent).toMatch(/Bez kategorii\s· karta/);
    expect(rows[0].textContent).toContain('−43,90');
    expect(rows[1].textContent).toContain('Acme');
    expect(rows[1].textContent).toMatch(/\swpływ · Wynagrodzenie/);
    expect(rows[1].textContent).toMatch(/\+4\s?200,00/);
    expect(screen.getByText('Konto osobiste ··4245')).toBeTruthy();
  });
  it('names a payment by phone for what it is: a payment without a shop name', () => {
    const source = connected();
    source.data!.transactions = [tx('p1', '2026-10-25', -1868.49, 'Płatność telefonem')];
    render(<BankTile bank={hook(source)} now={NOW} />);
    expect(screen.getByText(/sklep nieznany/)).toBeTruthy();
  });
  it('shows what the bank sent for an operation when the pointer is on it, and says so when it kept nothing', async () => {
    const source = connected();
    source.data!.transactions[0] = { ...source.data!.transactions[0], raw: { entry_reference: 'O;7297', remittance_information: ['0000', 'MOBILE-PAYMENT-POS-NO-CARD-TX-CODE'] } };
    render(<BankTile bank={hook(source)} now={NOW} />);
    const rows = within(screen.getByLabelText('Operacje według dni')).getAllByRole('listitem');
    await userEvent.hover(rows[0]);
    expect(screen.getByRole('tooltip').textContent).toContain('"entry_reference": "O;7297"');
    await userEvent.unhover(rows[0]);
    expect(screen.queryByRole('tooltip')).toBeNull();
    await userEvent.hover(rows[1]);
    expect(screen.getByRole('tooltip').textContent).toContain('Brak surowych danych');
  });
  it('leaves the 30-day sums and the category bar out of a small tile', () => {
    render(<BankTile bank={hook(connected())} now={NOW} wide={false} tall={false} />);
    expect(screen.queryByText('30 dni')).toBeNull();
    expect(screen.queryByRole('img', { name: /Wydatki z 30 dni/ })).toBeNull();
  });
  it('warns when the consent in the bank is about to run out', () => {
    render(<BankTile bank={hook(connected({ consentUntil: NOW + 5 * 86_400_000 }))} now={NOW} />);
    expect(screen.getByText('zgoda: 5 dni')).toBeTruthy();
  });
  it('offers to connect when there is no consent, and opens the bank only from a link', async () => {
    const connect = vi.fn(async () => {});
    const source: BankSource = { live: true, name: 'PKO BP', status: 'unavailable', observedAt: null, loginRequired: true, message: 'Połącz konto w PKO BP.', data: null };
    const { rerender } = render(<BankTile bank={hook(source, { connect })} now={NOW} />);
    await userEvent.click(screen.getByRole('button', { name: 'Połącz konto' }));
    expect(connect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('link')).toBeNull();
    rerender(<BankTile bank={hook(source, { connect, signIn: 'https://auth.enablebanking.com/x' })} now={NOW} />);
    const link = screen.getByRole('link', { name: 'Otwórz logowanie w banku' });
    expect(link.getAttribute('href')).toBe('https://auth.enablebanking.com/x');
    expect(link.getAttribute('rel')).toContain('noopener');
  });
  it('keeps the last reading when the consent has run out, and offers to connect again', () => {
    render(<BankTile bank={hook(connected({ status: 'unavailable', loginRequired: true, message: 'Zgoda w banku wygasła. Połącz konto ponownie.' }))} now={NOW} />);
    expect(screen.getByText('Zgoda w banku wygasła. Połącz konto ponownie.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Połącz ponownie' })).toBeTruthy();
  });
  it('says so when the bank could not be read, with the last data still shown', () => {
    render(<BankTile bank={hook(connected({ status: 'offline', message: 'Nie udało się odczytać konta, ponowię później.' }))} now={NOW} />);
    expect(screen.getByText('Nie udało się odczytać konta, ponowię później.')).toBeTruthy();
    expect(screen.getByLabelText('Saldo')).toBeTruthy();
  });
  it('shows loading and a missing setup as words, not as an empty account', () => {
    const { rerender } = render(<BankTile bank={hook({ live: true, name: 'PKO BP', status: 'loading', observedAt: null, data: null })} now={NOW} />);
    expect(screen.getByText('Ładowanie konta…')).toBeTruthy();
    rerender(<BankTile bank={hook({ live: true, name: 'PKO BP', status: 'unavailable', observedAt: null, message: 'Konto bankowe nie jest skonfigurowane (DESK_BANK_APP_ID).', data: null })} now={NOW} />);
    expect(screen.getByText(/nie jest skonfigurowane/)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });
});
