import { createSign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { bankAccountSchema, bankTransactionSchema, type BankAccount, type BankSource, type BankTransaction } from '../src/bank-contract';
import { publicTransaction } from './bank-parties';

/**
 * PKO BP through Enable Banking (read-only, PSD2 account information). The application signs a short JWT with its private
 * key; the user's own consent is given once in iPKO/IKO and lasts up to 180 days. The bank allows about four unattended
 * readings of an account a day, so the panel reads at most every few hours and keeps the last answer on disk.
 */
const API = 'https://api.enablebanking.com';
const ASPSP = { name: 'PKO Bank Polski', country: 'PL' };
const DAY = 86_400_000;
/** Four unattended reads a day is the PSD2 limit; this stays under it even across restarts. */
export const BANK_REFRESH_MS = 7 * 3_600_000;
/** After a failed reading the bank is left alone for a while. */
const RETRY_MS = 30 * 60_000;
const CONSENT_MS = 179 * DAY;
/** How far back a reading asks: 90 days is what a bank gives without a fresh sign-in; a bank that refuses the period is asked for the shorter one. */
const HISTORY_DAYS = 90, FALLBACK_HISTORY_DAYS = 35;
const MAX_PAGES = 8;
const KEEP = 700;
const LOGIN_MS = 10 * 60_000;
/** The bank answers an account request slowly now and then. */
const CALL_TIMEOUT_MS = 60_000;

export class BankError extends Error {
  constructor(readonly reason: 'not_configured' | 'invalid_callback' | 'consent' | 'rate_limit' | 'storage_failed' | 'bank', readonly status?: number) { super(reason); }
}

/** Where the consent and the last reading are kept; encrypted for the Windows user in the real service. */
export interface BankStore { read(name: string): Promise<unknown | null>; write(name: string, value: unknown): Promise<void> }

const sessionSchema = z.object({
  sessionId: z.string().min(1),
  validUntil: z.number().finite(),
  accounts: z.array(z.object({ uid: z.string().min(1), name: z.string(), last4: z.string().nullable(), currency: z.string() })).max(10),
});
type Session = z.infer<typeof sessionSchema>;
const cacheSchema = z.object({ observedAt: z.number().finite(), accounts: z.array(bankAccountSchema), transactions: z.array(bankTransactionSchema) });
type Cache = z.infer<typeof cacheSchema>;

const amountOf = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? n : null; };
const day = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value) ? Date.parse(`${value.slice(0, 10)}T12:00:00Z`) : null;
const text = (value: unknown, max: number) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const last4 = (iban: unknown) => typeof iban === 'string' && /\d{4}$/.test(iban.replace(/\s/g, '')) ? iban.replace(/\s/g, '').slice(-4) : null;

/** How PKO names the way an operation was made, as it ends the title of a card or phone operation. */
const KINDS: [RegExp, string][] = [
  [/^CARD-PAYMENT$/, 'Płatność kartą'], [/^MOBILE-PAYMENT/, 'Płatność telefonem'], [/^BLIK-/, 'Płatność BLIK'], [/^PAYCARD-TRANSFER$/, 'Przelew z karty'],
];
/**
 * PKO leaves the other side empty for a card payment and writes `<city+merchant>PL CARD-PAYMENT` as the title. The way it was made
 * moves out of the title (it is the note), the glued country code goes, and a title that is only a terminal number is named by the way.
 */
export function cleanTitle(title: string): { title: string; note?: string } {
  const match = /^(.*?)\s*([A-Z]+(?:-[A-Z0-9]+)+)$/.exec(title);
  const kind = match && KINDS.find(([pattern]) => pattern.test(match[2]))?.[1];
  if (!match || !kind) return { title };
  const merchant = match[1].replace(/(?<=\S)PL$/, '').trim();
  return /^[\d\s]*$/.test(merchant) ? { title: kind } : { title: merchant, note: kind };
}

/** One operation as the bank reports it, reduced to the contract; null when it has no amount or day. */
export function mapTransaction(raw: unknown, accountId: string, index: number): BankTransaction | null {
  const t = raw as Record<string, any> | null;
  const amount = amountOf(t?.transaction_amount?.amount);
  const at = day(t?.booking_date) ?? day(t?.value_date) ?? day(t?.transaction_date);
  const currency = t?.transaction_amount?.currency;
  if (amount === null || at === null || typeof currency !== 'string' || currency.length !== 3) return null;
  const out = t?.credit_debit_indicator === 'DBIT';
  const note = text(Array.isArray(t?.remittance_information) ? t.remittance_information.join(' ') : t?.remittance_information, 200);
  const side = text(out ? t?.creditor?.name : t?.debtor?.name, 120);
  const reference = text(t?.entry_reference ?? t?.transaction_id, 80);
  return {
    id: reference ? `${accountId}:${reference}` : `${accountId}:${at}:${amount}:${index}`,
    accountId, at, amount: out ? -Math.abs(amount) : Math.abs(amount), currency,
    ...(side ? { title: side, ...(note ? { note } : {}) } : note ? cleanTitle(note) : { title: 'Operacja' }),
    raw: rawOf(t),
  };
}

/**
 * What the bank sent for one operation, empty fields left out. It is kept whole in the encrypted cache, because the account
 * and phone number of the other side tell who it is (bank-parties.ts); what leaves the server is `publicTransaction`, with
 * every IBAN cut to its last four digits and phone numbers masked (someone else's number is not shown even to the owner's panel).
 */
function rawOf(value: unknown): Record<string, unknown> {
  const clean = (v: unknown): unknown => {
    if (Array.isArray(v)) { const items = v.map(i => clean(i)).filter(i => i !== undefined); return items.length ? items : undefined; }
    if (v && typeof v === 'object') {
      const entries = Object.entries(v).map(([k, i]) => [k, clean(i)] as const).filter(([, i]) => i !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return v === null || v === '' ? undefined : v;
  };
  return (clean(value) as Record<string, unknown> | undefined) ?? {};
}

export function createBank(options: {
  appId?: string; keyFile: string; redirectUrl: string; store: BankStore; now?: () => number; fetch?: typeof fetch;
}) {
  const now = options.now ?? Date.now;
  const request = options.fetch ?? fetch;
  let key: string | undefined;
  let session: Session | null | undefined;
  let cache: Cache | null | undefined;
  let lastTry = 0;
  let pending: Promise<void> | undefined;
  let login: { state: string; expires: number } | undefined;

  async function jwt() {
    key ??= await readFile(options.keyFile, 'utf8');
    const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const iat = Math.floor(now() / 1000);
    const head = b64({ typ: 'JWT', alg: 'RS256', kid: options.appId });
    const body = b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat, exp: iat + 600 });
    return `${head}.${body}.${createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url')}`;
  }
  async function call(path: string, init?: { method: 'POST'; body: unknown }): Promise<any> {
    const response = await request(API + path, {
      method: init?.method ?? 'GET', redirect: 'error', signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      headers: { Authorization: `Bearer ${await jwt()}`, ...(init ? { 'Content-Type': 'application/json' } : {}) },
      ...(init ? { body: JSON.stringify(init.body) } : {}),
    });
    if (response.status === 401 || response.status === 403) throw new BankError('consent', response.status);
    if (response.status === 429) throw new BankError('rate_limit', response.status);
    if (!response.ok) throw new BankError('bank', response.status);
    return response.json();
  }
  /** Read from the store once; a missing or unreadable file means there is none (null), and that is remembered too. */
  async function stored<T>(name: string, schema: z.ZodType<T>): Promise<T | null> {
    try { return schema.parse(await options.store.read(name)); } catch { return null; }
  }
  const loadSession = async () => session === undefined ? session = await stored('session', sessionSchema) : session;
  /** A reading kept before titles were cleaned is cleaned as it is loaded: no new call to the bank for it. */
  const loadCache = async () => {
    if (cache === undefined) {
      const kept = await stored('cache', cacheSchema);
      cache = kept && { ...kept, transactions: kept.transactions.map(t => t.note ? t : { ...t, ...cleanTitle(t.title) }) };
    }
    return cache;
  };

  async function refresh(current: Session) {
    let days = HISTORY_DAYS;
    const accounts: BankAccount[] = [];
    const transactions: BankTransaction[] = [];
    const operations = async (uid: string): Promise<BankTransaction[]> => {
      const from = new Date(now() - days * DAY).toISOString().slice(0, 10);
      const list: BankTransaction[] = [];
      let continuation: string | undefined;
      let pages = 0;
      for (let page = 0; page < MAX_PAGES; page++) {
        pages++;
        const query = new URLSearchParams({ date_from: from, transaction_status: 'BOOK', ...(continuation ? { continuation_key: continuation } : {}) });
        const answer = await call(`/accounts/${encodeURIComponent(uid)}/transactions?${query}`);
        (answer.transactions as unknown[] | undefined)?.forEach((raw, i) => { const t = mapTransaction(raw, uid, page * 1000 + i); if (t) list.push(t); });
        continuation = typeof answer.continuation_key === 'string' && answer.continuation_key ? answer.continuation_key : undefined;
        if (!continuation) break;
      }
      // Only counts and a yes or no, never a payload: whether the bank had more after the last page asked for (the pages cap cut the reading).
      console.log(`bank: odczyt ${list.length} operacji od ${from} w ${pages} stronach; po ostatniej stronie bank ma ${continuation ? 'jeszcze dalsze (ucięte limitem stron)' : 'już nic więcej'}`);
      return list;
    };
    for (const account of current.accounts) {
      const balances = (await call(`/accounts/${encodeURIComponent(account.uid)}/balances`)).balances as Record<string, any>[] | undefined;
      // Closing booked is the balance the bank statement shows; the others are the next best.
      const pick = ['CLBD', 'ITBD', 'XPCD', 'ITAV', 'CLAV'].map(type => balances?.find(b => b.balance_type === type)).find(Boolean) ?? balances?.[0];
      accounts.push({
        id: account.uid, name: account.name, last4: account.last4, currency: pick?.balance_amount?.currency ?? account.currency,
        balance: amountOf(pick?.balance_amount?.amount), balanceAt: day(pick?.reference_date) ?? now(),
      });
      try { transactions.push(...await operations(account.uid)); }
      catch (error) {
        // A bank that refuses the longer period (a bad request) is asked once for the shorter one, and then for good in this reading.
        if (days > FALLBACK_HISTORY_DAYS && error instanceof BankError && error.reason === 'bank' && (error.status === 400 || error.status === 422)) {
          days = FALLBACK_HISTORY_DAYS;
          transactions.push(...await operations(account.uid));
        } else throw error;
      }
    }
    const seen = new Set<string>();
    const unique = transactions.filter(t => !seen.has(t.id) && !!seen.add(t.id)).sort((a, b) => b.at - a.at).slice(0, KEEP);
    cache = { observedAt: now(), accounts, transactions: unique };
    await options.store.write('cache', cache).catch(() => { /* the reading is still shown; the next start reads again */ });
  }

  const configured = () => !!options.appId;
  const source = (partial: Partial<BankSource>, data: Cache | null | undefined, consentUntil: number | null): BankSource => ({
    live: true, name: 'PKO BP', status: 'connected', observedAt: data?.observedAt ?? null, consentUntil,
    data: data ? { accounts: data.accounts, transactions: data.transactions.map(publicTransaction) } : null, ...partial,
  });

  return {
    /** The last reading, refreshed when it is older than `BANK_REFRESH_MS`; a failure keeps the last reading with its own time. */
    async read(): Promise<BankSource> {
      if (!configured()) return source({ status: 'unavailable', message: 'Konto bankowe nie jest skonfigurowane (DESK_BANK_APP_ID).' }, null, null);
      const current = await loadSession();
      const last = await loadCache();
      if (!current) return source({ status: 'unavailable', loginRequired: true, message: 'Połącz konto w PKO BP.' }, null, null);
      if (current.validUntil <= now()) return source({ status: 'unavailable', loginRequired: true, message: 'Zgoda w banku wygasła. Połącz konto ponownie.' }, last, current.validUntil);
      if (!last || now() - last.observedAt >= BANK_REFRESH_MS) {
        if (now() - lastTry >= RETRY_MS) {
          lastTry = now();
          pending ??= refresh(current).finally(() => { pending = undefined; });
          try { await pending; }
          catch (error) {
            // Only what went wrong, never a payload: the panel shows a general sentence and this is where to look.
            console.error('bank: reading the account failed:', error instanceof BankError ? `${error.reason}${error.status ? ` (HTTP ${error.status})` : ''}` : error instanceof Error ? `${error.name}: ${error.message}` : 'unknown');
            if (error instanceof BankError && error.reason === 'consent') return source({ status: 'unavailable', loginRequired: true, message: 'Bank odrzucił zgodę. Połącz konto ponownie.' }, cache, current.validUntil);
            return source({ status: 'offline', message: error instanceof BankError && error.reason === 'rate_limit' ? 'Bank ogranicza odczyty, ponowię później.' : 'Nie udało się odczytać konta, ponowię później.' }, cache, current.validUntil);
          }
        } else if (!last) return source({ status: 'offline', message: 'Nie udało się odczytać konta, ponowię później.' }, null, current.validUntil);
        else return source({ status: 'offline', message: 'Nie udało się odczytać konta, ponowię później.' }, last, current.validUntil);
      }
      return source({}, cache ?? last, current.validUntil);
    },

    /**
     * The last reading as it is kept, numbers whole, for the server's own use (who the other side is): never a call to the
     * bank, whatever its age. Not for the browser or the agent; they get `read`.
     */
    async cached(): Promise<{ observedAt: number; accounts: BankAccount[]; transactions: BankTransaction[] } | null> {
      if (!configured()) return null;
      return await loadCache() ?? null;
    },

    /** Starts the consent: resolves to the address where the user signs in to the bank. */
    async begin(): Promise<string> {
      if (!configured()) throw new BankError('not_configured');
      const state = randomBytes(24).toString('base64url');
      const answer = await call('/auth', { method: 'POST', body: {
        access: { valid_until: new Date(now() + CONSENT_MS).toISOString() }, aspsp: ASPSP, state, redirect_url: options.redirectUrl, psu_type: 'personal',
      } });
      if (typeof answer.url !== 'string') throw new BankError('bank');
      login = { state, expires: now() + LOGIN_MS };
      return answer.url;
    },

    /** Whether a callback belongs to the sign-in this panel started. */
    owns(params: URLSearchParams) { return !!login && params.get('state') === login.state && login.expires >= now(); },

    /** Turns the bank's redirect into a session and reads the account at once. */
    async finish(params: URLSearchParams): Promise<void> {
      const current = login;
      login = undefined; // one use
      const code = params.get('code');
      if (!current || params.get('state') !== current.state || current.expires < now() || !code || params.has('error')) throw new BankError('invalid_callback');
      const answer = await call('/sessions', { method: 'POST', body: { code } });
      const accounts = (answer.accounts as Record<string, any>[] | undefined ?? []).filter(a => typeof a?.uid === 'string').map(a => ({
        uid: a.uid as string, name: text(a.name ?? a.product, 60) || 'Konto', last4: last4(a.account_id?.iban), currency: typeof a.currency === 'string' ? a.currency : 'PLN',
      }));
      const validUntil = Date.parse(answer.access?.valid_until ?? '') || now() + 90 * DAY;
      if (typeof answer.session_id !== 'string' || !accounts.length) throw new BankError('bank');
      session = { sessionId: answer.session_id, validUntil, accounts };
      try { await options.store.write('session', session); } catch { session = undefined; throw new BankError('storage_failed'); }
      cache = null;
      lastTry = 0;
    },
  };
}
