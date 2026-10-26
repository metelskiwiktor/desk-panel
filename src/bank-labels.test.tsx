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
const FOOD = { id: 'c-00000001', name: 'Spożywcze', move: 'spend', color: 'green', icon: 'cart' } as const;
const BILLS = { id: 'c-00000002', name: 'Rachunki', move: 'spend', color: 'blue', icon: 'receipt' } as const;
const OUT = { id: 'c-00000003', name: 'Jedzenie na mieście', move: 'spend', color: 'orange', icon: 'utensils' } as const;
const SALARY = { id: 'c-00000004', name: 'Pensja', move: 'income', color: 'teal', icon: 'banknote' } as const;
const DANIEL = { id: 'k-00000001', name: 'Daniel', identifiers: [{ id: 'n1', kind: 'name' as const, hint: 'DANIEL KOWALSKI' }, { id: 'a1', kind: 'account' as const, hint: '··1234' }] };
const DANIEL2 = { id: 'k-00000002', name: 'Daniel', identifiers: [{ id: 'a2', kind: 'account' as const, hint: '··9876' }, { id: 't2', kind: 'phoneTail' as const, hint: '··321' }] };
const BIEDRONKA = { id: 'k-00000003', name: 'Biedronka', identifiers: [{ id: 'mb', kind: 'merchant' as const, hint: 'Biedronka' }] };
const PYSZNE = { id: 'k-00000004', name: 'pyszne.pl', identifiers: [] };
const MINE = { id: 'k-00000005', name: 'Moja firma', identifiers: [{ id: 'nf', kind: 'name' as const, hint: 'FIRMA INFORMATYCZNA' }] };
const mark = { tags: [], party: null, recurring: false, comment: '' };
const base = (over: Partial<BankLabelsData> = {}): BankLabelsData => ({
  since: '2026-10-20', categories: [FOOD, BILLS, OUT, SALARY], tags: ['zakupy', 'restauracja', 'ogrzewanie'],
  parties: [DANIEL, DANIEL2, BIEDRONKA, PYSZNE, MINE],
  labels: {
    t1: { move: 'spend', category: FOOD.id, tags: ['zakupy'], party: BIEDRONKA.id, recurring: true, comment: 'obiad' },
    t6: { ...mark, move: 'income', category: SALARY.id, party: MINE.id },
  },
  suggestions: {
    t2: { sure: true, options: [{ move: 'settle', party: DANIEL.id, reasons: ['ten sam rachunek ··1234: Daniel', 'Rozliczenie: 2 z 2 razy'] }] },
    t3: { sure: false, options: [{ move: 'spend', category: OUT.id, tags: ['restauracja'], party: PYSZNE.id, reasons: ['ta sama kwota 70,85 zł, bez nazwy sklepu', 'pyszne.pl · Jedzenie na mieście · #restauracja: 1 z 1 raz'] }] },
    t4: { sure: false, options: [
      { move: 'spend', category: FOOD.id, reasons: ['ten sam tekst w banku: Żabka', 'Spożywcze: 1 z 2 razy'] },
      { move: 'spend', category: OUT.id, reasons: ['ten sam tekst w banku: Żabka', 'Jedzenie na mieście: 1 z 2 razy'] },
    ] },
  },
  known: { t1: BIEDRONKA.id, t2: DANIEL.id, t6: MINE.id },
  pending: ['t2', 't3', 't4'],
  balances: [{ party: DANIEL.id, currency: 'PLN', amount: 200 }], habits: { t2: { settle: 2, spend: 1 } }, ...over,
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
const moves = (dialog: HTMLElement) => within(within(dialog).getByRole('group', { name: 'Co zrobiły pieniądze' }));
const pressed = (dialog: HTMLElement) => within(dialog).getByRole('group', { name: 'Co zrobiły pieniądze' }).querySelector('[aria-pressed="true"] .name')?.textContent ?? null;

describe('marking bank operations', () => {
  it('shows the other side, the category or source, tags and marks, “Nieoznaczona” otherwise, and counts only operations since the chosen day', () => {
    const { rows } = tile();
    expect(row(rows, 't1').textContent).toMatch(/^Biedronka/);
    expect(row(rows, 't1').textContent).toMatch(/Spożywcze\s#zakupy\s· karta/);
    expect(row(rows, 't1').querySelector('[aria-label="cykliczne"]')).toBeTruthy();
    expect(row(rows, 't1').querySelector('[aria-label="opis: obiad"]')).toBeTruthy();
    expect(row(rows, 't2').textContent).toContain('przypisz');
    expect(row(rows, 't2').querySelector('.bank-avatar.dashed')).toBeTruthy();
    // Older than the chosen day: unmarked, but not counted and not asked for.
    expect(row(rows, 'old').textContent).toContain('Nieoznaczona');
    expect(row(rows, 'old').textContent).toContain('sklep nieznany');
    expect(row(rows, 'old').textContent).not.toContain('przypisz');
    // Money from the user's own company is income from a source.
    expect(row(rows, 't6').textContent).toMatch(/^Moja firma/);
    expect(row(rows, 't6').textContent).toContain('Pensja');
    expect(screen.getByRole('button', { name: '3 do przypisania' })).toBeTruthy();
    expect(screen.getByRole('img', { name: /Wydatki z 30 dni/ }).querySelector('i.uncat')).toBeTruthy();
    // What is open with people, from every kept settlement.
    expect(screen.getByRole('list', { name: 'Rozliczenia' }).textContent).toMatch(/Daniel odda Ci 200,00\s?zł/);
    // The sums count income and spending; the net is what is left.
    expect(screen.getByTitle(/Przychody, wydatki i netto/).textContent).toMatch(/netto \+?6/);
  });

  it('takes a sure suggestion with one tap, says when one is unsure, and leaves several to choose in the dialog', async () => {
    const { rows, act } = tile();
    expect(row(rows, 't2').textContent).toContain('Daniel · Rozliczenie?');
    expect(row(rows, 't2').textContent).not.toContain('niepewne');
    expect(row(rows, 't3').textContent).toContain('pyszne.pl · Jedzenie na mieście · #restauracja?');
    expect(row(rows, 't3').textContent).toContain('(niepewne)');
    expect(row(rows, 't4').textContent).toContain('2 możliwości');
    expect(within(row(rows, 't4')).queryByRole('button', { name: /Przyjmij/ })).toBeNull();
    await userEvent.click(within(row(rows, 't2')).getByRole('button', { name: 'Przyjmij podpowiedź: Daniel · Rozliczenie' }));
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

  it('starts a card payment as a spend and marks it with the side, category, tags, recurring and description in a few taps', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(row(rows, 't4'));
    const dialog = screen.getByRole('dialog');
    expect(pressed(dialog)).toMatch(/^Wydatek/);
    expect((within(dialog).getByLabelText('Druga strona') as HTMLInputElement).value).toBe('Żabka');
    // Only spending categories: an income source is not offered for a spend.
    expect(within(dialog).queryByRole('button', { name: 'Pensja' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Spożywcze' }));
    expect(dialog.querySelector('.bank-sentence')!.textContent).toMatch(/^Wydane 12,50\s?zł · u Żabka · na Spożywcze$/);
    await userEvent.click(within(dialog).getByRole('button', { name: '#zakupy' }));
    await userEvent.type(within(dialog).getByLabelText('Nowa etykieta'), 'zakupy-spozywcze{Enter}');
    await userEvent.click(within(dialog).getByRole('switch'));
    await userEvent.type(within(dialog).getByLabelText('Opis'), 'rano');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenCalledWith({ action: 'createParty', name: 'Żabka' });
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't4', move: 'spend', category: FOOD.id, tags: ['zakupy', 'zakupy-spozywcze'], party: 'k-00000009', recurring: true, comment: 'rano' }, expect.any(Function));
  });

  it('names a payment with no shop by picking the other side, and the tile shows its name instead of “sklep nieznany”', async () => {
    const { rows, act } = tile(base({ suggestions: {} }));
    await userEvent.click(row(rows, 't3'));
    const dialog = screen.getByRole('dialog');
    expect((within(dialog).getByLabelText('Druga strona') as HTMLInputElement).value).toBe('');
    // The sides are not listed until typing finds them.
    expect(within(dialog).queryByRole('button', { name: /^pyszne\.pl/ })).toBeNull();
    await userEvent.type(within(dialog).getByLabelText('Druga strona'), 'pysz');
    await userEvent.click(within(dialog).getByRole('button', { name: /^pyszne\.pl/ }));
    expect(dialog.querySelector('.bank-dlg-meta')!.textContent).toMatch(/· BLIK · w banku: Płatność BLIK$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Jedzenie na mieście' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't3', move: 'spend', category: OUT.id, tags: [], party: PYSZNE.id, recurring: false, comment: '' }, expect.any(Function));
  });

  it('leaves a transfer’s move to the user, offers the bank’s name as the side, and a settlement needs one', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    expect(row(rows, 't2').textContent).toContain('przelew na telefon · Za bilety');
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    expect(pressed(dialog)).toBeNull();
    const side = within(dialog).getByLabelText('Druga strona') as HTMLInputElement;
    expect(side.value).toBe('Daniel Kowalski');
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Rozliczenie/ }));
    expect(dialog.textContent).toContain('Saldo z „Daniel Kowalski” zacznie się od tej operacji.');
    await userEvent.clear(side);
    expect(within(dialog).getByText('Wybierz niżej, z kim jest to rozliczenie.')).toBeTruthy();
    expect((within(dialog).getByRole('button', { name: 'Zapisz' }) as HTMLButtonElement).disabled).toBe(true);
    // The same name as a kept side is that side, unless the user says it is someone else.
    await userEvent.type(side, 'Daniel');
    await userEvent.click(within(dialog).getByRole('button', { name: '„Daniel” to ktoś inny niż zapisana strona' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenCalledWith({ action: 'createParty', name: 'Daniel' });
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't2', move: 'settle', category: null, tags: [], party: 'k-00000009', recurring: false, comment: '' }, expect.any(Function));
  });

  it('tells two people of the same name apart by their identifiers, and shows the balance a settlement leads to', async () => {
    const { rows, act } = tile(base({ suggestions: {}, known: {} }));
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    const side = within(dialog).getByLabelText('Druga strona');
    await userEvent.clear(side);
    await userEvent.type(side, 'dan');
    const list = within(dialog).getByRole('list', { name: 'Pasujące strony' });
    expect(list.textContent).toContain('Daniel„DANIEL KOWALSKI” · rach. ··1234');
    expect(list.textContent).toContain('Danielrach. ··9876 · tel. ··321');
    await userEvent.click(within(list).getAllByRole('button')[0]);
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Rozliczenie/ }));
    expect(dialog.querySelector('.bank-dlg-says')!.textContent).toMatch(/^Saldo: Daniel odda Ci 200,00\s?zł → Daniel odda Ci 400,00\s?zł\./);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't2', move: 'settle', category: null, tags: [], party: DANIEL.id, recurring: false, comment: '' }, expect.any(Function));
  });

  it('asks an income for its source and a move between own accounts for nothing', async () => {
    const { rows, act } = tile();
    await userEvent.click(row(rows, 't6'));
    const dialog = screen.getByRole('dialog');
    expect(pressed(dialog)).toMatch(/^Przychód/);
    expect(within(dialog).getByRole('button', { name: 'Pensja' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(dialog).queryByRole('button', { name: 'Spożywcze' })).toBeNull();
    expect(dialog.querySelector('.bank-sentence')!.textContent).toMatch(/^Przyszło 1\s?000,00\s?zł · od Moja firma · jako Pensja$/);
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Przełożenie/ }));
    expect(within(dialog).queryByRole('button', { name: 'Pensja' })).toBeNull();
    expect(within(dialog).getByText(/nie liczy się do wydatków ani przychodów/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't6', move: 'move', category: null, tags: [], party: MINE.id, recurring: false, comment: '' }, expect.any(Function));
  });

  it('shows how often the side’s money was each move, and says the mark as a sentence', async () => {
    const { rows } = tile();
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    expect(moves(dialog).getByRole('button', { name: 'Rozliczenie, wcześniej 2×' })).toBeTruthy();
    expect(moves(dialog).getByRole('button', { name: 'Wydatek, wcześniej 1×' })).toBeTruthy();
    expect(dialog.querySelector('.bank-sentence')!.textContent).toMatch(/^Wysłane 200,00\s?zł · do Daniel$/);
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Wydatek/ }));
    expect(dialog.querySelector('.bank-sentence')!.textContent).toMatch(/· na wybierz kategorię$/);
  });

  it('puts a move between own accounts into a pocket, made in the dialog', async () => {
    const pocket = { id: 'c-00000005', name: 'Oszczędności', move: 'move', color: 'slate', icon: 'piggyBank' } as const;
    const { rows, act } = tile(base({ categories: [FOOD, BILLS, OUT, SALARY, pocket], suggestions: {} }));
    await userEvent.click(row(rows, 't3'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Przełożenie/ }));
    expect(within(dialog).getByText('Kieszeń · gdzie leży (opcjonalnie)')).toBeTruthy();
    expect(within(dialog).queryByRole('button', { name: 'Spożywcze' })).toBeNull();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Oszczędności' }));
    expect(dialog.querySelector('.bank-sentence')!.textContent).toMatch(/^Przełożone 70,85\s?zł · do Oszczędności$/);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapisz' }));
    expect(act).toHaveBeenLastCalledWith({ action: 'label', tx: 't3', move: 'move', category: pocket.id, tags: [], party: null, recurring: false, comment: '' }, expect.any(Function));
  });

  it('offers only the most used tags until typing finds the others', async () => {
    const many = Array.from({ length: 12 }, (_, i) => `etykieta${i}`);
    const { rows } = tile(base({ tags: many, suggestions: {} }));
    await userEvent.click(row(rows, 't3'));
    const group = within(screen.getByRole('group', { name: 'Etykiety · szczegóły' }));
    expect(group.getAllByRole('button')).toHaveLength(8);
    await userEvent.type(group.getByLabelText('Nowa etykieta'), 'etykieta11');
    expect(group.getAllByRole('button').map(b => b.textContent)).toEqual(['#etykieta11']);
  });

  it('makes a new income source from the dialog', async () => {
    const { rows, act } = tile(base({ labels: {}, suggestions: {} }));
    await userEvent.click(row(rows, 't6'));
    const dialog = screen.getByRole('dialog');
    await userEvent.click(moves(dialog).getByRole('button', { name: /^Przychód/ }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Nowe' }));
    await userEvent.type(within(dialog).getByLabelText('Nazwa'), 'Zwrot podatku{Enter}');
    expect(act).toHaveBeenCalledWith({ action: 'createCategory', move: 'income', name: 'Zwrot podatku', color: expect.any(String), icon: 'banknote' });
  });

  it('fills the form from a sure suggestion and shows who the bank says it is; Odrzuć takes back only what the suggestion filled in', async () => {
    const { rows, act } = tile();
    await userEvent.click(row(rows, 't2'));
    const dialog = screen.getByRole('dialog');
    expect(pressed(dialog)).toMatch(/^Rozliczenie/);
    expect(within(dialog).getByText(/rozpoznawana po: „DANIEL KOWALSKI” · rach. ··1234/)).toBeTruthy();
    await userEvent.click(within(dialog).getByRole('button', { name: /Odrzuć/ }));
    expect(act).toHaveBeenCalledWith({ action: 'reject', tx: 't2' });
    expect(pressed(dialog)).toBeNull();
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
    data.suggestions.old = { sure: true, options: [{ move: 'spend', category: OUT.id, party: PYSZNE.id, reasons: ['ta sama kwota', 'pyszne.pl · Jedzenie na mieście: 2 z 2 razy'] }] };
    const { rows } = tile(data);
    expect(row(rows, 'old').textContent).toContain('pyszne.pl · Jedzenie na mieście?');
    expect(within(row(rows, 'old')).getByRole('button', { name: /Przyjmij podpowiedź/ })).toBeTruthy();
    expect(row(rows, 'old').textContent).not.toContain('przypisz');
  });

  it('sets the day “to be marked” counts from, lists categories and sources apart, renames a tag and forgets an identifier', async () => {
    const { act } = tile();
    await userEvent.click(screen.getByRole('button', { name: 'Ustawienia oznaczeń' }));
    const dialog = screen.getByRole('dialog', { name: 'Ustawienia oznaczeń' });
    fireEvent.change(dialog.querySelector('input[type="date"]') as HTMLInputElement, { target: { value: '2026-10-01' } });
    expect(act).toHaveBeenCalledWith({ action: 'setSince', since: '2026-10-01' });
    expect(within(dialog).getByRole('button', { name: 'Zmień źródło Pensja' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Zmień kategorię Spożywcze' })).toBeTruthy();
    const tag = within(dialog).getByLabelText('Etykieta ogrzewanie');
    await userEvent.clear(tag);
    await userEvent.type(tag, 'ciepło{Enter}');
    expect(act).toHaveBeenCalledWith({ action: 'renameTag', tag: 'ogrzewanie', name: 'ciepło' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Zapomnij: rachunek ··9876' }));
    expect(act).toHaveBeenCalledWith({ action: 'forgetIdentifier', party: DANIEL2.id, identifier: 'a2' });
    expect(within(dialog).getByText('tekst w banku „Biedronka”')).toBeTruthy();
  });
});
