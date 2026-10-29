// @vitest-environment node
import type { Server } from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BankTransaction } from '../src/bank-contract';
import { bankLabelsSourceSchema } from '../src/bank-labels-contract';
import { mapTransaction } from './bank';
import { createBankLabelStore, type BankLabelPersistence } from './bank-labels';
import { maskPhones, partiesOf, publicTransaction } from './bank-parties';
import { agentViews } from './agent-views';
import type { PanelSources } from './sources';
import { createPanelServer } from './app';
import { preamble } from './agent-chat';
import { createScenarioSources } from './scenario';

/**
 * Operations in the shapes PKO sends through Enable Banking, as seen in the account's own cache (every name, number and amount
 * here is made up): a phone transfer writes both numbers into the title and masks the other side's when money goes out; an
 * incoming transfer has the sender and their account in `debtor`; a card payment has only the merchant in the title.
 */
const ACCOUNTS = [{ id: 'acc', name: 'Konto', last4: '4245', currency: 'PLN', balance: 1000, balanceAt: 0 }];
const OWN = { iban: 'PL07102030880000830200724245' };
const day = (d: string) => d;
const raw = {
  phoneOut: (ref: string, date: string, amount: string) => ({ entry_reference: ref, booking_date: day(date), credit_debit_indicator: 'DBIT', status: 'BOOK', transaction_amount: { amount, currency: 'PLN' },
    creditor: { name: 'ANNA KOWALSKA' }, creditor_account: { iban: 'PL61109010140000071219812874' }, debtor_account: OWN,
    remittance_information: ['PRZELEW NA TELEFONOD: 48500100200 DO: 486*****321', 'MOBILE-PAYMENT-C2C-EXTERNAL'] }),
  phoneIn: (ref: string, date: string, amount: string) => ({ entry_reference: ref, booking_date: day(date), credit_debit_indicator: 'CRDT', status: 'BOOK', transaction_amount: { amount, currency: 'PLN' },
    debtor: { name: 'Anna Kowalska' }, debtor_account: { iban: 'PL27114020040000300201355387' },
    remittance_information: ['ZWROT ZA BILETYOD: 48600700321 DO: 48500100200', 'MOBILE-PAYMENT-C2C'] }),
  transferIn: (ref: string, date: string, amount: string, name = 'FIRMA PRZYKŁADOWA SP Z O O', iban = 'PL83101010230000261395100000') => ({ entry_reference: ref, booking_date: day(date), credit_debit_indicator: 'CRDT', status: 'BOOK',
    transaction_amount: { amount, currency: 'PLN' }, debtor: { name }, debtor_account: { iban }, remittance_information: ['PRZELEW IKO NA NUMER RACHUNKU', 'TRANSFER-IN'] }),
  card: (ref: string, date: string, amount: string, merchant = 'LESZNOJMP S.A. BIEDRONKA 5133PL') => ({ entry_reference: ref, booking_date: day(date), credit_debit_indicator: 'DBIT', status: 'BOOK',
    transaction_amount: { amount, currency: 'PLN' }, debtor_account: OWN, remittance_information: [merchant, 'CARD-PAYMENT'] }),
  phonePay: (ref: string, date: string, amount: string) => ({ entry_reference: ref, booking_date: day(date), credit_debit_indicator: 'DBIT', status: 'BOOK',
    transaction_amount: { amount, currency: 'PLN' }, debtor_account: OWN, remittance_information: ['00000000000012345', 'MOBILE-PAYMENT-POS-NO-CARD-TX-CODE'] }),
};
const map = (r: unknown, i = 0) => mapTransaction(r, 'acc', i)!;

describe('who is on the other side', () => {
  it('finds the account, the phone number and the bank’s name of the other side, never the own ones', () => {
    const out = partiesOf(map(raw.phoneOut('O;1', '2026-10-25', '400.00')), ACCOUNTS);
    expect(out.map(p => p.kind).sort()).toEqual(['account', 'name', 'phoneTail']);
    expect(out.find(p => p.kind === 'phoneTail')).toEqual({ kind: 'phoneTail', value: '6…321', hint: '··321' });
    expect(JSON.stringify(out)).not.toContain('500100200'); // the own number, written as OD:
    const back = partiesOf(map(raw.phoneIn('O;2', '2026-10-26', '400.00')), ACCOUNTS);
    expect(back.find(p => p.kind === 'phone')).toEqual({ kind: 'phone', value: '600700321', hint: '··321' });
    // A whole number also stands for its masked form, so the same person is known both ways.
    expect(back.find(p => p.kind === 'phoneTail')?.value).toBe('6…321');
    expect(partiesOf(map(raw.card('O;3', '2026-10-25', '12.00')), ACCOUNTS)).toEqual([]);
    expect(partiesOf(map(raw.phonePay('O;4', '2026-10-25', '12.00')), ACCOUNTS)).toEqual([]);
    // A reading kept before the full numbers were (cut to four digits) has no account to tell anyone by.
    const cut = map(raw.transferIn('O;5', '2026-10-25', '10.00'));
    expect(partiesOf({ ...cut, raw: { ...cut.raw, debtor_account: { iban: '…0000' } } }, ACCOUNTS).map(p => p.kind)).toEqual(['name']);
  });

  it('sends the browser no whole account or phone number', () => {
    const t = publicTransaction(map(raw.phoneIn('O;2', '2026-10-26', '400.00')));
    const text = JSON.stringify(t);
    for (const number of ['600700321', '500100200', '27114020040000300201355387']) expect(text).not.toContain(number);
    expect(t.raw).toMatchObject({ debtor_account: { iban: '…5387' } });
    expect(t.note).toContain('486*****321');
    expect(maskPhones('OD: 48600700321 DO: 600700321, BLIK 00000000000012345')).toBe('OD: 486*****321 DO: 6*****321, BLIK 00000000000012345');
    expect(maskPhones('12345678901234567890123456789012 PAYCARD-TRANSFER')).toBe('…9012 PAYCARD-TRANSFER');
  });
});

const memory = (initial: unknown = null): BankLabelPersistence & { file: unknown; writes: number } => {
  const box = { file: initial, writes: 0 } as BankLabelPersistence & { file: unknown; writes: number };
  box.read = async () => box.file === undefined ? null : structuredClone(box.file);
  box.write = async value => { box.file = structuredClone(value); box.writes++; };
  box.aside = async () => { box.file = null; return 'bank-labels.dpapi.corrupt-1'; };
  return box;
};
const NOW = Date.parse('2026-10-27T09:00:00Z');
function setup(transactions: BankTransaction[], persistence?: BankLabelPersistence) {
  const reading = { observedAt: NOW, accounts: ACCOUNTS, transactions };
  return { reading, store: createBankLabelStore({ operations: async () => reading, persistence, now: () => NOW, today: () => '2026-10-20' }) };
}

describe('bank label store', () => {
  it('counts only operations not done since the chosen day, and keeps marks across a restart', async () => {
    const persistence = memory();
    const ops = [map(raw.card('O;1', '2026-10-26', '43.90')), map(raw.card('O;2', '2026-10-10', '12.00'))];
    const { store } = setup(ops, persistence);
    let src = bankLabelsSourceSchema.parse(await store.read());
    expect(src.data?.since).toBe('2026-10-20');
    expect(src.data?.pending).toEqual(['acc:O;1']);
    const food = (await store.apply({ action: 'createCategory', name: 'Spożywcze' })).category!.id;
    expect((await store.apply({ action: 'createCategory', name: 'spożywcze' })).category).toEqual({ id: food, created: false });
    // A category says its move when the mark does not.
    await store.apply({ action: 'label', tx: 'acc:O;1', category: food, tags: ['#zakupy', 'zakupy ', 'Zakupy'], recurring: false, comment: ' rano ' });
    src = bankLabelsSourceSchema.parse(await store.read());
    expect(src.data?.pending).toEqual([]);
    expect(src.data?.labels['acc:O;1']).toEqual({ move: 'spend', category: food, tags: ['zakupy'], party: null, recurring: false, comment: 'rano' });
    expect(src.data?.tags).toEqual(['zakupy']);
    await store.apply({ action: 'setSince', since: '2026-10-01' });
    const again = setup(ops, persistence).store;
    const after = bankLabelsSourceSchema.parse(await again.read());
    expect(after.data?.labels['acc:O;1']?.category).toBe(food);
    expect(after.data?.pending).toEqual(['acc:O;2']);
    // The file holds no whole number, only keyed hashes and what the bank shows anyway.
    expect(JSON.stringify(persistence.file)).not.toMatch(/0724245/);
  });

  it('keeps a mark together: a category of its own move, none for a settlement or a move, and a settlement with someone', async () => {
    const { store } = setup([map(raw.transferIn('O;1', '2026-10-21', '1000.00'))]);
    const food = (await store.apply({ action: 'createCategory', name: 'Spożywcze' })).category!.id;
    const salary = (await store.apply({ action: 'createCategory', name: 'Pensja', move: 'income' })).category!.id;
    // A spending category and an income source may share a name.
    expect((await store.apply({ action: 'createCategory', name: 'Pensja' })).category?.created).toBe(true);
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', move: 'income', category: food, recurring: false })).rejects.toMatchObject({ status: 409, message: '„Spożywcze” należy do wydatków, nie do przychodów.' });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', move: 'settle', category: null, recurring: false })).rejects.toMatchObject({ status: 409, message: 'Rozliczenie potrzebuje drugiej strony: wybierz, z kim.' });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', move: 'move', category: salary, recurring: false })).rejects.toMatchObject({ status: 409 });
    // A spend or income without its category is said, but not done.
    await store.apply({ action: 'label', tx: 'acc:O;1', move: 'income', category: null, recurring: false });
    expect((await store.read()).data!.pending).toEqual(['acc:O;1']);
    await store.apply({ action: 'label', tx: 'acc:O;1', move: 'move', category: null, recurring: false });
    expect((await store.read()).data!.pending).toEqual([]);
    // A move may go into a pocket of the user's own; a pocket is no spending category.
    const savings = (await store.apply({ action: 'createCategory', name: 'Oszczędności', move: 'move' })).category!.id;
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', move: 'spend', category: savings, recurring: false })).rejects.toMatchObject({ status: 409, message: '„Oszczędności” należy do przełożeń, nie do wydatków.' });
    await store.apply({ action: 'label', tx: 'acc:O;1', category: savings, recurring: false });
    expect((await store.read()).data!.labels['acc:O;1']).toMatchObject({ move: 'move', category: savings });
  });

  it('suggests the next transfer from a known account as it was marked, and leaves it to be marked until taken', async () => {
    const ops = [map(raw.transferIn('O;1', '2026-10-21', '1000.00')), map(raw.transferIn('O;2', '2026-10-26', '500.00'))];
    const { store } = setup(ops);
    const mine = (await store.apply({ action: 'createParty', name: 'Moja firma' })).party!.id;
    const salary = (await store.apply({ action: 'createCategory', name: 'Pensja', move: 'income' })).category!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', move: 'income', category: salary, party: mine, recurring: true });
    const data = (await store.read()).data!;
    expect(data.known['acc:O;2']).toBe(mine);
    expect(data.pending).toEqual(['acc:O;2']);
    expect(data.suggestions['acc:O;2']).toEqual({ sure: false, options: [{ move: 'income', category: salary, party: mine, recurring: true, reasons: ['ten sam rachunek ··0000: Moja firma', 'Przychód · Pensja · cykliczne: 1 z 1 raz'] }] });
    expect(data.suggestions['acc:O;1']).toBeUndefined();
    // The side's habit, for the move buttons; none for an operation already done.
    expect(data.habits).toEqual({ 'acc:O;2': { income: 1 } });
    await store.apply({ action: 'accept', tx: 'acc:O;2' });
    expect((await store.read()).data!.pending).toEqual([]);
  });

  it('is sure of a transfer only after two agreeing marks; a single mark is a choice that can be picked', async () => {
    const ops = [map(raw.transferIn('O;0', '2026-10-19', '1000.00')), map(raw.transferIn('O;1', '2026-10-21', '1000.00')), map(raw.transferIn('O;2', '2026-10-26', '500.00')), map(raw.transferIn('O;3', '2026-10-27', '500.00')), map(raw.card('O;4', '2026-10-27', '12.00'))];
    const { store } = setup(ops);
    const mine = (await store.apply({ action: 'createParty', name: 'Moja firma' })).party!.id;
    const salary = (await store.apply({ action: 'createCategory', name: 'Pensja', move: 'income' })).category!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', move: 'income', category: salary, party: mine, recurring: true });
    expect((await store.read()).data!.suggestions['acc:O;2'].sure).toBe(false);
    await store.apply({ action: 'label', tx: 'acc:O;0', move: 'income', category: salary, party: mine, recurring: true });
    expect((await store.read()).data!.suggestions['acc:O;2']).toMatchObject({ sure: true });
  });

  it('marks many operations in one write with the whole mark of each, or none', async () => {
    const ops = [map(raw.transferIn('O;1', '2026-10-21', '1000.00')), map(raw.transferIn('O;2', '2026-10-26', '500.00')), map(raw.card('O;3', '2026-10-27', '12.00')), map(raw.card('O;4', '2026-10-27', '13.00'))];
    const { store } = setup(ops);
    const mine = (await store.apply({ action: 'createParty', name: 'Moja firma' })).party!.id;
    const salary = (await store.apply({ action: 'createCategory', name: 'Pensja', move: 'income' })).category!.id;
    const food = (await store.apply({ action: 'createCategory', name: 'Jedzenie' })).category!.id;
    const item = (tx: string, over: Record<string, unknown> = {}) => ({ tx, move: 'income', category: salary, tags: [], party: mine, recurring: false, ...over });
    // an operation of a kind that does not fit its category refuses the lot
    await expect(store.apply({ action: 'markMany', items: [item('acc:O;1'), item('acc:O;3', { move: 'spend' })] } as never)).rejects.toMatchObject({ status: 409 });
    expect((await store.read()).data!.labels['acc:O;1']).toBeUndefined();
    expect(await store.apply({ action: 'markMany', items: [item('acc:O;1', { recurring: true }), item('acc:O;3', { move: 'spend', category: food, tags: ['kfc'], party: null })] } as never)).toMatchObject({ ok: true, assigned: 2 });
    const data = (await store.read()).data!;
    expect(data.labels['acc:O;1']).toMatchObject({ move: 'income', category: salary, party: mine, recurring: true });
    expect(data.labels['acc:O;3']).toMatchObject({ move: 'spend', category: food, tags: ['kfc'], party: null });
    // an operation already done, one that is not there, one twice, and nothing at all are refused
    await expect(store.apply({ action: 'markMany', items: [item('acc:O;1')] } as never)).rejects.toMatchObject({ status: 409 });
    await expect(store.apply({ action: 'markMany', items: [item('acc:nope')] } as never)).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'markMany', items: [item('acc:O;2'), item('acc:O;2')] } as never)).rejects.toMatchObject({ status: 400 });
    await expect(store.apply({ action: 'markMany', items: [] } as never)).rejects.toMatchObject({ status: 400 });
  });

  it('makes the categories named on the card in the same write, uses one that exists, and makes nothing when the write is refused', async () => {
    const ops = [map(raw.card('O;1', '2026-10-26', '43.90')), map(raw.card('O;2', '2026-10-25', '80.00')), map(raw.card('O;3', '2026-10-24', '12.00'))];
    const { store } = setup(ops);
    const food = (await store.apply({ action: 'createCategory', name: 'Jedzenie' })).category!.id;
    const item = (tx: string, over: Record<string, unknown> = {}) => ({ tx, move: 'spend', category: null, tags: [], party: null, recurring: false, ...over });
    // refused as a whole (an unknown new name): no category is made
    await expect(store.apply({ action: 'markMany', create: ['Paliwo'], items: [item('acc:O;1', { newCategory: 'Paliwo' }), item('acc:O;2', { newCategory: 'Inna' })] } as never)).rejects.toMatchObject({ status: 404 });
    expect((await store.read()).data!.categories.map(c => c.name)).toEqual(['Jedzenie']);
    expect(await store.apply({ action: 'markMany', create: ['Paliwo', 'jedzenie'], items: [item('acc:O;1', { newCategory: 'Paliwo' }), item('acc:O;2', { newCategory: 'Jedzenie' }), item('acc:O;3', { category: food })] } as never)).toMatchObject({ ok: true, assigned: 3 });
    const data = (await store.read()).data!;
    const fuel = data.categories.find(c => c.name === 'Paliwo')!;
    expect(data.categories.map(c => c.name)).toEqual(['Jedzenie', 'Paliwo']);
    expect(data.labels['acc:O;1']).toMatchObject({ move: 'spend', category: fuel.id });
    expect(data.labels['acc:O;2']).toMatchObject({ category: food });
  });

  it('refuses what it cannot do and changes nothing then', async () => {
    const persistence = memory();
    const { store } = setup([map(raw.card('O;1', '2026-10-26', '43.90'))], persistence);
    await expect(store.apply({ action: 'label', tx: 'acc:nope', category: null, recurring: true })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', category: 'c-00000000', recurring: false })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', category: null, party: 'k-00000000', recurring: false })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'accept', tx: 'acc:O;1' })).rejects.toMatchObject({ status: 409 });
    await expect(store.apply({ action: 'nuke' } as never)).rejects.toMatchObject({ status: 400 });
    await expect(store.apply({ action: 'createParty', name: 'X', kind: 'person' } as never)).rejects.toMatchObject({ status: 400 });
    const failing = { ...persistence, write: async () => { throw new Error('disk'); } };
    const broken = setup([map(raw.card('O;1', '2026-10-26', '43.90'))], failing).store;
    await expect(broken.apply({ action: 'createCategory', name: 'X' })).rejects.toMatchObject({ status: 503 });
    expect((await broken.read()).data?.categories).toEqual([]);
  });

  it('keeps an unreadable file aside and says so, and leaves a file it cannot read now alone', async () => {
    const corrupt = memory({ version: 7 });
    const src = await setup([], corrupt).store.read();
    expect(src.message).toContain('zachowany jako bank-labels.dpapi.corrupt-1');
    const busy: BankLabelPersistence = { read: async () => { throw new Error('Private store unavailable'); }, write: async () => { throw new Error('must not write'); } };
    const offline = await setup([], busy).store.read();
    expect(offline.status).toBe('offline');
  });

  it('tells two people of the same name apart by what the bank showed for each, and recognises them on the next transfer', async () => {
    const first = map(raw.phoneIn('O;1', '2026-10-21', '150.00'));
    const next = map(raw.phoneOut('O;2', '2026-10-26', '400.00'));
    const other = map(raw.transferIn('O;3', '2026-10-22', '50.00', 'DANIEL NOWAK', 'PL10105000997603123456789123'));
    const { store } = setup([next, other, first]);
    const anna = (await store.apply({ action: 'createParty', name: 'Daniel' })).party!.id;
    const second = (await store.apply({ action: 'createParty', name: 'Daniel' })).party!.id;
    expect(second).not.toBe(anna);
    expect((await store.read()).data?.suggestions['acc:O;2']).toBeUndefined();
    await store.apply({ action: 'label', tx: 'acc:O;1', category: null, recurring: false, party: anna });
    await store.apply({ action: 'label', tx: 'acc:O;3', category: null, recurring: false, party: second });
    const src = (await store.read()).data!;
    expect(src.parties.find(p => p.id === anna)!.identifiers.map(i => `${i.kind} ${i.hint}`).sort()).toEqual(['account ··5387', 'name Anna Kowalska', 'phone ··321', 'phoneTail ··321']);
    expect(src.parties.find(p => p.id === second)!.identifiers.map(i => `${i.kind} ${i.hint}`).sort()).toEqual(['account ··9123', 'name DANIEL NOWAK']);
    // Going out the bank sends to another account and masks the number; the bank's name still says who it is.
    expect(src.known['acc:O;2']).toBe(anna);
    expect(src.suggestions['acc:O;2']).toEqual({ sure: true, options: [{ party: anna, reasons: ['ta sama nazwa w banku („Anna Kowalska”): Daniel'] }] });
  });

  it('learns a merchant from its text in the bank and proposes its earlier mark after one time, never marking by itself', async () => {
    const ops = ['O;1', 'O;2', 'O;3'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, `${20 + i}.00`, 'LESZNOSPOLEM PSS Sklep nr 12PL')));
    const { store } = setup(ops);
    const food = (await store.apply({ action: 'createCategory', name: 'Spożywcze' })).category!.id;
    const spolem = (await store.apply({ action: 'createParty', name: 'Społem' })).party!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', move: 'spend', category: food, tags: ['zakupy'], party: spolem, recurring: false });
    let data = (await store.read()).data!;
    expect(data.known['acc:O;3']).toBe(spolem);
    expect(data.suggestions['acc:O;3']).toEqual({ sure: false, options: [{ move: 'spend', category: food, tags: ['zakupy'], party: spolem, reasons: ['ten sam tekst w banku: Społem', 'Spożywcze · #zakupy: 1 z 1 raz'] }] });
    expect(data.labels['acc:O;3']).toBeUndefined();
    // Older than the day "to be marked" counts from: not counted, but still suggested when opened.
    await store.apply({ action: 'setSince', since: '2026-10-25' });
    data = (await store.read()).data!;
    expect(data.pending).toEqual([]);
    expect(data.suggestions['acc:O;3'].sure).toBe(false);
    await store.apply({ action: 'accept', tx: 'acc:O;3' });
    data = (await store.read()).data!;
    expect(data.labels['acc:O;3']).toEqual({ move: 'spend', category: food, tags: ['zakupy'], party: spolem, recurring: false, comment: '' });
    // A rejection is remembered for that operation, and puts the same mark in doubt for the others.
    await store.apply({ action: 'reject', tx: 'acc:O;2' });
    data = (await store.read()).data!;
    expect(data.suggestions['acc:O;2']).toBeUndefined();
  });

  it('offers a choice, not a guess, when earlier marks differ, and nothing for a payment with no name from the bank', async () => {
    const ops = [
      ...['O;1', 'O;2', 'O;3'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, '10.00', 'LESZNOKAWIARNIA 7PL'))),
      map(raw.phonePay('P;1', '2026-10-21', '76.93')), map(raw.phonePay('P;2', '2026-10-26', '76.93')), map(raw.phonePay('P;3', '2026-10-26', '20.10')),
    ];
    const { store } = setup(ops);
    const a = (await store.apply({ action: 'createCategory', name: 'Kawa' })).category!.id;
    const b = (await store.apply({ action: 'createCategory', name: 'Spotkania' })).category!.id;
    const cafe = (await store.apply({ action: 'createParty', name: 'Kawiarnia' })).party!.id;
    const pyszne = (await store.apply({ action: 'createParty', name: 'pyszne.pl' })).party!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: a, party: cafe, recurring: false });
    await store.apply({ action: 'label', tx: 'acc:O;2', category: b, party: cafe, recurring: false });
    await store.apply({ action: 'label', tx: 'acc:P;1', category: a, tags: ['restauracja'], party: pyszne, recurring: false });
    const data = (await store.read()).data!;
    expect(data.suggestions['acc:O;3'].sure).toBe(false);
    expect(data.suggestions['acc:O;3'].options.map(o => o.category)).toEqual([b, a]);
    // A payment the bank gives no name for is linked to nothing, not even to an earlier one of the very same amount: amounts change.
    expect(data.suggestions['acc:P;2']).toBeUndefined();
    expect(data.suggestions['acc:P;3']).toBeUndefined();
    await store.apply({ action: 'accept', tx: 'acc:O;3', option: 1 });
    expect((await store.read()).data!.labels['acc:O;3']).toMatchObject({ move: 'spend', category: a, party: cafe });
  });

  it('merges a category into another of its list: marks move, the name may stay as a tag, lists of other moves are refused', async () => {
    const ops = [map(raw.card('O;1', '2026-10-26', '43.90')), map(raw.card('O;2', '2026-10-25', '80.00'))];
    const { store } = setup(ops);
    const health = (await store.apply({ action: 'createCategory', name: 'Zdrowie', move: 'spend' })).category!.id;
    const psy = (await store.apply({ action: 'createCategory', name: 'Psycholog', move: 'spend' })).category!.id;
    const pocket = (await store.apply({ action: 'createCategory', name: 'Revolut', move: 'move' })).category!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: psy, recurring: false });
    await store.apply({ action: 'label', tx: 'acc:O;2', category: psy, tags: ['psycholog'], recurring: false });
    await expect(store.apply({ action: 'mergeCategory', category: psy, into: pocket })).rejects.toMatchObject({ status: 409 });
    expect((await store.apply({ action: 'mergeCategory', category: psy, into: health, tag: 'Psycholog' })).removed).toBe(2);
    const data = (await store.read()).data!;
    expect(data.categories.map(c => c.name)).not.toContain('Psycholog');
    expect(data.labels['acc:O;1']).toMatchObject({ category: health, tags: ['psycholog'] });
    expect(data.labels['acc:O;2']).toMatchObject({ category: health, tags: ['psycholog'] });
    expect(data.tags).toEqual(['psycholog']);
  });

  it('renames and deletes tags everywhere, and deleting a category or a side unmarks only that part', async () => {
    const ops = ['O;1', 'O;2'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, '10.00', 'LESZNOKAWIARNIA 7PL')));
    const { store } = setup(ops);
    const a = (await store.apply({ action: 'createCategory', name: 'Kawa' })).category!.id;
    const cafe = (await store.apply({ action: 'createParty', name: 'Kawiarnia' })).party!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: a, tags: ['kawa', 'praca'], party: cafe, recurring: true });
    await store.apply({ action: 'label', tx: 'acc:O;2', category: null, tags: ['praca'], party: null, recurring: false });
    await store.apply({ action: 'renameTag', tag: 'praca', name: 'kawa' });
    let data = (await store.read()).data!;
    expect(data.labels['acc:O;1'].tags).toEqual(['kawa']);
    expect(data.tags).toEqual(['kawa']);
    expect((await store.apply({ action: 'deleteTag', tag: 'kawa' })).removed).toBe(2);
    data = (await store.read()).data!;
    expect(data.labels['acc:O;2']).toBeUndefined();
    expect((await store.apply({ action: 'deleteParty', party: cafe })).removed).toBe(1);
    expect((await store.apply({ action: 'deleteCategory', category: a })).removed).toBe(1);
    // The move stays: it is still a spend, now without a category, so it is to be marked again.
    expect((await store.read()).data!.labels['acc:O;1']).toEqual({ move: 'spend', category: null, tags: [], party: null, recurring: true, comment: '' });
  });
});

describe('the agent’s bank view', () => {
  it('answers what is open with whom, what went on a category, net, and what is still to be marked, with no whole numbers', async () => {
    const lent = map(raw.phoneOut('O;1', '2026-10-21', '400.00'));
    const back = map(raw.phoneIn('O;2', '2026-10-26', '150.00'));
    const shrink = map(raw.card('O;3', '2026-10-22', '200.00', 'LESZNOGABINET PSYCHOLOGICZNY 3PL'));
    const open = map(raw.phonePay('O;4', '2026-10-26', '33.10'));
    const { store, reading } = setup([open, back, shrink, lent]);
    const psych = (await store.apply({ action: 'createCategory', name: 'Psycholog' })).category!.id;
    const anna = (await store.apply({ action: 'createParty', name: 'Anna' })).party!.id;
    await store.apply({ action: 'label', tx: lent.id, move: 'settle', category: null, recurring: false, party: anna, comment: 'na bilety' });
    await store.apply({ action: 'label', tx: back.id, move: 'settle', category: null, recurring: false, party: anna });
    await store.apply({ action: 'label', tx: shrink.id, category: psych, recurring: true });
    const sources = {
      bank: async () => ({ live: true, name: 'PKO BP', status: 'connected', observedAt: NOW, consentUntil: null, data: { accounts: ACCOUNTS, transactions: reading.transactions.map(publicTransaction) } }),
      bankLedger: () => store.ledger(),
    } as unknown as PanelSources;
    const view = (q = '') => agentViews(sources).bank(new URL(`http://x/api/agent/bank${q}`), NOW);
    const text = await view();
    expect(text).toContain('Anna: do oddania użytkownikowi 250,00 PLN');
    expect(text).toContain('Przychody 0,00 PLN, wydatki −233,10 PLN, netto −233,10 PLN. Poza tymi sumami: rozliczenia −250,00 PLN, przełożenia 0,00 PLN.');
    expect(text).toContain('Wydatki według kategorii: Psycholog 200,00 PLN; nieoznaczone 33,10 PLN.');
    expect(text).toContain('opis: „na bilety”');
    expect(text).toContain('ruch: rozliczenie');
    expect(text).toContain('Do przypisania: 1.');
    expect(text).not.toMatch(/\d{9}/);
    expect(text).not.toContain('PL61');
    const settled = await view('?ruch=rozliczenia');
    expect(settled.split('\n').filter(l => l.includes('ruch: rozliczenie'))).toHaveLength(2);
    const month = await view('?from=2026-10-01&to=2026-10-31&kategoria=psych');
    expect(month).toContain('w kategorii Psycholog');
    expect(month.split('\n').filter(l => l.includes('kategoria: Psycholog'))).toHaveLength(1);
    expect(month).toContain('cykliczne');
    const todo = await view('?nieprzypisane=1');
    expect(todo.split('\n').filter(l => l.includes('DO PRZYPISANIA'))).toHaveLength(1);
    await expect(view('?from=2025-01-01&to=2026-10-31')).rejects.toThrow('najwyżej 400 dni');
  });
});

describe('the bank label routes (standard scenario)', () => {
  let server: Server | undefined;
  afterEach(() => { server?.close(); server = undefined; });
  async function start() {
    server = createPanelServer(createScenarioSources(path.join(process.cwd(), 'scenarios', 'standard.json')), process.cwd()).listen(0, '127.0.0.1');
    await new Promise(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const post = (body: unknown, origin: string | null = base) => fetch(`${base}/api/bank/labels/action`, { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) } });
    return { base, post };
  }

  it('serves marks and suggestions, takes actions only from the panel’s own page, and keeps numbers out', async () => {
    const { base, post } = await start();
    const labels = bankLabelsSourceSchema.parse(await (await fetch(`${base}/api/bank/labels`)).json());
    expect(labels.data!.suggestions['acc-1:t13']).toEqual({ sure: true, options: [{ party: 'k-00000012', reasons: ['ta sama nazwa w banku („Anna Kowalska”): Anna'] }] });
    expect(labels.data!.suggestions['acc-1:t1'].options[0]).toMatchObject({ move: 'income', category: 'c-0000000f', party: 'k-00000010', recurring: true });
    expect(labels.data!.suggestions['acc-1:t22']).toBeUndefined();
    expect(labels.data!.balances).toEqual([{ party: 'k-00000012', currency: 'PLN', amount: -120 }]);
    expect((await post({ action: 'accept', tx: 'acc-1:t3' }, null)).status).toBe(403);
    expect((await post({ action: 'accept', tx: 'acc-1:t3' }, 'http://evil.example')).status).toBe(403);
    expect((await post({ action: 'nuke' })).status).toBe(400);
    const missing = await post({ action: 'label', tx: 'acc-1:none', category: null, recurring: true });
    expect(await missing.json()).toEqual({ error: 'Nie ma takiej operacji w ostatnim odczycie banku.' });
    expect((await post({ action: 'accept', tx: 'acc-1:t3' })).status).toBe(200);
    const after = bankLabelsSourceSchema.parse(await (await fetch(`${base}/api/bank/labels`)).json());
    expect(after.data!.labels['acc-1:t3']).toEqual({ move: 'spend', category: 'c-0000000a', tags: [], party: 'k-0000000a', recurring: false, comment: '' });
    expect(after.data!.pending).not.toContain('acc-1:t3');
    const everything = await (await fetch(`${base}/api/bank`)).text() + await (await fetch(`${base}/api/bank/labels`)).text();
    for (const number of ['PL61109010140000071219812874', '48667178938', '667178938']) expect(everything).not.toContain(number);
    const agent = await (await fetch(`${base}/api/agent/bank?nieprzypisane=1`)).text();
    expect(agent).toContain('Anna: użytkownik ma do oddania 120,00 PLN');
    expect(agent).not.toMatch(/667178938|0071219812874/);
  });
});

it('tells the agent about the bank view and that marks are not its to change', () => {
  const text = preamble();
  expect(text).toContain('/api/agent/bank?from=');
  expect(text).toContain('oznaczeń nie zmieniasz');
  expect(text).toContain('/api/bank/labels/action');
});
