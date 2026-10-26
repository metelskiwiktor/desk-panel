import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BankTile } from './BankTile';
import type { BankSource, BankTransaction } from './bank-contract';
import type { BankLabelAction, BankLabelsData } from './bank-labels-contract';
import type { BankHook } from './useBank';
import type { BankLabelsHook } from './useBankLabels';

afterEach(cleanup);
const NOW = Date.parse('2026-10-25T10:00:00Z');
const at = (d: string) => Date.parse(`${d}T12:00:00Z`);
const tx = (id: string, day: string, amount: number, title = id, over: Partial<BankTransaction> = {}): BankTransaction => ({ id, accountId: 'a', at: at(day), amount, currency: 'PLN', title, ...over });
const source: BankSource = {
  live: true, name: 'PKO BP', status: 'connected', observedAt: NOW - 60_000, consentUntil: NOW + 100 * 86_400_000,
  data: {
    accounts: [{ id: 'a', name: 'Konto osobiste', last4: '4245', currency: 'PLN', balance: 1000, balanceAt: NOW }],
    transactions: [
      tx('t1', '2026-10-25', -43.9, 'LESZNOJMP S.A. BIEDRONKA 5133', { note: 'Płatność kartą' }),
      tx('t2', '2026-10-24', -200, 'DANIEL KOWALSKI', { note: 'Za bilety', raw: { entry_reference: 'O;1', remittance_information: ['Za bilety', 'MOBILE-PAYMENT-C2C-EXTERNAL'] } }),
      tx('t3', '2026-10-23', -70.85, 'Płatność BLIK'),
      tx('t4', '2026-10-22', -12.5, 'LESZNOZABKA ZD623 K.1', { note: 'Płatność kartą' }),
      tx('old', '2026-09-01', -12, 'Płatność telefonem'),
    ],
  },
};
const FOOD = { id: 'c-00000001', name: 'Spożywcze', color: 'green', icon: 'cart' } as const;
const LOAN = { id: 'c-00000002', name: 'Pożyczka', color: 'blue', icon: 'handCoins' } as const;
const OUT = { id: 'c-00000003', name: 'Jedzenie na mieście', color: 'orange', icon: 'utensils' } as const;
const DANIEL = { id: 'p-00000001', name: 'Daniel', identifiers: [{ id: 'n1', kind: 'name' as const, hint: 'DANIEL KOWALSKI' }, { id: 'a1', kind: 'account' as const, hint: '··1234' }] };
const DANIEL2 = { id: 'p-00000002', name: 'Daniel', identifiers: [{ id: 'a2', kind: 'account' as const, hint: '··9876' }, { id: 't2', kind: 'phoneTail' as const, hint: '··321' }] };
const BIEDRONKA = { id: 'm-00000001', name: 'Biedronka', identifiers: [{ id: 'mb', kind: 'merchant' as const, hint: 'Biedronka' }] };
const PYSZNE = { id: 'm-00000002', name: 'pyszne.pl', identifiers: [] };
const base = (over: Partial<BankLabelsData> = {}): BankLabelsData => ({
  since: '2026-10-20', categories: [FOOD, LOAN, OUT], tags: ['zakupy', 'restauracja', 'ogrzewanie'], merchants: [BIEDRONKA, PYSZNE], people: [DANIEL, DANIEL2],
  labels: { t1: { category: FOOD.id, tags: ['zakupy'], merchant: BIEDRONKA.id, person: null, recurring: true, comment: 'obiad' } },
  suggestions: {
    t2: { sure: true, options: [{ category: LOAN.id, person: DANIEL.id, reasons: ['ten sam rachunek ··1234: Daniel', 'Pożyczka: 2 z 2 razy'] }] },
    t3: { sure: false, options: [{ category: OUT.id, tags: ['restauracja'], merchant: PYSZNE.id, reasons: ['ta sama kwota 70,85 zł, bez nazwy sklepu', 'pyszne.pl · Jedzenie na mieście · #restauracja: 1 z 1 raz'] }] },
    t4: { sure: false, options: [
      { category: FOOD.id, reasons: ['ten sam sprzedawca w banku: Żabka', 'Spożywcze: 1 z 2 razy'] },
      { category: OUT.id, reasons: ['ten sam sprzedawca w banku: Żabka', 'Jedzenie na mieście: 1 z 2 razy'] },
    ] },
  },
  known: { t1: { merchant: BIEDRONKA.id }, t2: { person: DANIEL.id } },
  pending: ['t2', 't3', 't4'], ...over,
});
function tile(data = base(), wide = true) {
  const act = vi.fn(async (action: BankLabelAction) => action.action === 'createCategory' ? { ok: true as const, category: { id: 'c-00000009', created: true } }
    : action.action === 'createPerson' ? { ok: true as const, person: { id: 'p-00000009', created: true } }
    : action.action === 'createMerchant' ? { ok: true as const, merchant: { id: 'm-00000009', created: true } } : { ok: true as const });
  const labels: BankLabelsHook = { source: { live: true, name: 'Oznaczenia', status: 'connected', observedAt: NOW, data }, error: '', clearError: vi.fn(), act };
  const bank: BankHook = { source, signIn: null, error: '', busy: false, connect: vi.fn(async () => {}), refresh: vi.fn(), labels };
  render(<BankTile bank={bank} now={NOW} wide={wide} />);
  return { act, rows: within(screen.getByLabelText('Operacje według dni')).getAllByRole('listitem') };
}

describe('marking bank operations', () => {
  it('shows the merchant, the category, tags and marks, “Bez kategorii” otherwise, and counts only operations since the chosen day', () => {
    const { rows } = tile();
    expect(rows[0].textContent).toMatch(/^Biedronka/);
    expect(rows[0].textContent).toMatch(/Spożywcze\s#zakupy\s· karta/);
    expect(rows[0].querySelector('[aria-label="cykliczne"]')).toBeTruthy();
    expect(rows[0].querySelector('[aria-label="opis: obiad"]')).toBeTruthy();
    expect(rows[1].textContent).toContain('przypisz');
    expect(rows[1].querySelector('.bank-avatar.dashed')).toBeTruthy();
    // Older than the chosen day: uncategorised, but not counted and not asked for.
    expect(rows[4].textContent).toContain('Bez kategorii');
    expect(rows[4].textContent).toContain('sklep nieznany');
    expect(rows[4].textContent).not.toContain('przypisz');
    expect(screen.getByRole('button', { name: '3 do przypisania' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Wydatki z 30 dni/ }).querySelector('i.uncat')).toBeTruthy();
  });

  it('takes a sure suggestion with one tap, says when one is unsure, and leaves several to choose in the dialog', async () => {
    const { rows, act } = tile();
    expect(rows[1].textContent).toContain('Daniel · Pożyczka?');
    expect(rows[1].textContent).not.toContain('niepewne');
    expect(rows[2].textContent).toContain('pyszne.pl · Jedzenie na mieście · #restauracja?');
    expect(rows[2].textContent).toContain('(niepewne)');
    expect(rows[3].textContent).toContain('2 możliwości');
    expect(within(rows[3]).queryByRole('button', { name: /Przyjmij/ })).toBeNull();
    await userEvent.click(within(rows[1]).getByRole('button', { name: 'Przyjmij podpowiedź: Daniel · Pożyczka' }));
    expect(act).toHaveBeenCalledWith({ action: 'accept', tx: 't2', option: 0 }, expect.any(Function));
    await userEvent.click(within(rows[2]).getByRole('button', { name: 'Odrzuć podpowiedź' }));
    expect(act).toHaveBeenCalledWith({ action: 'reject', tx: 't3' }, expect.any(Function));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(rows[3]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Do wyboru')).toBeTruthy();
    await userEvent.click(within(dialog.querySelector('.bank-dlg-options') as HTMLElement).getByRole('button', { name: /^Jedzenie na mieście/ }));
    expect(act).toHaveBeenCalledWith({ action: 'accept', tx: 't4', option: 1 }, expect.any(Function));
  });

  it('marks with merchant, category, tags, recurring, person and description in a few taps, making the merchant from the bank’s name', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(rows[3]);
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Sprzedawca') as HTMLInputElement).value).toBe('Żabka');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Spożywcze' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '#zakupy' }));
    await userEvent.type(within(dialog).getByLabelText('Nowa etykieta'), 'zakupy-spozywcze{Enter}');
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.type(within(dialog).getByLabelText('Opis'), 'rano');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenCalledWith({ action: 'createMerchant', name: 'Żabka' });
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't4', category: FOOD.id, tags: ['zakupy', 'zakupy-spozywcze'], merchant: 'm-00000009', person: null, recurring: true, comment: 'rano' }, expect.any(Function));
  });

  it('names a payment with no shop by picking a merchant, and the tile shows its name instead of “sklep nieznany”', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(rows[2]);
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Sprzedawca') as HTMLInputElement).value).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: 'pyszne.pl' }));
    expect(dialog.querySelector('.bank-dlg-meta')!.textContent).toMatch(/· BLIK · w banku: Płatność BLIK$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Jedzenie na mieście' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't3', category: OUT.id, tags: [], merchant: PYSZNE.id, person: null, recurring: false, comment: '' }, expect.any(Function));
  });

  it('names the way the bank says it was paid, and offers to make an unknown side of a transfer a person in one tap', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    expect(rows[1].textContent).toContain('przelew na telefon · Za bilety');
    await userEvent.click(rows[1]);
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.bank-dlg-who')!.textContent).toContain('Z banku: Daniel Kowalski. Kto to?');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Osoba' }));
    expect(act).toHaveBeenCalledWith({ action: 'createPerson', name: 'Daniel Kowalski' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't2', category: null, tags: [], merchant: null, person: 'p-00000009', recurring: false, comment: '' }, expect.any(Function));
  });

  it('tells two people of the same name apart by their identifiers, and adds another one on purpose', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    await userEvent.click(rows[2]);
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/^Osoba/), 'dan');
    const list = within(dialog).getByRole('list', { name: 'Osoby' });
    expect(list.textContent).toContain('Daniel„DANIEL KOWALSKI” · rach. ··1234');
    expect(list.textContent).toContain('Danielrach. ··9876 · tel. ··321');
    await userEvent.clear(within(dialog).getByLabelText(/^Osoba/));
    await userEvent.type(within(dialog).getByLabelText(/^Osoba/), 'Daniel');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Dodaj kolejną osobę „Daniel”' }));
    expect(act).toHaveBeenCalledWith({ action: 'createPerson', name: 'Daniel' });
  });

  it('fills the form from a sure suggestion and shows who the bank says it is; Odrzuć takes back only what the suggestion filled in', async () => {
    const { rows, act } = tile();
    await userEvent.click(rows[1]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'Pożyczka' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByText(/rozpoznawana po: „DANIEL KOWALSKI” · rach. ··1234/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Odrzuć/ }));
    expect(act).toHaveBeenCalledWith({ action: 'reject', tx: 't2' });
    expect(within(dialog).getByRole('button', { name: 'Pożyczka' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(dialog).queryByText('Podpowiedź')).toBeNull();
    // The person the bank names stays: it is not a guess.
    expect(within(dialog).getByText(/rozpoznawana po/)).toBeTruthy();
    expect(dialog.textContent).toContain('"entry_reference": "O;1"');
  });

  it('goes from one operation to the next from “N do przypisania”, and clears a mark', async () => {
    const { act } = tile();
    await userEvent.click(screen.getByRole('button', { name: '3 do przypisania' }));
    expect(screen.getByRole('dialog').textContent).toContain('1 z 3');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Przyjmij/ }));
    expect(act).toHaveBeenCalledWith({ action: 'accept', tx: 't2', option: 0 }, expect.any(Function));
    expect(screen.getByRole('dialog', { name: /Płatność BLIK/ })).toBeTruthy();
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Anuluj' }));
    await userEvent.click(within(screen.getByLabelText('Operacje według dni')).getAllByRole('listitem')[0]);
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Wyczyść' }));
    expect(act).toHaveBeenCalledWith({ action: 'clear', tx: 't1' }, expect.any(Function));
  });

  it('sets the day “to be marked” counts from, renames a tag and forgets an identifier taken by mistake', async () => {
    const { act } = tile();
    await userEvent.click(screen.getByRole('button', { name: 'Ustawienia oznaczeń' }));
    const dialog = screen.getByRole('dialog', { name: 'Ustawienia oznaczeń' });
    fireEvent.change(dialog.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-10-01' } });
    expect(act).toHaveBeenCalledWith({ action: 'setSince', since: '2026-10-01' });
    const tag = within(dialog).getByLabelText('Etykieta zakupy');
    await userEvent.clear(tag);
    await userEvent.type(tag, 'zakupy-dom{Enter}');
    expect(act).toHaveBeenCalledWith({ action: 'renameTag', tag: 'zakupy', name: 'zakupy-dom' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapomnij: rachunek ··9876' }));
    expect(act).toHaveBeenCalledWith({ action: 'forgetIdentifier', owner: DANIEL2.id, identifier: 'a2' });
    expect(within(dialog).getByText('tekst w banku „Biedronka”')).toBeTruthy();
  });
});
