import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider, ComposerPrimitive, MessagePrimitive, ThreadPrimitive, useAui, useAuiState, useExternalStoreRuntime,
  type AppendMessage, type TextMessagePartProps, type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  Activity, ArrowUp, Bot, CalendarDays, Crosshair, LayoutGrid, ListChecks, Mail, RefreshCw, Sparkles, Square, SquareCheck, Wrench, X, type LucideIcon,
} from 'lucide-react';
import { CHAT_SKILLS, MAX_CONTEXT, skillItem, type ChatSkill, type ContextItem, type ContextKind } from '../chat-contract';
import { sameContext } from '../chat-context';
import { Markdown } from '../markdown-lite';
import { CardActions, DispatchCard, HermesApprovalCard, ReconCard, ToolCard, WatchCard } from './cards';
import { DISPATCH, HERMES_APPROVAL, RECON, WATCH, type CockpitMessage, type CockpitSource } from './types';

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
    ...(m.role === 'assistant' ? { status: m.status === 'error' ? { type: 'incomplete', reason: 'error', error: m.error } : STATUS[m.status] } : {}),
    metadata: { custom: { context: m.context ?? [], notice: m.notice, error: m.error, status: m.status } },
  };
}

const Text = ({ text }: TextMessagePartProps) => <Markdown text={text} />;
const PARTS = {
  Text,
  tools: { by_name: { [RECON]: ReconCard, [DISPATCH]: DispatchCard, [WATCH]: WatchCard, [HERMES_APPROVAL]: HermesApprovalCard }, Fallback: ToolCard },
};

type Custom = { context: ContextItem[]; notice?: string; error?: string; status: CockpitMessage['status'] };
const useCustom = () => useAuiState(s => s.message.metadata.custom) as Custom;

function UserMessage() {
  const { context } = useCustom();
  return <MessagePrimitive.Root className="tw:flex tw:flex-col tw:items-end tw:gap-2">
    {!!context?.length && <div className="tw:flex tw:max-w-[85%] tw:flex-wrap tw:justify-end tw:gap-1.5">{context.map((item, i) => <Chip key={`${item.kind}:${item.id}:${i}`} item={item} />)}</div>}
    <div className="tw:max-w-[85%] tw:whitespace-pre-wrap tw:rounded-2xl tw:rounded-br-md tw:bg-ck-cal/15 tw:px-4 tw:py-2.5 tw:text-[15px] tw:text-ck-text tw:[overflow-wrap:anywhere]">
      <MessagePrimitive.Parts components={{ Text: ({ text }: TextMessagePartProps) => <>{text}</> }} />
    </div>
  </MessagePrimitive.Root>;
}

function AssistantMessage() {
  const { notice, error, status } = useCustom();
  const empty = useAuiState(s => s.message.content.length === 0);
  return <MessagePrimitive.Root className="tw:flex tw:gap-3">
    <div className="tw:grid tw:size-8 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-ck-agent/20 tw:text-ck-agent" aria-hidden="true"><Sparkles size={16} /></div>
    <div className="md-scope tw:flex tw:min-w-0 tw:flex-1 tw:flex-col tw:gap-3 tw:text-[15px] tw:leading-relaxed tw:[overflow-wrap:anywhere]">
      <MessagePrimitive.Parts components={PARTS} />
      {status === 'running' && (notice || empty) && <p className="tw:m-0 tw:flex tw:items-center tw:gap-2 tw:text-sm tw:text-ck-muted" role="status"><i className="tw:size-2 tw:rounded-full tw:bg-ck-agent tw:animate-ck-pulse" aria-hidden="true" />{notice || 'Wektor pracuje…'}</p>}
      {status === 'error' && <p className="tw:m-0 tw:rounded-xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-3.5 tw:py-2.5 tw:text-sm tw:text-[#ffd3d4]" role="alert">{error || 'Agent nie odpowiedział.'}</p>}
      {status === 'stopped' && <p className="tw:m-0 tw:text-[13px] tw:text-ck-faint">Zatrzymano.</p>}
    </div>
  </MessagePrimitive.Root>;
}

/** Detects a trailing `@query` token so typing `@` opens the skill picker. */
export function detectAtSkill(draft: string): { start: number; query: string; token: string } | null {
  const match = /(?:^|\s)(@[^\n@]*)$/.exec(draft);
  if (!match) return null;
  const token = match[1];
  const query = token.slice(1).trim().toLowerCase();
  return { start: match.index + (match[0].length - token.length), query, token };
}
const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

/** The composer: `@` opens the skills, picked dashboard elements sit above the field as chips. */
function Composer({ source, context, setContext, picking, setPicking }: {
  source: CockpitSource; context: ContextItem[]; setContext: (fn: (list: ContextItem[]) => ContextItem[]) => void; picking: boolean; setPicking: (on: boolean) => void;
}) {
  const aui = useAui();
  const draft = useAuiState(s => s.composer.text);
  const running = useAuiState(s => s.thread.isRunning);
  const [index, setIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const at = detectAtSkill(draft);
  const matching = at && dismissed !== at.token ? CHAT_SKILLS.filter(s => !at.query || fold(s.title).includes(fold(at.query)) || s.id.includes(fold(at.query))) : [];
  const active = matching.length ? Math.min(index, matching.length - 1) : 0;
  const skill = context.find(c => c.kind === 'skill');
  const down = !source.hermes.up;

  const pick = (s: ChatSkill) => {
    const item = skillItem(s);
    setContext(list => list.some(x => sameContext(x, item)) ? list : list.length < MAX_CONTEXT ? [...list, item] : list);
    if (at) { const before = draft.slice(0, at.start).replace(/\s+$/, ''); aui.composer().setText(before ? `${before} ` : ''); }
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

  return <div className="tw:flex-none tw:px-4 tw:pb-4 tw:pt-2 tw:md:px-6">
    {down && <div className="tw:mb-3 tw:rounded-2xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:p-4" role="alert">
      <p className="tw:m-0 tw:text-sm tw:text-[#ffd3d4]"><b>Hermes nie odpowiada.</b> {source.hermes.error ?? ''} Wiadomość nie zostanie wysłana, szkic zostaje.</p>
      <button type="button" className="tw:mt-3 tw:inline-flex tw:min-h-10 tw:items-center tw:gap-2 tw:rounded-xl tw:bg-ck-surface-2 tw:px-4 tw:text-sm tw:font-medium tw:hover:bg-ck-line tw:disabled:opacity-50" disabled={source.hermes.checking} onClick={source.retry}>
        <RefreshCw size={15} className={source.hermes.checking ? 'tw:animate-spin' : ''} aria-hidden="true" />{source.hermes.checking ? 'Sprawdzam…' : 'Ponów próbę'}
      </button>
    </div>}
    <ComposerPrimitive.Root className="tw:relative tw:rounded-2xl tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:p-2 tw:focus-within:border-ck-cal tw:focus-within:shadow-[0_0_0_1px_#7ca9ff]">
      {matching.length > 0 && <div role="listbox" aria-label="Wybór skillów" className="tw:absolute tw:inset-x-2 tw:bottom-full tw:mb-2 tw:grid tw:gap-1 tw:rounded-2xl tw:border tw:border-ck-line-2 tw:bg-ck-surface tw:p-1.5 tw:shadow-2xl">
        {matching.map((s, i) => <button key={s.id} type="button" role="option" aria-selected={i === active}
          className={`tw:flex tw:min-h-12 tw:items-center tw:gap-3 tw:rounded-xl tw:px-3 tw:py-2 ${i === active ? 'tw:bg-ck-agent/15' : 'tw:hover:bg-ck-surface-2'}`}
          onMouseDown={e => e.preventDefault()} onClick={() => pick(s)}>
          <Wrench size={15} className="tw:text-ck-agent" aria-hidden="true" />
          <span className="tw:font-semibold tw:text-ck-text">@{s.title}</span>
          <span className="tw:truncate tw:text-xs tw:text-ck-muted">{s.description}</span>
        </button>)}
      </div>}
      {(context.length > 0 || picking) && <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5 tw:px-1 tw:pb-2" aria-label="Wskazane elementy">
        {context.map(item => <Chip key={`${item.kind}:${item.id}`} item={item} remove={() => setContext(list => list.filter(x => !sameContext(x, item)))} />)}
        {picking && <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-xs tw:text-ck-cal"><Crosshair size={14} aria-hidden="true" />{context.length ? 'Kliknij kolejny element na pulpicie' : 'Kliknij element na pulpicie'}</span>}
      </div>}
      <ComposerPrimitive.Input autoFocus cancelOnEscape={false} onKeyDown={onKeyDown} rows={1} maxRows={7}
        onChange={() => { setDismissed(null); setIndex(0); }}
        aria-label="Wiadomość do agenta" placeholder={picking ? 'Co z tym zrobić?' : 'Napisz do Wektora lub wpisz @ aby wybrać skill…'}
        className="tw:block tw:w-full tw:resize-none tw:border-0 tw:bg-transparent tw:font-ck tw:px-2 tw:py-1.5 tw:text-[15px] tw:leading-relaxed tw:text-ck-text tw:placeholder:text-ck-faint" />
      <div className="tw:flex tw:items-center tw:gap-2 tw:pt-1">
        {picking
          ? <button type="button" className="tw:min-h-10 tw:rounded-xl tw:bg-ck-cal tw:px-4 tw:text-sm tw:font-semibold tw:text-ck-bg tw:hover:bg-[#9cc0ff]" onClick={() => setPicking(false)}>Gotowe</button>
          : <button type="button" className="tw:inline-flex tw:min-h-10 tw:items-center tw:gap-2 tw:rounded-xl tw:px-3 tw:text-sm tw:text-ck-muted tw:hover:bg-ck-line tw:hover:text-ck-text" onClick={() => setPicking(true)}><Crosshair size={16} aria-hidden="true" />Wskaż element</button>}
        <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-ck-line tw:px-2.5 tw:py-1 tw:text-xs tw:text-ck-muted" title="Czat działa na Hermesie">
          <i className={`tw:size-2 tw:rounded-full ${down ? 'tw:bg-ck-red' : running ? 'tw:bg-ck-agent tw:animate-ck-pulse' : 'tw:bg-ck-green'}`} aria-hidden="true" />Hermes
        </span>
        <div className="tw:ml-auto">
          {running
            ? <ComposerPrimitive.Cancel className="tw:grid tw:size-10 tw:place-items-center tw:rounded-full tw:bg-ck-text tw:text-ck-bg" aria-label="Zatrzymaj odpowiedź"><Square size={14} fill="currentColor" aria-hidden="true" /></ComposerPrimitive.Cancel>
            : <ComposerPrimitive.Send className="tw:grid tw:size-10 tw:place-items-center tw:rounded-full tw:bg-ck-cal tw:text-ck-bg tw:disabled:bg-ck-line tw:disabled:text-ck-faint" aria-label="Wyślij"><ArrowUp size={19} aria-hidden="true" /></ComposerPrimitive.Send>}
        </div>
      </div>
    </ComposerPrimitive.Root>
  </div>;
}

/**
 * The left column: the conversation (assistant-ui over the cockpit's source) and the composer. The source keeps the
 * messages; assistant-ui only renders them and reports what the user sends or stops.
 */
export function Thread({ source, context, setContext, picking, setPicking, empty }: {
  source: CockpitSource; context: ContextItem[]; setContext: (fn: (list: ContextItem[]) => ContextItem[]) => void; picking: boolean; setPicking: (on: boolean) => void; empty: ReactNode;
}) {
  const contextRef = useRef(context);
  contextRef.current = context;
  const runtimeRef = useRef<ReturnType<typeof useExternalStoreRuntime> | null>(null);
  const onNew = async (message: AppendMessage) => {
    const text = message.content.map(p => p.type === 'text' ? p.text : '').join('').trim();
    if (!text) return;
    // On failure the draft and the picked elements stay, so nothing is lost while Hermes is down.
    if (await source.send(text, contextRef.current)) setContext(() => []);
    else runtimeRef.current?.thread.composer.setText(text);
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
  const actions = useMemo(() => ({ respond: source.respond, running: source.running }), [source.respond, source.running]);

  return <AssistantRuntimeProvider runtime={runtime}>
    <CardActions.Provider value={actions}>
      <ThreadPrimitive.Root className="tw:flex tw:min-h-0 tw:flex-1 tw:flex-col">
        <ThreadPrimitive.Viewport className="tw:min-h-0 tw:flex-1 tw:overflow-y-auto" role="log" aria-live="polite" aria-label="Rozmowa">
          <div className="tw:mx-auto tw:flex tw:max-w-[820px] tw:flex-col tw:gap-6 tw:px-4 tw:py-6 tw:md:px-6">
            <ThreadPrimitive.Empty>{empty}</ThreadPrimitive.Empty>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </div>
        </ThreadPrimitive.Viewport>
        {source.error && <p className="tw:mx-4 tw:mb-2 tw:flex tw:items-center tw:justify-between tw:gap-3 tw:rounded-xl tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-3 tw:py-2 tw:text-[13px] tw:text-[#ffd3d4] tw:md:mx-6" role="alert">
          {source.error}<button type="button" className="tw:grid tw:size-7 tw:place-items-center tw:rounded-lg tw:hover:bg-ck-red/20" aria-label="Zamknij komunikat" onClick={source.clearError}><X size={14} aria-hidden="true" /></button>
        </p>}
        <Composer source={source} context={context} setContext={setContext} picking={picking} setPicking={setPicking} />
      </ThreadPrimitive.Root>
    </CardActions.Provider>
  </AssistantRuntimeProvider>;
}
