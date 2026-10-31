import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode } from 'react';
import {
  AssistantRuntimeProvider, makeAssistantToolUI, useAui, useAuiState, useExternalStoreRuntime,
  type AppendMessage, type ThreadMessageLike,
} from '@assistant-ui/react';
import {
  Activity, Bot, CalendarDays, Crosshair, FileText, Landmark, LayoutGrid, ListChecks, Mail, Paperclip, RefreshCw, SquareCheck, Wrench, X, Zap, type LucideIcon,
} from 'lucide-react';
import { Thread as AuiThread, type ThreadComponents } from '@/components/thread.aui';
import { TooltipProvider } from '@/components/ui/tooltip';
import { CHAT_SKILLS, MAX_CHAT_FILES, MAX_CHAT_TOTAL_BYTES, MAX_CONTEXT, automationLabel, isChatImage, skillItem, type ChatAutomation, type ChatFileRef, type ChatFileUpload, type ChatSkill, type ContextItem, type ContextKind } from '../chat-contract';
import { sameContext } from '../chat-context';
import { CHAT_DRAFT_EVENT, clearChatDraft, getChatDraft, setChatDraftText } from '../chat-draft';
import { attachmentProblem, chatFileUrl, fileLabel, fileSize, mimeOf, readDraft, UNSUPPORTED_PDF, unsupportedType, type DraftFile } from './attachments';
import { CardActions, CardBoundary, DispatchCard, HermesApprovalCard, ReconCard, ShowCard, WatchCard } from './cards';
import { BankPlanCard } from './consent-card';
import { MailListCard, SmartRuleCard } from './smart-cards';
import { AutomationCard } from './automation-card';
import { BankAssignCard } from './assign-card';
import { AppointmentCard, CalendarPlanCard, type AppointmentArgs } from './appointment-card';
import {
  APPOINTMENT, CALENDAR_PLAN, BANK_ASSIGN, BANK_PLAN, DISPATCH, HERMES_APPROVAL, MAIL_LIST, RECON, SHOW, SMART_RULE, AUTOMATION, WATCH, type MailListArgs, type SmartRuleArgs, type AutomationArgs, type AutomationResult,
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
  smartAction: { label: 'Alert', icon: Zap },
  smartRule: { label: 'Reguła', icon: Zap },
  bankOp: { label: 'Operacja', icon: Landmark },
  automation: { label: 'Automat', icon: Bot },
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
    metadata: { custom: { context: m.context ?? [], files: m.files, notice: m.notice, status: m.status, ...(m.automation ? { automation: m.automation } : {}) } },
  };
}

// The panel's cards, as assistant-ui tool UIs: they win over its generic tool row for these names, and stand on their own
// (`standalone`) instead of folding into the group of tool calls.
const ReconUI = makeAssistantToolUI<ReconArgs, unknown>({ toolName: RECON, display: 'standalone', render: props => <CardBoundary><ReconCard {...props} /></CardBoundary> });
const DispatchUI = makeAssistantToolUI<DispatchArgs, DispatchResult>({ toolName: DISPATCH, display: 'standalone', render: props => <CardBoundary><DispatchCard {...props} /></CardBoundary> });
const WatchUI = makeAssistantToolUI<WatchArgs, unknown>({ toolName: WATCH, display: 'standalone', render: props => <CardBoundary><WatchCard {...props} /></CardBoundary> });
const BankPlanUI = makeAssistantToolUI<BankPlanArgs, unknown>({ toolName: BANK_PLAN, display: 'standalone', render: props => <CardBoundary><BankPlanCard {...props} /></CardBoundary> });
const BankAssignUI = makeAssistantToolUI<BankAssignArgs, unknown>({ toolName: BANK_ASSIGN, display: 'standalone', render: props => <CardBoundary><BankAssignCard {...props} /></CardBoundary> });
const AppointmentUI = makeAssistantToolUI<AppointmentArgs, unknown>({ toolName: APPOINTMENT, display: 'standalone', render: props => <CardBoundary><AppointmentCard {...props} /></CardBoundary> });
const CalendarPlanUI = makeAssistantToolUI<AppointmentArgs, unknown>({ toolName: CALENDAR_PLAN, display: 'standalone', render: props => <CardBoundary><CalendarPlanCard {...props} /></CardBoundary> });
const MailListUI = makeAssistantToolUI<MailListArgs, unknown>({ toolName: MAIL_LIST, display: 'standalone', render: props => <CardBoundary><MailListCard {...props} /></CardBoundary> });
const SmartRuleUI = makeAssistantToolUI<SmartRuleArgs, unknown>({ toolName: SMART_RULE, display: 'standalone', render: props => <CardBoundary><SmartRuleCard {...props} /></CardBoundary> });
const AutomationUI = makeAssistantToolUI<AutomationArgs, AutomationResult>({ toolName: AUTOMATION, display: 'standalone', render: props => <CardBoundary><AutomationCard {...props} /></CardBoundary> });
const ShowUI = makeAssistantToolUI<ShowArgs, unknown>({ toolName: SHOW, display: 'standalone', render: props => <CardBoundary><ShowCard {...props} /></CardBoundary> });
const ApprovalUI = makeAssistantToolUI<HermesApprovalArgs, unknown>({ toolName: HERMES_APPROVAL, display: 'standalone', render: props => <CardBoundary><HermesApprovalCard {...props} /></CardBoundary> });

type Custom = { context: ContextItem[]; files?: ChatFileRef[]; notice?: string; status: CockpitMessage['status']; automation?: ChatAutomation };
const useCustom = () => useAuiState(s => s.message.metadata.custom) as Custom;

/** A screenshot or file waiting in the composer: a thumbnail with „Usuń załącznik”, or a chip with its name, type and size. */
function DraftAttachments({ files, remove }: { files: DraftFile[]; remove: (key: string) => void }) {
  return <div className="tw:flex tw:flex-wrap tw:items-start tw:gap-2" aria-label="Załączniki do wysłania">
    {files.map(file => isChatImage(file.type)
      ? <div key={file.key} className="tw:relative">
        <img src={file.preview} alt={file.name} className="tw:block tw:h-24 tw:w-32 tw:rounded-xl tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:object-cover" />
        <button type="button" className="tw:absolute tw:-right-2 tw:-top-2 tw:grid tw:size-6 tw:place-items-center tw:rounded-full tw:border tw:border-ck-line-2 tw:bg-ck-surface tw:text-ck-text tw:hover:bg-ck-line" aria-label={`Usuń załącznik: ${file.name}`} onClick={() => remove(file.key)}><X size={12} aria-hidden="true" /></button>
      </div>
      : <div key={file.key} className="tw:flex tw:h-16 tw:max-w-[16rem] tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:pl-3 tw:pr-1">
        <FileText size={18} className="tw:shrink-0 tw:text-ck-agent" aria-hidden="true" />
        <div className="tw:min-w-0 tw:flex-1"><div className="tw:truncate tw:text-[13px] tw:text-ck-text" title={file.name}>{file.name}</div><div className="tw:text-[11px] tw:text-ck-muted">{fileLabel(file.type)} · {fileSize(file.size)}</div></div>
        <button type="button" className="tw:grid tw:size-8 tw:place-items-center tw:rounded-lg tw:text-ck-muted tw:hover:bg-ck-line tw:hover:text-ck-text" aria-label={`Usuń załącznik: ${file.name}`} onClick={() => remove(file.key)}><X size={14} aria-hidden="true" /></button>
      </div>)}
  </div>;
}

/** The attachments of a sent message, above its text: images open full size, files download. */
function SentAttachments({ files, chatId }: { files: ChatFileRef[]; chatId: string }) {
  return <div className="tw:flex tw:max-w-full tw:flex-wrap tw:justify-end tw:gap-2" aria-label="Załączniki wiadomości">
    {files.map(file => isChatImage(file.type)
      ? <a key={file.id} href={chatFileUrl(chatId, file.id)} target="_blank" rel="noreferrer" className="tw:block" title={file.name}>
        <img src={chatFileUrl(chatId, file.id)} alt={file.name} className="tw:block tw:max-h-52 tw:max-w-[18rem] tw:rounded-xl tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:object-cover" />
      </a>
      : <a key={file.id} href={chatFileUrl(chatId, file.id)} download={file.name} className="tw:flex tw:h-14 tw:max-w-[16rem] tw:items-center tw:gap-2 tw:rounded-xl tw:border tw:border-ck-line-2 tw:bg-ck-surface-2 tw:px-3 tw:text-ck-text tw:no-underline tw:hover:border-ck-agent/50">
        <FileText size={18} className="tw:shrink-0 tw:text-ck-agent" aria-hidden="true" />
        <span className="tw:min-w-0"><span className="tw:block tw:truncate tw:text-[13px]" title={file.name}>{file.name}</span><span className="tw:block tw:text-[11px] tw:text-ck-muted">{fileLabel(file.type)} · {fileSize(file.size)}</span></span>
      </a>)}
  </div>;
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

const COMMANDS = [
  { id: 'nowa', label: 'Nowa rozmowa', section: 'Rozmowa' },
  { id: 'tymczasowa', label: 'Rozmowa, która nie zostaje w historii', section: 'Rozmowa' },
  { id: 'archiwizuj', label: 'Przenieś tę rozmowę do archiwum', section: 'Rozmowa' },
  { id: 'koszt', label: 'Tokeny i koszt tej rozmowy', section: 'Rozmowa' },
  { id: 'zadanie', label: 'Załóż zadanie z ustaleń tej rozmowy', section: 'Zrób z tego' },
  { id: 'automat', label: 'Zaproponuj automat', section: 'Zrób z tego' },
  { id: 'notatka', label: 'Zapisz w notatkach', section: 'Zrób z tego', disabled: true },
];
interface ThreadProps {
  source: CockpitSource;
  context: ContextItem[];
  setContext: (fn: (list: ContextItem[]) => ContextItem[]) => void;
  picking: boolean;
  setPicking: (on: boolean) => void;
  empty: ReactNode;
  localMessage?(text: string): void;
  resetLocal?(): void;
  commandRef?: { current: ((id: string) => Promise<boolean>) | null };
}
interface AttachmentControls {
  /** Screenshots and files waiting in this conversation's composer. */
  files: DraftFile[];
  fileError: string;
  addFiles(list: FileList | File[]): void;
  removeFile(key: string): void;
}
interface Shared extends ThreadProps, AttachmentControls {
  commandMenu: ReactNode;
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
  const { source, matching, active, pick, commandMenu } = usePanel();
  const down = !source.hermes.up;
  return <>
    {source.temporary && <div className="wektor-temporary-banner"><div><b>Rozmowa tymczasowa</b><p>Nie trafi do historii; Wektor dostał polecenie, by nic z niej nie zapamiętywał. Zniknie po zamknięciu.</p></div><button type="button" className="wektor-text-button" onClick={source.keep}>Zachowaj rozmowę</button></div>}
    {commandMenu}
    {matching.length > 0 && <div role="listbox" id="wektor-skills" aria-label="Wybór skillów" className="wektor-skills">
      <div role="presentation" className="wektor-skills-heading"><span>Umiejętności Wektora</span><span>↑ ↓ wybierz · Enter dodaj · Esc zamknij</span></div>
      {matching.map((s, i) => <button key={s.id} type="button" role="option" aria-selected={i === active}
        id={`wektor-skill-${s.id}`} className="wektor-skill"
        onMouseDown={e => e.preventDefault()} onClick={() => pick(s)}>
        <span className="wektor-skill-icon"><Wrench size={16} aria-hidden="true" /></span>
        <span className="wektor-skill-label"><b>@{s.title}</b><small>{s.description}</small></span>
        {i === active && <kbd>↵</kbd>}
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

/** Inside the composer, above the field: the attachments and the picked elements. */
function ComposerTop() {
  const { context, setContext, files, removeFile, fileError } = usePanel();
  if (!context.length && !files.length && !fileError) return null;
  return <div className="tw:flex tw:flex-col tw:gap-2 tw:px-1">
    {files.length > 0 && <DraftAttachments files={files} remove={removeFile} />}
    {files.length > 0 && <p className="tw:m-0 tw:text-xs tw:text-muted-foreground">Limit: {MAX_CHAT_FILES} pliki, 5 MB na plik, {MAX_CHAT_TOTAL_BYTES / (1024 * 1024)} MB łącznie.</p>}
    {fileError && <p role="alert" className="tw:m-0 tw:rounded-lg tw:border tw:border-ck-red/40 tw:bg-ck-red/10 tw:px-2.5 tw:py-1.5 tw:text-[12px] tw:text-[#ffd3d4]">{fileError}</p>}
    {context.length > 0 && <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-1.5" aria-label="Wskazane elementy">
      {context.map(item => <Chip key={`${item.kind}:${item.id}`} item={item} remove={() => setContext(list => list.filter(x => !sameContext(x, item)))} />)}
    </div>}
  </div>;
}

/** Beside the send button: pointing at the dashboard, and the engine the chat runs on. */
function ComposerExtra() {
  const { source, picking, setPicking, addFiles } = usePanel();
  const running = useAuiState(s => s.thread.isRunning);
  const down = !source.hermes.up;
  const fileInput = useRef<HTMLInputElement>(null);
  return <>
    <input ref={fileInput} type="file" multiple hidden aria-hidden="true" tabIndex={-1} accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/markdown,text/csv,application/json" onChange={event => { if (event.target.files?.length) addFiles(event.target.files); event.target.value = ''; }} />
    <button type="button" className="tw:grid tw:size-9 tw:place-items-center tw:rounded-xl tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground" aria-label="Dodaj plik" title="Dodaj plik (albo wklej zrzut, albo upuść plik na czat). Limit: 4 pliki, 5 MB na plik, 6 MB łącznie." onClick={() => fileInput.current?.click()}><Paperclip size={17} aria-hidden="true" /></button>
    {picking
      ? <button type="button" className="tw:min-h-9 tw:rounded-xl tw:bg-ck-cal tw:px-4 tw:text-sm tw:font-semibold tw:text-ck-bg tw:hover:bg-[#9cc0ff]" onClick={() => setPicking(false)}>Gotowe</button>
      : <button type="button" className="tw:inline-flex tw:min-h-9 tw:items-center tw:gap-2 tw:rounded-xl tw:px-3 tw:text-sm tw:text-muted-foreground tw:hover:bg-accent tw:hover:text-foreground" onClick={() => setPicking(true)}><Crosshair size={16} aria-hidden="true" />Wskaż element</button>}
    <span className="tw:inline-flex tw:items-center tw:gap-1.5 tw:rounded-full tw:border tw:border-border tw:px-2.5 tw:py-1 tw:text-xs tw:text-muted-foreground" title="Czat działa na Hermesie">
      <i className={`tw:size-2 tw:rounded-full ${down ? 'tw:bg-ck-red' : running ? 'tw:bg-ck-agent tw:animate-ck-pulse' : 'tw:bg-ck-green'}`} aria-hidden="true" />Hermes
    </span>
  </>;
}

/** The small label of a turn the panel started itself: visibly not the user's message. */
export function AutomationLabel({ automation }: { automation: ChatAutomation }) {
  return <span title={automation.reason} className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded-full tw:border tw:border-ck-agent/40 tw:bg-ck-agent/10 tw:px-2 tw:py-0.5 tw:text-[11px] tw:font-semibold tw:text-ck-agent">
    {automationLabel(automation)}
  </span>;
}

function UserMessageHeader() {
  const { context, automation, files } = useCustom();
  const { source } = usePanel();
  if (!context?.length && !automation && !files?.length) return null;
  return <div className="tw:flex tw:max-w-full tw:flex-col tw:items-end tw:gap-2">
    {files?.length && source.activeId ? <SentAttachments files={files} chatId={source.activeId} /> : null}
    {(automation || context.length > 0) && <div className="tw:flex tw:max-w-full tw:flex-wrap tw:items-center tw:justify-end tw:gap-1.5">
      {automation && <AutomationLabel automation={automation} />}
      {context.map((item, i) => <Chip key={`${item.kind}:${item.id}:${i}`} item={item} />)}
    </div>}
  </div>;
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
function Conversation(props: ThreadProps & AttachmentControls) {
  const { source, context, setContext, picking, addFiles } = props;
  const aui = useAui();
  const draft = useAuiState(s => s.composer.text);
  const running = useAuiState(s => s.thread.isRunning);
  const [index, setIndex] = useState(0);
  const [arrowChoice, setArrowChoice] = useState(false);
  const [pendingCommand, setPendingCommand] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const initialDraft = useRef(getChatDraft(source.activeId).text);
  const hasRestored = useRef(false);

  useEffect(() => {
    if (initialDraft.current && !hasRestored.current) {
      hasRestored.current = true;
      aui.composer().setText(initialDraft.current);
    }
  }, [aui]);

  // A draft put in from outside (e.g. „Zapytaj Wektora o te runy”) while this conversation is already open.
  useEffect(() => {
    const apply = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string | null; text: string }>).detail;
      if (!detail || detail.id !== source.activeId) return;
      initialDraft.current = detail.text;
      hasRestored.current = true;
      aui.composer().setText(detail.text);
    };
    window.addEventListener(CHAT_DRAFT_EVENT, apply);
    return () => window.removeEventListener(CHAT_DRAFT_EVENT, apply);
  }, [aui, source.activeId]);

  useEffect(() => {
    if (initialDraft.current && draft === '') return;
    initialDraft.current = '';
    hasRestored.current = true;
    setChatDraftText(draft, source.activeId);
  }, [draft]);

  const slash = /^\/([^\n]*)$/.exec(draft);
  const commands = slash && dismissed !== draft ? COMMANDS.filter(c => c.id.startsWith(fold(slash[1]))) : [];
  const disabledCommand = (c: typeof COMMANDS[number]) => !!c.disabled || ['archiwizuj', 'zadanie', 'automat'].includes(c.id) && (!source.activeId || !!source.temporary);
  const choices = commands.filter(c => !disabledCommand(c));
  const commandActive = choices.length ? Math.min(index, choices.length - 1) : 0;
  const command = async (id: string, confirmed = false) => {
    const entry = COMMANDS.find(c => c.id === id);
    if (!entry || disabledCommand(entry)) return;
    if (!confirmed && source.temporary && ['nowa', 'tymczasowa'].includes(id)) { setPendingCommand(id); return; }
    setPendingCommand(null); setArrowChoice(false);
    aui.composer().setText(''); setChatDraftText('', source.activeId); setDismissed(null); setIndex(0);
    if (id === 'nowa') { setContext(() => []); props.resetLocal?.(); source.open(null); return; }
    if (id === 'tymczasowa') { setContext(() => []); props.resetLocal?.(); source.startTemporary?.(); return; }
    if (id === 'archiwizuj') { if (source.activeId) source.archive?.(source.activeId, true); return; }
    if (id === 'koszt') {
      try { props.localMessage?.(await source.cost?.() ?? 'Brak danych o tokenach i koszcie tej rozmowy.'); }
      catch { props.localMessage?.('Nie udało się odczytać danych o koszcie tej rozmowy.'); }
      return;
    }
    const text = id === 'zadanie' ? 'Załóż zadanie z ustaleń tej rozmowy na liście zadań panelu. Uwzględnij uzgodniony cel i szczegóły.' : 'Zaproponuj automat z ustaleń tej rozmowy. Pokaż kartę zgody z celem, harmonogramem i parametrami akcji.';
    aui.composer().setText(text); setChatDraftText(text, source.activeId);
    if (!running && !source.refreshing && !source.loading && source.hermes.up) queueMicrotask(() => aui.composer().send());
  };
  if (props.commandRef) props.commandRef.current = async text => {
    if (dismissed?.trim() === text) return false;
    const entry = COMMANDS.find(c => text === `/${c.id}`);
    if (!entry) return false;
    if (disabledCommand(entry)) { aui.composer().setText(text); return true; }
    await command(entry.id); return true;
  };
  let commandSection = '';
  const commandMenu = commands.length > 0 ? <div className="wektor-skills wektor-commands" role="listbox" id="wektor-commands" aria-label="Komendy rozmowy">
    {commands.map(c => {
      const heading = commandSection !== c.section; commandSection = c.section;
      const disabled = disabledCommand(c);
      return <div role="presentation" key={c.id}>{heading && <div role="presentation" className="wektor-skills-heading">{c.section}</div>}<button type="button" role="option" id={`wektor-command-${c.id}`} aria-selected={(arrowChoice || draft === `/${c.id}`) && choices[commandActive]?.id === c.id} aria-disabled={disabled || undefined} disabled={disabled} className="wektor-skill" onMouseDown={e => e.preventDefault()} onClick={() => void command(c.id)}><code>/{c.id}</code><span>{c.label}</span>{c.disabled && <small>później</small>}</button></div>;
    })}<div role="presentation" className="wektor-skills-heading">Skille pod @ · ↑↓ wybór · Enter · Esc</div>
  </div> : null;
  useEffect(() => { document.getElementById(`wektor-command-${choices[commandActive]?.id}`)?.scrollIntoView?.({ block: 'nearest' }); }, [commandActive, choices[commandActive]?.id]);
  const at = detectAtSkill(draft);
  const matching = at && dismissed !== at.token ? CHAT_SKILLS.filter(s => !at.query || fold(s.title).includes(fold(at.query)) || s.id.includes(fold(at.query))) : [];
  const active = matching.length ? Math.min(index, matching.length - 1) : 0;
  useEffect(() => { if (matching[active]) document.getElementById(`wektor-skill-${matching[active].id}`)?.scrollIntoView?.({ block: 'nearest' }); }, [active, matching[active]?.id]);
  const skill = context.find(c => c.kind === 'skill');
  const down = !source.hermes.up;

  const pick = (s: ChatSkill) => {
    const item = skillItem(s);
    setContext(list => list.some(x => sameContext(x, item)) ? list : list.length < MAX_CONTEXT ? [...list, item] : list);
    if (at) {
      const before = draft.slice(0, at.start).replace(/\s+$/, '');
      const nextText = before ? `${before} ` : '';
      aui.composer().setText(nextText);
      setChatDraftText(nextText, source.activeId);
    }
    setDismissed(null);
    setIndex(0);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commands.length) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setDismissed(draft); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => choices.length ? (arrowChoice ? i + (e.key === 'ArrowDown' ? 1 : -1) + choices.length : e.key === 'ArrowDown' ? 0 : choices.length - 1) % choices.length : 0); setArrowChoice(true); return; }
      if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); const chosen = arrowChoice ? choices[commandActive] : choices.find(c => draft === `/${c.id}`); if (chosen) void command(chosen.id); return; }
    }
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
      onPaste: event => {
        const pasted = event.clipboardData?.files;
        if (pasted?.length) { event.preventDefault(); addFiles(pasted); }
      },
      onChange: (e) => {
        hasRestored.current = true;
        setDismissed(null); setArrowChoice(false); setPendingCommand(null);
        setIndex(0);
        initialDraft.current = '';
        setChatDraftText((e.target as HTMLTextAreaElement).value, source.activeId);
      },
      role: 'combobox',
      'aria-autocomplete': 'list',
      'aria-haspopup': 'listbox',
      'aria-label': 'Wiadomość do agenta',
      'aria-controls': commands.length ? 'wektor-commands' : matching.length ? 'wektor-skills' : undefined,
      'aria-expanded': matching.length > 0 || commands.length > 0,
      'aria-activedescendant': commands.length && arrowChoice && choices[commandActive] ? `wektor-command-${choices[commandActive].id}` : matching[active] ? `wektor-skill-${matching[active].id}` : undefined,
      placeholder: picking ? 'Co z tym zrobić?' : 'Napisz do Wektora…',
    },
  };
  return <Panel.Provider value={{ ...props, matching, active, pick, commandMenu: <>{pendingCommand && <div role="alert" className="wektor-temporary-banner"><p>Opuścić rozmowę tymczasową? Jej treść zostanie usunięta.</p><button type="button" onClick={() => void command(pendingCommand, true)}>Opuść rozmowę tymczasową</button><button type="button" onClick={() => setPendingCommand(null)}>Anuluj</button></div>}{commandMenu}</> }}>
    <AuiThread components={components} />
  </Panel.Provider>;
}

/**
 * The left column: the conversation (assistant-ui over the cockpit's source). The source keeps the messages;
 * assistant-ui renders them and reports what the user sends or stops.
 */
export function Thread(props: ThreadProps) {
  const { source, setContext } = props;
  const [localMessages, setLocalMessages] = useState<CockpitMessage[]>([]);
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [fileError, setFileError] = useState('');
  const filesRef = useRef(files);
  filesRef.current = files;
  useEffect(() => { setFiles([]); setFileError(''); }, [source.activeId]);
  const addFiles = useCallback((incoming: FileList | File[]) => {
    const list = Array.from(incoming);
    if (!list.length) return;
    void (async () => {
      let problem = '';
      for (const file of list) {
        const type = mimeOf(file);
        if (!type) { problem ||= unsupportedType(file.name); continue; }
        if (type === 'application/pdf') { problem ||= UNSUPPORTED_PDF; continue; }
        const check = () => attachmentProblem(file.name, file.size, filesRef.current.length, filesRef.current.reduce((sum, f) => sum + f.size, 0));
        const bad = check();
        if (bad) { problem ||= bad; continue; }
        try {
          const draft = await readDraft(file, type);
          const changed = check(); // Another paste/drop may have completed while FileReader was working.
          if (changed) { problem ||= changed; continue; }
          filesRef.current = [...filesRef.current, draft];
          setFiles(filesRef.current);
        }
        catch { problem ||= `Nie udało się odczytać pliku ${file.name}.`; }
      }
      setFileError(problem);
    })();
  }, []);
  const removeFile = useCallback((key: string) => { setFiles(list => list.filter(file => file.key !== key)); setFileError(''); }, []);
  const commandRef = useRef<((id: string) => Promise<boolean>) | null>(null);
  const contextRef = useRef(props.context);
  contextRef.current = props.context;
  const runtimeRef = useRef<ReturnType<typeof useExternalStoreRuntime> | null>(null);
  const onNew = async (message: AppendMessage) => {
    const text = message.content.map(p => p.type === 'text' ? p.text : '').join('').trim();
    if (!text) return;
    if (await commandRef.current?.(text)) return;
    const uploads: ChatFileUpload[] = filesRef.current.map(file => ({ name: file.name, type: file.type, size: file.size, data: file.data }));
    // On failure the draft, the picked elements and the attachments stay, so nothing is lost while Hermes is down.
    if (await source.send(text, contextRef.current, uploads.length ? uploads : undefined)) {
      setContext(() => []);
      clearChatDraft(source.activeId);
      setFiles([]); setFileError('');
    } else {
      runtimeRef.current?.thread.composer.setText(text);
      setChatDraftText(text, source.activeId);
    }
  };
  const onDragOver = (event: DragEvent<HTMLDivElement>) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { if (event.dataTransfer.files.length) { event.preventDefault(); addFiles(event.dataTransfer.files); } };
  const runtime = useExternalStoreRuntime<CockpitMessage>({
    messages: [...source.messages, ...localMessages].sort((a, b) => a.at - b.at),
    convertMessage: toThreadMessage,
    isRunning: source.running,
    isDisabled: source.unavailable,
    isSendDisabled: !source.hermes.up || source.loading || source.refreshing,
    onNew,
    onCancel: async () => source.stop(),
  });
  runtimeRef.current = runtime;
  const actions = useMemo(() => ({ respond: source.respond, running: source.running || !!source.refreshing, refreshing: source.refreshing, watched: source.cockpit.task, chatId: source.activeId }), [source.respond, source.running, source.refreshing, source.cockpit.task, source.activeId]);

  return <AssistantRuntimeProvider runtime={runtime}>
    <TooltipProvider>
      <CardActions.Provider value={actions}>
        <ReconUI /><DispatchUI /><WatchUI /><ShowUI /><BankPlanUI /><BankAssignUI /><AppointmentUI /><CalendarPlanUI /><MailListUI /><SmartRuleUI /><AutomationUI /><ApprovalUI />
        <div className="tw:relative tw:min-h-0 tw:flex-1" onDragOver={onDragOver} onDrop={onDrop}>
          <Conversation {...props} files={files} fileError={fileError} addFiles={addFiles} removeFile={removeFile} commandRef={commandRef} resetLocal={() => setLocalMessages([])} localMessage={text => setLocalMessages(list => [...list, { id: crypto.randomUUID(), role: 'assistant', at: Date.now(), status: 'done', parts: [{ type: 'text', text }] }])} />
        </div>
      </CardActions.Provider>
    </TooltipProvider>
  </AssistantRuntimeProvider>;
}
