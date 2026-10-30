import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, Minus, Repeat } from 'lucide-react';
import { ACTION_HINTS, ACTION_LABELS, automationPlanSchema, describeTriggerRange, type AutomationAction } from '../automation-contract';
import { openPanelPage } from '../panel-nav';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { AutomationArgs, AutomationResult } from './types';

/*
 * `panel_automation_propose`: zgoda na nowy automat. Wektor podał plan; karta pokazuje go po polsku, pozwala odznaczyć
 * akcje i ustawić „Ucz się między runami”. Automat powstaje dopiero po kliknięciu „Utwórz automat”, a plan do zapisu
 * pochodzi z wywołania narzędzia w tej rozmowie (karta tylko zawęża akcje). Decyzja jest zapisana w kokpicie, więc po
 * przeładowaniu karta pokazuje „Utworzono automat …” zamiast drugi raz proponować zapis.
 */

export function AutomationCard({ toolCallId, args, result }: ToolCallMessagePartProps<AutomationArgs, AutomationResult>) {
  const { respond, running } = useContext(CardActions);
  const plan = automationPlanSchema.safeParse({ ...args, actions: Array.isArray(args.actions) ? args.actions : [{ kind: 'message' }] });
  const [actions, setActions] = useState<AutomationAction[]>(plan.success ? plan.data.actions : []);
  const [learn, setLearn] = useState(plan.success ? plan.data.learn : false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!plan.success) return;
    setActions(plan.data.actions);
    setLearn(plan.data.learn);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the plan is the tool call
  }, [plan.success ? JSON.stringify(plan.data) : '']);
  const decided = result && typeof result === 'object' && ['created', 'rejected'].includes((result as { decision?: string }).decision ?? '') ? result : undefined;
  const title = typeof args.name === 'string' && args.name.trim() ? args.name.trim().slice(0, 120) : 'Nowy automat';
  const unidentified = toolCallId.startsWith('pending:') || !toolCallId.includes(':');
  const answer = async (decision: 'create' | 'reject') => {
    setSending(true); setError('');
    try { await respond(toolCallId, { kind: 'automation', decision, ...(decision === 'create' ? { actions, learn } : {}) }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const toggle = (kind: AutomationAction['kind']) => setActions(list => list.some(a => a.kind === kind) ? list.filter(a => a.kind !== kind) : [...list, { kind }]);
  return <ConsentShell
    label="Nowy automat"
    heading={!decided ? 'Utworzyć automat?' : decided.decision === 'created' ? 'Automat utworzony' : 'Odrzucono'}
    subtitle={title}
    applyLabel="Utwórz automat"
    actionsAlign="end"
    rejectFirst
    notices={!decided && <>
      {typeof args.refused === 'string' && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {args.refused}</p>}
      {!plan.success && !args.refused && <p className={refusedNote} role="alert">Agent przysłał niepoprawny plan automatu.</p>}
    </>}
    body={plan.success ? <div className="tw:grid tw:gap-4" data-state={decided ? decided.decision : 'open'}>
      <div className="tw:grid tw:gap-3 tw:sm:grid-cols-2">
        <div className="tw:grid tw:content-start tw:gap-1 tw:rounded-xl tw:bg-ck-surface-2 tw:px-3.5 tw:py-3">
          <span className="tw:text-xs tw:text-ck-muted">Kiedy</span>
          <span className="tw:text-ck-text">{describeTriggerRange(plan.data.trigger)}</span>
        </div>
        <div className="tw:grid tw:content-start tw:gap-1 tw:rounded-xl tw:bg-ck-surface-2 tw:px-3.5 tw:py-3">
          <span className="tw:text-xs tw:text-ck-muted">Cel osiągnięty, gdy</span>
          <span className="tw:text-ck-text">{plan.data.doneWhen ?? 'Wektor sam rozpozna, że cel jest osiągnięty.'}</span>
        </div>
      </div>
      <div className="tw:grid tw:gap-0.5">
        <span className="tw:text-xs tw:text-ck-muted">Cel</span>
        <p className="tw:m-0 tw:whitespace-pre-wrap tw:text-ck-text">{plan.data.goal}</p>
      </div>
      <div className="tw:grid tw:gap-2">
        <span className="tw:text-[13px] tw:font-semibold tw:text-ck-text">Wtedy zrobi sam, bez pytania</span>
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1.5 tw:p-0">
          {plan.data.actions.map(a => <li key={a.kind}>
            <label className="tw:flex tw:cursor-pointer tw:items-start tw:gap-2.5 tw:py-0.5 tw:text-ck-text">
              <input type="checkbox" className="tw:mt-1" checked={actions.some(x => x.kind === a.kind)} disabled={!!decided} onChange={() => toggle(a.kind)} />
              <span className="tw:grid tw:gap-0.5">
                <span>{ACTION_LABELS[a.kind] ?? a.kind}</span>
                <span className="tw:text-xs tw:text-ck-muted">{ACTION_HINTS[a.kind] ?? ''}</span>
              </span>
            </label>
          </li>)}
        </ul>
        <span className="tw:text-xs tw:text-ck-faint">Wszystko inne pokaże Ci jak dziś — kartą do zatwierdzenia.</span>
      </div>
      <label className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2.5 tw:border-t tw:border-ck-line tw:pt-3 tw:text-ck-text">
        <input type="checkbox" checked={learn} disabled={!!decided} onChange={e => setLearn(e.target.checked)} />
        <Repeat size={14} className="tw:text-ck-cal" aria-hidden="true" />
        <span>Ucz się między runami (notatnik: gdzie i jak sprawdzać)</span>
      </label>
    </div> : undefined}
    footnote={!decided && plan.success ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted">
      Automat zapisuje się dopiero po kliknięciu. Run cykliczny to nowa rozmowa automatu; wynik wraca do tej rozmowy.
      {plan.data.replaces && ' Zastąpi wskazany automat.'}
    </p> : undefined}
    outcome={decided?.decision === 'created'
      ? <div className="tw:grid tw:justify-items-start tw:gap-1.5" role="status">
        <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green"><Check size={15} aria-hidden="true" />Utworzono automat „{decided.name}”.</p>
        <button type="button" className="tw:inline-flex tw:items-center tw:gap-1 tw:bg-transparent tw:p-0 tw:text-[13px] tw:text-ck-cal tw:underline" onClick={() => openPanelPage('automations')}>Otwórz widok Automaty</button>
      </div>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-ck-muted" role="status"><Minus size={13} aria-hidden="true" />Nic nie zostało utworzone.</p> : undefined}
    canApply={!running && !unidentified && plan.success && actions.length > 0 && !args.refused}
    canReject={!running && !unidentified}
    onApply={() => void answer('create')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
