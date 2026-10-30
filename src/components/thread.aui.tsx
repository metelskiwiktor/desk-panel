"use client";
// assistant-ui's Thread (shadcn registry `thread`), adapted for Desk Panel: Polish labels, no attachments, edits, reloads
// or branches (the panel's runtime has none of them), and slots for what the panel adds (skills, picked elements,
// the "Hermes nie odpowiada" card, notices). Updating from the registry means merging these changes again.

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/attachment.aui";
import { File, getFileHref } from "@/components/file";
import { ThreadFollowupSuggestions } from "@/components/follow-up-suggestions.aui";
import { Image } from "@/components/image";
import { MarkdownText } from "@/components/markdown-text";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/reasoning.aui";
import { ToolFallback } from "@/components/tool-fallback.aui";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/tool-group.aui";
import { TooltipIconButton } from "@/components/tooltip-icon-button";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  SuggestionPrimitive,
  ThreadPrimitive,
  type FileMessagePartComponent,
  type ImageMessagePartComponent,
  type TextMessagePartComponent,
  type ToolCallMessagePartComponent,
  useAuiState,
} from "@assistant-ui/react";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  AudioLinesIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  RefreshCwIcon,
  SquareIcon,
  PlayIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentType,
  type FC,
  type PropsWithChildren,
  type ComponentProps,
} from "react";

export type ThreadGroupPart = MessagePrimitive.GroupedParts.GroupPart;

const shouldShowComposerResume = (s: AssistantState) =>
  !!s.thread.canResume && s.composer.type === "thread" && s.composer.isEmpty;

const reasoningDuration = (timing: ThreadGroupPart["timing"]) =>
  timing?.completedAt === undefined
    ? undefined
    : Math.round((timing.completedAt - timing.startedAt) / 1000);

/**
 * Optional component overrides for the thread. `AssistantMessage` and
 * `Welcome` replace whole sections; the remaining slots override how the
 * assistant message renders tool calls and part groups. Tool UIs registered
 * by name (toolkit `render`, `useAssistantDataUI`) take precedence over
 * `ToolFallback`. When `TaskGroup` is set, tool calls that carry a nested
 * conversation and have no registered UI render through it instead of the
 * tool group; without it they render like any other tool call.
 * `ComposerExtra` renders in the composer's action row beside the attach
 * button.
 */
export type ThreadComponents = {
  AssistantMessage?: ComponentType | undefined;
  Welcome?: ComponentType | undefined;
  ToolFallback?: ToolCallMessagePartComponent | undefined;
  ToolGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  ReasoningGroup?:
    | ComponentType<PropsWithChildren<{ group: ThreadGroupPart }>>
    | undefined;
  TaskGroup?: ComponentType<{ group: ThreadGroupPart }> | undefined;
  ComposerExtra?: ComponentType | undefined;
  /** Desk Panel: above the composer's field (a popover anchored to it, cards about sending). */
  ComposerHeader?: ComponentType | undefined;
  /** Desk Panel: inside the composer, above the field (picked elements as chips). */
  ComposerTop?: ComponentType | undefined;
  /** Desk Panel: the field's label, placeholder and keys. */
  composerInput?: Partial<ComponentProps<typeof ComposerPrimitive.Input>> | undefined;
  /** Desk Panel: above a user message (the elements it was about). */
  UserMessageHeader?: ComponentType | undefined;
  /** Desk Panel: under an assistant message (what the panel is doing about the run, a stopped answer). */
  AssistantMessageFooter?: ComponentType | undefined;
};

const messageGroupBy = groupPartByType({
  reasoning: ["group-chainOfThought", "group-reasoning"],
  "tool-call": ["group-chainOfThought", "group-tool"],
  "standalone-tool-call": [],
});

type ThreadGroupKey =
  | "group-chainOfThought"
  | "group-reasoning"
  | "group-tool"
  | "group-task";

const TASK_GROUP_PATH: readonly ThreadGroupKey[] = [
  "group-chainOfThought",
  "group-task",
];

const taskAwareGroupBy = (
  part: Parameters<typeof messageGroupBy>[0],
  context?: Parameters<typeof messageGroupBy>[1],
): readonly ThreadGroupKey[] => {
  const path = messageGroupBy(part, context);
  return part.type === "tool-call" &&
    part.messages !== undefined &&
    path.length > 0 &&
    !context?.toolUIs?.[part.toolName]?.length
    ? TASK_GROUP_PATH
    : path;
};

export type ThreadProps = {
  components?: ThreadComponents | undefined;
  autoFocus?: boolean | undefined;
};

const EMPTY_COMPONENTS: ThreadComponents = {};

const ThreadComponentsContext =
  createContext<ThreadComponents>(EMPTY_COMPONENTS);

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

// A switched thread that is still fetching its history: skeleton, not welcome.
const isHistoryLoadingView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  s.thread.isLoading &&
  !s.thread.isDisabled &&
  !s.threads.isLoading;

const ThreadHistorySkeleton: FC = () => (
  <div
    data-slot="aui_thread-history-skeleton"
    role="status"
    className="tw:animate-in tw:fade-in tw:fill-mode-both tw:flex tw:flex-col tw:gap-y-6 tw:[animation-delay:150ms] tw:[animation-duration:200ms]"
  >
    <span className="tw:sr-only">Wczytuję rozmowę</span>
    <Skeleton className="tw:ml-auto tw:h-9 tw:w-2/5 tw:rounded-xl tw:motion-reduce:animate-none" />
    <div className="tw:flex tw:flex-col tw:gap-y-2">
      <Skeleton className="tw:h-4 tw:w-11/12 tw:motion-reduce:animate-none" />
      <Skeleton className="tw:h-4 tw:w-4/5 tw:motion-reduce:animate-none" />
      <Skeleton className="tw:h-4 tw:w-3/5 tw:motion-reduce:animate-none" />
    </div>
    <Skeleton className="tw:ml-auto tw:h-9 tw:w-1/3 tw:rounded-xl tw:motion-reduce:animate-none" />
    <div className="tw:flex tw:flex-col tw:gap-y-2">
      <Skeleton className="tw:h-4 tw:w-10/12 tw:motion-reduce:animate-none" />
      <Skeleton className="tw:h-4 tw:w-2/3 tw:motion-reduce:animate-none" />
    </div>
  </div>
);

export const Thread: FC<ThreadProps> = ({
  components = EMPTY_COMPONENTS,
  autoFocus = true,
}) => {
  const isEmpty = useAuiState(isNewChatView);

  return (
    <ThreadComponentsContext.Provider value={components}>
      <ThreadRoot isEmpty={isEmpty} autoFocus={autoFocus} />
    </ThreadComponentsContext.Provider>
  );
};

const ThreadRoot: FC<{ isEmpty: boolean; autoFocus: boolean }> = ({
  isEmpty,
  autoFocus,
}) => {
  const { Welcome = ThreadWelcome } = useContext(ThreadComponentsContext);

  return (
    <ThreadPrimitive.Root
      className="tw:aui-root tw:aui-thread-root tw:bg-background tw:@container tw:flex tw:h-full tw:flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, transparent)",
        ["--composer-radius" as string]: "1rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        role="log"
        aria-live="polite"
        aria-label="Rozmowa"
        className="tw:relative tw:flex tw:flex-1 tw:flex-col tw:overflow-x-auto tw:overflow-y-scroll tw:scroll-smooth"
      >
        <div
          className={cn(
            "tw:mx-auto tw:flex tw:w-full tw:max-w-(--thread-max-width) tw:flex-1 tw:flex-col tw:px-4 tw:pt-4",
            isEmpty && "tw:justify-center",
          )}
        >
          <AuiIf condition={isNewChatView}>
            <Welcome />
          </AuiIf>
          <AuiIf condition={isHistoryLoadingView}>
            <ThreadHistorySkeleton />
          </AuiIf>

          <ThreadLoadEarlier />

          <div
            data-slot="aui_message-group"
            className="tw:mb-14 tw:flex tw:flex-col tw:gap-y-6 tw:empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {() => <ThreadMessage />}
            </ThreadPrimitive.Messages>
          </div>

          <ThreadPrimitive.ViewportFooter
            className={cn(
              "tw:aui-thread-viewport-footer tw:bg-background tw:flex tw:flex-col tw:gap-4 tw:overflow-visible tw:pb-4 tw:md:pb-6",
              !isEmpty &&
                "tw:sticky tw:bottom-0 tw:mt-auto tw:rounded-t-(--composer-radius)",
            )}
          >
            <ThreadScrollToBottom />
            <ThreadFollowupSuggestions />
            <Composer autoFocus={autoFocus} />
            <AuiIf condition={(s) => isNewChatView(s) && s.composer.isEmpty}>
              <ThreadSuggestions />
            </AuiIf>
          </ThreadPrimitive.ViewportFooter>
        </div>
      </ThreadPrimitive.Viewport>
    </ThreadPrimitive.Root>
  );
};

const ThreadMessage: FC = () => {
  const { AssistantMessage: AssistantMessageComponent = AssistantMessage } =
    useContext(ThreadComponentsContext);
  const role = useAuiState((s) => s.message.role);
  const isEditing = useAuiState((s) => s.message.composer.isEditing);
  const isSpoken = useAuiState((s) => s.message.metadata.modality === "voice");

  if (isEditing) return <EditComposer />;
  if (isSpoken) return <SpokenMessage />;
  if (role === "user") return <UserMessage />;
  return <AssistantMessageComponent />;
};

type VoiceRunPosition = "single" | "start" | "middle" | "end";

const useVoiceRunPosition = (): VoiceRunPosition =>
  useAuiState((s) => {
    const before =
      s.thread.messages[s.message.index - 1]?.metadata.modality === "voice";
    const after =
      s.thread.messages[s.message.index + 1]?.metadata.modality === "voice";
    if (before) return after ? "middle" : "end";
    return after ? "start" : "single";
  });

const SpokenText: TextMessagePartComponent = ({ text }) => (
  <p className="tw:aui-spoken-message-text tw:m-0">{text}</p>
);

const SpokenMessage: FC = () => {
  const role = useAuiState((s) => s.message.role);
  const position = useVoiceRunPosition();
  const isSpeaking = useAuiState(
    (s) =>
      s.message.role === "assistant" && s.message.status?.type === "running",
  );
  const opensExchange = position === "start" || position === "single";

  return (
    <MessagePrimitive.Root
      data-slot="aui_spoken-message-root"
      data-role={role}
      data-voice-run={position}
      className={cn(
        "tw:aui-spoken-message tw:bg-muted/40 tw:mx-2 tw:px-3 tw:py-1.5 tw:[contain-intrinsic-size:auto_48px] tw:[content-visibility:auto]",
        position === "single" && "tw:rounded-xl tw:py-2",
        position === "start" && "tw:rounded-t-xl tw:pt-2",
        position === "middle" && "tw:-mt-6",
        position === "end" && "tw:-mt-6 tw:rounded-b-xl tw:pb-2",
      )}
    >
      {opensExchange && (
        <div
          data-slot="aui_spoken-exchange-header"
          className="tw:text-muted-foreground tw:mb-1.5 tw:flex tw:items-center tw:gap-1.5 tw:text-xs"
        >
          <PhoneIcon className="tw:size-3" aria-hidden />
          <span>Voice conversation</span>
        </div>
      )}
      <div
        data-slot="aui_spoken-message-content"
        className="tw:text-foreground tw:flex tw:items-start tw:gap-2 tw:text-sm tw:leading-relaxed"
      >
        <span className="tw:text-muted-foreground tw:mt-1 tw:shrink-0" aria-hidden>
          {role === "user" ? (
            <MicIcon className="tw:size-3.5" />
          ) : (
            <AudioLinesIcon className="tw:size-3.5" />
          )}
        </span>
        <span className="tw:sr-only">
          {role === "user" ? "You said" : "Assistant said"}
        </span>
        <div className="tw:min-w-0 tw:flex-1 tw:wrap-break-word">
          <MessagePrimitive.Parts components={{ Text: SpokenText }} />
          {isSpeaking && (
            <span
              data-slot="aui_spoken-message-indicator"
              role="status"
              className="tw:text-muted-foreground tw:ms-1 tw:animate-pulse tw:font-sans"
              aria-label="Assistant is speaking"
            >
              ●
            </span>
          )}
        </div>
        <SpokenActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const SpokenActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="always"
      className="tw:aui-spoken-action-bar tw:text-muted-foreground tw:flex tw:shrink-0 tw:gap-1"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="tw:size-6">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="tw:animate-in tw:zoom-in-50 tw:fade-in tw:duration-200 tw:ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="tw:animate-in tw:zoom-in-75 tw:fade-in tw:duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const FOCUSABLE_SELECTOR =
  "a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1']):not([disabled])";

const nextFocusable = (start: Element) => {
  for (
    let element = start.nextElementSibling;
    element;
    element = element.nextElementSibling
  ) {
    const target = element.matches(FOCUSABLE_SELECTOR)
      ? element
      : element.querySelector(FOCUSABLE_SELECTOR);
    if (target instanceof HTMLElement) return target;
  }
  return null;
};

const ThreadLoadEarlier: FC = () => {
  const visible = useAuiState(
    (s) => s.thread.hasEarlier || s.thread.isLoadingEarlier,
  );
  const loading = useAuiState((s) => s.thread.isLoadingEarlier);
  const slotRef = useRef<HTMLDivElement>(null);
  const focusedRef = useRef<Element | null>(null);

  // The last page removes the button; a keyboard user on it continues from the
  // next control in tab order rather than from the document body.
  useLayoutEffect(() => {
    const focused = focusedRef.current;
    const slot = slotRef.current;
    if (visible || !focused || focused.isConnected || !slot) return;
    focusedRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    nextFocusable(slot)?.focus();
  }, [visible]);

  return (
    <div
      ref={slotRef}
      className="tw:contents"
      onFocus={(event) => {
        focusedRef.current = event.target;
      }}
    >
      <span role="status" className="tw:sr-only">
        {loading ? "Loading earlier messages" : ""}
      </span>
      {visible && (
        <ThreadPrimitive.LoadEarlier asChild>
          <Button
            variant="ghost"
            size="sm"
            data-slot="aui_thread-load-earlier"
            className="tw:aui-thread-load-earlier tw:text-muted-foreground tw:mb-6 tw:self-center tw:rounded-full"
          >
            <span
              className={cn(loading && "tw:shimmer tw:motion-reduce:animate-none")}
            >
              {loading ? "Loading earlier messages" : "Load earlier messages"}
            </span>
          </Button>
        </ThreadPrimitive.LoadEarlier>
      )}
    </div>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Na dół rozmowy"
        variant="outline"
        className="tw:aui-thread-scroll-to-bottom tw:dark:border-border tw:dark:bg-background tw:dark:hover:bg-accent tw:absolute tw:-top-12 tw:z-10 tw:self-center tw:rounded-full tw:p-4 tw:disabled:invisible"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="tw:aui-thread-welcome-root tw:mb-6 tw:flex tw:flex-col tw:px-2">
      <p className="tw:aui-thread-welcome-message-inner tw:fade-in tw:slide-in-from-bottom-1 tw:animate-in tw:fill-mode-both tw:text-2xl tw:font-medium tw:tracking-tight tw:duration-200">
        How can I help you today?
      </p>
    </div>
  );
};

const ThreadSuggestions: FC = () => {
  return (
    <div className="tw:aui-thread-welcome-suggestions tw:flex tw:w-full tw:flex-col tw:empty:hidden">
      <ThreadPrimitive.Suggestions>
        {() => <ThreadSuggestionItem />}
      </ThreadPrimitive.Suggestions>
    </div>
  );
};

const ThreadSuggestionItem: FC = () => {
  return (
    <div className="tw:aui-thread-welcome-suggestion-display tw:fade-in tw:slide-in-from-bottom-2 tw:animate-in tw:fill-mode-both tw:duration-200">
      <SuggestionPrimitive.Trigger send asChild>
        <button
          type="button"
          className="tw:aui-thread-welcome-suggestion tw:group tw:hover:bg-foreground/[0.03] tw:focus-visible:ring-ring/50 tw:flex tw:w-full tw:items-baseline tw:gap-2.5 tw:rounded-md tw:px-2 tw:py-2 tw:text-start tw:text-sm tw:transition-colors tw:outline-none tw:focus-visible:ring-1 tw:motion-reduce:transition-none"
        >
          <span
            aria-hidden
            className="tw:text-muted-foreground/60 tw:group-hover:text-foreground tw:font-mono tw:text-xs tw:transition-colors tw:motion-reduce:transition-none"
          >
            {">"}
          </span>
          <span className="tw:min-w-0 tw:flex-1 tw:truncate">
            <SuggestionPrimitive.Title className="tw:aui-thread-welcome-suggestion-text-1 tw:text-foreground" />{" "}
            <SuggestionPrimitive.Description className="tw:aui-thread-welcome-suggestion-text-2 tw:text-muted-foreground tw:empty:hidden" />
          </span>
        </button>
      </SuggestionPrimitive.Trigger>
    </div>
  );
};

const Composer: FC<{ autoFocus: boolean }> = ({ autoFocus }) => {
  const { ComposerHeader, ComposerTop, composerInput } = useContext(ThreadComponentsContext);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [, resizeInput] = useState(0);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || typeof ResizeObserver === 'undefined') return;
    let previousWidth = 0;
    // TextareaAutosize remeasures on render/window resize. Our animated shell and resizable history also change its
    // width without a window resize; re-render only on width changes so a stale height cannot survive until typing.
    const observer = new ResizeObserver(([entry]) => {
      const width = entry.contentRect.width;
      if (width > 0 && width !== previousWidth) { previousWidth = width; resizeInput(value => value + 1); }
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, []);
  return (
    <ComposerPrimitive.Root className="tw:aui-composer-root tw:relative tw:flex tw:w-full tw:flex-col">
      {ComposerHeader && <ComposerHeader />}
      <div
        data-slot="aui_composer-shell"
        className="tw:border-foreground/10 tw:focus-within:border-foreground/25 tw:flex tw:w-full tw:cursor-text tw:flex-col tw:gap-2 tw:rounded-(--composer-radius) tw:border tw:bg-(--composer-bg) tw:p-(--composer-padding) tw:transition-[border-color]"
      >
        {ComposerTop && <ComposerTop />}
        <ComposerPrimitive.Input
          ref={inputRef}
          placeholder="Napisz wiadomość…"
          className="tw:aui-composer-input tw:caret-primary tw:placeholder:text-muted-foreground/60 tw:max-h-48 tw:min-h-10 tw:w-full tw:resize-none tw:bg-transparent tw:px-2.5 tw:py-1 tw:text-base tw:leading-6 tw:outline-none"
          rows={1}
          autoFocus={autoFocus}
          enterKeyHint="send"
          aria-label="Wiadomość"
          {...composerInput}
        />
        <ComposerAction />
      </div>
    </ComposerPrimitive.Root>
  );
};

const ComposerAction: FC = () => {
  const { ComposerExtra } = useContext(ThreadComponentsContext);
  // The stop control only cancels the send while no run it could stop is going.
  const isSending = useAuiState(
    (s) =>
      s.composer.submission !== undefined &&
      !(s.thread.isRunning && s.thread.capabilities.cancel),
  );

  return (
    <div className="tw:aui-composer-action-wrapper tw:relative tw:flex tw:items-center tw:justify-between">
      <div className="tw:aui-composer-action-start tw:flex tw:items-center tw:gap-1.5">
        {ComposerExtra && <ComposerExtra />}
      </div>
      <div className="tw:flex tw:items-center tw:gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="tw:aui-composer-dictate tw:text-muted-foreground tw:hover:text-foreground tw:size-7 tw:rounded-full"
                aria-label="Start voice input"
              >
                <MicIcon className="tw:aui-composer-dictate-icon tw:size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="tw:aui-composer-stop-dictation tw:text-destructive tw:size-7 tw:rounded-full"
                aria-label="Stop voice input"
              >
                <SquareIcon className="tw:aui-composer-stop-dictation-icon tw:size-3.5 tw:animate-pulse tw:fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        <AuiIf
          condition={(s) =>
            (!s.composer.canCancel ||
              (s.thread.voice !== undefined &&
                s.composer.submission === undefined)) &&
            !shouldShowComposerResume(s)
          }
        >
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Wyślij"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="tw:aui-composer-send tw:size-9 tw:rounded-full"
              aria-label="Wyślij"
            >
              <ArrowUpIcon className="tw:aui-composer-send-icon tw:size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={shouldShowComposerResume}>
          <ComposerPrimitive.Resume asChild>
            <TooltipIconButton
              tooltip="Wznów odpowiedź"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
              className="tw:aui-composer-resume tw:size-7 tw:rounded-full"
              aria-label="Wznów odpowiedź"
            >
              <PlayIcon className="tw:aui-composer-resume-icon tw:size-4" />
            </TooltipIconButton>
          </ComposerPrimitive.Resume>
        </AuiIf>
        <AuiIf
          condition={(s) =>
            s.composer.canCancel &&
            (s.thread.voice === undefined ||
              s.composer.submission !== undefined)
          }
        >
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="tw:aui-composer-cancel tw:size-9 tw:rounded-full"
              aria-label={isSending ? "Anuluj wysyłanie" : "Zatrzymaj odpowiedź"}
            >
              <SquareIcon className="tw:aui-composer-cancel-icon tw:size-3.5 tw:fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        </AuiIf>
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="tw:aui-message-error-root tw:border-destructive tw:bg-destructive/10 tw:text-destructive tw:dark:bg-destructive/5 tw:mt-2 tw:rounded-md tw:border tw:p-3 tw:text-sm tw:dark:text-red-200">
        <ErrorPrimitive.Message className="tw:aui-message-error-message tw:line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  const {
    ToolFallback: ToolFallbackComponent = ToolFallback,
    ToolGroup,
    ReasoningGroup,
    TaskGroup: TaskGroupComponent,
    AssistantMessageFooter,
  } = useContext(ThreadComponentsContext);
  const groupBy = TaskGroupComponent ? taskAwareGroupBy : messageGroupBy;

  // Always reserve the action row; copying or moving the pointer must never move the next message.
  const ACTION_BAR_HEIGHT = "tw:min-h-8 tw:pt-0.5";

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="tw:relative"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="tw:text-foreground tw:px-2 tw:leading-relaxed tw:wrap-break-word"
      >
        <MessagePrimitive.GroupedParts groupBy={groupBy}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-task":
                return TaskGroupComponent ? (
                  <TaskGroupComponent group={part} />
                ) : null;
              case "group-tool":
                if (ToolGroup) {
                  return <ToolGroup group={part}>{children}</ToolGroup>;
                }
                return (
                  <ToolGroupRoot variant="ghost">
                    <ToolGroupTrigger
                      count={part.indices.length}
                      active={part.status.type === "running"}
                    />
                    <ToolGroupContent>{children}</ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "group-reasoning": {
                if (ReasoningGroup) {
                  return (
                    <ReasoningGroup group={part}>{children}</ReasoningGroup>
                  );
                }
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger
                      active={running}
                      duration={reasoningDuration(part.timing)}
                    />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text":
                return <MarkdownText />;
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return part.toolUI ?? <ToolFallbackComponent {...part} />;
              case "data":
                return part.dataRendererUI;
              case "file":
                return (
                  <div data-slot="aui_assistant-message-file" className="tw:py-1">
                    <MessageFile {...part} />
                  </div>
                );
              case "image":
                return (
                  <div data-slot="aui_assistant-message-image" className="tw:py-1">
                    <Image {...part} />
                  </div>
                );
              case "indicator":
                return (
                  <span
                    data-slot="aui_assistant-message-indicator"
                    className="tw:animate-pulse tw:font-sans"
                    aria-label="Wektor pracuje"
                  >
                    {"●"}
                  </span>
                );
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <MessageError />
        {AssistantMessageFooter && <AssistantMessageFooter />}
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("tw:ms-2 tw:flex tw:items-center", ACTION_BAR_HEIGHT)}
      >
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="never"
      className="tw:aui-assistant-action-bar-root tw:text-muted-foreground tw:animate-in tw:fade-in tw:col-start-3 tw:row-start-2 tw:-ms-1 tw:flex tw:gap-1 tw:duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Kopiuj">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="tw:animate-in tw:zoom-in-50 tw:fade-in tw:duration-200 tw:ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="tw:animate-in tw:zoom-in-75 tw:fade-in tw:duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
    </ActionBarPrimitive.Root>
  );
};

const MessageFile: FileMessagePartComponent = (part) => {
  const image = part.mimeType.toLowerCase().startsWith("image/")
    ? getFileHref(part.data, part.mimeType, part.sourceType)
    : null;
  if (!image) return <File {...part} />;
  return (
    <Image
      type="image"
      image={image}
      status={part.status}
      {...(part.filename !== undefined && { filename: part.filename })}
    />
  );
};

const UserFilePart: FileMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-file" className="tw:py-1">
    <MessageFile {...part} />
  </div>
);

const UserImagePart: ImageMessagePartComponent = (part) => (
  <div data-slot="aui_user-message-image" className="tw:py-1">
    <Image {...part} />
  </div>
);

const UserMessage: FC = () => {
  const { UserMessageHeader } = useContext(ThreadComponentsContext);
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      className="tw:fade-in tw:slide-in-from-bottom-1 tw:animate-in tw:grid tw:auto-rows-auto tw:grid-cols-[minmax(72px,1fr)_auto] tw:content-start tw:gap-y-2 tw:px-2 tw:duration-150 tw:[contain-intrinsic-size:auto_200px] tw:[content-visibility:auto] tw:[&:where(>*)]:col-start-2"
      data-role="user"
    >
      {UserMessageHeader && <div className="tw:col-start-2 tw:flex tw:justify-end"><UserMessageHeader /></div>}

      <div className="tw:aui-user-message-content-wrapper tw:relative tw:col-start-2 tw:min-w-0">
        <div className="tw:aui-user-message-content tw:peer tw:bg-muted tw:text-foreground tw:rounded-(--composer-radius) tw:px-4 tw:py-2 tw:wrap-break-word tw:empty:hidden">
          <MessagePrimitive.Parts
            components={{ File: UserFilePart, Image: UserImagePart }}
          />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="tw:aui-user-action-bar-root tw:flex tw:flex-col tw:items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="tw:aui-user-action-edit">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="tw:flex tw:flex-col tw:px-2 tw:[contain-intrinsic-size:auto_200px] tw:[content-visibility:auto]"
    >
      <ComposerPrimitive.Root className="tw:aui-edit-composer-root tw:border-foreground/10 tw:focus-within:border-foreground/25 tw:ms-auto tw:flex tw:w-full tw:max-w-[85%] tw:cursor-text tw:flex-col tw:rounded-(--composer-radius) tw:border tw:bg-(--composer-bg) tw:transition-[border-color]">
        <ComposerPrimitive.Input
          className="tw:aui-edit-composer-input tw:text-foreground tw:min-h-14 tw:w-full tw:resize-none tw:bg-transparent tw:px-4 tw:pt-3 tw:pb-1 tw:text-base tw:outline-none"
          autoFocus
        />
        <div className="tw:aui-edit-composer-footer tw:mx-2.5 tw:mb-2.5 tw:flex tw:items-center tw:gap-1.5 tw:self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" className="tw:h-8 tw:px-3">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" className="tw:h-8 tw:px-3">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </MessagePrimitive.Root>
  );
};

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "tw:aui-branch-picker-root tw:text-muted-foreground tw:-ms-2 tw:me-2 tw:inline-flex tw:items-center tw:text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="tw:aui-branch-picker-state tw:font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};
