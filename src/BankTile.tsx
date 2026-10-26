import { useState, type CSSProperties } from 'react';
import { Check, Landmark, MessageSquare, Repeat, Settings2, User, X } from 'lucide-react';
import { SourceNote } from './components';
import { MAX_AGE, fresh } from './model';
import type { BankTransaction } from './bank-contract';
import type { BankCategory, BankLabel, BankLabelsData } from './bank-labels-contract';
import { describe } from './bank-merchants';
import { COLOR_VALUES, ICONS, howPaid, optionText } from './bank-look';
import { BankLabelDialog } from './BankLabelDialog';
import { BankLabelSettings } from './BankLabelSettings';
import type { BankHook } from './useBank';
import { withLabel } from './useBankLabels';

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

/**
 * What the last `SUM_DAYS` days went on, by the user's own categories, largest first; money that came in is not counted and
 * whatever has no category (or one since deleted) is one "Bez kategorii" share, never guessed.
 */
export function spending(transactions: BankTransaction[], now: number, currency: string, labels: Record<string, BankLabel> = {}, categories: BankCategory[] = []): { category: BankCategory | null; sum: number }[] {
  const known = new Map(categories.map(c => [c.id, c]));
  const by = new Map<string, { category: BankCategory | null; sum: number }>();
  for (const t of transactions) {
    if (t.currency !== currency || t.amount >= 0 || now - t.at > SUM_DAYS * DAY) continue;
    const category = known.get(labels[t.id]?.category ?? '') ?? null;
    const entry = by.get(category?.id ?? '') ?? { category, sum: 0 };
    entry.sum -= t.amount;
    by.set(category?.id ?? '', entry);
  }
  return [...by.values()].sort((a, b) => b.sum - a.sum);
}

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

const tint = (category: BankCategory | null | undefined): CSSProperties | undefined => category ? { '--c': COLOR_VALUES[category.color] } as CSSProperties : undefined;

/**
 * The bank account as a tile: the balance, what came in and went out in the last 30 days, where the money went by the user's
 * own categories, and the operations by day. An operation shows its category in its colour and icon, or "Bez kategorii":
 * since the day the user picked, an unmarked one has a dashed circle and counts in "N do przypisania", with the server's
 * suggestion beside it (✓ takes it, ✕ rejects it) when the tile is wide. A tap opens the marking dialog; the bank's raw answer
 * shows beside a row under the pointer. Without a consent (or when it has run out) the tile offers to connect: the bank's
 * sign-in opens from a link, because a browser blocks a window opened after the server has answered. `wide` and `tall`
 * follow the tile's cells.
 */
export function BankTile({ bank, now, wide = true, tall = true }: { bank: BankHook; now: number; wide?: boolean; tall?: boolean }) {
  const { source, signIn, error, busy, connect, labels: marks } = bank;
  const data = source.data;
  const labels: BankLabelsData | null = marks.source.data;
  const categories = new Map((labels?.categories ?? []).map(c => [c.id, c]));
  const people = new Map((labels?.people ?? []).map(p => [p.id, p]));
  const merchants = new Map((labels?.merchants ?? []).map(m => [m.id, m]));
  const pending = new Set(labels?.pending ?? []);
  const accounts = data?.accounts ?? [];
  const currency = accounts[0]?.currency ?? 'PLN';
  const balances = accounts.filter(a => a.currency === currency);
  const total = balances.length && balances.every(a => a.balance !== null) ? balances.reduce((s, a) => s + (a.balance ?? 0), 0) : null;
  const flow = data ? sums(data.transactions, now, currency) : null;
  const kinds = data ? spending(data.transactions, now, currency, labels?.labels, labels?.categories) : [];
  const spent = kinds.reduce((s, k) => s + k.sum, 0);
  const daysLeft = source.consentUntil ? Math.floor((source.consentUntil - now) / DAY) : null;
  const expiring = !source.loginRequired && daysLeft !== null && daysLeft <= CONSENT_WARN_DAYS;
  const groups = byDay(data?.transactions.slice(0, SHOWN) ?? []);
  // The raw answer of the bank for the operation under the pointer (or focus), beside its row.
  const [peeked, setPeeked] = useState<{ t: BankTransaction; box: DOMRect } | null>(null);
  const peek = (t: BankTransaction, row: HTMLElement) => setPeeked({ t, box: row.getBoundingClientRect() });
  // The operation being marked; `queue` when it was opened from "N do przypisania", so saving goes on to the next one.
  const [editing, setEditing] = useState<{ id: string; queue: boolean } | null>(null);
  const [settings, setSettings] = useState(false);
  const open = (id: string, queue = false) => { setPeeked(null); marks.clearError(); setEditing({ id, queue }); };
  const toMark = (data?.transactions ?? []).filter(t => pending.has(t.id));
  const edited = editing && data?.transactions.find(t => t.id === editing.id);
  const label = accounts.length === 1 ? `${accounts[0].name}${accounts[0].last4 ? ` ··${accounts[0].last4}` : ''}` : accounts.length > 1 ? `${accounts.length} konta` : '';

  const accept = (t: BankTransaction) => {
    const o = labels?.suggestions[t.id]?.options[0];
    if (!o) return;
    const before = labels?.labels[t.id];
    void marks.act({ action: 'accept', tx: t.id, option: 0 }, d => withLabel(d, t.id, {
      category: o.category ?? before?.category ?? null, tags: o.tags ?? before?.tags ?? [], merchant: o.merchant ?? before?.merchant ?? null,
      person: o.person ?? before?.person ?? null, recurring: o.recurring ?? before?.recurring ?? false, comment: before?.comment ?? '',
    }));
  };
  const reject = (t: BankTransaction) => void marks.act({ action: 'reject', tx: t.id }, d => { const suggestions = { ...d.suggestions }; delete suggestions[t.id]; return { ...d, suggestions }; });

  return <section className={`p2-card bank${wide ? ' wide' : ''}${tall ? ' tall' : ''}`} aria-label="Konto bankowe">
    <div className="p2-card-head static">
      <Landmark size={18} aria-hidden="true" />
      <h2>Konto</h2>
      {label && wide && <span className="p2-meta">{label}</span>}
      {expiring && <span className="p2-badge warn" title="Zgoda w banku wygasa; połącz konto ponownie">zgoda: {daysLeft} dni</span>}
      {data && labels && toMark.length > 0 && <button type="button" className="p2-badge bank-todo" onClick={() => open(toMark[0].id, true)}
        title={`Operacje od ${labels.since} bez kategorii`}>{toMark.length} do przypisania</button>}
      {data && labels && <button type="button" className="bank-gear" aria-label="Ustawienia oznaczeń" onClick={() => setSettings(true)}><Settings2 size={16} aria-hidden="true" /></button>}
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
          {kinds.map(k => <i key={k.category?.id ?? 'none'} className={k.category ? undefined : 'uncat'} style={{ flex: k.sum, ...tint(k.category) }} title={`${k.category?.name ?? 'Bez kategorii'}: ${money(k.sum, currency)}`} />)}
        </div>
        <ul className="bank-legend">
          {kinds.slice(0, wide ? 4 : 3).map(k => <li key={k.category?.id ?? 'none'} className={k.category ? undefined : 'uncat'} style={tint(k.category)}><i />{k.category?.name ?? 'Bez kategorii'} <b>{Math.round((k.sum / spent) * 100)}%</b></li>)}
        </ul>
      </div>}
      {marks.error && !editing && <p className="p2-note warn" role="status">{marks.error}</p>}
      {groups.length ? <div className="bank-days" aria-label="Operacje według dni">
        {groups.map(g => {
          const net = g.items.reduce((s, t) => s + (t.currency === currency ? t.amount : 0), 0);
          return <section key={g.at} className="bank-day">
            <h3><span>{dayHeading(g.at, now)}</span><span className={`num${net > 0 ? ' in' : ''}`}>{signed(net, currency)}</span></h3>
            <ul>
              {g.items.map(t => {
                const d = describe(t);
                const mark = labels?.labels[t.id];
                const category = mark?.category ? categories.get(mark.category) : undefined;
                const person = mark?.person ? people.get(mark.person) : undefined;
                // The merchant the user named, or the one the bank's text or account is known to be.
                const merchant = merchants.get(mark?.merchant ?? labels?.known[t.id]?.merchant ?? '');
                const name = merchant?.name ?? d.name;
                const todo = pending.has(t.id);
                const suggestion = todo ? labels?.suggestions[t.id] : undefined;
                const first = suggestion?.options[0];
                const proposed = first?.category ? categories.get(first.category) : undefined;
                const Icon = category ? ICONS[category.icon] : null;
                return <li key={t.id} className={`bank-row${todo ? ' todo' : ''}${category ? ' marked' : ''}`} style={tint(category)} tabIndex={0}
                  aria-label={`${name}, ${signed(t.amount, t.currency)}, ${category ? category.name : 'bez kategorii'}${todo ? ', do przypisania' : ''}`}
                  onMouseEnter={e => peek(t, e.currentTarget)} onFocus={e => { if (e.target === e.currentTarget) peek(t, e.currentTarget); }} onMouseLeave={() => setPeeked(null)} onBlur={() => setPeeked(null)}
                  onClick={() => open(t.id)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); open(t.id); } }}>
                  <span className={`bank-avatar${category ? '' : todo ? ' dashed' : ' none'}`} aria-hidden="true">{Icon && <Icon size={18} />}</span>
                  <span className="bank-what">
                    <span className="bank-title">{name}</span>
                    <span className="bank-note">
                      {todo && !category ? <span className="bank-assign">przypisz</span> : <span className={category ? 'bank-cat' : 'bank-uncat'}>{category?.name ?? 'Bez kategorii'}</span>}
                      {mark?.tags.length ? <span className="bank-tags">{' '}{mark.tags.map(tag => `#${tag}`).join(' ')}</span> : null}
                      <span>{' · '}{howPaid(t, !!merchant)}</span>
                      {mark?.recurring && <Repeat size={12} className="bank-flag" aria-label="cykliczne" />}
                      {person && <span className="bank-flag person"><User size={12} aria-hidden="true" />{person.name}</span>}
                      {mark?.comment && <MessageSquare size={12} className="bank-flag" aria-label={`opis: ${mark.comment}`} />}
                    </span>
                    {suggestion && first && wide && (suggestion.options.length > 1
                      ? <span className="bank-sug weak"><i aria-hidden="true" /><span className="bank-sug-text"><b>{suggestion.options.length} możliwości</b> do wyboru w oknie</span></span>
                      : <span className={`bank-sug${suggestion.sure ? '' : ' weak'}`} style={tint(proposed)}>
                        <i aria-hidden="true" />
                        <span className="bank-sug-text"><b>{optionText(first, labels!)}?</b> {first.reasons.at(-1)}{suggestion.sure ? '' : ' (niepewne)'}</span>
                        <button type="button" className="ok" aria-label={`Przyjmij podpowiedź: ${optionText(first, labels!)}`} onClick={e => { e.stopPropagation(); accept(t); }}><Check size={15} aria-hidden="true" /></button>
                        <button type="button" className="no" aria-label="Odrzuć podpowiedź" onClick={e => { e.stopPropagation(); reject(t); }}><X size={15} aria-hidden="true" /></button>
                      </span>)}
                  </span>
                  <span className="bank-side">
                    <b className={`bank-amount num${t.amount > 0 ? ' in' : ''}`}>{signed(t.amount, t.currency)}</b>
                    {suggestion && !wide && <span className={`bank-sug-dot${suggestion.sure ? '' : ' weak'}`} title="Jest podpowiedź" />}
                  </span>
                </li>;
              })}
            </ul>
          </section>;
        })}
      </div> : <p className="p2-empty">Brak operacji w ostatnich dniach.</p>}
      {source.status === 'offline' && <p className="p2-note warn">{source.message}</p>}
    </div>}
    {peeked && !editing && <RawPopover t={peeked.t} box={peeked.box} />}
    {edited && labels && <BankLabelDialog key={edited.id} t={edited} data={labels} act={marks.act} error={marks.error}
      position={editing.queue ? { index: toMark.findIndex(t => t.id === edited.id) + 1, of: toMark.length } : undefined}
      close={() => setEditing(null)}
      done={() => {
        // From the queue the next operation still to be marked opens; otherwise the dialog just closes.
        const at = toMark.findIndex(t => t.id === edited.id);
        const next = editing.queue ? [...toMark.slice(at + 1), ...toMark.slice(0, Math.max(0, at))].find(t => t.id !== edited.id) : undefined;
        setEditing(next ? { id: next.id, queue: true } : null);
      }} />}
    {settings && labels && <BankLabelSettings data={labels} act={marks.act} error={marks.error} close={() => setSettings(false)} />}
    {data && !fresh(source, now, MAX_AGE.bank) && source.status !== 'offline' && tall && <SourceNote source={source} now={now} maxAge={MAX_AGE.bank} />}
  </section>;
}
