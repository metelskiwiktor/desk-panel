// @vitest-environment node
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bankSourceSchema } from '../src/bank-contract';
import { publicTransaction } from './bank-parties';
import { BANK_REFRESH_MS, BankError, cleanTitle, createBank, mapTransaction, type BankStore } from './bank';

let dir = '';
let keyFile = '';
beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'bank-'));
  keyFile = join(dir, 'private.pem');
  await writeFile(keyFile, generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }));
});
afterAll(() => rm(dir, { recursive: true, force: true }));

const memory = (initial: Record<string, unknown> = {}): BankStore & { files: Record<string, unknown> } => {
  const files = { ...initial };
  return { files, read: async name => { if (!(name in files)) throw new Error('missing'); return files[name]; }, write: async (name, value) => { files[name] = value; } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const NOW = Date.parse('2026-10-25T12:00:00Z');
const session = { sessionId: 's-1', validUntil: NOW + 100 * 86_400_000, accounts: [{ uid: 'uid-1', name: 'Konto', last4: '4245', currency: 'PLN' }] };
const operation = { entry_reference: 'r1', transaction_amount: { amount: '12.50', currency: 'PLN' }, credit_debit_indicator: 'DBIT', booking_date: '2026-10-24', creditor: { name: 'Sklep' }, remittance_information: ['Zakup', 'karta'] };

function api(over: Record<string, () => Response> = {}) {
  return vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    for (const [match, answer] of Object.entries(over)) if (path.includes(match)) return answer();
    if (path.endsWith('/balances')) return json({ balances: [{ balance_type: 'ITAV', balance_amount: { amount: '1.00', currency: 'PLN' } }, { balance_type: 'CLBD', balance_amount: { amount: '100.25', currency: 'PLN' }, reference_date: '2026-10-24' }] });
    if (path.endsWith('/transactions')) return json({ transactions: [operation, { ...operation, entry_reference: 'r2', credit_debit_indicator: 'CRDT', transaction_amount: { amount: '300', currency: 'PLN' }, debtor: { name: 'Firma' }, creditor: undefined, booking_date: '2026-10-25' }] });
    return json({}, 404);
  });
}
const bank = (store: BankStore, fetch: ReturnType<typeof api>, now = () => NOW, appId: string | null = 'app-1') =>
  createBank({ appId: appId ?? undefined, keyFile, redirectUrl: 'https://panel.ts.net/api/bank/callback', store, now, fetch: fetch as unknown as typeof globalThis.fetch });

describe('mapTransaction', () => {
  it('signs by direction and names the other side', () => {
    expect(mapTransaction(operation, 'a', 0)).toEqual({ id: 'a:r1', accountId: 'a', at: Date.parse('2026-10-24T12:00:00Z'), amount: -12.5, currency: 'PLN', title: 'Sklep', note: 'Zakup karta', raw: operation });
    const kept = mapTransaction({ ...operation, creditor_account: { iban: 'PL07 1020 3088 0000 8302 0072 4245', other: null }, debtor: null, merchant_category_code: null }, 'a', 0)!;
    // Whole in the encrypted cache (it tells who the other side is), cut to the last four digits on the way out.
    expect(kept.raw).toMatchObject({ creditor_account: { iban: 'PL07 1020 3088 0000 8302 0072 4245' } });
    expect(publicTransaction(kept).raw).toMatchObject({ creditor_account: { iban: '…4245' } });
    const iban = kept.raw;
    expect(iban).not.toHaveProperty('debtor');
    expect(iban).not.toHaveProperty('merchant_category_code');
    expect(mapTransaction({ ...operation, credit_debit_indicator: 'CRDT', debtor: { name: 'Firma' } }, 'a', 0)).toMatchObject({ amount: 12.5, title: 'Firma' });
  });
  it('falls back to the transfer title, and drops what has no amount or day', () => {
    expect(mapTransaction({ ...operation, creditor: undefined }, 'a', 0)).toMatchObject({ title: 'Zakup karta' });
    expect(mapTransaction({ ...operation, creditor: undefined, remittance_information: undefined }, 'a', 0)?.title).toBe('Operacja');
    expect(mapTransaction({ ...operation, booking_date: undefined }, 'a', 0)).toBeNull();
    expect(mapTransaction({ ...operation, transaction_amount: { amount: 'x', currency: 'PLN' } }, 'a', 0)).toBeNull();
  });
  it('turns the way PKO writes a card or phone operation into a title and a note', () => {
    expect(cleanTitle('LESZNOJMP S.A. BIEDRONKA 5133PL CARD-PAYMENT')).toEqual({ title: 'LESZNOJMP S.A. BIEDRONKA 5133', note: 'Płatność kartą' });
    expect(cleanTitle('LESZNOPOLOMARKETPL CARD-PAYMENT')).toEqual({ title: 'LESZNOPOLOMARKET', note: 'Płatność kartą' });
    expect(cleanTitle('00000095242384876 BLIK-CONTACTLESS-PAYMENT')).toEqual({ title: 'Płatność BLIK' });
    expect(cleanTitle('00000095244569044 MOBILE-PAYMENT-POS-NO-CARD-TX-CODE')).toEqual({ title: 'Płatność telefonem' });
    expect(cleanTitle('01008523274350276296017793535083 PAYCARD-TRANSFER')).toEqual({ title: 'Przelew z karty' });
    expect(cleanTitle('Zakup karta')).toEqual({ title: 'Zakup karta' });
    expect(cleanTitle('Faktura FV-2026-10')).toEqual({ title: 'Faktura FV-2026-10' });
    expect(mapTransaction({ ...operation, creditor: undefined, remittance_information: ['SKLEPPL CARD-PAYMENT'] }, 'a', 0)).toMatchObject({ title: 'SKLEP', note: 'Płatność kartą' });
  });
  it('gives an operation without a reference an id from its content', () => {
    const t = mapTransaction({ ...operation, entry_reference: undefined }, 'a', 3);
    expect(t?.id).toBe(`a:${Date.parse('2026-10-24T12:00:00Z')}:12.5:3`);
  });
});

describe('bank source', () => {
  it('is unavailable without an application', async () => {
    const source = await bank(memory(), api(), () => NOW, null).read();
    expect(source).toMatchObject({ status: 'unavailable', data: null });
    expect(source.loginRequired).toBeUndefined();
  });
  it('asks to connect before the first consent, without calling the bank', async () => {
    const fetch = api();
    const source = await bank(memory(), fetch).read();
    expect(source).toMatchObject({ status: 'unavailable', loginRequired: true, data: null, observedAt: null });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('reads balance and operations, newest first, signed, and keeps them encrypted-store side', async () => {
    const store = memory({ session });
    const source = await bank(store, api()).read();
    expect(() => bankSourceSchema.parse(source)).not.toThrow();
    expect(source).toMatchObject({ status: 'connected', observedAt: NOW, consentUntil: session.validUntil });
    expect(source.data?.accounts).toEqual([{ id: 'uid-1', name: 'Konto', last4: '4245', currency: 'PLN', balance: 100.25, balanceAt: Date.parse('2026-10-24T12:00:00Z') }]);
    expect(source.data?.transactions.map(t => [t.id, t.amount])).toEqual([['uid-1:r2', 300], ['uid-1:r1', -12.5]]);
    expect(store.files.cache).toBeDefined();
  });
  it('signs the request with the application key and asks only for booked operations from a bounded window', async () => {
    const fetch = api();
    await bank(memory({ session }), fetch).read();
    const calls = fetch.mock.calls.map(([url, init]) => ({ url: String(url), headers: (init as RequestInit).headers as Record<string, string> }));
    const header = JSON.parse(Buffer.from(calls[0].headers.Authorization.split('.')[0].replace('Bearer ', ''), 'base64url').toString());
    expect(header).toEqual({ typ: 'JWT', alg: 'RS256', kid: 'app-1' });
    const transactions = new URL(calls.find(c => c.url.includes('/transactions'))!.url);
    expect(transactions.searchParams.get('transaction_status')).toBe('BOOK');
    expect(transactions.searchParams.get('date_from')).toBe('2026-07-27');
  });
  it('says in the log how many pages it read and whether the bank had more, without any operation', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await bank(memory({ session }), api()).read();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/^bank: odczyt 2 operacji od 2026-07-27 w 1 stronach; po ostatniej stronie bank ma już nic więcej$/));
      log.mockClear();
      const more = api({ '/transactions': () => json({ transactions: [operation], continuation_key: 'k' }) });
      await bank(memory({ session }), more).read();
      expect(log).toHaveBeenCalledWith(expect.stringMatching(/w 8 stronach; po ostatniej stronie bank ma jeszcze dalsze/));
      expect(JSON.stringify(log.mock.calls)).not.toContain('Sklep');
    } finally { log.mockRestore(); }
  });
  it('asks for the shorter period when the bank refuses 90 days, and still reads', async () => {
    let first = true;
    const fetch = api({ '/transactions': () => { if (first) { first = false; return json({}, 400); } return json({ transactions: [operation] }); } });
    const source = await bank(memory({ session }), fetch).read();
    expect(source.status).toBe('connected');
    expect(source.data!.transactions).toHaveLength(1);
    const dates = fetch.mock.calls.map(([url]) => new URL(String(url))).filter(u => u.pathname.endsWith('/transactions')).map(u => u.searchParams.get('date_from'));
    expect(dates).toEqual(['2026-07-27', '2026-09-20']);
  });
  it('does not read the bank again before the refresh interval, even after a restart', async () => {
    const store = memory({ session });
    await bank(store, api()).read();
    const fetch = api();
    let now = NOW + BANK_REFRESH_MS - 1;
    const restarted = bank(store, fetch, () => now);
    expect((await restarted.read()).status).toBe('connected');
    expect(fetch).not.toHaveBeenCalled();
    now = NOW + BANK_REFRESH_MS;
    await restarted.read();
    expect(fetch).toHaveBeenCalled();
  });
  it('keeps the last reading with its own time when the bank fails, and leaves the bank alone for a while', async () => {
    const store = memory({ session });
    let now = NOW;
    const first = bank(store, api(), () => now);
    await first.read();
    now = NOW + BANK_REFRESH_MS;
    const failing = api({ '/balances': () => json({}, 500) });
    const again = bank(store, failing, () => now);
    const source = await again.read();
    expect(source).toMatchObject({ status: 'offline', observedAt: NOW });
    expect(source.data?.transactions).toHaveLength(2);
    const calls = failing.mock.calls.length;
    await again.read();
    expect(failing.mock.calls.length).toBe(calls);
  });
  it('says so when the bank refuses the consent or limits reads', async () => {
    expect(await bank(memory({ session }), api({ '/balances': () => json({}, 401) })).read()).toMatchObject({ status: 'unavailable', loginRequired: true });
    expect(await bank(memory({ session }), api({ '/balances': () => json({}, 429) })).read()).toMatchObject({ status: 'offline', message: expect.stringContaining('ogranicza') });
  });
  it('asks to connect again once the consent has run out', async () => {
    const fetch = api();
    const source = await bank(memory({ session: { ...session, validUntil: NOW - 1 } }), fetch).read();
    expect(source).toMatchObject({ status: 'unavailable', loginRequired: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('bank consent', () => {
  const login = (fetch: ReturnType<typeof api>) => {
    let state = '';
    fetch.mockImplementation(async (url: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(url)).pathname;
      if (path === '/auth') { state = JSON.parse(String(init?.body)).state; return json({ url: 'https://bank.example/login', authorization_id: 'x' }); }
      if (path === '/sessions') return json({ session_id: 's-9', access: { valid_until: '2027-03-01T00:00:00Z' }, accounts: [{ uid: 'u-9', account_id: { iban: 'PL07 1020 3088 0000 8302 0072 4245' }, name: 'ROR', currency: 'PLN' }] });
      return api()(url);
    });
    return () => state;
  };
  it('starts with a personal-account request to the redirect address and finishes into a stored session', async () => {
    const fetch = api();
    const state = login(fetch);
    const store = memory();
    const b = bank(store, fetch);
    expect(await b.begin()).toBe('https://bank.example/login');
    const body = JSON.parse(String(fetch.mock.calls[0][1]!.body));
    expect(body).toMatchObject({ psu_type: 'personal', aspsp: { name: 'PKO Bank Polski', country: 'PL' }, redirect_url: 'https://panel.ts.net/api/bank/callback' });
    expect(Date.parse(body.access.valid_until)).toBeLessThanOrEqual(NOW + 180 * 86_400_000);
    const params = new URLSearchParams({ code: 'c-1', state: state() });
    expect(b.owns(params)).toBe(true);
    await b.finish(params);
    expect(store.files.session).toEqual({ sessionId: 's-9', validUntil: Date.parse('2027-03-01T00:00:00Z'), accounts: [{ uid: 'u-9', name: 'ROR', last4: '4245', currency: 'PLN' }] });
    expect((await b.read()).status).toBe('connected');
  });
  it('accepts a callback only once, with its own state, and not an error or a late one', async () => {
    const fetch = api();
    const state = login(fetch);
    let now = NOW;
    const b = bank(memory(), fetch, () => now);
    await b.begin();
    expect(b.owns(new URLSearchParams({ code: 'c', state: 'other' }))).toBe(false);
    await expect(b.finish(new URLSearchParams({ error: 'access_denied', state: state() }))).rejects.toBeInstanceOf(BankError);
    expect(b.owns(new URLSearchParams({ code: 'c', state: state() }))).toBe(false); // used up
    await b.begin();
    now += 11 * 60_000;
    expect(b.owns(new URLSearchParams({ code: 'c', state: state() }))).toBe(false);
  });
  it('refuses to start without an application', async () => {
    await expect(bank(memory(), api(), () => NOW, null).begin()).rejects.toMatchObject({ reason: 'not_configured' });
  });
});
