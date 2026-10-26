import { useState } from 'react';
import { ArrowDownLeft, Banknote, Fuel, HeartPulse, Landmark, Repeat, Send, ShoppingCart, Smartphone, Store, UtensilsCrossed, type LucideIcon } from 'lucide-react';
import { SourceNote } from './components';
import { MAX_AGE, fresh } from './model';
import type { BankTransaction } from './bank-contract';
import { categoryNames, describe, type BankCategory } from './bank-merchants';
import type { BankHook } from './useBank';

const DAY = 86_400_000;
/** The same window as the sums above the list. */
const SUM_DAYS = 30;
const CONSENT_WARN_DAYS = 14;
const SHOWN = 80;

export const money = (amount: number, currency: string) => amount.toLocaleString('pl-PL', { style: 'currency', currency });
/** "+1 200,00 zł" / "−43,90 zł": the sign is always there, so colour is never the only sign. */
export const signed = (amount: number, currency: string) => `${amount > 0 ? '+' : amount < 0 ? '−' : ''}${money(Math.abs(amount), currency)}`;

const localDay = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** A booking day is kept as noon UTC of that date, so its date is read in UTC. */
export function dayLabel(at: number, now: number): string {
  const day = new Date(at).toISOString().slice(0, 10);
  if (day === localDay(now)) return 'dziś';
  if (day === localDay(now - DAY)) return 'wczoraj';
  return new Date(at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}
/** The heading of a day group: "Dziś", "Wczoraj", then the weekday and date ("Pt, 23 paź"). */
export function dayHeading(at: number, now: number): string {
  const label = dayLabel(at, now);
  if (label === 'dziś' || label === 'wczoraj') return label[0].toUpperCase() + label.slice(1);
  const text = new Date(at).toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).replace(/^(\p{L}+)\./u, '$1');
  return text[0].toUpperCase() + text.slice(1);
}

/** What came in and went out over the last `SUM_DAYS` days, per currency of the first transaction's account; mixed currencies are not added up. */
export function sums(transactions: BankTransaction[], now: number, currency: string) {
  const recent = transactions.filter(t => t.currency === currency && now - t.at <= SUM_DAYS * DAY);
  return { income: recent.filter(t => t.amount > 0).reduce((s, t) => s + t.amount, 0), spent: recent.filter(t => t.amount < 0).reduce((s, t) => s - t.amount, 0) };
}

/** What the last `SUM_DAYS` days went on, by category, largest first; money that came in is not counted. */
export function spending(transactions: BankTransaction[], now: number, currency: string): { category: BankCategory; sum: number }[] {
  const by = new Map<BankCategory, number>();
  for (const t of transactions) {
    if (t.currency !== currency || t.amount >= 0 || now - t.at > SUM_DAYS * DAY) continue;
    const { category } = describe(t);
    by.set(category, (by.get(category) ?? 0) - t.amount);
  }
  return [...by].map(([category, sum]) => ({ category, sum })).sort((a, b) => b.sum - a.sum);
}

const ICONS: Record<BankCategory, LucideIcon> = {
  income: ArrowDownLeft, phone: Smartphone, atm: Banknote, grocery: ShoppingCart, fuel: Fuel, eat: UtensilsCrossed, sub: Repeat, health: HeartPulse, transfer: Send, other: Store,
};

/** Operations grouped by booking day, newest first, each group with what the day came to. */
function byDay(transactions: BankTransaction[]) {
  const groups: { at: number; items: BankTransaction[] }[] = [];
  for (const t of transactions) {
    const last = groups.at(-1);
    if (last && new Date(last.at).toISOString().slice(0, 10) === new Date(t.at).toISOString().slice(0, 10)) last.items.push(t);
    else groups.push({ at: t.at, items: [t] });
  }
  return groups;
}

const POP_W = 380;
/** What the bank sent for one operation, as JSON beside its row (fixed to the screen, so a small tile cannot clip it). */
function RawPopover({ t, box }: { t: BankTransaction; box: DOMRect }) {
  const room = window.innerWidth - box.right;
  const left = room >= POP_W + 12 ? box.right + 8 : Math.max(8, box.left - POP_W - 8);
  const top = Math.max(8, Math.min(box.top, window.innerHeight - 320));
  return <div className="bank-raw" role="tooltip" style={{ left, top, width: POP_W }}>
    <p>Odpowiedź banku (PKO przez Enable Banking)</p>
    <pre>{t.raw ? JSON.stringify(t.raw, null, 2) : 'Brak surowych danych: pojawią się przy następnym odczycie banku.'}</pre>
  </div>;
}

/**
 * The bank account as a tile: the balance, what came in and went out in the last 30 days, where the money went, and the
 * operations by day, each with the icon of its category and a clean name. The bank gives text only, so there are no logos
 * (see bank-merchants.ts); a payment by phone says it has no shop name. Without a consent (or when it has run out) the
 * tile offers to connect: the bank's sign-in opens from a link, because a browser blocks a window opened after the server
 * has answered. `wide` and `tall` follow the tile's cells.
 */
export function BankTile({ bank, now, wide = true, tall = true }: { bank: BankHook; now: number; wide?: boolean; tall?: boolean }) {
  const { source, signIn, error, busy, connect } = bank;
  const data = source.data;
  const accounts = data?.accounts ?? [];
  const currency = accounts[0]?.currency ?? 'PLN';
  const balances = accounts.filter(a => a.currency === currency);
  const total = balances.length && balances.every(a => a.balance !== null) ? balances.reduce((s, a) => s + (a.balance ?? 0), 0) : null;
  const flow = data ? sums(data.transactions, now, currency) : null;
  const kinds = data ? spending(data.transactions, now, currency) : [];
  const spent = kinds.reduce((s, k) => s + k.sum, 0);
  const daysLeft = source.consentUntil ? Math.floor((source.consentUntil - now) / DAY) : null;
  const expiring = !source.loginRequired && daysLeft !== null && daysLeft <= CONSENT_WARN_DAYS;
  const groups = byDay(data?.transactions.slice(0, SHOWN) ?? []);
  // The raw answer of the bank for the operation under the pointer (or focus, or the last tap), beside its row.
  const [peeked, setPeeked] = useState<{ t: BankTransaction; box: DOMRect } | null>(null);
  const peek = (t: BankTransaction, row: HTMLElement) => setPeeked({ t, box: row.getBoundingClientRect() });
  const label = accounts.length === 1 ? `${accounts[0].name}${accounts[0].last4 ? ` ··${accounts[0].last4}` : ''}` : accounts.length > 1 ? `${accounts.length} konta` : '';
  return <section className={`p2-card bank${wide ? ' wide' : ''}${tall ? ' tall' : ''}`} aria-label="Konto bankowe">
    <div className="p2-card-head static">
      <Landmark size={18} aria-hidden="true" />
      <h2>Konto</h2>
      {label && <span className="p2-meta">{label}</span>}
      {expiring && <span className="p2-badge warn" title="Zgoda w banku wygasa; połącz konto ponownie">zgoda: {daysLeft} dni</span>}
    </div>
    {source.loginRequired || (!data && source.status !== 'loading') ? <div className="bank-connect">
      <p className="p2-empty">{source.message || 'Konto bankowe jest niedostępne.'}</p>
      {source.loginRequired && <>
        <button type="button" className="bank-button" disabled={busy} onClick={() => void connect()}>{busy ? 'Przygotowuję…' : data ? 'Połącz ponownie' : 'Połącz konto'}</button>
        {signIn && <>
          <a className="bank-button primary" href={signIn} target="_blank" rel="noopener noreferrer">Otwórz logowanie w banku</a>
          <p className="p2-note">Zaloguj się do iPKO i potwierdź w aplikacji IKO. Po powrocie dane pojawią się same.</p>
        </>}
        {error && <p className="p2-note warn" role="status">{error}</p>}
      </>}
    </div> : !data ? <p className="p2-empty">Ładowanie konta…</p> : <div className="bank-body">
      <div className="bank-top">
        <strong className="bank-balance" aria-label="Saldo">{total === null ? '—' : money(total, currency)}</strong>
        {flow && wide && <span className="bank-flow"><span className="in">{signed(flow.income, currency)}</span><span className="out">{signed(-flow.spent, currency)}</span><small>{SUM_DAYS} dni</small></span>}
      </div>
      {tall && spent > 0 && <div className="bank-kinds">
        <div className="bank-bar" role="img" aria-label={`Wydatki z ${SUM_DAYS} dni według kategorii`}>
          {kinds.map(k => <i key={k.category} className={`cat-${k.category}`} style={{ flex: k.sum }} title={`${categoryNames[k.category]}: ${money(k.sum, currency)}`} />)}
        </div>
        <ul className="bank-legend">
          {kinds.slice(0, wide ? 4 : 3).map(k => <li key={k.category} className={`cat-${k.category}`}><i />{categoryNames[k.category]} <b>{Math.round((k.sum / spent) * 100)}%</b></li>)}
        </ul>
      </div>}
      {groups.length ? <div className="bank-days" aria-label="Operacje według dni">
        {groups.map(g => {
          const net = g.items.reduce((s, t) => s + (t.currency === currency ? t.amount : 0), 0);
          return <section key={g.at} className="bank-day">
            <h3><span>{dayHeading(g.at, now)}</span><span className={`num${net > 0 ? ' in' : ''}`}>{signed(net, currency)}</span></h3>
            <ul>
              {g.items.map(t => {
                const d = describe(t), Icon = ICONS[d.category];
                return <li key={t.id} className={`bank-row cat-${d.category}`} tabIndex={0} aria-label={`${d.name}, ${signed(t.amount, t.currency)}`}
                  onMouseEnter={e => peek(t, e.currentTarget)} onFocus={e => peek(t, e.currentTarget)} onMouseLeave={() => setPeeked(null)} onBlur={() => setPeeked(null)}
                  onClick={e => peeked?.t.id === t.id ? setPeeked(null) : peek(t, e.currentTarget)}>
                  <span className="bank-avatar" aria-hidden="true"><Icon size={18} /></span>
                  <span className="bank-what"><span className="bank-title">{d.name}</span>{d.sub && <span className="bank-note">{d.sub}</span>}</span>
                  <b className={`bank-amount num${t.amount > 0 ? ' in' : ''}`}>{signed(t.amount, t.currency)}</b>
                </li>;
              })}
            </ul>
          </section>;
        })}
      </div> : <p className="p2-empty">Brak operacji w ostatnich dniach.</p>}
      {source.status === 'offline' && <p className="p2-note warn">{source.message}</p>}
    </div>}
    {peeked && <RawPopover t={peeked.t} box={peeked.box} />}
    {data && !fresh(source, now, MAX_AGE.bank) && source.status !== 'offline' && tall && <SourceNote source={source} now={now} maxAge={MAX_AGE.bank} />}
  </section>;
}
