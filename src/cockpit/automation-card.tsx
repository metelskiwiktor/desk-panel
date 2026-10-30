import { useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Bot, Check, Minus, Repeat } from 'lucide-react';
import { automationPlanSchema, describeTrigger, type AutomationAction } from '../automation-contract';
import { CardActions, refusedNote } from './cards';
import { ConsentShell } from './consent-card';
import type { AutomationArgs, AutomationResult } from './types';

/*
 * `panel_automation_propose`: zgoda na nowy automat. Wektor podał plan; karta pokazuje go po polsku, pozwala odznaczyć
 * akcje i ustawić „Ucz się między runami”. Automat powstaje dopiero po kliknięciu „Utwórz automat”, a plan do zapisu
 * pochodzi z wywołania narzędzia w tej rozmowie (karta tylko zawęża akcje).
 */

const chip = 'tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:text-[11px] tw:text-ck-muted';
const ACTION_LABEL: Record<string, string> = { message: 'krótka wiadomość w rozmowie automatu' };

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
    try { await respond(toolCallId, { kind: 'automation', decision, ...(decision === 'create' ? { actions } : {}) }); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  const toggle = (kind: AutomationAction['kind']) => setActions(list => list.some(a => a.kind === kind) ? list.filter(a => a.kind !== kind) : [...list, { kind }]);
  return <ConsentShell
    label="Nowy automat"
    heading={!decided ? 'Utworzyć automat?' : decided.decision === 'created' ? 'Automat utworzony' : 'Odrzucono'}
    subtitle={title}
    applyLabel="Utwórz automat"
    notices={!decided && <>
      {typeof args.refused === 'string' && <p className={refusedNote} role="alert">Panel nie przyjął propozycji: {args.refused}</p>}
      {!plan.success && !args.refused && <p className={refusedNote} role="alert">Agent przysłał niepoprawny plan automatu.</p>}
    </>}
    body={plan.success ? <div className="tw:grid tw:gap-3" data-state={decided ? decided.decision : 'open'}>
      <div className="tw:flex tw:items-start tw:gap-2">
        <Bot size={16} className="tw:mt-0.5 tw:flex-none tw:text-ck-cal" aria-hidden="true" />
        <div className="tw:min-w-0 tw:grid tw:gap-0.5">
          <span className="tw:text-xs tw:text-ck-muted">Kiedy</span>
          <span className="tw:text-ck-text">{describeTrigger(plan.data.trigger)}</span>
          {plan.data.trigger.kind !== 'once' && ('until' in plan.data.trigger) && plan.data.trigger.until && <span className="tw:text-xs tw:text-ck-faint">Do {plan.data.trigger.until}</span>}
        </div>
      </div>
      <div className="tw:grid tw:gap-0.5">
        <span className="tw:text-xs tw:text-ck-muted">Cel</span>
        <p className="tw:m-0 tw:whitespace-pre-wrap tw:text-ck-text">{plan.data.goal}</p>
      </div>
      {plan.data.doneWhen && <div className="tw:grid tw:gap-0.5">
        <span className="tw:text-xs tw:text-ck-muted">Cel osiągnięty, gdy</span>
        <p className="tw:m-0 tw:text-ck-text">{plan.data.doneWhen}</p>
      </div>}
      <div className="tw:grid tw:gap-1.5">
        <span className="tw:text-xs tw:text-ck-muted">Zatwierdzone akcje</span>
        <ul className="tw:m-0 tw:grid tw:list-none tw:gap-1 tw:p-0">
          {plan.data.actions.map(a => <li key={a.kind} className="tw:flex tw:items-center tw:gap-2">
            <label className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-ck-text">
              <input type="checkbox" checked={actions.some(x => x.kind === a.kind)} disabled={!!decided} onChange={() => toggle(a.kind)} />
              <span className={`${chip} tw:text-ck-text`}>{a.kind}</span>
              <span className="tw:text-xs tw:text-ck-muted">{ACTION_LABEL[a.kind] ?? a.kind}</span>
            </label>
          </li>)}
        </ul>
      </div>
      <label className="tw:flex tw:cursor-pointer tw:items-center tw:gap-2 tw:text-ck-text">
        <input type="checkbox" checked={learn} disabled={!!decided} onChange={e => setLearn(e.target.checked)} />
        <Repeat size={14} className="tw:text-ck-cal" aria-hidden="true" />
        <span>Ucz się między runami</span>
      </label>
    </div> : undefined}
    footnote={!decided && plan.success ? <p className="tw:m-0 tw:text-xs tw:text-ck-muted">
      Automat zapisuje się dopiero po kliknięciu. Run cykliczny to nowa rozmowa automatu; wynik wraca do tej rozmowy.
      {plan.data.replaces && ' Zastąpi wskazany automat.'}
    </p> : undefined}
    outcome={decided?.decision === 'created'
      ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-ck-green" role="status"><Check size={15} aria-hidden="true" />Automat gotowy; widać go w widoku Automaty.</p>
      : decided?.decision === 'rejected' ? <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-ck-muted" role="status"><Minus size={13} aria-hidden="true" />Nic nie zostało utworzone.</p> : undefined}
    canApply={!running && !unidentified && plan.success && actions.length > 0 && !args.refused}
    canReject={!running && !unidentified}
    onApply={() => void answer('create')}
    onReject={() => void answer('reject')}
    sending={sending}
    error={error}
  />;
}
