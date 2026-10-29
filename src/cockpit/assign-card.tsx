import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import { bankAssignSchema, type BankAssignGroup, type BankAssignOutcome, type BankAssignPreview } from '../bank-assign-contract';
import { COLOR_VALUES, ICONS } from '../bank-look';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { BankAssignArgs } from './types';

const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const signed = (amount: number) => `${amount > 0 ? '+' : ''}${pln(amount)}`;
const MOVE_WORDS = { spend: 'Wydatek', income: 'Przychód', settle: 'Rozliczenie', move: 'Przełożenie' } as const;
const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-md tw:px-2 tw:py-0.5 tw:text-xs';

/** What the group's operations are called, from the few the card lists: a handful of distinct names. */
const namesOf = (g: BankAssignGroup) => {
  const names = [...new Set(g.items.map(i => i.name))];
  return names.slice(0, 3).join(', ') + (names.length > 3 || g.hidden ? '…' : '');
};

/** The mark a group gives: its kind and category in the category's colour, then the tags and the other side. */
function Mark({ group }: { group: BankAssignGroup }) {
  const Icon = group.category ? ICONS[group.category.icon] ?? ICONS.tag : null;
  return <div className="tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5">
    <span className={`${chip} tw:bg-ck-cal/15 tw:text-ck-text`}>
      {Icon && group.category && <Icon size={13} style={{ color: COLOR_VALUES[group.category.color] }} aria-hidden="true" />}
      {group.category ? `${MOVE_WORDS[group.move]} · ${group.category.name}` : MOVE_WORDS[group.move]}
    </span>
    {group.party && <span className={`${chip} tw:bg-ck-surface-2 tw:text-ck-muted`}>{group.party}</span>}
    {group.tags.map(t => <span key={t} className={`${chip} tw:bg-ck-surface-2 tw:text-ck-muted`}>#{t}</span>)}
  </div>;
}

/**
 * The groups of operations that would get the same mark, one row each: a tick, how many and what they are, what mark they get
 * and the sum; a row opens to list its operations. A group that is unticked is left as it is.
 */
export function AssignBody({ preview, ticked, onToggle, locked = false, state = 'open' }: {
  preview: BankAssignPreview; ticked: ReadonlySet<string>; onToggle?: (key: string) => void; locked?: boolean; state?: 'open' | 'applied' | 'rejected';
}) {
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const flip = (key: string) => setOpen(prev => { const next = new Set(prev); if (!next.delete(key)) next.add(key); return next; });
  return <div className={`tw:grid tw:overflow-hidden tw:rounded-xl tw:border tw:border-ck-line ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state} data-testid="assign-groups">
    {preview.groups.map(g => {
      const on = ticked.has(g.key), expanded = open.has(g.key);
      return <div key={g.key} className="tw:border-b tw:border-ck-line tw:last:border-b-0" data-group={g.key}>
        <div className={`tw:grid tw:grid-cols-[20px_minmax(0,1fr)_auto] tw:items-center tw:gap-3 tw:px-3 tw:py-2 ${on ? '' : 'tw:opacity-55'}`}>
          <input type="checkbox" className="tw:size-4 tw:accent-[#7ca9ff]" checked={on} disabled={locked} onChange={() => onToggle?.(g.key)} aria-label={`Oznacz ${g.count} operacji: ${namesOf(g)}`} />
          <div className="tw:min-w-0">
            <div className="tw:truncate tw:text-sm tw:text-ck-text"><span className="tw:text-ck-muted">{g.count} ×</span> {namesOf(g)}</div>
            <button type="button" className="tw:inline-flex tw:items-center tw:gap-1 tw:text-xs tw:text-ck-muted tw:hover:text-ck-text" aria-expanded={expanded} onClick={() => flip(g.key)}>
              {expanded ? <ChevronUp size={13} aria-hidden="true" /> : <ChevronDown size={13} aria-hidden="true" />}{g.why || 'pokaż operacje'}
            </button>
          </div>
          <div className="tw:grid tw:justify-items-end tw:gap-0.5"><Mark group={g} /><span className="tw:text-xs tw:text-ck-muted">{signed(g.total)}</span></div>
        </div>
        {expanded && <ul className="tw:m-0 tw:grid tw:list-none tw:gap-0.5 tw:px-3 tw:pb-2 tw:pl-[44px] tw:text-xs tw:text-ck-muted">
          {g.items.map((i, n) => <li key={n} className="tw:flex tw:justify-between tw:gap-3"><span className="tw:truncate">{i.day} · {i.name}</span><span className="tw:flex-none">{signed(i.amount)}</span></li>)}
          {g.hidden > 0 && <li>… jeszcze {g.hidden}</li>}
        </ul>}
      </div>;
    })}
  </div>;
}

/**
 * `panel_bank_assign`: the consent card for marking many operations with the panel's own suggestions. Wektor only named a
 * range of days; the groups are worked out here by the panel (`GET /api/bank/assign`), the user may untick a group, and
 * nothing is marked until „Wykonaj”. A suggestion that is only a choice is not here: it is left to be marked by hand.
 */
export function BankAssignCard({ toolCallId, args, result }: ToolCallMessagePartProps<BankAssignArgs>) {
  const { respond, running } = useContext(CardActions);
  const plan = bankAssignSchema.safeParse(args);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as BankAssignOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: BankAssignPreview; error?: string }>({ key: '' });
  const needsPreview = !decided || (decided.decision === 'rejected' && !decided.preview);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
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
  const skipped = decided?.decision === 'applied' ? new Set(decided.skipped) : unticked;
  const ticked = new Set((preview?.groups ?? []).filter(g => !skipped.has(g.key)).map(g => g.key));
  const chosen = (preview?.groups ?? []).filter(g => ticked.has(g.key));
  const count = chosen.reduce((sum, g) => sum + g.count, 0);
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Oznaczenia z podpowiedzi';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const ok = !!preview && !preview.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    try { await respond(toolCallId, { kind: 'bankPlan', decision, ...(decision === 'apply' && unticked.size ? { skip: [...unticked] } : {}) }); }
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
    body={ok ? <AssignBody preview={preview} ticked={ticked} locked={!!decided} state={decided ? decided.decision : 'open'}
      onToggle={k => setUnticked(prev => { const next = new Set(prev); if (!next.delete(k)) next.add(k); return next; })} /> : undefined}
    footnote={!decided && ok ? <div className="tw:grid tw:gap-1 tw:text-xs tw:text-ck-muted">
      <p className="tw:m-0 tw:text-ck-text">Zaznaczone: {count} {count === 1 ? 'operacja' : 'operacji'}{chosen.length ? `, ${signed(chosen.reduce((sum, g) => sum + g.total, 0))}` : ''}.</p>
      {preview.choices.count > 0 && <p className="tw:m-0">{preview.choices.count} {preview.choices.count === 1 ? 'operacja ma' : 'operacji ma'} tylko propozycje do wyboru: zostają nieoznaczone, wybierzesz sam.</p>}
      <p className="tw:m-0">Kwoty, daty i strony zostają, a nic nie idzie do banku.</p>
    </div> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Oznaczono {decided.assigned} {decided.assigned === 1 ? 'operację' : 'operacji'}{decided.skipped.length ? `; ${decided.skipped.length === 1 ? 'jedna grupa została' : `${decided.skipped.length} grup zostało`} bez zmian` : ''}.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !args.refused && count > 0}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
