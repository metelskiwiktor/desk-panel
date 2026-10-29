import { createContext, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider, makeAssistantToolUI, useAui, useAuiState, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  Activity, Bot, CalendarDays, Crosshair, LayoutGrid, ListChecks, Mail, RefreshCw, SquareCheck, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { Thread as AuiThread, type ThreadComponents } from '@/components/thread.aui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CHAT_SKILLS, MAX_CONTEXT, skillItem, type ChatSkill, type ContextItem, type ContextKind } from '../chat-contract';
import { sameContext } from '../chat-context';
import { clearChatDraft, getChatDraft, setChatDraftText } from '../chat-draft';
import { CardActions, CardBoundary, DispatchCard, HermesApprovalCard, ReconCard, ShowCard, WatchCard } from './cards';
import { BankPlanCard } from './consent-card';
import { BankAssignCard } from './assign-card';
import {
  BANK_ASSIGN, BANK_PLAN, DISPATCH, HERMES_APPROVAL, RECON, SHOW, WATCH,
  type BankAssignArgs, type BankPlanArgs, type CockpitMessage, type CockpitSource, type DispatchArgs, type DispatchResult, type HermesApprovalArgs, type ReconArgs, type ShowArgs, type WatchArgs,
} from './types';

/*
 * The conversation is assistant-ui's own Thread (src/components/thread.aui.tsx, from their shadcn registry): messages,
 * markdown, tool rows, the composer. What is the panel's goes into its slots: the skill cards as tool UIs by name, the
 * `@` skill picker, the picked dashboard elements as chips, the "Hermes nie odpowiada" card and the run's notices.
 */

const KINDS: Record<ContextKind, { label: string; icon: LucideIcon }> = {
  mail: { label: 'Mail', icon: Mail },
  event: { label: 'Spotkanie', icon: CalendarDays },
  task: { label: 'Task Cezara', icon: Bot },
  workout: { label: 'Trening', icon: Activity },
  tile: { label: 'Kafelek', icon: LayoutGrid },
  todoList: { label: 'Lista', icon: ListChecks },
  todo: { label: 'Zadanie', icon: SquareCheck },
  skill: { label: 'Skill', icon: Wrench },
};
const KIND_COLOR: Partial<Record<ContextKind, string>> = {
  mail: 'tw:border-ck-mail/50 tw:text-ck-mail', event: 'tw:border-ck-cal/50 tw:text-ck-cal', task: 'tw:border-ck-agent/50 tw:text-ck-agent',
  skill: 'tw:border-ck-agent/70 tw:text-ck-agent tw:bg-ck-agent/10', todo: 'tw:border-ck-green/50 tw:text-ck-green', todoList: 'tw:border-ck-green/50 tw:text-ck-green',
};

/** A dashboard element in the conversation: the small label the user picked, with a remove button while it is still a draft. */
export function Chip({ item, remove }: { item: ContextItem; remove?: () => void }) {
  const { label, icon: Icon } = KINDS[item.kind];
  return <span className={`chat-chip ${item.kind} tw:inline-flex tw:max-w-full tw:items-center tw:gap-1.5 tw:rounded-lg tw:border tw:bg-ck-surface-2 tw:py-1 tw:pl-2 tw:text-xs ${remove ? 'tw:pr-1' : 'tw:pr-2'} ${KIND_COLOR[item.kind] ?? 'tw:border-ck-line-2 tw:text-ck-muted'}`} title={item.text || item.title}>
    <Icon size={14} aria-hidden="true" />
    <span className="tw:font-semibold">{item.kind === 'skill' ? `@${item.title}` : label}</span>
    {item.kind !== 'skill' && <span className="tw:truncate tw:text-ck-text">{item.title}</span>}
    {remove && <button type="button" className="tw:grid tw:size-6 tw:place-items-center tw:rounded-md tw:hover:bg-ck-line" aria-label={`Usuń z kontekstu: ${item.title}`} onClick={remove}><X size={13} aria-hidden="true" /></button>}
  </span>;
}

const STATUS: Record<CockpitMessage['status'], ThreadMessageLike['status']> = {
  running: { type: 'running' },
  done: { type: 'complete', reason: 'stop' },
  stopped: { type: 'incomplete', reason: 'cancelled' },
  error: { type: 'incomplete', reason: 'error' },
};

/** The cockpit's message as assistant-ui reads it; the context chips and notices ride along in `custom`. */
export function toThreadMessage(m: CockpitMessage): ThreadMessageLike {
  return {
    id: m.id, role: m.role, createdAt: new Date(m.at),
    content: m.parts.map(p => p.type === 'text'
      ? { type: 'text' as const, text: p.text }
      : { type: 'tool-call' as const, toolCallId: p.id, toolName: p.name, args: p.args as never, argsText: JSON.stringify(p.args), ...(p.result !== undefined ? { result: p.result } : {}), ...(p.error ? { isError: true } : {}) }),
    ...(m.role === 'assistant' ? { status: m.status === 'error' ? { type: 'incomplete', reason: 'error', error: m.error || 'Agent nie odpowiedział.' } : STATUS[m.status] } : {}),
    metadata: { custom: { context: m.context ?? [], notice: m.notice, status: m.status } },
  };
}

// The panel's cards, as assistant-ui tool UIs: they win over its generic tool row for these names, and stand on their own
// (`standalone`) instead of folding into the group of tool calls.
const ReconUI = makeAssistantToolUI<ReconArgs, unknown>({ toolName: RECON, display: 'standalone', render: props => <CardBoundary><ReconCard {...props} /></CardBoundary> });
const DispatchUI = makeAssistantToolUI<DispatchArgs, DispatchResult>({ toolName: DISPATCH, display: 'standalone', render: props => <CardBoundary><DispatchCard {...props} /></CardBoundary> });
const WatchUI = makeAssistantToolUI<WatchArgs, unknown>({ toolName: WATCH, display: 'standalone', render: props => <CardBoundary><WatchCard {...props} /></CardBoundary> });
const BankPlanUI = makeAssistantToolUI<BankPlanArgs, unknown>({ toolName: BANK_PLAN, display: 'standalone', render: props => <CardBoundary><BankPlanCard {...props} /></CardBoundary> });
const BankAssignUI = makeAssistantToolUI<BankAssignArgs, unknown>({ toolName: BANK_ASSIGN, display: 'standalone', render: props => <CardBoundary><BankAssignCard {...props} /></CardBoundary> });
const ShowUI = makeAssistantToolUI<ShowArgs, unknown>({ toolName: SHOW, display: 'standalone', render: props => <CardBoundary><ShowCard {...props} /></CardBoundary> });
const ApprovalUI = makeAssistantToolUI<HermesApprovalArgs, unknown>({ toolName: HERMES_APPROVAL, display: 'standalone', render: props => <CardBoundary><HermesApprovalCard {...props} /></CardBoundary> });

type Custom = { context: ContextItem[]; notice?: string; status: CockpitMessage['status'] };
const useCustom = () => useAuiState(s => s.message.metadata.custom) as Custom;

/** Detects a trailing `@query` token so typing `@` opens the skill picker. */
export function detectAtSkill(draft: string): { start: number; query: string; token: string } | null {
  const match = /(?:^|\s)(@[^\n@]*)$/.exec(draft);
  if (!match) return null;
  const token = match[1];
  const query = token.slice(1).trim().toLowerCase();
  return { start: match.index + (match[0].length - token.length), query, token };
}
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

interface Shared {
  source: CockpitSource;
  context: ContextItem[];
  setContext: (fn: (list: ContextItem[]) => ContextItem[]) => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  empty: ReactNode;
  matching: readonly ChatSkill[];
  active: number;
  pick(skill: ChatSkill): void;
}
const Panel = createContext<Shared | null>(null);
const usePanel = () => useContext(Panel)!;

// ── the slots ──

function Welcome() { return <>{usePanel().empty}</>; }

/** Above the field: the skill picker, the panel's error and the card when Hermes is down. */
function ComposerHeader() {
  const { source, matching, active, pick } = usePanel();
  const down = !source.hermes.up;
  return <>
    {matching.length > 0 && <div role="listbox" aria-label="Wybór skillów" className="tw:absolute tw:inset-x-0 tw:bottom-full tw:z-10 tw:mb-2 tw:grid tw:gap-1 tw:rounded-2xl tw:border tw:border-ck-line-2 tw:bg-ck-surface tw:p-1.5 tw:shadow-2xl">
      {matching.map((s, i) => <button key={s.id} type="button" role="option" aria-selected={i === active}
        className={`tw:flex tw:min-h-12 tw:items-center tw:gap-3 tw:rounded-xl tw:px-3 tw:py-2 ${i === active ? 'tw:bg-ck-agent/15' : 'tw:hover:bg-ck-surface-2'}`}
        onMouseDown={e => e.preventDefault()} onClick={() => pick(s)}>
        <Wrench size={15} className="tw:text-ck-agent" aria-hidden="true" />
        <span className="tw:font-semibold tw:text-ck-text">@{s.title}</span>
        <span className="tw:truncate tw:text-xs tw:text-ck-muted">{s.description}</span>
      </button>)}
    </div>}
    {source.error && <p className="tw:mb-2 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-3 tw:py-2 tw:text-[13px] tw:text-[#ffd3d4]" role="alert">
      {source.error}<button type="button" className="tw:grid tw:size-7 tw:place-items-center tw:rounded-lg tw:hover:bg-ck-red/20" aria-label="Zamknij komunikat" onClick={source.clearError}><X size={14} aria-hidden="true" /></button>
    </p>}
    {down && <div className="tw:mb-3 tw:rounded-2xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:p-4" role="alert">
      <p className="tw:m-0 tw:text-sm tw:text-[#ffd3d4]"><b>Hermes nie odpowiada.</b> {source.hermes.error ?? ''} Wiadomość nie zostanie wysłana, szkic zostaje.</p>
      <button type="button" className="tw:mt-3 tw:inline-flex tw:min-h-10 tw:items-center tw:gap-2 tw:rounded-xl tw:bg-ck-surface-2 tw:px-4 tw:text-sm tw:font-medium tw:hover:bg-ck-line tw:disabled:opacity-50" disabled={source.hermes.checking} onClick={source.retry}>
        <RefreshCw size={15} className={source.hermes.checking ? 'tw:animate-spin' : ''} aria-hidden="true" />{source.hermes.checking ? 'Sprawdzam…' : 'Ponów próbę'}
      </button>
    </div>}
  </>;
}

/** Inside the composer, above the field: the picked elements. */
function ComposerTop() {
  const { context, setContext, picking } = usePanel();
  if (!context.length && !picking) return null;
  return <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:px-1" aria-label="Wskazane elementy">
    {context.map(item => <Chip key={`${item.kind}:${item.id}`} item={item} remove={() => setContext(list => list.filter(x => !sameContext(x, item)))} />)}
    {picking && <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-ck-cal"><Crosshair size={14} aria-hidden="true" />{context.length ? 'Kliknij kolejny element na pulpicie' : 'Kliknij element na pulpicie'}</span>}
  </div>;
}

/** Beside the send button: pointing at the dashboard, and the engine the chat runs on. */
function ComposerExtra() {
  const { source, picking, setPicking } = usePanel();
  const running = useAuiState(s => s.thread.isRunning);
  const down = !source.hermes.up;
  return <>
    {picking
      ? <button type="button" className="tw:min-h-9 tw:rounded-xl tw:bg-ck-cal tw:px-4 tw:text-sm tw:font-semibold tw:text-ck-bg tw:hover:bg-[#9cc0ff]" onClick={() => setPicking(false)}>Gotowe</button>
      : <button type="button" className="tw:inline-flex tw:min-h-9 tw:items-center tw:gap-2 tw:rounded-xl tw:px-3 tw:text-sm tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground" onClick={() => setPicking(true)}><Crosshair size={16} aria-hidden="true" />Wskaż element</button>}
    <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1 tw:text-xs tw:text-muted-foreground" title="Czat działa na Hermesie">
      <i className={`tw:size-2 tw:rounded-full ${down ? 'tw:bg-ck-red' : running ? 'tw:bg-ck-agent tw:animate-ck-pulse' : 'tw:bg-ck-green'}`} aria-hidden="true" />Hermes
    </span>
  </>;
}

function UserMessageHeader() {
  const { context } = useCustom();
  if (!context?.length) return null;
  return <div className="tw:flex tw:max-w-full tw:flex-wrap tw:justify-end tw:gap-1.5">{context.map((item, i) => <Chip key={`${item.kind}:${item.id}:${i}`} item={item} />)}</div>;
}

/** What the panel says about a run (reconnecting, an approval sent), or that the answer was stopped. */
function AssistantMessageFooter() {
  const { notice, status } = useCustom();
  if (status === 'running' && notice) return <p className="tw:m-0 tw:mt-2 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-muted-foreground" role="status"><i className="tw:size-2 tw:rounded-full tw:bg-ck-agent tw:animate-ck-pulse" aria-hidden="true" />{notice}</p>;
  if (status === 'stopped') return <p className="tw:m-0 tw:mt-2 tw:text-[13px] tw:text-muted-foreground">Zatrzymano.</p>;
  return null;
}

const SLOTS: ThreadComponents = { Welcome, ComposerHeader, ComposerTop, ComposerExtra, UserMessageHeader, AssistantMessageFooter };

/** Inside the runtime: the `@` picker's state and keys, given to the slots and to the field. */
function Conversation(props: Omit<Shared, 'matching' | 'active' | 'pick'>) {
  const { source, context, setContext, picking } = props;
  const aui = useAui();
  const draft = useAuiState(s => s.composer.text);
  const running = useAuiState(s => s.thread.isRunning);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const initialDraft = useRef(getChatDraft().text);
  const hasRestored = useRef(false);

  useEffect(() => {
    if (initialDraft.current && !hasRestored.current) {
      hasRestored.current = true;
      aui.composer().setText(initialDraft.current);
    }
  }, [aui]);

  useEffect(() => {
    if (initialDraft.current && draft === '') return;
    initialDraft.current = '';
    hasRestored.current = true;
    setChatDraftText(draft);
  }, [draft]);

  const at = detectAtSkill(draft);
  const matching = at && dismissed !== at.token ? CHAT_SKILLS.filter(s => !at.query || fold(s.title).includes(fold(at.query)) || s.id.includes(fold(at.query))) : [];
  const active = matching.length ? Math.min(index, matching.length - 1) : 0;
  const skill = context.find(c => c.kind === 'skill');
  const down = !source.hermes.up;

  const pick = (s: ChatSkill) => {
    const item = skillItem(s);
    setContext(list => list.some(x => sameContext(x, item)) ? list : list.length < MAX_CONTEXT ? [...list, item] : list);
    if (at) {
      const before = draft.slice(0, at.start).replace(/\s+$/, '');
      const nextText = before ? `${before} ` : '';
      aui.composer().setText(nextText);
      setChatDraftText(nextText);
    }
    setDismissed(null);
    setIndex(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (matching.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => (i + 1) % matching.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => (i - 1 + matching.length) % matching.length); return; }
      if ((e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) || e.key === 'Tab') { e.preventDefault(); pick(matching[active]); return; }
      if (e.key === 'Escape' && at) { e.preventDefault(); e.stopPropagation(); setDismissed(at.token); return; }
    }
    // A picked skill is a message on its own: Enter sends it even with nothing typed.
    if (e.key === 'Enter' && !e.shiftKey && !draft.trim() && skill && !running && !down) { e.preventDefault(); aui.composer().setText(skill.title); queueMicrotask(() => aui.composer().send()); }
  };
  const components: ThreadComponents = {
    ...SLOTS,
    composerInput: {
      onKeyDown, cancelOnEscape: false, disabled: source.unavailable,
      onChange: (e) => {
        hasRestored.current = true;
        setDismissed(null);
        setIndex(0);
        setChatDraftText((e.target as HTMLTextAreaElement).value);
      },
      'aria-label': 'Wiadomość do agenta',
      placeholder: picking ? 'Co z tym zrobić?' : 'Napisz do Wektora lub wpisz @ aby wybrać skill…',
    },
  };
  return <Panel.Provider value={{ ...props, matching, active, pick }}>
    <AuiThread components={components} />
  </Panel.Provider>;
}

/**
 * The left column: the conversation (assistant-ui over the cockpit's source). The source keeps the messages;
 * assistant-ui renders them and reports what the user sends or stops.
 */
export function Thread(props: Omit<Shared, 'matching' | 'active' | 'pick'>) {
  const { source, setContext } = props;
  const contextRef = useRef(props.context);
  contextRef.current = props.context;
  const runtimeRef = useRef<ReturnType<typeof useExternalStoreRuntime> | null>(null);
  const onNew = async (message: AppendMessage) => {
    const text = message.content.map(p => p.type === 'text' ? p.text : '').join('').trim();
    if (!text) return;
    // On failure the draft and the picked elements stay, so nothing is lost while Hermes is down.
    if (await source.send(text, contextRef.current)) {
      setContext(() => []);
      clearChatDraft();
    } else {
      runtimeRef.current?.thread.composer.setText(text);
      setChatDraftText(text);
    }
  };
  const runtime = useExternalStoreRuntime<CockpitMessage>({
    messages: source.messages,
    convertMessage: toThreadMessage,
    isRunning: source.running,
    isDisabled: source.unavailable,
    isSendDisabled: !source.hermes.up,
    onNew,
    onCancel: async () => source.stop(),
  });
  runtimeRef.current = runtime;
  const actions = useMemo(() => ({ respond: source.respond, running: source.running, watched: source.cockpit.task }), [source.respond, source.running, source.cockpit.task]);

  return <AssistantRuntimeProvider runtime={runtime}>
    <TooltipProvider>
      <CardActions.Provider value={actions}>
        <ReconUI /><DispatchUI /><WatchUI /><ShowUI /><BankPlanUI /><BankAssignUI /><ApprovalUI />
        <div className="tw:relative tw:min-h-0 tw:flex-1">
          <Conversation {...props} />
        </div>
      </CardActions.Provider>
    </TooltipProvider>
  </AssistantRuntimeProvider>;
}
