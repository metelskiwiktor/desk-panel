import { describe as suite, expect, it } from 'vitest';
import type { BankTransaction } from './bank-contract';
import { cleanName, describe, humanNote } from './bank-merchants';

const tx = (title: string, amount: number, note?: string): BankTransaction => ({ id: title, accountId: 'a', at: 0, amount, currency: 'PLN', title, ...(note ? { note } : {}) });

suite('merchant names', () => {
  it('takes the town, country, store number and company form off a merchant', () => {
    expect(cleanName('LESZNOJMP S.A. BIEDRONKA 5133')).toBe('JMP S.A. Biedronka');
    expect(cleanName('LesznoSPOLEM PSS Sklep nr 12')).toBe('Spolem PSS Sklep');
    expect(cleanName('LESZNOSERCE SP ZOO')).toBe('Serce');
    expect(cleanName('LESZNOGRANO SP. Z O.O.')).toBe('Grano');
    expect(cleanName('ZIELONA GORACRS')).toBe('CRS');
    expect(cleanName('LESZNOZABKA ZD623 K.1')).toBe('Zabka');
    expect(cleanName('LESZNOCUKIERNIA HOFFMANNPL')).toBe('Cukiernia Hoffmann');
    expect(cleanName('SkorzewoWYGODNE ROWERY')).toBe('Wygodne Rowery');
    expect(cleanName('LESZNOTK TRADING TOMASZ72039')).toBe('TK Trading Tomasz');
    expect(cleanName('LESZNO3306 LESZNOFRANCISZKA')).toBe('Franciszka');
    expect(cleanName('ODBIORCA PRZELEWU NA TELEFON')).toBe('Odbiorca Przelewu na Telefon');
  });
  it('leaves a name that is only a town alone', () => {
    expect(cleanName('LESZNO')).toBe('Leszno');
    expect(cleanName('Anna Kowalska')).toBe('Anna Kowalska');
  });
  it('keeps the part of a transfer title that a person wrote and drops the bank’s own wording', () => {
    expect(humanNote('Wynagrodzenie za październik')).toBe('Wynagrodzenie za październik');
    expect(humanNote('LAPTOP OSTATNIA CZESCOD: 48667178938 DO: 487*****248')).toBe('Laptop ostatnia czesc');
    expect(humanNote('PRZELEW IKO NA NUMER RACHUNKU TRANSFER-IN')).toBeNull();
    expect(humanNote('FF TRANSFER-IN')).toBeNull();
    expect(humanNote('PRZELEW NA TELEFONOD: 48726571688 DO: 487*****248 MOBILE-PAYMENT-C2C-EXTERNAL')).toBeNull();
    expect(humanNote(undefined)).toBeNull();
  });
});

suite('operation description', () => {
  it('names known shops properly and says how they were paid', () => {
    expect(describe(tx('LESZNOJMP S.A. BIEDRONKA 5133', -35.46, 'Płatność kartą'))).toEqual({ name: 'Biedronka', sub: 'Zakupy · karta', category: 'grocery' });
    expect(describe(tx('LESZNOZABKA ZD623 K.1', -51.97, 'Płatność kartą'))).toMatchObject({ name: 'Żabka', category: 'grocery' });
    expect(describe(tx('LESZNOORLEN STACJA NR 4398', -278.17, 'Płatność kartą'))).toEqual({ name: 'Orlen', sub: 'Paliwo · karta', category: 'fuel' });
    expect(describe(tx('LesznoMcDonalds Galeria Lesz', -45, 'Płatność kartą'))).toMatchObject({ name: 'McDonald’s', category: 'eat' });
    expect(describe(tx('LESZNO (RYNEKDINO LESZNO 7', -30, 'Płatność kartą'))).toMatchObject({ name: 'Dino', category: 'grocery' });
    expect(describe(tx('LESZNOALDI SP. Z O.O.', -22, 'Płatność kartą'))).toMatchObject({ name: 'Aldi', category: 'grocery' });
    expect(describe(tx('LesznoGAB. STOMAT. D. BUDZINS', -150, 'Płatność kartą'))).toMatchObject({ category: 'health' });
    expect(describe(tx('Los GatosNetflix.comNL', -75, 'Płatność kartą'))).toMatchObject({ name: 'Netflix', category: 'sub' });
    expect(describe(tx('DublinGoogle Play AppsIE', -47.5, 'Płatność kartą'))).toMatchObject({ name: 'Google Play', category: 'sub' });
  });
  it('guesses a category from a word in an unknown name, and says nothing when it cannot', () => {
    expect(describe(tx('LESZNOCUKIERNIA SOWA 01', -48, 'Płatność kartą'))).toMatchObject({ name: 'Cukiernia Sowa', category: 'eat' });
    expect(describe(tx('LESZNOCENTRUM MEDYCZNE SPO 0', -220, 'Płatność kartą'))).toMatchObject({ category: 'health' });
    expect(describe(tx('LESZNOSERCE SP ZOO', -270))).toEqual({ name: 'Serce', sub: '', category: 'other' });
    expect(describe(tx('LESZNOGRANO SP. Z O.O.', -63.11, 'Płatność kartą'))).toEqual({ name: 'Grano', sub: 'Karta', category: 'other' });
  });
  it('does not invent a shop for a payment by phone or BLIK', () => {
    expect(describe(tx('Płatność telefonem', -1868.49))).toEqual({ name: 'Płatność telefonem', sub: 'Sklep nieznany', category: 'phone' });
    expect(describe(tx('Płatność BLIK', -70.85))).toEqual({ name: 'Płatność BLIK', sub: 'Sklep nieznany', category: 'phone' });
    expect(describe(tx('Płatność telefonem', 12.5))).toEqual({ name: 'Zwrot', sub: 'Zwrot · telefon', category: 'income' });
  });
  it('shows a terminal code as what it looks like, without claiming it is one', () => {
    expect(describe(tx('S1PO1921 4987 00000095087600848', -1500, 'Płatność telefonem'))).toMatchObject({ category: 'atm', sub: 'Wygląda na bankomat' });
  });
  it('tells transfers and income apart, with the written title when there is one', () => {
    expect(describe(tx('ALICJA', -400, 'PRZELEW NA TELEFONOD: 48726571688 MOBILE-PAYMENT-C2C-EXTERNAL'))).toEqual({ name: 'Alicja', sub: 'Przelew', category: 'transfer' });
    expect(describe(tx('FIRMA INFORMATYCZNA WIKTOR METELSKI', 1000, 'PRZELEW IKO NA NUMER RACHUNKU TRANSFER-IN')))
      .toEqual({ name: 'Firma Informatyczna Wiktor Metelski', sub: 'Wpływ · przelew', category: 'income' });
    expect(describe(tx('JONASZ METELSKI', 500, 'LAPTOP OSTATNIA CZESCOD: 48667178938'))).toMatchObject({ sub: 'Wpływ · Laptop ostatnia czesc', category: 'income' });
    expect(describe(tx('Przelew z karty', -100))).toEqual({ name: 'Przelew z karty', sub: 'Karta', category: 'transfer' });
  });
});
