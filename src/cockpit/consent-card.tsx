import { useContext, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { ArrowBigRightDash, Check, Merge, Minus, X } from 'lucide-react';
import { bankPlanSchema, type BankPlanOutcome, type BankPlanPreview } from '../bank-plan-contract';
import { COLOR_VALUES, ICONS } from '../bank-look';
import { btn, card, CardActions, head, refusedNote } from './cards';
import type { BankPlanArgs } from './types';

/*
 * A change the agent proposes and the user decides: one shell for every kind (header, what it would do, „Wykonaj” and
 * „Odrzuć”, what was decided), and a body for the shape of the change. Only the merge has a body so far (several things
 * folded into one); a move of items from one state to another, or a deletion, would be another body in the same shell.
 */

interface ShellProps {
  label: string;
  heading: string;
  subtitle: string;
  /** Refusals and problems, shown above the body. */
  notices?: ReactNode;
  body?: ReactNode;
  footnote?: ReactNode;
  /** Set when the user has answered: the buttons go and this says what came of it. */
  outcome?: ReactNode;
  canApply: boolean;
  canReject: boolean;
  onApply: () => void;
  onReject: () => void;
  sending: boolean;
  error: string;
  /** The apply button's label (default „Wykonaj”). */
  applyLabel?: string;
}

export function ConsentShell(p: ShellProps) {
  return <section className={`${card} ${p.outcome ? '' : 'tw:border-ck-cal/60 tw:shadow-[0_0_0_1px_rgba(124,169,255,0.25)]'}`} aria-label={p.label}>
    <div className={head}>
      <Merge size={16} className="tw:text-ck-cal" aria-hidden="true" />
      <b className="tw:font-semibold tw:text-ck-text">{p.heading}</b>
      <span className="tw:ml-auto tw:text-xs tw:text-ck-muted">{p.subtitle}</span>
    </div>
    <div className="tw:grid tw:gap-3 tw:p-4">
      {p.notices}
      {p.body}
      {p.footnote}
      {!p.outcome && <div className="tw:flex tw:flex-wrap tw:gap-2">
        <button type="button" className={`${btn} tw:bg-ck-cal tw:text-ck-bg tw:hover:bg-[#9bbcff]`} disabled={!p.canApply || p.sending} onClick={p.onApply}><Check size={15} aria-hidden="true" />{p.applyLabel ?? 'Wykonaj'}</button>
        <button type="button" className={`${btn} tw:text-ck-red tw:hover:bg-ck-red/10`} disabled={!p.canReject || p.sending} onClick={p.onReject}><X size={15} aria-hidden="true" />Odrzuć</button>
      </div>}
      {p.sending && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Zapisuję decyzję…</p>}
      {p.error && <p className="tw:m-0 tw:rounded-xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-3 tw:py-2 tw:text-[13px] tw:text-[#ffd3d4]" role="alert">{p.error}</p>}
      {p.outcome}
    </div>
  </section>;
}

const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const COLUMNS: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,1.25fr) 52px minmax(0,1fr)' };
const chip = 'tw:inline-flex tw:items-center tw:rounded-md tw:px-2 tw:py-0.5 tw:text-xs';
const kept = `${chip} tw:bg-ck-surface-2 tw:text-ck-muted`;

/**
 * A merge as rows: what each thing is now (how many, its name, the tags it already has), one arrow, and what it becomes (the
 * new category, and the tags its things end with). A thing that goes is struck through with a minus; a new tag is green
 * with a plus; a tag the user has already or that stays is grey.
 */
export function MergeBody({ preview, state = 'open' }: { preview: BankPlanPreview; state?: 'open' | 'applied' | 'rejected' }) {
  const Icon = ICONS[preview.into.icon] ?? ICONS.tag;
  const rows = preview.sources;
  return <div className={`tw:grid tw:gap-1.5 ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state}>
    <div style={COLUMNS}>
      <div className="tw:self-end tw:pb-1.5 tw:pl-0.5 tw:text-xs tw:text-ck-muted">Teraz</div>
      <div />
      <div className="tw:grid tw:gap-0.5 tw:rounded-t-xl tw:bg-ck-cal/15 tw:px-3 tw:py-2">
        <div className="tw:flex tw:items-center tw:gap-2">
          <Icon size={20} className="tw:flex-none" style={{ color: COLOR_VALUES[preview.into.color] }} aria-hidden="true" />
          <span className="tw:min-w-0 tw:truncate tw:text-[15px] tw:font-semibold tw:text-ck-text">{preview.into.name}</span>
          {preview.into.created && <span className="tw:flex-none tw:rounded tw:bg-ck-green/25 tw:px-1.5 tw:text-[11px] tw:text-ck-text">nowa</span>}
        </div>
        <span className="tw:pl-7 tw:text-xs tw:text-ck-muted">{preview.into.after.count} op. · {pln(preview.into.after.spent)}</span>
      </div>
    </div>
    <div className="tw:max-h-72 tw:overflow-y-auto" style={{ ...COLUMNS, gridTemplateRows: `repeat(${rows.length}, auto)`, marginTop: -6 }} data-testid="merge-rows">
      <div style={{ gridColumn: 2, gridRow: '1 / -1' }} className="tw:grid tw:place-items-center tw:text-ck-muted"><ArrowBigRightDash size={28} aria-label="zamienia się w" /></div>
      {rows.map((s, i) => <div key={s.id} style={{ display: 'contents' }}>
        <div style={{ gridColumn: 1, gridRow: i + 1 }} className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:border-t tw:border-ck-line tw:py-2 tw:pr-1">
          <i className="tw:size-2.5 tw:flex-none tw:rounded-full" style={{ background: COLOR_VALUES[s.color] }} aria-hidden="true" />
          <span className="tw:text-[13px] tw:text-ck-muted">{s.count} ×</span>
          <span className="tw:text-sm tw:text-ck-muted tw:line-through">{s.name}</span>
          {s.keeps.map(t => <span key={t} className={kept}>#{t}</span>)}
          <Minus size={14} className="tw:ml-auto tw:flex-none tw:text-ck-red" aria-label="kategoria zniknie" />
        </div>
        <div style={{ gridColumn: 3, gridRow: i + 1 }} className={`tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:border-t tw:border-ck-line tw:bg-ck-cal/15 tw:px-3 tw:py-2 ${i === rows.length - 1 ? 'tw:rounded-b-xl' : ''}`}>
          {s.tag && (s.tagState === 'new'
            ? <span className={`${chip} tw:bg-ck-green/30 tw:text-ck-text`}>+ #{s.tag}</span>
            : <><span className={kept}>#{s.tag}</span><span className="tw:text-[11px] tw:text-ck-faint">już istnieje</span></>)}
          {s.keeps.map(t => <span key={t} className={kept}>#{t}</span>)}
          {!s.tag && !s.keeps.length && <span className="tw:text-xs tw:text-ck-faint">bez etykiet</span>}
        </div>
      </div>)}
    </div>
  </div>;
}

/** What the symbols of a merge mean, and what stays. */
function MergeLegend({ preview }: { preview: BankPlanPreview }) {
  return <div className="tw:grid tw:gap-1.5 tw:text-xs tw:text-ck-muted">
    <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1">
      <span className="tw:inline-flex tw:items-center tw:gap-1.5"><span className={`${chip} tw:bg-ck-green/30 tw:px-1.5 tw:py-0 tw:text-ck-text`}>+ #etykieta</span>nowa etykieta</span>
      <span className="tw:inline-flex tw:items-center tw:gap-1.5"><span className={`${kept} tw:px-1.5 tw:py-0`}>#etykieta</span>zostaje</span>
      <span className="tw:inline-flex tw:items-center tw:gap-1.5"><Minus size={13} className="tw:text-ck-red" aria-hidden="true" />kategoria znika</span>
    </div>
    <p className="tw:m-0">Zmieni {preview.moved} oznaczeń. Kwoty, daty i strony zostają, a nic nie idzie do banku.</p>
    {preview.noTag > 0 && <p className="tw:m-0 tw:text-ck-text">{preview.noTag} {preview.noTag === 1 ? 'oznaczenie ma' : 'oznaczeń ma'} już komplet etykiet i nie dostanie nowej.</p>}
  </div>;
}

/**
 * `panel_bank_propose`: the consent card for a change in the spending categories. Wektor only named the change; what it
 * would do is worked out here by the panel (`GET /api/bank/plan`), and nothing changes until the user clicks „Wykonaj”. The
 * answer is kept with the conversation, so the card shows what was decided later too.
 */
export function BankPlanCard({ toolCallId, args, result }: ToolCallMessagePartProps<BankPlanArgs>) {
  const { respond, running } = useContext(CardActions);
  const plan = bankPlanSchema.safeParse(args);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as BankPlanOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: BankPlanPreview; error?: string }>({ key: '' });
  // A rejected card whose answer kept no preview (an older one) is worked out anew: its categories are still there.
  const needsPreview = !decided || (decided.decision === 'rejected' && !decided.preview);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.success || !needsPreview) return;
    const params = new URLSearchParams({ into: plan.data.into, tags: plan.data.tags ? '1' : '0' });
    for (const name of plan.data.merge) params.append('merge', name);
    let gone = false;
    fetch(`/api/bank/plan?${params}`, { signal: AbortSignal.timeout(15_000) }).then(async response => {
      const body = await response.json().catch(() => null) as (BankPlanPreview & { error?: string }) | null;
      if (gone) return;
      setState(response.ok && body ? { key, data: body } : { key, error: body?.error || 'Nie udało się pobrać podglądu zmiany.' });
    }, () => { if (!gone) setState({ key, error: 'Nie udało się pobrać podglądu zmiany.' }); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the plan
  }, [key, needsPreview]);
  const preview = decided?.preview ?? (state.key === key ? state.data : undefined);
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Zmiana w kategoriach';
  // Until the card has its stable id (the answer is over and its arguments are in), a decision could not be tied to it.
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const blocked = !!args.refused || !plan.success || !!preview?.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    try { await respond(toolCallId, { kind: 'bankPlan', decision }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const open = !decided;
  const ok = !!preview && !preview.problems.length;
  return <ConsentShell
    label="Zgoda na zmianę kategorii"
    heading={!decided ? 'Wykonać zmianę?' : decided.decision === 'applied' ? 'Zmiana wykonana' : 'Odrzucono'}
    subtitle={title}
    notices={open && <>
      {args.refused && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {args.refused}</p>}
      {!plan.success && <p className={refusedNote} role="alert">Agent przysłał niepoprawną propozycję zmiany.</p>}
      {state.key === key && state.error && <p className={refusedNote} role="alert">{state.error}</p>}
      {plan.success && !preview && !state.error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Liczę podgląd…</p>}
      {preview?.problems.map(p => <p key={p} className={refusedNote} role="alert">{p}</p>)}
    </>}
    body={ok ? <MergeBody preview={preview} state={decided ? decided.decision : 'open'} /> : undefined}
    footnote={open && ok ? <MergeLegend preview={preview} /> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Przeniesiono {decided.moved} oznaczeń do „{decided.into}”{decided.created ? ' (nowa kategoria)' : ''}.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !blocked}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
