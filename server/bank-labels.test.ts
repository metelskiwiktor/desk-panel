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
  it('counts only unmarked operations since the chosen day, and keeps marks across a restart', async () => {
    const persistence = memory();
    const ops = [map(raw.card('O;1', '2026-10-26', '43.90')), map(raw.card('O;2', '2026-10-10', '12.00'))];
    const { store } = setup(ops, persistence);
    let src = bankLabelsSourceSchema.parse(await store.read());
    expect(src.data?.since).toBe('2026-10-20');
    expect(src.data?.pending).toEqual(['acc:O;1']);
    const food = (await store.apply({ action: 'createCategory', name: 'Spożywcze' })).category!.id;
    expect((await store.apply({ action: 'createCategory', name: 'spożywcze' })).category).toEqual({ id: food, created: false });
    await store.apply({ action: 'label', tx: 'acc:O;1', category: food, tags: ['#zakupy', 'zakupy ', 'Zakupy'], recurring: false, person: null, comment: ' rano ' });
    src = bankLabelsSourceSchema.parse(await store.read());
    expect(src.data?.pending).toEqual([]);
    expect(src.data?.labels['acc:O;1']).toEqual({ category: food, tags: ['zakupy'], merchant: null, person: null, recurring: false, comment: 'rano' });
    expect(src.data?.tags).toEqual(['zakupy']);
    await store.apply({ action: 'setSince', since: '2026-10-01' });
    const again = setup(ops, persistence).store;
    const after = bankLabelsSourceSchema.parse(await again.read());
    expect(after.data?.labels['acc:O;1']?.category).toBe(food);
    expect(after.data?.pending).toEqual(['acc:O;2']);
    // The file holds no whole number, only keyed hashes and what the bank shows anyway.
    expect(JSON.stringify(persistence.file)).not.toMatch(/0724245/);
  });

  it('upgrades a file of the first version: categories, people and marks stay, tags and merchants start empty', async () => {
    const op = { at: Date.parse('2026-10-26T12:00:00Z'), amount: -43.9, currency: 'PLN', name: 'Biedronka', method: 'card', merchant: 'BIEDRONKA', keys: [] };
    const v1 = {
      version: 1, secret: 'x'.repeat(43), since: '2026-10-26', categories: [{ id: 'c-00000001', name: 'Jedzenie', color: 'orange', icon: 'utensils' }],
      people: [{ id: 'p-00000001', name: 'pyszne.pl', createdAt: 1, identifiers: [] }],
      labels: { 'acc:O;1': { category: 'c-00000001', recurring: false, person: 'p-00000001', comment: '', labeledAt: 1, op } },
    };
    const persistence = memory(v1);
    const src = await setup([map(raw.card('O;1', '2026-10-26', '43.90'))], persistence).store.read();
    expect(src.message).toBeUndefined();
    expect(src.data?.labels['acc:O;1']).toEqual({ category: 'c-00000001', tags: [], merchant: null, person: 'p-00000001', recurring: false, comment: '' });
    expect((persistence.file as { version: number }).version).toBe(2);
  });

  it('refuses what it cannot do and changes nothing then', async () => {
    const persistence = memory();
    const { store } = setup([map(raw.card('O;1', '2026-10-26', '43.90'))], persistence);
    await expect(store.apply({ action: 'label', tx: 'acc:nope', category: null, recurring: true, person: null })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', category: 'c-00000000', recurring: false, person: null })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'label', tx: 'acc:O;1', category: null, merchant: 'm-00000000', recurring: false, person: null })).rejects.toMatchObject({ status: 404 });
    await expect(store.apply({ action: 'accept', tx: 'acc:O;1' })).rejects.toMatchObject({ status: 409 });
    await expect(store.apply({ action: 'nuke' } as never)).rejects.toMatchObject({ status: 400 });
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
    const anna = (await store.apply({ action: 'createPerson', name: 'Daniel' })).person!.id;
    const second = (await store.apply({ action: 'createPerson', name: 'Daniel' })).person!.id;
    expect(second).not.toBe(anna);
    expect((await store.read()).data?.suggestions['acc:O;2']).toBeUndefined();
    await store.apply({ action: 'label', tx: 'acc:O;1', category: null, recurring: false, person: anna });
    await store.apply({ action: 'label', tx: 'acc:O;3', category: null, recurring: false, person: second });
    const src = (await store.read()).data!;
    expect(src.people.find(p => p.id === anna)!.identifiers.map(i => `${i.kind} ${i.hint}`).sort()).toEqual(['account ··5387', 'name Anna Kowalska', 'phone ··321', 'phoneTail ··321']);
    expect(src.people.find(p => p.id === second)!.identifiers.map(i => `${i.kind} ${i.hint}`).sort()).toEqual(['account ··9123', 'name DANIEL NOWAK']);
    // Going out the bank sends to another account and masks the number; the bank's name still says who it is.
    expect(src.known['acc:O;2']).toEqual({ person: anna });
    expect(src.suggestions['acc:O;2']).toEqual({ sure: true, options: [{ person: anna, reasons: ['ta sama nazwa w banku („Anna Kowalska”): Daniel'] }] });
  });

  it('learns a merchant from its text in the bank and proposes its earlier mark after one time, never marking by itself', async () => {
    const ops = ['O;1', 'O;2', 'O;3'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, `${20 + i}.00`, 'LESZNOSPOLEM PSS Sklep nr 12PL')));
    const { store } = setup(ops);
    const food = (await store.apply({ action: 'createCategory', name: 'Spożywcze' })).category!.id;
    const spolem = (await store.apply({ action: 'createMerchant', name: 'Społem' })).merchant!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: food, tags: ['zakupy'], merchant: spolem, recurring: false, person: null });
    let data = (await store.read()).data!;
    expect(data.known['acc:O;3']).toEqual({ merchant: spolem });
    expect(data.suggestions['acc:O;3']).toEqual({ sure: true, options: [{ category: food, tags: ['zakupy'], merchant: spolem, reasons: ['ten sam sprzedawca w banku: Społem', 'Spożywcze · #zakupy: 1 z 1 raz'] }] });
    expect(data.labels['acc:O;3']).toBeUndefined();
    await store.apply({ action: 'accept', tx: 'acc:O;3' });
    data = (await store.read()).data!;
    expect(data.labels['acc:O;3']).toEqual({ category: food, tags: ['zakupy'], merchant: spolem, person: null, recurring: false, comment: '' });
    // A rejection is remembered for that operation, and puts the same mark in doubt for the others.
    await store.apply({ action: 'reject', tx: 'acc:O;2' });
    data = (await store.read()).data!;
    expect(data.suggestions['acc:O;2']).toBeUndefined();
  });

  it('offers a choice, not a guess, when earlier marks differ or only the exact amount links them', async () => {
    const ops = [
      ...['O;1', 'O;2', 'O;3'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, '10.00', 'LESZNOKAWIARNIA 7PL'))),
      map(raw.phonePay('P;1', '2026-10-21', '76.93')), map(raw.phonePay('P;2', '2026-10-26', '76.93')), map(raw.phonePay('P;3', '2026-10-26', '20.10')),
    ];
    const { store } = setup(ops);
    const a = (await store.apply({ action: 'createCategory', name: 'Kawa' })).category!.id;
    const b = (await store.apply({ action: 'createCategory', name: 'Spotkania' })).category!.id;
    const cafe = (await store.apply({ action: 'createMerchant', name: 'Kawiarnia' })).merchant!.id;
    const pyszne = (await store.apply({ action: 'createMerchant', name: 'pyszne.pl' })).merchant!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: a, merchant: cafe, recurring: false, person: null });
    await store.apply({ action: 'label', tx: 'acc:O;2', category: b, merchant: cafe, recurring: false, person: null });
    await store.apply({ action: 'label', tx: 'acc:P;1', category: a, tags: ['restauracja'], merchant: pyszne, recurring: false, person: null });
    const data = (await store.read()).data!;
    expect(data.suggestions['acc:O;3'].sure).toBe(false);
    expect(data.suggestions['acc:O;3'].options.map(o => o.category)).toEqual([b, a]);
    expect(data.suggestions['acc:P;2']).toEqual({ sure: false, options: [{ category: a, tags: ['restauracja'], merchant: pyszne, reasons: [expect.stringMatching(/^ta sama kwota 76,93\s?zł, bez nazwy sklepu$/), 'pyszne.pl · Kawa · #restauracja: 1 z 1 raz'] }] });
    // No ranges and no guessing: another amount has nothing.
    expect(data.suggestions['acc:P;3']).toBeUndefined();
    await store.apply({ action: 'accept', tx: 'acc:O;3', option: 1 });
    expect((await store.read()).data!.labels['acc:O;3']).toMatchObject({ category: a, merchant: cafe });
  });

  it('renames and deletes tags everywhere, and deleting a category or merchant unmarks only that part', async () => {
    const ops = ['O;1', 'O;2'].map((ref, i) => map(raw.card(ref, `2026-10-2${i}`, '10.00', 'LESZNOKAWIARNIA 7PL')));
    const { store } = setup(ops);
    const a = (await store.apply({ action: 'createCategory', name: 'Kawa' })).category!.id;
    const cafe = (await store.apply({ action: 'createMerchant', name: 'Kawiarnia' })).merchant!.id;
    await store.apply({ action: 'label', tx: 'acc:O;1', category: a, tags: ['kawa', 'praca'], merchant: cafe, recurring: true, person: null });
    await store.apply({ action: 'label', tx: 'acc:O;2', category: null, tags: ['praca'], merchant: null, recurring: false, person: null });
    await store.apply({ action: 'renameTag', tag: 'praca', name: 'kawa' });
    let data = (await store.read()).data!;
    expect(data.labels['acc:O;1'].tags).toEqual(['kawa']);
    expect(data.tags).toEqual(['kawa']);
    expect((await store.apply({ action: 'deleteTag', tag: 'kawa' })).removed).toBe(2);
    data = (await store.read()).data!;
    expect(data.labels['acc:O;2']).toBeUndefined();
    expect((await store.apply({ action: 'deleteMerchant', merchant: cafe })).removed).toBe(1);
    expect((await store.apply({ action: 'deleteCategory', category: a })).removed).toBe(1);
    expect((await store.read()).data!.labels['acc:O;1']).toEqual({ category: null, tags: [], merchant: null, person: null, recurring: true, comment: '' });
  });
});

describe('the agent’s bank view', () => {
  it('answers who paid back, what went on a category and what is still to be marked, with no whole numbers', async () => {
    const lent = map(raw.phoneOut('O;1', '2026-10-21', '400.00'));
    const back = map(raw.phoneIn('O;2', '2026-10-26', '150.00'));
    const shrink = map(raw.card('O;3', '2026-10-22', '200.00', 'LESZNOGABINET PSYCHOLOGICZNY 3PL'));
    const open = map(raw.phonePay('O;4', '2026-10-26', '33.10'));
    const { store, reading } = setup([open, back, shrink, lent]);
    const loan = (await store.apply({ action: 'createCategory', name: 'Pożyczka' })).category!.id;
    const psych = (await store.apply({ action: 'createCategory', name: 'Psycholog' })).category!.id;
    const anna = (await store.apply({ action: 'createPerson', name: 'Anna' })).person!.id;
    await store.apply({ action: 'label', tx: lent.id, category: loan, recurring: false, person: anna, comment: 'na bilety' });
    await store.apply({ action: 'label', tx: back.id, category: loan, recurring: false, person: anna });
    await store.apply({ action: 'label', tx: shrink.id, category: psych, recurring: true, person: null });
    const sources = {
      bank: async () => ({ live: true, name: 'PKO BP', status: 'connected', observedAt: NOW, consentUntil: null, data: { accounts: ACCOUNTS, transactions: reading.transactions.map(publicTransaction) } }),
      bankLedger: () => store.ledger(),
    } as unknown as PanelSources;
    const view = (q = '') => agentViews(sources).bank(new URL(`http://x/api/agent/bank${q}`), NOW);
    const text = await view();
    expect(text).toContain('Anna: wysłano 400,00 PLN, otrzymano 150,00 PLN; Pożyczka −250,00 PLN');
    expect(text).toContain('Wydatki według kategorii: Pożyczka 400,00 PLN; Psycholog 200,00 PLN; bez kategorii 33,10 PLN.');
    expect(text).toContain('komentarz: „na bilety”');
    expect(text).toContain('Do przypisania: 1.');
    expect(text).not.toMatch(/\d{9}/);
    expect(text).not.toContain('PL61');
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
    expect(labels.data!.suggestions['acc-1:t13']).toMatchObject({ sure: true, options: [{ person: 'p-0000000a', category: 'c-0000000d' }] });
    expect(labels.data!.suggestions['acc-1:t22'].sure).toBe(false);
    expect((await post({ action: 'accept', tx: 'acc-1:t13' }, null)).status).toBe(403);
    expect((await post({ action: 'accept', tx: 'acc-1:t13' }, 'http://evil.example')).status).toBe(403);
    expect((await post({ action: 'nuke' })).status).toBe(400);
    const missing = await post({ action: 'label', tx: 'acc-1:none', category: null, recurring: true, person: null });
    expect(await missing.json()).toEqual({ error: 'Nie ma takiej operacji w ostatnim odczycie banku.' });
    expect((await post({ action: 'accept', tx: 'acc-1:t13' })).status).toBe(200);
    const after = bankLabelsSourceSchema.parse(await (await fetch(`${base}/api/bank/labels`)).json());
    expect(after.data!.labels['acc-1:t13']).toEqual({ category: 'c-0000000d', tags: [], merchant: null, recurring: false, person: 'p-0000000a', comment: '' });
    expect(after.data!.pending).not.toContain('acc-1:t13');
    const everything = await (await fetch(`${base}/api/bank`)).text() + await (await fetch(`${base}/api/bank/labels`)).text();
    for (const number of ['PL61109010140000071219812874', '48667178938', '667178938']) expect(everything).not.toContain(number);
    const agent = await (await fetch(`${base}/api/agent/bank?nieprzypisane=1`)).text();
    expect(agent).toContain('Anna: wysłano 120,00 PLN, otrzymano 120,00 PLN; Pożyczka 0,00 PLN');
    expect(agent).not.toMatch(/667178938|0071219812874/);
  });
});

it('tells the agent about the bank view and that marks are not its to change', () => {
  const text = preamble();
  expect(text).toContain('/api/agent/bank?from=');
  expect(text).toContain('oznaczeń nie zmieniasz');
  expect(text).toContain('/api/bank/labels/action');
});
