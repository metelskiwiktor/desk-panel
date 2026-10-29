import { Component, createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { ToolCallMessagePartProps } from '@assistant-ui/react';
import { Check, ChartColumn, Circle, CircleX, ExternalLink, FileCode2, LoaderCircle, Minus, Pencil, Radar, Rocket, Send, ShieldQuestion, X } from 'lucide-react';
import {
  type CockpitTask, type DispatchArgs, type DispatchResult, type HermesApprovalArgs, type ReconArgs, type ShowArgs, type StepState, type WatchArgs,
} from './types';
import { bankShowQuerySchema, type BankShowData } from '../bank-show-contract';
import { COLOR_VALUES } from '../bank-look';
import { watchAnswerTask } from '../cockpit-contract';

/**
 * What a card can do and see: answer on behalf of the user (a promise that fails says why), whether the thread is busy
 * (cards wait then), and the task the cockpit watches now, so a watch card shows it live.
 */
export const CardActions = createContext<{ respond: (toolCallId: string, response: unknown) => void | Promise<void>; running: boolean; watched?: CockpitTask }>({ respond: () => {}, running: false });
const ACTIVE = new Set(['QUEUED', 'RUNNING', 'INPUT']);

/** One card that cannot render says so in its place; without this, React drops the whole chat window (a black screen). */
export class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed
      ? <p className="tw:m-0 tw:rounded-xl tw:border tw:border-ck-line tw:px-3 tw:py-2 tw:text-xs tw:text-ck-muted" role="alert">Nie da się pokazać tej karty: agent przysłał nieoczekiwane dane.</p>
      : this.props.children;
  }
}

/** `0:53`, `2:05`: how long something has been going. */
export const elapsed = (ms: number) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const card = 'tw:rounded-2xl tw:border tw:border-ck-line tw:bg-ck-side tw:text-sm tw:overflow-hidden';
const head = 'tw:flex tw:items-center tw:gap-2 tw:px-4 tw:py-3 tw:border-b tw:border-ck-line';
const eyebrow = 'tw:text-[11px] tw:font-semibold tw:uppercase tw:tracking-[0.14em] tw:text-ck-muted';
const refusedNote = 'tw:m-0 tw:rounded-xl tw:border tw:border-ck-amber/40 tw:bg-ck-amber/10 tw:px-3 tw:py-2 tw:text-[13px] tw:text-ck-text';
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
      <span className="tw:ml-auto tw:text-xs tw:text-ck-muted">{running ? 'Rekonesans…' : args.refused ? 'Rekonesans odrzucony' : 'Rekonesans gotowy'}</span>
    </div>
    <div className="tw:grid tw:gap-4 tw:p-4">
      {args.refused && <p className={refusedNote} role="alert">Panel nie przyjął rekonesansu: {args.refused}</p>}
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

type PinnedStep = { id: string; runner: string; model: string | null; follows?: string };
/** What the user picked for a pinned step on the card; empty strings keep the workflow's pin. */
type StepChoice = { runner: string; model: string };
const RUNNERS = ['agy', 'claude', 'codex', 'opencode', 'cursor', 'pi', 'junie', 'copilot'];
/** Pinned steps that start their own session; one continuing another's session (fix, address after implement) follows it. */
const leadSteps = (pinned: PinnedStep[]) => pinned.filter(s => !s.follows || !pinned.some(p => p.id === s.follows));
/**
 * Cezar's `stepOverrides` from the card: only steps whose choice differs from the pin, each lead with its followers, so a
 * continued session stays on one runner. A new runner without a model lets Cezar resolve that runner's default.
 */
export function stepOverrides(pinned: PinnedStep[], choices: Record<string, StepChoice>, modelsLocked: boolean) {
  const out: Record<string, { runner?: string; model?: string }> = {};
  for (const lead of leadSteps(pinned)) {
    const choice = choices[lead.id];
    if (!choice) continue;
    const runner = choice.runner && choice.runner !== lead.runner ? choice.runner : undefined;
    const model = !modelsLocked && choice.model ? choice.model : undefined;
    if (!runner && !model) continue;
    for (const step of [lead, ...pinned.filter(s => s.follows === lead.id)]) out[step.id] = { ...(runner ? { runner } : {}), ...(model ? { model } : {}) };
  }
  return Object.keys(out).length ? out : undefined;
}

function PinnedStepChoice({ workflow, lead, followers, choice, disabled, modelsLocked, onChange }: {
  workflow: string; lead: PinnedStep; followers: PinnedStep[]; choice?: StepChoice; disabled: boolean; modelsLocked: boolean; onChange: (choice: StepChoice) => void;
}) {
  const runner = choice?.runner || lead.runner;
  const moved = runner !== lead.runner;
  const [catalog, setCatalog] = useState<{ model: string | null; models: { id: string; label: string }[] } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    setCatalog(null);
    fetch(`/api/cezar/dispatch-defaults?${new URLSearchParams({ workflow, runner })}`, { signal: abort.signal }).then(r => r.ok ? r.json() : null)
      .then(value => { if (!abort.signal.aborted && value && Array.isArray(value.models)) setCatalog(value); }).catch(() => {});
    return () => abort.abort();
  }, [workflow, runner]);
  const models = catalog?.models ?? [];
  const label = `${lead.id}${followers.length ? ` (z ${followers.map(s => s.id).join(', ')})` : ''}`;
  return <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:text-xs tw:text-ck-muted">
    <span className="tw:font-ck-mono tw:text-ck-text">{label}</span>
    <select aria-label={`Wykonawca kroku ${lead.id}`} value={runner} disabled={disabled} onChange={e => onChange({ runner: e.target.value, model: '' })} className="tw:bg-ck-surface-2 tw:text-ck-text">
      {RUNNERS.map(name => <option key={name} value={name}>{name === lead.runner ? `${name} (workflow)` : name}</option>)}
    </select>
    {!modelsLocked && <select aria-label={`Model kroku ${lead.id}`} value={choice?.model ?? ''} disabled={disabled} onChange={e => onChange({ runner, model: e.target.value })} className="tw:bg-ck-surface-2 tw:text-ck-text">
      <option value="">{moved ? `Domyślny: ${catalog?.model || 'nieznany'}` : `Z workflow: ${lead.model || 'domyślny'}`}</option>
      {models.filter(item => moved || item.id !== lead.model).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
    </select>}
  </div>;
}

/** Human in the loop: nothing goes to Cezar until the user says so here, and the prompt can be corrected first. */
export function DispatchCard({ toolCallId, args, result }: ToolCallMessagePartProps<DispatchArgs, DispatchResult>) {
  const { respond, running } = useContext(CardActions);
  const [editing, setEditing] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [runner, setRunner] = useState('');
  const [model, setModel] = useState('');
  const [defaults, setDefaults] = useState<{ runner: string | null; model: string | null; models: { id: string; label: string }[]; catalogSource: string; modelsLocked: boolean; pinned?: PinnedStep[] } | null>(null);
  const pinned = defaults?.pinned ?? [];
  const [stepChoices, setStepChoices] = useState<Record<string, StepChoice>>({});
  useEffect(() => {
    const abort = new AbortController();
    setDefaults(null);
    const query = new URLSearchParams({ workflow: args.workflow || 'desk-panel-task', ...(runner ? { runner } : {}) });
    fetch(`/api/cezar/dispatch-defaults?${query}`, { signal: abort.signal }).then(r => r.ok ? r.json() : null).then(value => { if (!abort.signal.aborted && value && typeof value.modelsLocked === 'boolean' && Array.isArray(value.models)) setDefaults(value); }).catch(() => {});
    return () => abort.abort();
  }, [args.workflow, runner]);
  const decided = result as DispatchResult | undefined;
  if (args.refused && !decided) return <section className={card} aria-label="Zgoda na zlecenie taska">
    <div className={head}>
      <ShieldQuestion size={16} className="tw:text-ck-muted" aria-hidden="true" />
      <b className="tw:font-semibold tw:text-ck-text">Propozycja odrzucona przez panel</b>
    </div>
    <div className="tw:grid tw:gap-2 tw:p-4">
      <div className="tw:text-ck-text tw:font-medium">{args.title}</div>
      <p className={refusedNote} role="alert">{args.refused}</p>
      <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Tej propozycji nie da się zlecić; Wektor powinien przysłać nową.</p>
    </div>
  </section>;
  // Hermes streams a tool without its arguments: the prompt arrives when the answer ends (from the session).
  const waiting = !args.prompt?.trim();
  const unidentified = toolCallId.startsWith('pending:') || toolCallId.includes('panel_cezar_propose');
  const busy = running || sending || waiting || unidentified || args.legacyUnresolved;
  const answer = async (response: { decision: 'dispatch' | 'reject'; prompt?: string }) => {
    setSending(true); setError('');
    const selectedRunner = runner || (model ? defaults?.runner : undefined);
    const steps = stepOverrides(pinned, stepChoices, defaults?.modelsLocked === true);
    try { await respond(toolCallId, { ...response, title: args.title, prompt: response.prompt ?? args.prompt, workflow: args.workflow, todoId: args.todoId, ...(selectedRunner ? { runner: selectedRunner } : {}), ...(!defaults?.modelsLocked && model ? { model } : {}), ...(steps ? { steps } : {}) }); setEditing(null); }
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
      {waiting && !decided && <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-xs tw:text-ck-muted" role="status"><LoaderCircle size={13} className="tw:animate-spin" aria-hidden="true" />Czekam na prompt od Hermesa…</p>}
      {unidentified && !decided && <p role="status">Czekam na potwierdzenie tożsamości karty z historii Hermesa.</p>}
      {args.legacyUnresolved && !decided && <p role="alert">Wcześniejszej decyzji nie można jednoznacznie przypisać do karty. Przed kolejnym zleceniem potrzebna jest diagnostyka rozmowy.</p>}
      <div className="tw:text-ck-text tw:font-medium">{args.title}</div>
      {args.workflow && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Workflow: {args.workflow}</p>}
      {decided?.decision === 'dispatched' && (decided.runner || decided.model) && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Wybrano: {decided.runner ?? 'wykonawca domyślny'}{decided.model ? ` · ${decided.model}` : ''}</p>}
      {decided?.decision === 'dispatched' && decided.steps && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Kroki: {Object.entries(decided.steps).map(([id, o]) => `${id} · ${o.runner ?? 'jak w workflow'}${o.model ? ` · ${o.model}` : ''}`).join(', ')}</p>}
      {!decided && <div className="tw:grid tw:gap-2">
        <label className="tw:text-xs tw:text-ck-muted">Wykonawca
          <select aria-label="Wykonawca Cezara" value={runner} disabled={busy} onChange={e => { setRunner(e.target.value); setModel(''); }} className="tw:ml-2 tw:bg-ck-surface-2 tw:text-ck-text">
            <option value="">Domyślny dla workflow w Cezarze</option>
            {RUNNERS.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        {pinned.length > 0 && <div className="tw:grid tw:gap-1" data-testid="pinned-steps">
          <p className="tw:m-0 tw:text-xs tw:text-ck-text">Kroki z wykonawcą ustalonym w workflow; tutaj zmienisz go tylko dla tego taska:</p>
          {leadSteps(pinned).map(lead => <PinnedStepChoice key={lead.id} workflow={args.workflow || 'desk-panel-task'} lead={lead} followers={pinned.filter(s => s.follows === lead.id)}
            choice={stepChoices[lead.id]} disabled={Boolean(busy)} modelsLocked={defaults?.modelsLocked === true}
            onChange={choice => setStepChoices(current => ({ ...current, [lead.id]: choice }))} />)}
        </div>}
        <p className="tw:m-0 tw:text-xs tw:text-ck-muted">{defaults ? `${pinned.length ? 'Pozostałe kroki według' : 'Według'} obecnych ustawień Cezara: ${defaults.runner || 'wykonawca nieznany'} · ${defaults.model || 'model nieznany'}.` : 'Nie udało się jeszcze odczytać ustawień domyślnych Cezara.'}</p>
        {defaults && !defaults.modelsLocked && <label className="tw:text-xs tw:text-ck-muted">Model
          <select aria-label="Model Cezara" value={model} disabled={busy || defaults.models.length === 0} onChange={e => setModel(e.target.value)} className="tw:ml-2 tw:bg-ck-surface-2 tw:text-ck-text">
            <option value="">Domyślny: {defaults.model || 'nieznany'}</option>
            {defaults.models.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>}
        {defaults?.catalogSource === 'unavailable' && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Katalog modeli jest niedostępny; można użyć domyślnego modelu.</p>}
        {defaults?.catalogSource === 'stale' && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Lista modeli pochodzi z wcześniejszego odczytu Cezara.</p>}
        {defaults?.modelsLocked && <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Wybór modelu jest zablokowany w ustawieniach Cezara.</p>}
        <p className="tw:m-0 tw:text-xs tw:text-ck-muted">Dla AGY poziom może być częścią nazwy modelu, np. gemini-3.8-flash-low, -medium lub -high. Cezar nie udostępnia osobnego pola poziomu rozumowania.</p>
      </div>}
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
const pln = (amount: number) => `${amount.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} zł`;
const dayLabel = (day: string) => new Date(`${day}T12:00:00Z`).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * `panel_show`: bank spending of some categories as a table or bars. The model sent only what to show; the rows are read
 * here from the panel (`GET /api/bank/show`), so they never went through it, and the card shows the marks as they are now.
 */
export function ShowCard({ args }: ToolCallMessagePartProps<ShowArgs>) {
  const query = bankShowQuerySchema.safeParse(args);
  const key = query.success ? JSON.stringify(query.data) : '';
  const [state, setState] = useState<{ key: string; data?: BankShowData; error?: string }>({ key: '' });
  useEffect(() => {
    if (!query.success) return;
    const params = new URLSearchParams({ view: query.data.view });
    for (const name of query.data.kategorie) params.append('kategorie', name);
    if (query.data.nieoznaczone) params.set('nieoznaczone', '1');
    if (query.data.from) params.set('from', query.data.from);
    if (query.data.to) params.set('to', query.data.to);
    let gone = false;
    fetch(`/api/bank/show?${params}`, { signal: AbortSignal.timeout(15_000) }).then(async response => {
      const body = await response.json().catch(() => null) as (BankShowData & { error?: string }) | null;
      if (gone) return;
      setState(response.ok && body ? { key, data: body } : { key, error: body?.error || 'Nie udało się pobrać danych karty.' });
    }, () => { if (!gone) setState({ key, error: 'Nie udało się pobrać danych karty.' }); });
    return () => { gone = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the query
  }, [key]);
  const title = typeof args.tytul === 'string' && args.tytul.trim() ? args.tytul.trim().slice(0, 80) : 'Wydatki';
  const data = state.key === key ? state.data : undefined;
  const error = !query.success ? 'Agent przysłał niepoprawne zapytanie karty.' : state.key === key ? state.error : undefined;
  const widest = Math.max(1, ...(data?.categories.map(c => Math.max(0, c.spent)) ?? []));
  return <section className={card} aria-label={`Karta: ${title}`}>
    <div className={head}>
      <ChartColumn size={16} className="tw:text-ck-cal" aria-hidden="true" />
      <span className={eyebrow}>{title}</span>
      {data && <span className="tw:ml-auto tw:text-xs tw:text-ck-muted">{dayLabel(data.from)} – {dayLabel(data.to)}</span>}
    </div>
    <div className="tw:grid tw:gap-3 tw:p-4">
      {error && <p className={refusedNote} role="alert">{error}</p>}
      {!data && !error && <p className="tw:m-0 tw:text-xs tw:text-ck-muted" role="status">Wczytuję…</p>}
      {data && <>
        <p className="tw:m-0 tw:text-ck-text"><b className="tw:font-semibold">{pln(data.total.spent)}</b> <span className="tw:text-ck-muted">· {data.total.count} {data.total.count === 1 ? 'operacja' : 'operacji'}</span></p>
        {data.view === 'słupki' || data.categories.length > 1 ? <ul className="tw:m-0 tw:grid tw:list-none tw:gap-2 tw:p-0">
          {data.categories.map(c => <li key={c.id} className="tw:grid tw:gap-1">
            <div className="tw:flex tw:items-baseline tw:gap-2"><span className="tw:text-ck-text">{c.name}</span><span className="tw:text-xs tw:text-ck-faint">{c.count} op.</span><span className="tw:ml-auto tw:font-ck-mono tw:text-[13px] tw:text-ck-text">{pln(c.spent)}</span></div>
            <div className="tw:h-2 tw:overflow-hidden tw:rounded-full tw:bg-ck-surface-2" aria-hidden="true"><div className="tw:h-full tw:rounded-full" style={{ width: `${Math.round(Math.max(0, c.spent) / widest * 100)}%`, background: COLOR_VALUES[c.color] }} /></div>
          </li>)}
        </ul> : null}
        {data.view === 'tabela' && <div className="tw:overflow-x-auto">
          <table className="tw:w-full tw:border-collapse tw:text-[13px]">
            <thead><tr className="tw:text-left tw:text-[11px] tw:uppercase tw:tracking-wider tw:text-ck-muted"><th className="tw:py-1 tw:pr-3 tw:font-semibold">Dzień</th><th className="tw:py-1 tw:pr-3 tw:font-semibold">Operacja</th><th className="tw:py-1 tw:pr-3 tw:font-semibold">Kategoria</th><th className="tw:py-1 tw:text-right tw:font-semibold">Kwota</th></tr></thead>
            <tbody>
              {data.rows.map((r, i) => <tr key={`${i}:${r.day}:${r.name}`} className="tw:border-t tw:border-ck-line">
                <td className="tw:whitespace-nowrap tw:py-1.5 tw:pr-3 tw:text-ck-muted">{dayLabel(r.day)}</td>
                <td className="tw:py-1.5 tw:pr-3 tw:text-ck-text">{r.name}{r.tags.map(t => <span key={t} className="tw:ml-1.5 tw:text-xs tw:text-ck-faint">#{t}</span>)}</td>
                <td className="tw:py-1.5 tw:pr-3 tw:text-ck-muted">{r.category}</td>
                <td className="tw:whitespace-nowrap tw:py-1.5 tw:text-right tw:font-ck-mono tw:text-ck-text">{pln(-r.amount)}</td>
              </tr>)}
            </tbody>
          </table>
        </div>}
        {data.hidden > 0 && <p className="tw:m-0 tw:text-xs tw:text-ck-faint">… i {data.hidden} starszych (zawęź zakres dat).</p>}
        {data.unknown.length > 0 && <p className="tw:m-0 tw:text-xs tw:text-ck-faint">Bez dopasowania: {data.unknown.join(', ')}.</p>}
      </>}
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
