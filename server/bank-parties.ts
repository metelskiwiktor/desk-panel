import type { BankAccount, BankTransaction } from '../src/bank-contract';

/**
 * Who is on the other side of an operation, as far as the bank says, and how its numbers are kept out of the browser.
 *
 * What PKO sends (checked on the account's own readings): a transfer names the other side (`creditor` going out, `debtor`
 * coming in) and carries its account; a transfer to a phone number writes both numbers into the title ("PRZELEW NA TELEFON
 * OD: <own number> DO: 48X*****123" going out, "… OD: <sender> DO: <own>" coming in), so the other side's number is whole when
 * money comes in and masked by the bank when it goes out. A card payment has the merchant in the title only; a phone or BLIK
 * payment has no name at all. The full numbers stay in the DPAPI cache on the server; what leaves it is cut like the bank cuts.
 */
export type PartyKind = 'account' | 'phone' | 'phoneTail' | 'name';
export interface Party { kind: PartyKind; value: string; hint: string }

/** Upper case without Polish letters or accents and with single spaces: one way to write a name the bank writes many ways. */
export const plainName = (text: string) => text.replace(/ł/g, 'l').replace(/Ł/g, 'L').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

/** A run of 9 or 11 (48…) digits, the shapes a Polish phone number takes in PKO titles. */
const PHONE = /(?<![\d*])(?:48)?\d{9}(?![\d*])/g;
/** A phone number as the bank masks it, first three and last three digits ("485*****123"). */
const maskPhone = (digits: string) => digits.length === 11 ? `${digits.slice(0, 3)}*****${digits.slice(-3)}` : `${digits[0]}*****${digits.slice(-3)}`;
/**
 * Phone numbers in a text masked the way the bank masks them in a transfer it sends, and any run of 20 or more digits (an account
 * or card number in a title, as a transfer from a card has) cut to its last four.
 */
export const maskPhones = (text: string) => text.replace(/\d{20,}/g, run => `…${run.slice(-4)}`).replace(PHONE, maskPhone);

/** What may leave the server of one operation: phone numbers masked, every IBAN cut to its last four digits. */
export function publicTransaction(t: BankTransaction): BankTransaction {
  const clean = (v: unknown, key = ''): unknown => {
    if (typeof v === 'string') return /iban/i.test(key) ? `…${v.replace(/\s/g, '').slice(-4)}` : maskPhones(v);
    if (Array.isArray(v)) return v.map(i => clean(i, key));
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, i]) => [k, clean(i, k)]));
    return v;
  };
  return { ...t, title: maskPhones(t.title), ...(t.note !== undefined ? { note: maskPhones(t.note) } : {}), ...(t.raw ? { raw: clean(t.raw) as Record<string, unknown> } : {}) };
}

const iban = (value: unknown) => {
  const flat = typeof value === 'string' ? value.replace(/\s/g, '').toUpperCase() : '';
  // An IBAN cut before it reached the cache ("…4245", readings kept before the full numbers were) cannot tell anyone apart.
  return /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(flat) ? flat : null;
};
/** "48667178938" or "667178938" → the nine digits; a masked one ("485*****123") → first and last three digits. */
function phoneParty(raw: string): Party | null {
  const digits = raw.replace(/[^\d*]/g, '');
  if (/^(48)?\d{9}$/.test(digits)) { const nine = digits.slice(-9); return { kind: 'phone', value: nine, hint: `··${nine.slice(-3)}` }; }
  const masked = /^(?:48)?(\d)\*+(\d{3})$/.exec(digits);
  return masked ? { kind: 'phoneTail', value: `${masked[1]}…${masked[2]}`, hint: `··${masked[2]}` } : null;
}
/** A whole number also stands for its masked form, so a person known from money they sent is known when money goes to them. */
export const tailOf = (phone: Party): Party => ({ kind: 'phoneTail', value: `${phone.value[0]}…${phone.value.slice(-3)}`, hint: phone.hint });

/**
 * The identifiers of the other side of one operation: its account (whole IBAN), phone number (whole or masked) and the name
 * the bank gives it. Own accounts are never the other side. Operations without `raw` (scenario files) are read from the title.
 */
export function partiesOf(t: BankTransaction, accounts: Pick<BankAccount, 'last4'>[] = []): Party[] {
  const raw = t.raw as Record<string, any> | undefined;
  const out = t.amount < 0;
  const own = new Set(accounts.map(a => a.last4).filter(Boolean));
  const parties: Party[] = [];
  const name = raw ? (out ? raw.creditor?.name : raw.debtor?.name) : t.note && !/^(Płatność|Przelew z karty)/.test(t.note) && !/^Płatność/.test(t.title) ? t.title : undefined;
  if (typeof name === 'string' && plainName(name)) parties.push({ kind: 'name', value: plainName(name), hint: name.replace(/\s+/g, ' ').trim().slice(0, 60) });
  const account = iban(out ? raw?.creditor_account?.iban : raw?.debtor_account?.iban);
  if (account && !own.has(account.slice(-4))) parties.push({ kind: 'account', value: account, hint: `··${account.slice(-4)}` });
  const title = raw ? [raw.remittance_information].flat().filter(v => typeof v === 'string').join(' ') : t.note ?? '';
  const number = (out ? /\bDO:\s*(\+?[\d*]{9,13})/ : /OD:\s*(\+?[\d*]{9,13})/).exec(title)?.[1];
  const phone = number ? phoneParty(number) : null;
  if (phone) parties.push(phone, ...(phone.kind === 'phone' ? [tailOf(phone)] : []));
  return parties;
}
