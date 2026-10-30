import { useContext, useEffect, useState, type ReactNode } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ExternalLink, Mail, MailOpen, Minus, X, Zap } from 'lucide-react';
import { smartRulePlanSchema, type SmartMailRow, type SmartRule, type SmartRuleOutcome, type SmartRulePreview, type SmartTestRow } from '../smart-rules-contract';
import { card, CardActions, head, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { MailListArgs, SmartRuleArgs } from './types';

/*
 * Cards of mail and Smart Actions. One list of mails serves a search (`panel_mail_show`) and a rule's test (the consent
 * card of `panel_smart_rule_propose`): a test only adds what the rule does with each mail. Both read their rows from the
 * panel, never from the model.
 */

const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:px-2 tw:py-0.5 tw:text-[11px] tw:whitespace-nowrap';
const grey = `${chip} tw:bg-ck-surface-2 tw:text-ck-muted`;
const green = `${chip} tw:bg-ck-green/25 tw:text-ck-text`;
const red = `${chip} tw:bg-ck-red/20 tw:text-ck-text`;
const amber = `${chip} tw:bg-ck-amber/20 tw:text-ck-text`;
const day = (at: number) => new Date(at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' });
const host = (url: string) => { try { return new URL(url).hostname; } catch { return url; } };

/** What a rule does with one mail: caught or not, and whether that is a change from the rule saved now. */
function Verdict({ row }: { row: SmartTestRow }) {
  if (row.caught) return <span className="tw:flex tw:flex-wrap tw:justify-end tw:gap-1">
    <span className={green}><Check size={11} aria-hidden="true" />{row.caughtNow === false ? 'zacznie łapać' : 'złapie'}</span>
    {/* The very link the button would open for this mail: the user checks where it leads before saving the rule. */}
    {row.url && <a href={row.url} target="_blank" rel="noopener noreferrer" className={`${grey} tw:no-underline tw:hover:bg-ck-cal/20 tw:hover:text-ck-text`}
      title={`Otwiera link z tego maila: ${row.url}`} aria-label={`Sprawdź przycisk tego maila: ${row.url}`}>→ {host(row.url)}<ExternalLink size={10} aria-hidden="true" /></a>}
  </span>;
  if (row.caughtNow) return <span className={red}><X size={11} aria-hidden="true" />przestanie łapać</span>;
  return row.noLink ? <span className={amber} title={row.noLink}>pominie: brak linku</span> : <span className={grey}>pominie</span>;
}

/** Mails as rows: day, subject and sender, and on the right whether it is unread, or what a rule does with it. */
export function MailRows({ rows, test }: { rows: (SmartMailRow | SmartTestRow)[]; test?: boolean }) {
  if (!rows.length) return <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Brak maili.</p>;
  return <ul className="tw:m-0 tw:grid tw:max-h-80 tw:list-none tw:overflow-y-auto tw:p-0" data-testid="mail-rows">
    {rows.map(r => {
      const verdict = test && 'caught' in r;
      const Icon = r.unread ? Mail : MailOpen;
      return <li key={r.id} className="tw:grid tw:grid-cols-[18px_52px_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:border-t tw:border-ck-line tw:py-2 tw:first:border-t-0" data-caught={verdict ? String((r as SmartTestRow).caught) : undefined}>
        <Icon size={14} className={verdict ? ((r as SmartTestRow).caught ? 'tw:text-ck-green' : 'tw:text-ck-faint') : r.unread ? 'tw:text-ck-cal' : 'tw:text-ck-faint'} aria-hidden="true" />
        <span className="tw:text-xs tw:text-ck-muted">{day(r.at)}</span>
        <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="tw:min-w-0 tw:no-underline" title="Otwórz w Gmailu">
          <span className={`tw:block tw:truncate ${verdict && !(r as SmartTestRow).caught ? 'tw:text-ck-muted' : 'tw:text-ck-text'}`}>{r.subject}</span>
          <span className="tw:block tw:truncate tw:text-xs tw:text-ck-faint">{r.from}{r.address && r.address !== r.from ? ` · ${r.address}` : ''}</span>
        </a>
        {verdict ? <Verdict row={r as SmartTestRow} /> : <span className={grey}>{r.unread ? 'nieprzeczytany' : 'przeczytany'}</span>}
      </li>;
    })}
  </ul>;
}

/** `panel_mail_show`: the mails of a Gmail query, read by the card itself. */
export function MailListCard({ args }: ToolCallMessagePartProps<MailListArgs>) {
  const q = typeof args.q === 'string' ? args.q.trim().slice(0, 300) : '';
  const [state, setState] = useState<{ q: string; rows?: SmartMailRow[]; error?: string }>({ q: '' });
  useEffect(() => {
    if (!q) return;
    let gone = false;
    fetch(`/api/mail/search?${new URLSearchParams({ q, limit: '20' })}`, { signal: AbortSignal.timeout(20_000) }).then(async response => {
      const body = await response.json().catch(() => null) as { rows?: SmartMailRow[]; error?: string } | null;
      if (!gone) setState(response.ok && body?.rows ? { q, rows: body.rows } : { q, error: body?.error || 'Nie udało się przeszukać poczty.' });
    }, () => { if (!gone) setState({ q, error: 'Nie udało się przeszukać poczty.' }); });
    return () => { gone = true; };
  }, [q]);
  const rows = state.q === q ? state.rows : undefined;
  const error = !q ? 'Agent nie podał zapytania.' : args.refused ?? (state.q === q ? state.error : undefined);
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Poczta';
  return <section className={card} aria-label={`Karta: ${title}`}>
    <div className={head}>
      <Mail size={16} className="tw:text-ck-cal" aria-hidden="true" />
      <b className="tw:min-w-0 tw:truncate tw:font-semibold tw:text-ck-text">{title}</b>
      {rows && <span className="tw:ml-auto tw:flex-none tw:text-xs tw:text-ck-muted">{rows.length} maili · cała skrzynka</span>}
    </div>
    <div className="tw:grid tw:gap-2 tw:p-4">
      {q && <code className="tw:w-fit tw:max-w-full tw:truncate tw:rounded-md tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-muted">{q}</code>}
      {error && <p className={refusedNote} role="alert">{error}</p>}
      {!rows && !error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Szukam…</p>}
      {rows && <MailRows rows={rows} />}
    </div>
  </section>;
}

const FIELDS = [['from', 'Nadawca'], ['subject', 'Temat'], ['subjectNot', 'Temat nie'], ['body', 'Treść'], ['bodyNot', 'Treść nie']] as const;
const mailMatch = (r: SmartRule | null) => r?.source === 'mail' ? r.match : undefined;

/** One condition of the rule: words that go (struck through), stay (grey) and come (green with a plus). */
function WordsDiff({ label, before = [], after = [] }: { label: string; before?: string[]; after?: string[] }) {
  if (!before.length && !after.length) return null;
  const was = new Set(before.map(w => w.toLowerCase())), will = new Set(after.map(w => w.toLowerCase()));
  return <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5" data-field={label}>
    <span className="tw:w-20 tw:flex-none tw:text-xs tw:text-ck-muted">{label}</span>
    {before.filter(w => !will.has(w.toLowerCase())).map(w => <span key={`-${w}`} className={`${chip} tw:border tw:border-dashed tw:border-ck-red/50 tw:text-ck-muted tw:line-through`}>{w}</span>)}
    {after.map(w => was.has(w.toLowerCase()) ? <span key={w} className={grey}>{w}</span> : <span key={`+${w}`} className={green}>+ {w}</span>)}
  </div>;
}
function Changed({ label, before, after }: { label: string; before?: ReactNode; after?: ReactNode }) {
  if (before === after || (before === undefined && after === undefined)) return null;
  return <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5">
    <span className="tw:w-20 tw:flex-none tw:text-xs tw:text-ck-muted">{label}</span>
    {before !== undefined && <span className={`${chip} tw:border tw:border-dashed tw:border-ck-red/50 tw:text-ck-muted tw:line-through`}>{before}</span>}
    {after !== undefined && <span className={green}>+ {after}</span>}
  </div>;
}
const buttonText = (r: SmartRule | null) => r?.source === 'mail' ? `${r.button.label} → ${r.button.domain}${r.button.contains ? ` („${r.button.contains}”)` : ''}` : undefined;

/** A rule's change as conditions and a test on mails: the counts on top, then each mail with what the rule does with it. */
export function RuleBody({ preview, state = 'open' }: { preview: SmartRulePreview; state?: 'open' | 'applied' | 'rejected' }) {
  const { before, after } = preview;
  const rule = after ?? before;
  const caught = preview.rows.filter(r => r.caught).length;
  const flips = preview.rows.filter(r => r.caughtNow !== undefined && r.caughtNow !== r.caught).length;
  return <div className={`tw:grid tw:gap-3 ${state === 'rejected' ? 'tw:opacity-55' : ''}`} data-state={state}>
    <div className="tw:flex tw:items-center tw:gap-2">
      <Zap size={15} className="tw:text-ck-cal" aria-hidden="true" />
      <span className="tw:min-w-0 tw:truncate tw:font-semibold tw:text-ck-text">{rule?.name}</span>
      <span className={preview.kind === 'new' ? green : preview.kind === 'remove' ? red : grey}>{preview.kind === 'new' ? '+ nowa' : preview.kind === 'remove' ? '− usunięcie' : 'zmiana'}</span>
      <span className="tw:ml-auto tw:flex-none tw:text-xs tw:text-ck-faint">{rule?.source === 'bank' ? 'konto' : 'poczta'} · {rule?.id}</span>
    </div>
    {preview.kind !== 'remove' && <div className="tw:grid tw:gap-1.5">
      {FIELDS.map(([key, label]) => <WordsDiff key={key} label={label} before={mailMatch(before)?.[key]} after={mailMatch(after)?.[key]} />)}
      <Changed label="Przycisk" before={before ? buttonText(before) : undefined} after={buttonText(after)} />
      <Changed label="Etykieta" before={before?.badge} after={after?.badge} />
      <Changed label="Włączona" before={before ? (before.enabled ? 'tak' : 'nie') : undefined} after={after ? (after.enabled ? 'tak' : 'nie') : undefined} />
      <Changed label="Priorytet" before={before?.priority} after={after?.priority} />
      {after?.source === 'bank' && <Changed label="Podpowiedź" before={before?.source === 'bank' ? before.suggestion : undefined} after={after.suggestion} />}
    </div>}
    {after?.source === 'bank' && <p className="tw:m-0 tw:text-ck-text"><b className="tw:font-semibold">{preview.bankCount ?? 0}</b> <span className="tw:text-ck-muted">operacji z podpowiedzią pokaże teraz na kafelku</span></p>}
    {after?.source === 'mail' && <>
      <div className="tw:grid tw:grid-cols-2 tw:gap-2">
        <div className="tw:rounded-xl tw:bg-ck-green/15 tw:px-3 tw:py-2"><div className="tw:text-xl tw:font-semibold tw:text-ck-text">{caught}</div><div className="tw:text-xs tw:text-ck-muted">złapie</div></div>
        <div className="tw:rounded-xl tw:bg-ck-surface-2 tw:px-3 tw:py-2"><div className="tw:text-xl tw:font-semibold tw:text-ck-text">{preview.rows.length - caught}</div><div className="tw:text-xs tw:text-ck-muted">pominie{flips ? ` · ${flips} zmienia wynik` : ''}</div></div>
      </div>
      {preview.query ? <code className="tw:w-fit tw:max-w-full tw:truncate tw:rounded-md tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:text-xs tw:text-ck-muted" title="Maile, na których panel sprawdził regułę">test: {preview.query}</code>
        : <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Bez maili do testu.</p>}
      <MailRows rows={preview.rows} test />
    </>}
  </div>;
}

/**
 * `panel_smart_rule_propose`: the consent card for a Smart Actions rule. Wektor only named the rule; the test on the user's
 * mail is worked out by the panel (`GET /api/smart-rules/preview`), and nothing is saved until the user clicks „Wykonaj”.
 */
export function SmartRuleCard({ toolCallId, args, result }: ToolCallMessagePartProps<SmartRuleArgs>) {
  const { respond, running } = useContext(CardActions);
  const { tytul, refused, ...rest } = args;
  const plan = smartRulePlanSchema.safeParse(rest);
  const key = plan.success ? JSON.stringify(plan.data) : '';
  const decided = result && typeof result === 'object' && ['applied', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result as SmartRuleOutcome : undefined;
  const [state, setState] = useState<{ key: string; data?: SmartRulePreview; error?: string }>({ key: '' });
  const needsPreview = !decided?.preview;
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.success || !needsPreview) return;
    let gone = false;
    fetch(`/api/smart-rules/preview?${new URLSearchParams({ plan: key })}`, { signal: AbortSignal.timeout(30_000) }).then(async response => {
      const body = await response.json().catch(() => null) as (SmartRulePreview & { error?: string }) | null;
      if (!gone) setState(response.ok && body ? { key, data: body } : { key, error: body?.error || 'Nie udało się sprawdzić reguły.' });
    }, () => { if (!gone) setState({ key, error: 'Nie udało się sprawdzić reguły.' }); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the plan
  }, [key, needsPreview]);
  const preview = decided?.preview ?? (state.key === key ? state.data : undefined);
  const title = typeof tytul === 'string' && tytul.trim() ? tytul.trim().slice(0, 80) : 'Reguła Smart Actions';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const ok = !!preview && !preview.problems.length;
  const answer = async (decision: 'apply' | 'reject') => {
    setSending(true); setError('');
    try { await respond(toolCallId, { kind: 'smartRule', decision }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const open = !decided;
  return <ConsentShell
    label="Zgoda na regułę Smart Actions"
    heading={!decided ? 'Zapisać regułę?' : decided.decision === 'applied' ? 'Reguła zapisana' : 'Odrzucono'}
    subtitle={title}
    notices={open && <>
      {typeof refused === 'string' && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {refused}</p>}
      {!plan.success && !refused && <p className={refusedNote} role="alert">Agent przysłał niepoprawną regułę.</p>}
      {state.key === key && state.error && <p className={refusedNote} role="alert">{state.error}</p>}
      {plan.success && !preview && !state.error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Sprawdzam regułę na poczcie…</p>}
      {preview?.problems.map(p => <p key={p} className={refusedNote} role="alert">{p}</p>)}
    </>}
    body={preview ? <RuleBody preview={preview} state={decided ? decided.decision : 'open'} /> : undefined}
    footnote={open && ok ? <p className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-3 tw:gap-y-1 tw:text-xs tw:text-ck-muted">
      <span className={green}>+ słowo</span>dochodzi
      <span className={`${chip} tw:border tw:border-dashed tw:border-ck-red/50 tw:line-through`}>słowo</span>znika
      <span className="tw:basis-full">Reguła działa na nieprzeczytanych mailach i daje alert tylko, gdy przycisk ma link z maila na swojej domenie. Nic nie idzie do Gmaila. „→ domena” przy mailu otwiera link, który dałby przycisk: link potwierdzenia może przy tym wykonać akcję.</span>
    </p> : undefined}
    outcome={decided?.decision === 'applied'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />{preview?.kind === 'remove' ? 'Reguła usunięta.' : 'Reguła zapisana; kafelek Smart Actions pokaże jej alerty.'}</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-ck-muted" role="status"><Minus size={13} aria-hidden="true" />Nic nie zostało zmienione.</p> : undefined}
    canApply={!running && !unidentified && ok && !refused}
    canReject={!running && !unidentified}
    onApply={() => void answer('apply')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}


