import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { bankAssignSchema, type BankAssignCategory, type BankAssignChoice, type BankAssignMark, type BankAssignOutcome, type BankAssignPool, type BankAssignPreview, type BankAssignRecipient, type BankAssignTemplate } from '../bank-assign-contract';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { BankAssignArgs } from './types';

const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const signed = (amount: number) => `${amount > 0 ? '+' : ''}${pln(amount)}`;
const MOVE_WORDS = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' } as const;
const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-0.5 tw:text-xs';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const times = (n: number) => n === 1 ? 'raz' : 'razy';

const markLabel = (m: BankAssignMark) => `${m.category ? `${MOVE_WORDS[m.move]} · ${m.category.name}` : MOVE_WORDS[m.move]}${m.tags.map(t => ` #${t}`).join('')}`;
/** A mark without its kind when it is a spend (the common case): „Paliwo”, but „Przychód · Pensja”. */
const shortLabel = (m: BankAssignMark) => m.category ? (m.move === 'spend' ? m.category.name : `${MOVE_WORDS[m.move]} · ${m.category.name}`) : MOVE_WORDS[m.move];
const categoryLabel = (c: BankAssignCategory) => `${c.move === 'spend' ? 'Wydatek' : c.move === 'income' ? 'Przychód' : 'Przełożenie'} · ${c.name}`;

/** What the user chose on the card, as the request will carry it (and as the answer keeps it). */
export interface AssignSelection {
  skip: ReadonlySet<string>;
  skipOps: ReadonlySet<string>;
  groupPicks: Readonly<Record<string, string>>;
  picks: Readonly<Record<string, { template?: string; category?: string }>>;
}
const EMPTY: AssignSelection = { skip: new Set(), skipOps: new Set(), groupPicks: {}, picks: {} };
const fromChoice = (c: BankAssignChoice): AssignSelection => ({
  skip: new Set(c.skip), skipOps: new Set(c.skipOps), groupPicks: Object.fromEntries((c.groupPicks ?? []).map(g => [g.group, g.template])),
  picks: Object.fromEntries((c.picks ?? []).map(p => [p.tx, { template: p.template, category: p.category }])),
});

/** The template a recipient's operations follow: the one picked for it, else (when its earlier operations all agree) the only one. */
const groupTemplate = (r: BankAssignRecipient, sel: AssignSelection) => r.templates.find(t => t.key === sel.groupPicks[r.key]) ?? (r.certain ? r.templates[0] : undefined);
/** What one operation would be marked with now: its own pick, else its recipient's template; none when nothing is chosen. */
function markOf(r: BankAssignRecipient, tx: string, sel: AssignSelection, categories: BankAssignCategory[]): string | null {
  const pick = sel.picks[tx];
  if (pick?.category) { const c = categories.find(x => x.id === pick.category); return c ? categoryLabel(c) : null; }
  const t = pick?.template ? r.templates.find(x => x.key === pick.template) : groupTemplate(r, sel);
  return t ? markLabel(t.mark) : null;
}
/** How many of a recipient's operations get a mark and what they sum to; the ones beyond those listed follow the recipient's template. */
function counted(r: BankAssignRecipient, sel: AssignSelection, categories: BankAssignCategory[]) {
  if (sel.skip.has(r.key)) return { count: 0, total: 0 };
  const listed = r.items.filter(i => !sel.skipOps.has(i.tx) && markOf(r, i.tx, sel, categories));
  const rest = groupTemplate(r, sel) ? r.hidden : 0;
  const total = rest ? r.total - r.items.filter(i => !listed.includes(i)).reduce((s, i) => s + i.amount, 0) : listed.reduce((s, i) => s + i.amount, 0);
  return { count: listed.length + rest, total: Math.round(total * 100) / 100 };
}
const historyText = (r: BankAssignRecipient) => `wcześniej: ${r.templates.map(t => `${markLabel(t.mark)} ${t.count} ${times(t.count)}`).join(', ')}`;

const checkbox = 'tw:size-4 tw:accent-[#7ca9ff]';
const selectOn = 'tw:max-w-[170px] tw:rounded-full tw:border tw:border-ck-cal tw:bg-ck-cal/25 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-text';
const selectOff = 'tw:max-w-[170px] tw:rounded-full tw:border tw:border-ck-line tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-muted';

/** One recipient: a tick, who and how many, what it was marked with before, templates for the whole group; opens to its operations. */
function RecipientRow({ r, sel, categories, onChange, locked, expanded, onFlip }: {
  r: BankAssignRecipient; sel: AssignSelection; categories: BankAssignCategory[]; onChange: (next: AssignSelection) => void; locked: boolean; expanded: boolean; onFlip: () => void;
}) {
  const t = counted(r, sel, categories), partial = t.count > 0 && t.count < r.count;
  const group = groupTemplate(r, sel);
  const set = (patch: Partial<AssignSelection>) => onChange({ ...sel, ...patch });
  const toggleGroup = () => {
    if (t.count > 0) { set({ skip: new Set(sel.skip).add(r.key) }); return; }
    const skip = new Set(sel.skip); skip.delete(r.key);
    const skipOps = new Set([...sel.skipOps].filter(tx => !r.items.some(i => i.tx === tx)));
    set({ skip, skipOps, ...(group ? {} : { groupPicks: { ...sel.groupPicks, [r.key]: r.templates[0].key } }) });
  };
  const pickGroup = (tpl: BankAssignTemplate) => {
    const groupPicks = { ...sel.groupPicks };
    if (groupPicks[r.key] === tpl.key && !r.certain) delete groupPicks[r.key]; else groupPicks[r.key] = tpl.key;
    const skip = new Set(sel.skip); skip.delete(r.key);
    set({ groupPicks, skip });
  };
  const setOp = (tx: string, value: string) => {
    const picks = { ...sel.picks };
    if (!value) delete picks[tx]; else if (value.startsWith('t:')) picks[tx] = { template: value.slice(2) }; else picks[tx] = { category: value.slice(2) };
    const skipOps = new Set(sel.skipOps); skipOps.delete(tx);
    set({ picks, skipOps });
  };
  const toggleOp = (tx: string, has: boolean) => {
    if (has) { set({ skipOps: new Set(sel.skipOps).add(tx) }); return; }
    const skipOps = new Set(sel.skipOps); skipOps.delete(tx);
    // An operation with no mark yet gets the recipient's most frequent one when it is ticked.
    set({ skipOps, ...(markOf(r, tx, sel, categories) ? {} : { picks: { ...sel.picks, [tx]: { template: r.templates[0].key } } }), skip: new Set([...sel.skip].filter(k => k !== r.key)) });
  };
  return <div className="tw:border-b tw:border-ck-line tw:last:border-b-0" data-recipient={r.key}>
    <div className="tw:grid tw:grid-cols-[20px_minmax(0,1fr)_minmax(0,auto)] tw:items-center tw:gap-3 tw:px-3 tw:py-2">
      <input type="checkbox" className={checkbox} checked={t.count > 0} ref={el => { if (el) el.indeterminate = partial; }} disabled={locked} onChange={toggleGroup}
        aria-label={`Oznacz ${r.count} operacji: ${r.name}`} />
      <div className="tw:min-w-0">
        <div className="tw:truncate tw:text-sm tw:text-ck-text">{r.name} <span className="tw:text-ck-muted">· {partial ? `${t.count} z ${r.count}` : r.count} {r.count === 1 ? 'operacja' : 'operacji'} · {signed(t.count ? t.total : r.total)}</span></div>
        <button type="button" className="tw:flex tw:max-w-full tw:items-center tw:gap-1 tw:text-left tw:text-xs tw:text-ck-muted tw:hover:text-ck-text" aria-expanded={expanded} onClick={onFlip}>
          {expanded ? <ChevronUp size={13} className="tw:flex-none" aria-hidden="true" /> : <ChevronDown size={13} className="tw:flex-none" aria-hidden="true" />}<span className="tw:truncate">{historyText(r)}</span>
        </button>
      </div>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5" role="group" aria-label={`Szablon dla ${r.name}`}>
        <span className="tw:text-xs tw:text-ck-muted">oznacz jako</span>
        {r.templates.map(tpl => {
          const on = group?.key === tpl.key;
          return <button key={tpl.key} type="button" disabled={locked} aria-pressed={on} onClick={() => pickGroup(tpl)}
            className={`${chip} tw:border ${on ? 'tw:border-ck-cal tw:bg-ck-cal/25 tw:text-ck-text' : 'tw:border-ck-line tw:bg-ck-surface-2 tw:text-ck-muted tw:hover:text-ck-text'}`}>
            {on && <Check size={12} aria-hidden="true" />}{markLabel(tpl.mark)}{tpl.count > 0 && r.templates.length > 1 ? ` ×${tpl.count}` : ''}
          </button>;
        })}
      </div>
    </div>
    {expanded && <ul className="tw:m-0 tw:mb-1 tw:grid tw:list-none tw:gap-1 tw:px-3 tw:pb-2 tw:pl-[44px] tw:text-xs">
      {r.items.map(i => {
        const pick = sel.picks[i.tx];
        const has = !sel.skip.has(r.key) && !sel.skipOps.has(i.tx) && !!markOf(r, i.tx, sel, categories);
        const value = !has ? '__off' : pick?.category ? `c:${pick.category}` : pick?.template ? `t:${pick.template}` : '';
        return <li key={i.tx} className="tw:flex tw:items-center tw:gap-2">
          <input type="checkbox" className={checkbox} checked={has} disabled={locked} onChange={() => toggleOp(i.tx, has)} aria-label={`Oznacz ${i.day} ${i.name}`} />
          <span className={`tw:min-w-0 tw:flex-1 tw:truncate ${has ? 'tw:text-ck-text' : 'tw:text-ck-muted'}`}>{i.day} · {i.name} · {signed(i.amount)}</span>
          <select className={has ? selectOn : selectOff} value={value} disabled={locked} aria-label={`Oznaczenie: ${i.day} ${i.name}`}
            onChange={e => e.target.value === '__off' ? set({ skipOps: new Set(sel.skipOps).add(i.tx) }) : setOp(i.tx, e.target.value)}>
            <option value="__off">nie oznaczaj</option>
            {group && <option value="">{shortLabel(group.mark)}</option>}
            <optgroup label="Z historii odbiorcy">{r.templates.filter(tpl => tpl.key !== group?.key).map(tpl => <option key={tpl.key} value={`t:${tpl.key}`}>{shortLabel(tpl.mark)}</option>)}</optgroup>
            <optgroup label="Wszystkie kategorie">{categories.map(c => <option key={c.id} value={`c:${c.id}`}>{categoryLabel(c)}</option>)}</optgroup>
          </select>
        </li>;
      })}
      {r.hidden > 0 && <li>… jeszcze {r.hidden} (według szablonu grupy)</li>}
    </ul>}
  </div>;
}

/** A template in words; the other side the user gave it is shown only where the template is not one recipient's own. */
const templateLabel = (t: BankAssignTemplate, withParty: boolean) => `${markLabel(t.mark)}${withParty && t.party ? ` · ${t.party}` : ''}`;

/** How many payments of the pool have a pick (and what they sum to). */
function poolCounted(pool: BankAssignPool | null, sel: AssignSelection) {
  const picked = (pool?.items ?? []).filter(i => sel.picks[i.tx] && !sel.skipOps.has(i.tx));
  return { count: picked.length, total: Math.round(picked.reduce((s, i) => s + i.amount, 0) * 100) / 100 };
}

/**
 * The payments the bank gives no shop for. Nothing says whose they are, so nothing is suggested or ticked: the user selects payments
 * (a filter by amount helps), then clicks one of the templates the earlier marks of such payments give, or picks a category. A payment
 * whose very same amount was marked the same way before says so in a note and lists that template first; that is all a hint does.
 */
function PoolSection({ pool, categories, sel, onChange, locked }: {
  pool: BankAssignPool; categories: BankAssignCategory[]; sel: AssignSelection; onChange: (next: AssignSelection) => void; locked: boolean;
}) {
  const [checked, setChecked] = useState<ReadonlySet<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [view, setView] = useState<'all' | 'open' | 'marked'>('all');
  const amounts = [...pool.items.reduce((m, i) => m.set(Math.round(i.amount * 100), (m.get(Math.round(i.amount * 100)) ?? 0) + 1), new Map<number, number>())]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 15);
  const visible = pool.items.filter(i => (!amount || Math.round(i.amount * 100) === Number(amount)) && (view === 'all' || (view === 'marked') === !!sel.picks[i.tx]));
  const apply = (pick: { template?: string; category?: string } | null) => {
    const picks = { ...sel.picks };
    for (const tx of checked) { if (pick) picks[tx] = pick; else delete picks[tx]; }
    onChange({ ...sel, picks });
    setChecked(new Set());
  };
  const flip = (tx: string) => setChecked(prev => { const next = new Set(prev); if (!next.delete(tx)) next.add(tx); return next; });
  const setOne = (tx: string, value: string) => {
    const picks = { ...sel.picks };
    if (!value) delete picks[tx]; else if (value.startsWith('t:')) picks[tx] = { template: value.slice(2) }; else picks[tx] = { category: value.slice(2) };
    onChange({ ...sel, picks });
  };
  const none = checked.size === 0 || locked;
  const done = poolCounted(pool, sel);
  return <div className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid="assign-pool">
    <div className="tw:flex tw:justify-between tw:bg-ck-surface-2 tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted"><span>Bez sklepu: bank nie podaje, gdzie zapłaciłeś. Nic nie jest zaznaczone ani zaproponowane.</span><span>{plural(pool.count, 'płatność', 'płatności')}</span></div>
    <div className="tw:grid tw:gap-2 tw:border-t tw:border-ck-line tw:px-3 tw:py-2">
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5" role="group" aria-label="Szablony dla płatności bez sklepu">
        <span className="tw:text-xs tw:text-ck-muted">Zaznacz płatności, potem kliknij szablon{checked.size ? ` (zaznaczone: ${checked.size})` : ''}:</span>
        {pool.templates.map(t => <button key={t.key} type="button" disabled={none} onClick={() => apply({ template: t.key })}
          className={`${chip} tw:border tw:border-ck-line tw:bg-ck-surface-2 tw:text-ck-text tw:enabled:hover:border-ck-cal tw:disabled:opacity-50`}>{templateLabel(t, true)} ×{t.count}</button>)}
        <select className={selectOff} value="" disabled={none} aria-label="Inna kategoria dla zaznaczonych" onChange={e => { if (e.target.value) apply({ category: e.target.value.slice(2) }); }}>
          <option value="">Inna kategoria…</option>
          {categories.map(c => <option key={c.id} value={`c:${c.id}`}>{categoryLabel(c)}</option>)}
        </select>
        <button type="button" disabled={none} onClick={() => apply(null)} className={`${chip} tw:border tw:border-ck-line tw:text-ck-muted tw:enabled:hover:text-ck-text tw:disabled:opacity-50`}>Wyczyść zaznaczone</button>
      </div>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
        <span className="tw:text-xs tw:text-ck-muted">Pokaż:</span>
        <select className={selectOff} value={amount} aria-label="Filtr kwoty" onChange={e => setAmount(e.target.value)}>
          <option value="">wszystkie kwoty</option>
          {amounts.map(([c, n]) => <option key={c} value={c}>{pln(Math.abs(c) / 100)} ({n})</option>)}
        </select>
        <select className={selectOff} value={view} aria-label="Filtr stanu" onChange={e => setView(e.target.value as typeof view)}>
          <option value="all">wszystkie</option><option value="open">bez wyboru</option><option value="marked">z wyborem</option>
        </select>
        <button type="button" disabled={locked} onClick={() => setChecked(new Set(visible.map(i => i.tx)))} className={`${chip} tw:border tw:border-ck-line tw:text-ck-muted tw:enabled:hover:text-ck-text`}>Zaznacz widoczne ({visible.length})</button>
        <button type="button" disabled={locked || !checked.size} onClick={() => setChecked(new Set())} className={`${chip} tw:border tw:border-ck-line tw:text-ck-muted tw:enabled:hover:text-ck-text tw:disabled:opacity-50`}>Odznacz</button>
      </div>
    </div>
    <ul className="tw:m-0 tw:grid tw:max-h-80 tw:list-none tw:gap-0.5 tw:overflow-y-auto tw:border-t tw:border-ck-line tw:px-3 tw:py-2 tw:text-xs">
      {visible.map(i => {
        const pick = sel.picks[i.tx];
        const value = pick?.category ? `c:${pick.category}` : pick?.template ? `t:${pick.template}` : '';
        const hinted = i.hint ? pool.templates.find(t => t.key === i.hint!.template) : undefined;
        return <li key={i.tx} className="tw:flex tw:items-center tw:gap-2">
          <input type="checkbox" className={checkbox} checked={checked.has(i.tx)} disabled={locked} onChange={() => flip(i.tx)} aria-label={`Zaznacz ${i.day} ${signed(i.amount)}`} />
          <span className="tw:w-[72px] tw:flex-none tw:text-ck-muted">{i.day.slice(5)}</span>
          <span className="tw:w-[84px] tw:flex-none tw:text-ck-text">{signed(i.amount)}</span>
          <span className="tw:min-w-0 tw:flex-1 tw:truncate tw:text-ck-faint">{hinted && i.hint ? `ta sama kwota: ${templateLabel(hinted, true)} ${i.hint.count} ${times(i.hint.count)}` : ''}</span>
          <select className={value ? selectOn : selectOff} value={value} disabled={locked} aria-label={`Oznaczenie płatności ${i.day} ${signed(i.amount)}`} onChange={e => setOne(i.tx, e.target.value)}>
            <option value="">nie oznaczaj</option>
            <optgroup label="Szablony">{[...pool.templates].sort((a, b) => Number(b.key === i.hint?.template) - Number(a.key === i.hint?.template)).map(t => <option key={t.key} value={`t:${t.key}`}>{templateLabel(t, true)}</option>)}</optgroup>
            <optgroup label="Wszystkie kategorie">{categories.map(c => <option key={c.id} value={`c:${c.id}`}>{categoryLabel(c)}</option>)}</optgroup>
          </select>
        </li>;
      })}
      {!visible.length && <li className="tw:text-ck-muted">Nic nie pasuje do filtra.</li>}
      {pool.hidden > 0 && <li className="tw:text-ck-muted">… i {pool.hidden} starszych: poza limitem karty, oznaczysz je sam później.</li>}
    </ul>
    <div className="tw:border-t tw:border-ck-line tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted">Z tej sekcji do zapisu: {plural(done.count, 'płatność', 'płatności')}{done.count ? `, ${signed(done.total)}` : ''}. Reszta zostaje nieoznaczona.</div>
  </div>;
}

/**
 * The recipients with unmarked operations. Those whose earlier operations always got the same mark come first, ticked; the others
 * ("różnie") wait for a template or a category. Both can be changed for the whole group or for one operation.
 */
export function AssignBody({ preview, sel, onChange, locked = false, state = 'open' }: {
  preview: BankAssignPreview; sel: AssignSelection; onChange: (next: AssignSelection) => void; locked?: boolean; state?: 'open' | 'applied' | 'rejected';
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const flip = (key: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  const sections = [
    { title: 'Zawsze to samo: zaznaczone', rows: preview.recipients.filter(r => r.certain), id: 'assign-certain' },
    { title: 'Różnie: wybierz szablon dla grupy albo operacji', rows: preview.recipients.filter(r => !r.certain), id: 'assign-mixed' },
  ].filter(s => s.rows.length);
  return <div className={`tw:grid tw:gap-3 ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state}>
    {sections.map(s => <div key={s.id} className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid={s.id}>
      <div className="tw:flex tw:justify-between tw:bg-ck-surface-2 tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted"><span>{s.title}</span><span>{plural(s.rows.length, 'odbiorca', 'odbiorców')} · {plural(s.rows.reduce((n, r) => n + r.count, 0), 'operacja', 'operacji')}</span></div>
      {s.rows.map(r => <RecipientRow key={r.key} r={r} sel={sel} categories={preview.categories} onChange={onChange} locked={locked} expanded={open.has(r.key)} onFlip={() => flip(r.key)} />)}
    </div>)}
    {preview.pool && <PoolSection pool={preview.pool} categories={preview.categories} sel={sel} onChange={onChange} locked={locked} />}
  </div>;
}

/** The days the card covers, in words: what was asked and what the operations really span. */
function rangeText(p: BankAssignPreview) {
  const span = p.range.first ? (p.range.first === p.range.last ? p.range.first : `${p.range.first} do ${p.range.last}`) : null;
  if (!p.range.from && !p.range.to) return `Wszystkie zapisane operacje${span ? `: z dni ${span}` : ''}`;
  return `Zakres: ${p.range.from ?? 'od początku'} – ${p.range.to ?? 'do dziś'}${span ? ` · operacje z ${span}` : ''}`;
}

/**
 * `panel_bank_assign`: the consent card for marking many operations. Wektor only named a range of days; the recipients and their
 * templates are worked out here by the panel (`GET /api/bank/assign`), the user ticks, picks a template or a category for a
 * group or one operation, and nothing is marked until „Wykonaj”.
 */
export function BankAssignCard({ toolCallId, args, result }: ToolCallMessagePartProps<BankAssignArgs>) {
  const { respond, running } = useContext(CardActions);
  const plan = bankAssignSchema.safeParse(args);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as BankAssignOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: BankAssignPreview; error?: string }>({ key: '' });
  const needsPreview = !decided || (decided.decision === 'rejected' && !decided.preview);
  const [mine, setMine] = useState<AssignSelection>(EMPTY);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.success || !needsPreview) return;
    const params = new URLSearchParams();
    if (plan.data.from) params.set('from', plan.data.from);
    if (plan.data.to) params.set('to', plan.data.to);
    let gone = false;
    fetch(`/api/bank/assign?${params}`, { signal: AbortSignal.timeout(15_000) }).then(async response => {
      const body = await response.json().catch(() => null) as (BankAssignPreview & { error?: string }) | null;
      if (gone) return;
      setState(response.ok && body ? { key, data: body } : { key, error: body?.error || 'Nie udało się pobrać podglądu oznaczeń.' });
    }, () => { if (!gone) setState({ key, error: 'Nie udało się pobrać podglądu oznaczeń.' }); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the plan
  }, [key, needsPreview]);
  const preview = decided?.preview ?? (state.key === key ? state.data : undefined);
  // After an answer the card shows what was decided; before, what the user has ticked and picked so far.
  const sel = decided?.decision === 'applied' ? fromChoice(decided.choice) : mine;
  const rows = preview?.recipients ?? [];
  const sums = rows.map(r => counted(r, sel, preview?.categories ?? []));
  const poolDone = poolCounted(preview?.pool ?? null, sel);
  const count = sums.reduce((n, t) => n + t.count, 0) + poolDone.count;
  const total = sums.reduce((n, t) => n + t.total, 0) + poolDone.total;
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Oznaczenia z podpowiedzi';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const ok = !!preview && !preview.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    const live = new Set(rows.map(r => r.key));
    const opsOf = new Map([...rows.flatMap(r => r.items.map(i => [i.tx, r.key] as const)), ...(preview?.pool?.items ?? []).map(i => [i.tx, 'pool'] as const)]);
    const extra: BankAssignChoice = {
      ...(mine.skip.size ? { skip: [...mine.skip].filter(k => live.has(k)) } : {}),
      ...([...mine.skipOps].some(tx => opsOf.has(tx)) ? { skipOps: [...mine.skipOps].filter(tx => opsOf.has(tx)) } : {}),
      ...(Object.keys(mine.groupPicks).some(g => live.has(g)) ? { groupPicks: Object.entries(mine.groupPicks).filter(([g]) => live.has(g)).map(([group, template]) => ({ group, template })) } : {}),
      ...(Object.keys(mine.picks).some(tx => opsOf.has(tx)) ? { picks: Object.entries(mine.picks).filter(([tx]) => opsOf.has(tx)).map(([tx, p]) => ({ tx, ...(p.category ? { category: p.category } : { template: p.template }) })) as BankAssignChoice['picks'] } : {}),
    };
    try { await respond(toolCallId, { kind: 'bankPlan', decision, ...(decision === 'apply' ? extra : {}) }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  return <ConsentShell
    label="Zgoda na masowe oznaczenie"
    heading={!decided ? 'Oznaczyć z podpowiedzi?' : decided.decision === 'applied' ? 'Oznaczono' : 'Odrzucono'}
    subtitle={title}
    notices={!decided && <>
      {args.refused && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {args.refused}</p>}
      {!plan.success && <p className={refusedNote} role="alert">Agent przysłał niepoprawną propozycję.</p>}
      {state.key === key && state.error && <p className={refusedNote} role="alert">{state.error}</p>}
      {plan.success && !preview && !state.error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Liczę podgląd…</p>}
      {preview?.problems.map(p => <p key={p} className={refusedNote} role="alert">{p}</p>)}
    </>}
    body={ok ? <>
      <p className="tw:m-0 tw:text-xs tw:text-ck-muted" data-testid="assign-range">{rangeText(preview)}</p>
      <AssignBody preview={preview} sel={sel} locked={!!decided} state={decided ? decided.decision : 'open'} onChange={setMine} />
    </> : undefined}
    footnote={!decided && ok ? <div className="tw:grid tw:gap-1 tw:text-xs tw:text-ck-muted">
      <p className="tw:m-0 tw:text-ck-text">Zaznaczone: {plural(count, 'operacja', 'operacji')}{count ? `, ${signed(Math.round(total * 100) / 100)}` : ''}.</p>
      <p className="tw:m-0">Operacje jednego odbiorcy nie muszą mieć tego samego oznaczenia. Kwoty, daty i strony zostają, a nic nie idzie do banku.</p>
    </div> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Oznaczono {plural(decided.assigned, 'operację', 'operacji')}.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !args.refused && count > 0}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
