import { createContext, useContext, useEffect, useState } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, Circle, CircleX, ExternalLink, FileCode2, LoaderCircle, Minus, Pencil, Radar, Rocket, Send, ShieldQuestion, Wrench, X } from 'lucide-react';
import {
  type CockpitTask, type DispatchArgs, type DispatchResult, type HermesApprovalArgs, type ReconArgs, type StepState, type WatchArgs,
} from './types';
import { watchAnswerTask } from '../cockpit-contract';

/**
 * What a card can do and see: answer on behalf of the user (a promise that fails says why), whether the thread is busy
 * (cards wait then), and the task the cockpit watches now, so a watch card shows it live.
 */
export const CardActions = createContext<{ respond: (toolCallId: string, response: unknown) => void | Promise<void>; running: boolean; watched?: CockpitTask }>({ respond: () => {}, running: false });
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'INPUT']);

/** `0:53`, `2:05`: how long something has been going. */
export const elapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const card = 'tw:rounded-2xl tw:border tw:border-ck-line tw:bg-ck-side tw:text-sm tw:overflow-hidden';
const head = 'tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-3 tw:border-b tw:border-ck-line';
const eyebrow = 'tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.14em] tw:text-ck-muted';
const btn = 'tw:inline-flex tw:items-center tw:justify-center tw:gap-2 tw:min-h-10 tw:px-4 tw:rounded-xl tw:text-sm tw:font-medium tw:transition-colors tw:disabled:opacity-40';

function StepIcon({ state }: { state: StepState }) {
  if (state === 'done') return <Check size={15} className="tw:text-ck-green" aria-hidden="true" />;
  if (state === 'running') return <LoaderCircle size={15} className="tw:text-ck-agent tw:animate-spin" aria-hidden="true" />;
  if (state === 'failed') return <CircleX size={15} className="tw:text-ck-red" aria-hidden="true" />;
  if (state === 'skipped') return <Minus size={15} className="tw:text-ck-faint" aria-hidden="true" />;
  return <Circle size={15} className="tw:text-ck-faint" aria-hidden="true" />;
}
const STEP_LABEL: Record<StepState, string> = { done: 'gotowe', running: 'w toku', pending: 'czeka', failed: 'błąd', skipped: 'pominięty' };

function Steps({ steps }: { steps: { label: string; state: StepState }[] }) {
  return <ol className="tw:flex tw:flex-col tw:gap-1.5 tw:m-0 tw:p-0 tw:list-none">
    {steps.map((s, i) => <li key={`${i}:${s.label}`} className="tw:flex tw:items-center tw:gap-2.5" data-state={s.state}>
      <StepIcon state={s.state} />
      <span className={s.state === 'pending' || s.state === 'skipped' ? 'tw:text-ck-faint' : s.state === 'running' ? 'tw:text-ck-text tw:font-medium' : 'tw:text-ck-muted'}>{s.label}</span>
      <span className="tw:sr-only">({STEP_LABEL[s.state]})</span>
    </li>)}
  </ol>;
}

/** `@Zaimplementuj zadanie`: what the recon found, step by step, and the prompt it wrote for the executor. */
const REPORTED = ['Przeszukano repo', 'Ustalono typ zadania', 'Napisano prompt dla executora'];
export function ReconCard({ args, status }: ToolCallMessagePartProps<ReconArgs>) {
  // Hermes reports a finished recon: its steps are all done.
  const steps = args.steps ?? REPORTED.map(label => ({ label, done: true }));
  const running = status.type === 'running';
  // The first step not done is the one in progress while the recon runs.
  const current = running ? steps.findIndex(s => !s.done) : -1;
  return <section className={card} aria-label="Rekonesans zadania">
    <div className={head}>
      <Radar size={16} className="tw:text-ck-agent" aria-hidden="true" />
      <span className={eyebrow}>@Zaimplementuj zadanie</span>
      <span className="tw:ml-auto tw:text-xs tw:text-ck-muted">{running ? 'Rekonesans…' : 'Rekonesans gotowy'}</span>
    </div>
    <div className="tw:grid tw:gap-4 tw:p-4">
      <Steps steps={steps.map((s, i) => ({ label: s.label, state: s.done ? 'done' : i === current ? 'running' : 'pending' }))} />
      {!!args.files?.length && <div>
        <div className={`${eyebrow} tw:mb-2`}>Przeszukane pliki</div>
        <ul className="tw:m-0 tw:p-0 tw:list-none tw:grid tw:gap-1">
          {args.files.map((f, i) => <li key={`${i}:${f.path}`} className="tw:flex tw:items-baseline tw:gap-2 tw:min-w-0">
            <FileCode2 size={14} className="tw:text-ck-cal tw:translate-y-0.5" aria-hidden="true" />
            <code className="tw:font-ck-mono tw:text-[12.5px] tw:text-ck-text">{f.path}</code>
            <span className="tw:text-xs tw:text-ck-faint tw:truncate">{f.note}</span>
          </li>)}
        </ul>
      </div>}
      {args.kind && <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <span className={eyebrow}>Typ zadania</span>
        <span className={`tw:rounded-full tw:px-2.5 tw:py-0.5 tw:text-xs tw:font-semibold ${args.kind === 'UI' ? 'tw:bg-ck-cal/15 tw:text-ck-cal' : 'tw:bg-ck-mail/15 tw:text-ck-mail'}`}>{args.kind}</span>
        {args.scenario && <span className="tw:text-xs tw:text-ck-muted">scenariusz <code className="tw:font-ck-mono">{args.scenario}</code></span>}
      </div>}
      {args.prompt && <details className="tw:rounded-xl tw:border tw:border-ck-line tw:bg-ck-bg">
        <summary className="tw:flex tw:items-center tw:gap-2 tw:px-3 tw:py-2 tw:cursor-pointer tw:text-xs tw:text-ck-muted">Prompt dla executora <span className="tw:ml-auto">pokaż</span></summary>
        <pre className="tw:m-0 tw:px-3 tw:pb-3 tw:whitespace-pre-wrap tw:font-ck-mono tw:text-[12px] tw:leading-relaxed tw:text-ck-text">{args.prompt}</pre>
      </details>}
    </div>
  </section>;
}

/** Human in the loop: nothing goes to Cezar until the user says so here, and the prompt can be corrected first. */
export function DispatchCard({ toolCallId, args, result }: ToolCallMessagePartProps<DispatchArgs, DispatchResult>) {
  const { respond, running } = useContext(CardActions);
  const [editing, setEditing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const decided = result as DispatchResult | undefined;
  const busy = running || sending;
  const answer = async (response: { decision: 'dispatch' | 'reject'; prompt?: string }) => {
    setSending(true); setError('');
    try { await respond(toolCallId, { ...response, title: args.title, prompt: response.prompt ?? args.prompt, workflow: args.workflow, todoId: args.todoId }); setEditing(null); }
    catch (e) { setError(e instanceof Error && e.message ? e.message : 'Nie udało się zapisać decyzji.'); }
    finally { setSending(false); }
  };
  return <section className={`${card} ${decided ? '' : 'tw:border-ck-agent/60 tw:shadow-[0_0_0_1px_rgba(183,156,255,0.25)]'}`} aria-label="Zgoda na zlecenie taska">
    <div className={head}>
      <ShieldQuestion size={16} className="tw:text-ck-agent" aria-hidden="true" />
      <b className="tw:font-semibold tw:text-ck-text">{!decided ? 'Zlecić na Cezarze?' : decided.decision === 'dispatched' ? 'Zlecono na Cezarze' : 'Odrzucono'}</b>
      <span className="tw:ml-auto tw:rounded-md tw:bg-ck-surface-2 tw:px-2 tw:py-0.5 tw:font-ck-mono tw:text-xs tw:text-ck-muted">{args.repo ?? 'desk-panel'}</span>
    </div>
    <div className="tw:grid tw:gap-3 tw:p-4">
      <div className="tw:text-ck-text tw:font-medium">{args.title}</div>
      {editing !== null
        ? <textarea value={editing} onChange={e => setEditing(e.target.value)} aria-label="Prompt dla executora" rows={9}
          className="tw:w-full tw:resize-y tw:rounded-xl tw:border tw:border-ck-cal tw:bg-ck-bg tw:p-3 tw:font-ck-mono tw:text-[12px] tw:leading-relaxed tw:text-ck-text" />
        : <pre className="tw:m-0 tw:max-h-48 tw:overflow-auto tw:rounded-xl tw:border tw:border-ck-line tw:bg-ck-bg tw:p-3 tw:whitespace-pre-wrap tw:font-ck-mono tw:text-[12px] tw:leading-relaxed tw:text-ck-muted">{decided?.decision === 'dispatched' ? decided.prompt : args.prompt}</pre>}
      {!decided && <div className="tw:flex tw:flex-wrap tw:gap-2">
        {editing !== null
          ? <>
            <button type="button" className={`${btn} tw:bg-ck-agent tw:text-ck-bg tw:hover:bg-[#c8b4ff]`} disabled={busy || !editing.trim()} onClick={() => void answer({ decision: 'dispatch', prompt: editing.trim() })}><Send size={15} aria-hidden="true" />Zleć z poprawkami</button>
            <button type="button" className={`${btn} tw:bg-ck-surface-2 tw:text-ck-text tw:hover:bg-ck-line`} onClick={() => setEditing(null)}>Anuluj edycję</button>
          </>
          : <>
            <button type="button" className={`${btn} tw:bg-ck-agent tw:text-ck-bg tw:hover:bg-[#c8b4ff]`} disabled={busy} onClick={() => void answer({ decision: 'dispatch' })}><Rocket size={15} aria-hidden="true" />Zleć na Cezarze</button>
            <button type="button" className={`${btn} tw:bg-ck-surface-2 tw:text-ck-text tw:hover:bg-ck-line`} disabled={busy} onClick={() => setEditing(args.prompt)}><Pencil size={15} aria-hidden="true" />Edytuj prompt</button>
            <button type="button" className={`${btn} tw:text-ck-red tw:hover:bg-ck-red/10`} disabled={busy} onClick={() => void answer({ decision: 'reject' })}><X size={15} aria-hidden="true" />Odrzuć</button>
          </>}
      </div>}
      {sending && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Zapisuję decyzję…</p>}
      {error && <p className="tw:m-0 tw:rounded-xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-3 tw:py-2 tw:text-[13px] tw:text-[#ffd3d4]" role="alert">{error}</p>}
      {decided?.decision === 'dispatched' && <p className="tw:m-0 tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-ck-green" role="status">
        <Check size={15} aria-hidden="true" />Task <code className="tw:font-ck-mono">{decided.taskId}</code> poszedł do Cezara.
        {decided.url && <a href={decided.url} target="_blank" rel="noopener noreferrer" className="tw:inline-flex tw:items-center tw:gap-1 tw:text-ck-cal"><ExternalLink size={13} aria-hidden="true" />Otwórz</a>}
      </p>}
    </div>
  </section>;
}

/** `@nasłuchuj cezara`: the agent waits for a Cezar task, with the steps of its worktree. */
export function WatchCard({ args, result, status }: ToolCallMessagePartProps<WatchArgs>) {
  const { watched } = useContext(CardActions);
  // Hermes: its tool answers with the task as it was; the cockpit's reading of the same task is newer.
  const reported = parseTask(result);
  const id = args.taskId ?? args.id ?? reported?.id ?? '';
  const live = watched && watched.id === id ? watched : reported;
  const steps = args.steps ?? live?.steps ?? [];
  const running = status.type === 'running' || (!!live && ACTIVE.has(live.status));
  const pct = Math.round(Math.min(1, Math.max(0, args.progress ?? live?.progress ?? 0)) * 100);
  return <section className={card} aria-label="Nasłuchiwanie Cezara">
    <div className={head}>
      <Radar size={16} className={running ? 'tw:text-ck-amber tw:animate-ck-pulse' : 'tw:text-ck-green'} aria-hidden="true" />
      <span className={eyebrow}>@Nasłuchuj Cezara</span>
      <code className="tw:min-w-0 tw:truncate tw:font-ck-mono tw:text-xs tw:text-ck-text">{id}</code>
      <span className="tw:ml-auto tw:flex-none tw:text-xs tw:text-ck-muted">{running ? 'Czekam na Cezara…' : live?.status ?? 'Zakończono'}</span>
    </div>
    <div className="tw:grid tw:gap-4 tw:p-4">
      <div role="progressbar" aria-label="Postęp taska" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="tw:relative tw:h-2 tw:overflow-hidden tw:rounded-full tw:bg-ck-surface-2">
        <div className={`tw:absolute tw:inset-y-0 tw:left-0 tw:rounded-full tw:transition-[width] tw:duration-500 ${running ? 'tw:bg-ck-amber' : 'tw:bg-ck-green'}`} style={{ width: `${pct}%` }} />
        {running && <div className="tw:absolute tw:inset-y-0 tw:w-1/3 tw:bg-gradient-to-r tw:from-transparent tw:via-white/25 tw:to-transparent tw:animate-ck-sweep" aria-hidden="true" />}
      </div>
      {steps.length ? <Steps steps={steps} /> : <p className="tw:m-0 tw:text-xs tw:text-ck-faint">Cezar nie podał kroków tego taska.</p>}
    </div>
  </section>;
}
/** The task in a watch tool's answer (`{"task":{…}}`), if it has one. */
const parseTask = (result: unknown) => watchAnswerTask<CockpitTask>(result);

const DECIDED: Record<Exclude<HermesApprovalArgs['state'], 'pending'>, string> = { approved: 'Zezwolono', denied: 'Odmówiono', expired: 'Prośba o zgodę wygasła' };

/** Hermes asks before running a tool; its run waits for the answer (or its own timeout). */
export function HermesApprovalCard({ toolCallId, args }: ToolCallMessagePartProps<HermesApprovalArgs>) {
  const { respond } = useContext(CardActions);
  const pending = args.state === 'pending';
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [pending]);
  return <section className={`${card} ${pending ? 'tw:border-ck-amber/60' : ''}`} role="group" aria-label={`Prośba o zgodę: ${args.tool}`}>
    <div className={head}>
      <ShieldQuestion size={16} className="tw:text-ck-amber" aria-hidden="true" />
      <b className="tw:font-semibold">{args.state === 'pending' ? 'Agent prosi o zgodę' : DECIDED[args.state]}</b>
      <code className="tw:ml-auto tw:font-ck-mono tw:text-xs tw:text-ck-muted">{args.tool}</code>
    </div>
    <div className="tw:grid tw:gap-3 tw:p-4">
      {args.detail && <pre className="tw:m-0 tw:max-h-48 tw:overflow-auto tw:whitespace-pre-wrap tw:font-ck-mono tw:text-[12px] tw:text-ck-text">{args.detail}</pre>}
      {pending && <>
        <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Odpowiedź czeka na Twoją decyzję · {elapsed(now - args.at)}</p>
        <div className="tw:flex tw:gap-2">
          <button type="button" className={`${btn} tw:bg-ck-green tw:text-ck-bg tw:hover:bg-[#8de0ae]`} onClick={() => respond(toolCallId, 'approve')}>Zezwól</button>
          <button type="button" className={`${btn} tw:text-ck-red tw:hover:bg-ck-red/10`} onClick={() => respond(toolCallId, 'deny')}>Odmów</button>
        </div>
      </>}
    </div>
  </section>;
}

/** The one line a tool step shows: its first string argument (a command, a path, a query). */
function toolSummary(args: Record<string, unknown>): string {
  const first = Object.values(args ?? {}).find(v => typeof v === 'string' && v.trim()) as string | undefined;
  return (first ?? '').replace(/\s+/g, ' ').slice(0, 120);
}
const clip = (text: string) => text.length > 4000 ? `${text.slice(0, 4000)}\n… (skrócone)` : text;

/** Any other tool: one line, details on demand. */
export function ToolCard({ toolName, args, result, status, isError }: ToolCallMessagePartProps) {
  const running = status.type === 'running';
  const output = typeof result === 'string' ? result : result === undefined ? '' : JSON.stringify(result, null, 2);
  return <details className="tw:rounded-xl tw:border tw:border-ck-line tw:bg-ck-side tw:text-[13px]" data-state={running ? 'running' : 'done'}>
    <summary className="tw:flex tw:items-center tw:gap-2 tw:min-h-10 tw:px-3.5 tw:cursor-pointer tw:font-ck-mono tw:text-xs tw:text-ck-muted">
      <Wrench size={14} aria-hidden="true" />
      <b className="tw:font-medium tw:text-ck-text">{toolName}</b>
      <span className="tw:min-w-0 tw:flex-1 tw:truncate">{toolSummary(args as Record<string, unknown>)}</span>
      <span className={`tw:flex tw:items-center tw:gap-1.5 tw:font-ck tw:font-medium ${running ? 'tw:text-ck-amber' : isError ? 'tw:text-ck-red' : 'tw:text-ck-green'}`}>
        {running ? <><LoaderCircle size={13} className="tw:animate-spin" aria-hidden="true" />Działa</> : <><Check size={13} aria-hidden="true" />{isError ? 'Błąd' : 'Gotowe'}</>}
      </span>
    </summary>
    <div className="tw:grid tw:gap-2 tw:px-3.5 tw:pb-3">
      <pre className="tw:m-0 tw:overflow-auto tw:whitespace-pre-wrap tw:font-ck-mono tw:text-[12px] tw:text-ck-muted">{JSON.stringify(args, null, 2)}</pre>
      {output && <pre className="tw:m-0 tw:max-h-64 tw:overflow-auto tw:whitespace-pre-wrap tw:font-ck-mono tw:text-[12px] tw:text-ck-text">{clip(output)}</pre>}
    </div>
  </details>;
}
