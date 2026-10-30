import type { ContextItem } from '../chat-contract';
import type { CezarStatus, CheckState, CockpitPrView, CockpitTaskView, StepState } from '../cockpit-contract';

export type { CezarStatus, CheckState, StepState };

/**
 * The cockpit's own view of a conversation, independent of where it comes from (the mock script or Hermes through
 * useChat). It maps one to one onto assistant-ui messages: text parts, and tool calls rendered by name.
 */
export type CockpitPart =
  | { type: 'text'; text: string }
  | { type: 'tool'; id: string; name: string; args: Record<string, unknown>; result?: unknown; running?: boolean; error?: boolean };

export interface CockpitMessage {
  id: string;
  role: 'user' | 'assistant';
  at: number;
  parts: CockpitPart[];
  context?: ContextItem[];
  status: 'running' | 'done' | 'error' | 'stopped';
  error?: string;
  /** While running: what the panel is doing about the run (reconnecting…), in Polish. */
  notice?: string;
}

// ── Skill cards: tool calls with these names get their own UI (cards.tsx) ──

/** `@Zaimplementuj zadanie`: the read-only recon before a task goes to Cezar. */
export const RECON = 'skill_recon';
export interface ReconArgs {
  /** Only while the recon runs (the mock); Hermes reports a finished one. */
  steps?: { label: string; done: boolean }[];
  files: { path: string; note?: string }[];
  kind?: 'UI' | 'non-UI';
  scenario?: string;
  prompt?: string;
  /** Why the panel refused the recon (files the repository does not have); the card says so. */
  refused?: string;
}

/** Human in the loop: the agent asks before it hands a task to Cezar. */
export const DISPATCH = 'cezar_dispatch';
/** `refused`: why the panel refused the proposal (sent before its recon's answer); the card offers no „Zleć” then. */
export interface DispatchArgs { title: string; repo?: string; prompt: string; workflow?: string; todoId?: string; legacyUnresolved?: boolean; refused?: string }
export type DispatchResult = { decision: 'dispatched'; taskId: string; prompt: string; url?: string; runner?: string; model?: string; steps?: Record<string, { runner?: string; model?: string }> } | { decision: 'rejected' };

/** `@nasłuchuj cezara`: the agent watches a running Cezar task (watchdog). */
export const WATCH = 'cezar_watch';
/** The mock gives the steps; Hermes gives the task id (`id`) and its tool answers with the task as JSON. */
export interface WatchArgs { taskId?: string; id?: string; steps?: { label: string; state: StepState }[]; progress?: number }

/** The data card (`panel_show`): the arguments as the model wrote them (the card checks them); the rows the card reads itself. */
export const SHOW = 'bank_show';
export interface ShowArgs { tytul?: unknown; view?: unknown; kategorie?: unknown; nieoznaczone?: unknown; from?: unknown; to?: unknown; refused?: string }

/** The consent card for a change in the account's categories (`panel_bank_propose`): the arguments as the model wrote them (checked by the card). */
export const BANK_PLAN = 'bank_plan';
export interface BankPlanArgs { tytul?: unknown; merge?: unknown; into?: unknown; tags?: unknown; refused?: string }

/** The consent card for marking many operations with the panel's own suggestions (`panel_bank_assign`). */
export const BANK_ASSIGN = 'bank_assign';
export const APPOINTMENT = 'appointment';
export const CALENDAR_PLAN = 'calendar_plan';
export interface BankAssignArgs { tytul?: unknown; from?: unknown; to?: unknown; refused?: string }

/** The mail list card (`panel_mail_show`): the Gmail query; the rows the card reads itself. */
export const MAIL_LIST = 'mail_list';
export interface MailListArgs { q?: unknown; tytul?: unknown; refused?: string }
/** The consent card for a Smart Actions rule (`panel_smart_rule_propose`): the plan as the model wrote it (checked by the card). */
export const SMART_RULE = 'smart_rule';
export interface SmartRuleArgs { tytul?: unknown; rule?: unknown; remove?: unknown; q?: unknown; refused?: string }

/** A Hermes tool waiting for the user's yes or no (approval part of the live chat). */
export const HERMES_APPROVAL = 'hermes_approval';
export interface HermesApprovalArgs { tool: string; detail: string; state: 'pending' | 'approved' | 'denied' | 'expired'; at: number }

// ── The right pane ──

export type CockpitTask = Omit<CockpitTaskView, 'steps' | 'progress'> & Partial<Pick<CockpitTaskView, 'steps' | 'progress'>>;
export type CockpitPr = Omit<CockpitPrView, 'state'> & { state?: CockpitPrView['state'] };
export interface CockpitState {
  /** Whether Wektor is watching a task now, and since when. */
  watching: boolean;
  since?: number;
  task?: CockpitTask;
  pr?: CockpitPr;
}

export interface CockpitChat { id: string; title: string; running: boolean; createdAt?: number; updatedAt: number }

/** Where the window gets its conversation and cockpit: the mock (scenarios, `?cockpit=mock`) or Hermes. */
export interface CockpitSource {
  mode: 'mock' | 'live';
  title: string;
  messages: CockpitMessage[];
  running: boolean;
  /** Hermes: whether it takes messages; `checking` while the panel asks again. */
  hermes: { up: boolean; checking: boolean; error?: string };
  /** The panel has no chat at all (a server without an agent). */
  unavailable: boolean;
  /** Loading the conversation that was picked. */
  loading: boolean;
  /** A cached conversation may render immediately; decisions wait for the current server state. */
  refreshing?: boolean;
  cockpitLoading?: boolean;
  error: string;
  clearError(): void;
  /** False when the message was not taken: the composer keeps it. */
  send(text: string, context: ContextItem[]): Promise<boolean>;
  stop(): void;
  retry(): void;
  /** The user's answer on a card: a dispatch decision or a Hermes approval. */
  respond(toolCallId: string, response: unknown): void | Promise<void>;
  chats: CockpitChat[] | null;
  activeId: string | null;
  createdAt?: number;
  open(id: string | null): void;
  remove(): void;
  cockpit: CockpitState;
  /** The cockpit could not be read (live only), in Polish. */
  cockpitError?: string;
}
