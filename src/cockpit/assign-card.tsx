import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { bankAssignSchema, type BankAssignGroup, type BankAssignMark, type BankAssignOutcome, type BankAssignPreview } from '../bank-assign-contract';
import { COLOR_VALUES, ICONS } from '../bank-look';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { BankAssignArgs } from './types';

const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const signed = (amount: number) => `${amount > 0 ? '+' : ''}${pln(amount)}`;
const MOVE_WORDS = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' } as const;
const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-0.5 tw:text-xs';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** What the group's operations are called, from the few the card lists: a handful of distinct names. */
const namesOf = (g: BankAssignGroup) => {
  const names = [...new Set(g.items.map(i => i.name))];
  return names.slice(0, 3).join(', ') + (names.length > 3 || g.hidden ? '…' : '');
};

/** A mark in words: its kind and category in the category's colour, then the other side and the tags. */
function MarkChips({ mark, hideParty = '' }: { mark: BankAssignMark; hideParty?: string }) {
  const Icon = mark.category ? ICONS[mark.category.icon] ?? ICONS.tag : null;
  return <>
    <span className={`${chip} tw:bg-ck-cal/15 tw:text-ck-text`}>
      {Icon && mark.category && <Icon size={13} style={{ color: COLOR_VALUES[mark.category.color] }} aria-hidden="true" />}
      {mark.category ? `${MOVE_WORDS[mark.move]} · ${mark.category.name}` : MOVE_WORDS[mark.move]}
    </span>
    {mark.party && !hideParty.toLowerCase().includes(mark.party.toLowerCase()) && <span className={`${chip} tw:bg-ck-surface-2 tw:text-ck-muted`}>{mark.party}</span>}
    {mark.tags.map(t => <span key={t} className={`${chip} tw:bg-ck-surface-2 tw:text-ck-muted`}>#{t}</span>)}
  </>;
}

/** What the user has ticked and picked; the card owns it, the body only shows it. */
export interface AssignSelection {
  /** Groups unticked, single operations unticked, and the option picked for each choice (by operation id). */
  groups: ReadonlySet<string>;
  ops: ReadonlySet<string>;
  picks: Readonly<Record<string, number>>;
}
/** How many operations a group has ticked and what they sum to; the ones beyond those listed are always in. */
function ticked(g: BankAssignGroup, sel: AssignSelection) {
  if (sel.groups.has(g.key)) return { count: 0, total: 0 };
  const off = g.items.filter(i => sel.ops.has(i.tx));
  return { count: g.count - off.length, total: Math.round((g.total - off.reduce((s, i) => s + i.amount, 0)) * 100) / 100 };
}

const checkbox = 'tw:size-4 tw:accent-[#7ca9ff]';

/**
 * The groups of operations that would get the same mark, one row each: a tick, how many and what they are, what mark they get
 * and the sum; a row opens to list its operations, each with its own tick. Below, the operations the panel has only a choice
 * for, each with its options to pick from; nothing is picked until the user clicks one.
 */
export function AssignBody({ preview, sel, onGroup, onOp, onPick, locked = false, state = 'open' }: {
  preview: BankAssignPreview; sel: AssignSelection; onGroup?: (g: BankAssignGroup) => void; onOp?: (tx: string) => void; onPick?: (tx: string, option: number) => void;
  locked?: boolean; state?: 'open' | 'applied' | 'rejected';
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const flip = (key: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  return <div className={`tw:grid tw:gap-3 ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state}>
    {preview.groups.length > 0 && <div className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid="assign-groups">
      {preview.groups.map(g => {
        const t = ticked(g, sel), expanded = open.has(g.key), partial = t.count > 0 && t.count < g.count;
        return <div key={g.key} className="tw:border-b tw:border-ck-line tw:last:border-b-0" data-group={g.key}>
          <div className={`tw:grid tw:grid-cols-[20px_minmax(0,1fr)_minmax(0,auto)] tw:items-center tw:gap-3 tw:px-3 tw:py-2 ${t.count ? '' : 'tw:opacity-55'}`}>
            <input type="checkbox" className={checkbox} checked={t.count > 0} ref={el => { if (el) el.indeterminate = partial; }} disabled={locked} onChange={() => onGroup?.(g)}
              aria-label={`Oznacz ${g.count} operacji: ${namesOf(g)}`} />
            <div className="tw:min-w-0">
              <div className="tw:truncate tw:text-sm tw:text-ck-text"><span className="tw:text-ck-muted">{partial ? `${t.count} z ${g.count}` : `${g.count}`} ×</span> {namesOf(g)}</div>
              <button type="button" className="tw:flex tw:max-w-full tw:items-center tw:gap-1 tw:text-left tw:text-xs tw:text-ck-muted tw:hover:text-ck-text" aria-expanded={expanded} onClick={() => flip(g.key)}>
                {expanded ? <ChevronUp size={13} className="tw:flex-none" aria-hidden="true" /> : <ChevronDown size={13} className="tw:flex-none" aria-hidden="true" />}<span className="tw:truncate">{g.why || 'pokaż operacje'}</span>
              </button>
            </div>
            <div className="tw:grid tw:justify-items-end tw:gap-0.5"><div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5"><MarkChips mark={g} hideParty={namesOf(g)} /></div><span className="tw:text-xs tw:text-ck-muted">{signed(t.count ? t.total : g.total)}</span></div>
          </div>
          {expanded && <ul className="tw:m-0 tw:grid tw:list-none tw:gap-0.5 tw:px-3 tw:pb-2 tw:pl-[44px] tw:text-xs tw:text-ck-muted">
            {g.items.map(i => {
              const on = !sel.groups.has(g.key) && !sel.ops.has(i.tx);
              return <li key={i.tx} className={`tw:flex tw:items-center tw:gap-2 ${on ? '' : 'tw:opacity-55'}`}>
                <input type="checkbox" className={checkbox} checked={on} disabled={locked} onChange={() => onOp?.(i.tx)} aria-label={`Oznacz ${i.day} ${i.name}`} />
                <span className="tw:min-w-0 tw:flex-1 tw:truncate">{i.day} · {i.name}</span><span className="tw:flex-none">{signed(i.amount)}</span>
              </li>;
            })}
            {g.hidden > 0 && <li>… jeszcze {g.hidden} (zawsze razem z grupą)</li>}
          </ul>}
        </div>;
      })}
    </div>}
    {preview.choices.items.length > 0 && <div className="tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line" data-testid="assign-choices">
      <div className="tw:flex tw:justify-between tw:bg-ck-surface-2 tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted"><span>Do wyboru: kliknij oznaczenie, inaczej zostaje bez zmian</span><span>{plural(preview.choices.count, 'operacja', 'operacji')}</span></div>
      {preview.choices.items.map(c => <div key={c.tx} className="tw:grid tw:grid-cols-[minmax(0,1fr)_minmax(0,auto)] tw:items-center tw:gap-3 tw:border-t tw:border-ck-line tw:px-3 tw:py-2">
        <div className="tw:min-w-0">
          <div className="tw:truncate tw:text-sm tw:text-ck-text">{c.name}</div>
          <div className="tw:truncate tw:text-xs tw:text-ck-muted">{c.day} · {signed(c.amount)} · {c.why}</div>
        </div>
        <div className="tw:flex tw:flex-wrap tw:justify-end tw:gap-1.5" role="group" aria-label={`Oznaczenie dla ${c.day} ${c.name}`}>
          {c.options.map((o, n) => {
            const label = o.category ? `${MOVE_WORDS[o.move]} · ${o.category.name}` : MOVE_WORDS[o.move];
            const picked = sel.picks[c.tx] === n;
            return <button key={n} type="button" disabled={locked} aria-pressed={picked} onClick={() => onPick?.(c.tx, n)}
              className={`${chip} tw:border ${picked ? 'tw:border-ck-cal tw:bg-ck-cal/25 tw:text-ck-text' : 'tw:border-ck-line tw:bg-ck-surface-2 tw:text-ck-muted tw:hover:text-ck-text'}`}>
              {picked && <Check size={12} aria-hidden="true" />}{label}{o.party ? ` · ${o.party}` : ''}{o.tags.map(t => ` #${t}`).join('')}
            </button>;
          })}
        </div>
      </div>)}
      {preview.choices.count > preview.choices.items.length && <div className="tw:border-t tw:border-ck-line tw:px-3 tw:py-1.5 tw:text-xs tw:text-ck-muted">… i {preview.choices.count - preview.choices.items.length} kolejnych: oznaczysz je sam później.</div>}
    </div>}
  </div>;
}

/** The days the card covers, in words: what was asked and what the operations really span. */
function rangeText(p: BankAssignPreview) {
  const span = p.range.first ? (p.range.first === p.range.last ? p.range.first : `${p.range.first} do ${p.range.last}`) : null;
  if (!p.range.from && !p.range.to) return `Wszystkie zapisane operacje${span ? `: z dni ${span}` : ''}`;
  return `Zakres: ${p.range.from ?? 'od początku'} – ${p.range.to ?? 'do dziś'}${span ? ` · operacje z ${span}` : ''}`;
}

const toggled = (set: ReadonlySet<string>, id: string) => { const next = new Set(set); if (!next.delete(id)) next.add(id); return next; };

/**
 * `panel_bank_assign`: the consent card for marking many operations with the panel's own suggestions. Wektor only named a
 * range of days; the groups and choices are worked out here by the panel (`GET /api/bank/assign`), the user may untick a group
 * or one operation and pick an option for a choice, and nothing is marked until „Wykonaj”.
 */
export function BankAssignCard({ toolCallId, args, result }: ToolCallMessagePartProps<BankAssignArgs>) {
  const { respond, running } = useContext(CardActions);
  const plan = bankAssignSchema.safeParse(args);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as BankAssignOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: BankAssignPreview; error?: string }>({ key: '' });
  const needsPreview = !decided || (decided.decision === 'rejected' && !decided.preview);
  const [mine, setMine] = useState<AssignSelection>({ groups: new Set(), ops: new Set(), picks: {} });
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
  const sel: AssignSelection = decided?.decision === 'applied'
    ? { groups: new Set(decided.skipped), ops: new Set(decided.skippedOps ?? []), picks: Object.fromEntries((decided.picked ?? []).map(p => [p.tx, p.option])) }
    : mine;
  const groups = preview?.groups ?? [];
  const sums = groups.map(g => ticked(g, sel));
  const count = sums.reduce((n, t) => n + t.count, 0);
  const pickedItems = (preview?.choices.items ?? []).filter(c => c.tx in sel.picks);
  const total = sums.reduce((n, t) => n + t.total, 0) + pickedItems.reduce((n, c) => n + c.amount, 0);
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Oznaczenia z podpowiedzi';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const ok = !!preview && !preview.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    // Unticked single operations only matter inside a group that stays ticked.
    const skipOps = groups.filter(g => !mine.groups.has(g.key)).flatMap(g => g.items.filter(i => mine.ops.has(i.tx)).map(i => i.tx));
    const picks = pickedItems.map(c => ({ tx: c.tx, option: mine.picks[c.tx] }));
    const extra = { ...(mine.groups.size ? { skip: [...mine.groups] } : {}), ...(skipOps.length ? { skipOps } : {}), ...(picks.length ? { picks } : {}) };
    try { await respond(toolCallId, { kind: 'bankPlan', decision, ...(decision === 'apply' ? extra : {}) }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const left = decided?.decision === 'applied' ? decided.skipped.length + (decided.skippedOps ?? []).length : 0;
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
      <AssignBody preview={preview} sel={sel} locked={!!decided} state={decided ? decided.decision : 'open'}
        onGroup={g => setMine(prev => ticked(g, prev).count
          ? { ...prev, groups: new Set(prev.groups).add(g.key) }
          : { ...prev, groups: toggled(prev.groups, g.key), ops: new Set([...prev.ops].filter(tx => !g.items.some(i => i.tx === tx))) })}
        onOp={tx => setMine(prev => ({ ...prev, ops: toggled(prev.ops, tx) }))}
        onPick={(tx, option) => setMine(prev => { const picks = { ...prev.picks }; if (picks[tx] === option) delete picks[tx]; else picks[tx] = option; return { ...prev, picks }; })} />
    </> : undefined}
    footnote={!decided && ok ? <div className="tw:grid tw:gap-1 tw:text-xs tw:text-ck-muted">
      <p className="tw:m-0 tw:text-ck-text">Zaznaczone: {plural(count, 'operacja', 'operacji')}{pickedItems.length ? ` i ${plural(pickedItems.length, 'wybrana', 'wybranych')}` : ''}{count + pickedItems.length ? `, ${signed(Math.round(total * 100) / 100)}` : ''}.</p>
      <p className="tw:m-0">Kwoty, daty i strony zostają, a nic nie idzie do banku.</p>
    </div> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Oznaczono {plural(decided.assigned, 'operację', 'operacji')}{left ? `; część (${left === 1 ? 'jedna pozycja lub grupa' : `${left} pozycji lub grup`}) została bez zmian` : ''}.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !args.refused && count + pickedItems.length > 0}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
