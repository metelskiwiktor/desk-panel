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
      tx('t6', '2026-10-21', 1000, 'FIRMA INFORMATYCZNA', { note: 'PRZELEW IKO', raw: { remittance_information: ['PRZELEW IKO NA NUMER RACHUNKU', 'TRANSFER-IN'] } }),
      tx('old', '2026-09-01', -12, 'Płatność telefonem'),
    ],
  },
};
const FOOD = { id: 'c-00000001', name: 'Spożywcze', color: 'green', icon: 'cart' } as const;
const BILLS = { id: 'c-00000002', name: 'Rachunki', color: 'blue', icon: 'receipt' } as const;
const OUT = { id: 'c-00000003', name: 'Jedzenie na mieście', color: 'orange', icon: 'utensils' } as const;
const DANIEL = { id: 'k-00000001', name: 'Daniel', kind: 'person' as const, identifiers: [{ id: 'n1', kind: 'name' as const, hint: 'DANIEL KOWALSKI' }, { id: 'a1', kind: 'account' as const, hint: '··1234' }] };
const DANIEL2 = { id: 'k-00000002', name: 'Daniel', kind: 'person' as const, identifiers: [{ id: 'a2', kind: 'account' as const, hint: '··9876' }, { id: 't2', kind: 'phoneTail' as const, hint: '··321' }] };
const BIEDRONKA = { id: 'k-00000003', name: 'Biedronka', kind: 'company' as const, identifiers: [{ id: 'mb', kind: 'merchant' as const, hint: 'Biedronka' }] };
const PYSZNE = { id: 'k-00000004', name: 'pyszne.pl', kind: 'company' as const, identifiers: [] };
const MINE = { id: 'k-00000005', name: 'Moja firma', kind: 'self' as const, identifiers: [{ id: 'nf', kind: 'name' as const, hint: 'FIRMA INFORMATYCZNA' }] };
const base = (over: Partial<BankLabelsData> = {}): BankLabelsData => ({
  since: '2026-10-20', categories: [FOOD, BILLS, OUT], tags: ['zakupy', 'restauracja', 'ogrzewanie'], purposes: ['pożyczka', 'zwrot', 'dokładka'],
  parties: [DANIEL, DANIEL2, BIEDRONKA, PYSZNE, MINE],
  labels: { t1: { category: FOOD.id, tags: ['zakupy'], party: BIEDRONKA.id, purpose: null, recurring: true, comment: 'obiad' } },
  suggestions: {
    t2: { sure: true, options: [{ party: DANIEL.id, purpose: 'pożyczka', reasons: ['ten sam rachunek ··1234: Daniel', 'pożyczka: 2 z 2 razy'] }] },
    t3: { sure: false, options: [{ category: OUT.id, tags: ['restauracja'], party: PYSZNE.id, reasons: ['ta sama kwota 70,85 zł, bez nazwy sklepu', 'pyszne.pl · Jedzenie na mieście · #restauracja: 1 z 1 raz'] }] },
    t4: { sure: false, options: [
      { category: FOOD.id, reasons: ['ten sam tekst w banku: Żabka', 'Spożywcze: 1 z 2 razy'] },
      { category: OUT.id, reasons: ['ten sam tekst w banku: Żabka', 'Jedzenie na mieście: 1 z 2 razy'] },
    ] },
  },
  known: { t1: BIEDRONKA.id, t2: DANIEL.id, t6: MINE.id },
  pending: ['t2', 't3', 't4'], ...over,
});
function tile(data = base(), wide = true) {
  const act = vi.fn(async (action: BankLabelAction) => action.action === 'createCategory' ? { ok: true as const, category: { id: 'c-00000009', created: true } }
    : action.action === 'createParty' ? { ok: true as const, party: { id: 'k-00000009', created: true } } : { ok: true as const });
  const labels: BankLabelsHook = { source: { live: true, name: 'Oznaczenia', status: 'connected', observedAt: NOW, data }, error: '', clearError: vi.fn(), act };
  const bank: BankHook = { source, signIn: null, error: '', busy: false, connect: vi.fn(async () => {}), refresh: vi.fn(), labels };
  render(<BankTile bank={bank} now={NOW} wide={wide} />);
  return { act, rows: within(screen.getByLabelText('Operacje według dni')).getAllByRole('listitem') };
}
const row = (rows: HTMLElement[], id: string) => rows[source.data!.transactions.findIndex(t => t.id === id)];

describe('marking bank operations', () => {
  it('shows the other side, the category, tags and marks, “Bez kategorii” otherwise, and counts only operations since the chosen day', () => {
    const { rows } = tile();
    expect(row(rows, 't1').textContent).toMatch(/^Biedronka/);
    expect(row(rows, 't1').textContent).toMatch(/Spożywcze\s#zakupy\s· karta/);
    expect(row(rows, 't1').querySelector('[aria-label="cykliczne"]')).toBeTruthy();
    expect(row(rows, 't1').querySelector('[aria-label="opis: obiad"]')).toBeTruthy();
    expect(row(rows, 't2').textContent).toContain('przypisz');
    expect(row(rows, 't2').querySelector('.bank-avatar.dashed')).toBeTruthy();
    // Older than the chosen day: uncategorised, but not counted and not asked for.
    expect(row(rows, 'old').textContent).toContain('Bez kategorii');
    expect(row(rows, 'old').textContent).toContain('sklep nieznany');
    expect(row(rows, 'old').textContent).not.toContain('przypisz');
    // Money from the user's own company: known by the bank's name, a transfer of their own, never asked for.
    expect(row(rows, 't6').textContent).toMatch(/^Moja firma/);
    expect(row(rows, 't6').textContent).toContain('Przelew własny');
    expect(screen.getByRole('button', { name: '3 do przypisania' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Wydatki z 30 dni/ }).querySelector('i.uncat')).toBeTruthy();
  });

  it('takes a sure suggestion with one tap, says when one is unsure, and leaves several to choose in the dialog', async () => {
    const { rows, act } = tile();
    expect(row(rows, 't2').textContent).toContain('Daniel · pożyczka?');
    expect(row(rows, 't2').textContent).not.toContain('niepewne');
    expect(row(rows, 't3').textContent).toContain('pyszne.pl · Jedzenie na mieście · #restauracja?');
    expect(row(rows, 't3').textContent).toContain('(niepewne)');
    expect(row(rows, 't4').textContent).toContain('2 możliwości');
    expect(within(row(rows, 't4')).queryByRole('button', { name: /Przyjmij/ })).toBeNull();
    await userEvent.click(within(row(rows, 't2')).getByRole('button', { name: 'Przyjmij podpowiedź: Daniel · pożyczka' }));
    expect(act).toHaveBeenCalledWith({ action: 'accept', tx: 't2', option: 0 }, expect.any(Function));
    await userEvent.click(within(row(rows, 't3')).getByRole('button', { name: 'Odrzuć podpowiedź' }));
    expect(act).toHaveBeenCalledWith({ action: 'reject', tx: 't3' }, expect.any(Function));
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(row(rows, 't4'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Do wyboru')).toBeTruthy();
    await userEvent.click(within(dialog.querySelector('.bank-dlg-options') as HTMLElement).getByRole('button', { name: /^Jedzenie na mieście/ }));
    expect(act).toHaveBeenCalledWith({ action: 'accept', tx: 't4', option: 1 }, expect.any(Function));
  });

  it('marks with the other side, category, tags, recurring and description in a few taps, making a company from the bank’s name', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(row(rows, 't4'));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Druga strona · kto') as HTMLInputElement).value).toBe('Żabka');
    expect(within(dialog).getByRole('group', { name: 'Rodzaj nowej drugiej strony' }).querySelector('[aria-pressed="true"]')!.textContent).toBe('Firma');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Spożywcze' }));
    await userEvent.click(within(dialog).getByRole('button', { name: '#zakupy' }));
    await userEvent.type(within(dialog).getByLabelText('Nowa etykieta'), 'zakupy-spozywcze{Enter}');
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.type(within(dialog).getByLabelText('Opis'), 'rano');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenCalledWith({ action: 'createParty', name: 'Żabka', kind: 'company' });
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't4', category: FOOD.id, tags: ['zakupy', 'zakupy-spozywcze'], party: 'k-00000009', purpose: null, recurring: true, comment: 'rano' }, expect.any(Function));
  });

  it('names a payment with no shop by picking the other side, and the tile shows its name instead of “sklep nieznany”', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(row(rows, 't3'));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Druga strona · kto') as HTMLInputElement).value).toBe('');
    await userEvent.click(within(dialog).getByRole('button', { name: /^pyszne\.pl/ }));
    expect(dialog.querySelector('.bank-dlg-meta')!.textContent).toMatch(/· BLIK · w banku: Płatność BLIK$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Jedzenie na mieście' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't3', category: OUT.id, tags: [], party: PYSZNE.id, purpose: null, recurring: false, comment: '' }, expect.any(Function));
  });

  it('names the way the bank says it was paid, and asks who an unknown side of a transfer is: one tap makes a person', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    expect(row(rows, 't2').textContent).toContain('przelew na telefon · Za bilety');
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('.bank-dlg-who')!.textContent).toContain('Z banku: Daniel Kowalski. Kto to?');
    await userEvent.click(within(dialog.querySelector('.bank-dlg-who') as HTMLElement).getByRole('button', { name: 'Osoba' }));
    expect(act).toHaveBeenCalledWith({ action: 'createParty', name: 'Daniel Kowalski', kind: 'person' });
  });

  it('tells two people of the same name apart by their identifiers, and gives a person a purpose from the own list', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    await userEvent.click(row(rows, 't3'));
    const dialog = screen.getByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Druga strona · kto'), 'dan');
    const list = within(dialog).getByRole('list', { name: 'Druga strona' });
    expect(list.textContent).toContain('Daniel„DANIEL KOWALSKI” · rach. ··1234');
    expect(list.textContent).toContain('Danielrach. ··9876 · tel. ··321');
    await userEvent.click(within(list).getAllByRole('button')[1]);
    await userEvent.click(within(dialog).getByRole('button', { name: 'dokładka' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rachunki' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't3', category: BILLS.id, tags: [], party: DANIEL2.id, purpose: 'dokładka', recurring: false, comment: '' }, expect.any(Function));
  });

  it('for the user’s own account asks for no category and changes a side’s kind in one tap', async () => {
    const { rows, act } = tile();
    await userEvent.click(row(rows, 't6'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/Przelew własny: kategoria niepotrzebna/)).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Spożywcze' })).toBeNull();
    await userEvent.click(within(within(dialog).getByRole('group', { name: 'Rodzaj drugiej strony' })).getByRole('button', { name: 'Firma' }));
    expect(act).toHaveBeenCalledWith({ action: 'updateParty', party: MINE.id, kind: 'company' });
  });

  it('fills the form from a sure suggestion and shows who the bank says it is; Odrzuć takes back only what the suggestion filled in', async () => {
    const { rows, act } = tile();
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('button', { name: 'pożyczka' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).getByText(/rozpoznawana po: „DANIEL KOWALSKI” · rach. ··1234/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Odrzuć/ }));
    expect(act).toHaveBeenCalledWith({ action: 'reject', tx: 't2' });
    expect(within(dialog).getByRole('button', { name: 'pożyczka' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(dialog).queryByText('Podpowiedź')).toBeNull();
    // The side the bank names stays: it is not a guess.
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

  it('shows a suggestion also beside an operation older than the day “to be marked” counts from, without counting it', () => {
    const data = base();
    data.suggestions.old = { sure: true, options: [{ category: OUT.id, party: PYSZNE.id, reasons: ['ta sama kwota', 'pyszne.pl · Jedzenie na mieście: 2 z 2 razy'] }] };
    const { rows } = tile(data);
    expect(row(rows, 'old').textContent).toContain('pyszne.pl · Jedzenie na mieście?');
    expect(within(row(rows, 'old')).getByRole('button', { name: /Przyjmij podpowiedź/ })).toBeTruthy();
    expect(row(rows, 'old').textContent).not.toContain('przypisz');
  });

  it('sets the day “to be marked” counts from, renames a purpose and forgets an identifier taken by mistake', async () => {
    const { act } = tile();
    await userEvent.click(screen.getByRole('button', { name: 'Ustawienia oznaczeń' }));
    const dialog = screen.getByRole('dialog', { name: 'Ustawienia oznaczeń' });
    fireEvent.change(dialog.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-10-01' } });
    expect(act).toHaveBeenCalledWith({ action: 'setSince', since: '2026-10-01' });
    const purpose = within(dialog).getByLabelText('Cel dokładka');
    await userEvent.clear(purpose);
    await userEvent.type(purpose, 'dorzutka{Enter}');
    expect(act).toHaveBeenCalledWith({ action: 'renamePurpose', purpose: 'dokładka', name: 'dorzutka' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapomnij: rachunek ··9876' }));
    expect(act).toHaveBeenCalledWith({ action: 'forgetIdentifier', party: DANIEL2.id, identifier: 'a2' });
    expect(within(dialog).getByText('tekst w banku „Biedronka”')).toBeTruthy();
  });
});
