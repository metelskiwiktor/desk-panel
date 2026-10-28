import type { BankSource } from '../src/bank-contract';
import type { BankLabelAction, BankLabelResult, BankLabelsSource } from '../src/bank-labels-contract';
import type { BankLedger } from './bank-labels';
import type { CezarAction, CezarCreateRunInput, CezarCreatedRun, CezarSnapshot } from '../src/cezar-contract';
import type { CalendarSource } from '../src/calendar-contract';
import type { GoogleAccountStatus } from '../src/google-contract';
import { MAIL_PAGE, type MailAction, type MailSource } from '../src/mail-contract';
import type { SystemSource } from '../src/system-contract';
import type { QuotaSource } from '../src/quota-contract';
import type { TrainingSource } from '../src/training-contract';
import type { TodoAction, TodoResult, TodoSource } from '../src/todo-contract';
import type { UsageBreakdown } from '../src/usage-breakdown-contract';
import type { WarmupStatus, WarmupProvider, WarmupSettings, WarmupRunResult } from '../src/warmup-contract';
import type { GitHubPrSource } from '../src/types';

/**
 * Everything the panel API serves. The UI only sees these contracts, never which
 * implementation (real integrations or a scenario file) produced them.
 */
export interface PanelSources {
  cezar(): Promise<CezarSnapshot>;
  /** Raw details of a single run from Cezar (steps, error, worktreePath) for agent views. */
  cezarRun?(id: string): Promise<Record<string, any> | null>;
  /** Archive or restore a finished task, or mark it read or unread, in Cezar itself. */
  cezarAction(id: string, action: CezarAction): Promise<void>;
  /** Start a new task run in Cezar (used by the chat dispatcher after user confirmation). */
  cezarCreateRun?(input: CezarCreateRunInput): Promise<CezarCreatedRun>;
  /** `pinned`: agent steps whose runner (and model) the workflow fixes; the run's choice does not reach them. */
  cezarDefaults?(workflow: string, runner?: string): Promise<{ runner: string | null; model: string | null; models: { id: string; label: string }[]; catalogSource: string; modelsLocked: boolean; pinned?: { id: string; runner: string; model: string | null }[] }>;
  calendar(): Promise<CalendarSource>;
  /** Garmin Connect plan, the coming workouts' steps and recent recordings. */
  training(): Promise<TrainingSource>;
  /** First `limit` unread inbox conversations of all mail accounts, newest first. */
  mail(limit: number): Promise<MailSource>;
  mailAction(account: string, threadId: string, action: MailAction): Promise<void>;
  googleAccounts(): Promise<GoogleAccountStatus[]>;
  system(): Promise<SystemSource>;
  quotas(): Promise<QuotaSource>;
  /** The user's to-do lists: the panel's own data, changed only by `todoAction`. */
  todos(): Promise<TodoSource>;
  todoAction(action: TodoAction): Promise<TodoResult>;
  /** The bank account (balance and booked operations), read-only; the consent is given in the bank, see `bankConnect`. */
  bank(): Promise<BankSource>;
  /** Starts the bank consent and resolves to the address where the user signs in to the bank. */
  bankConnect(): Promise<string>;
  bankCallback(params: URLSearchParams): Promise<{ ok: boolean; message: string }>;
  /** The user's own marks on the operations of the last reading (categories, people, comments) and suggestions; local only. */
  bankLabels(): Promise<BankLabelsSource>;
  bankLabelAction(action: BankLabelAction): Promise<BankLabelResult>;
  /** Every kept operation with its mark, for the agent's text view; server-side only, no identifiers. */
  bankLedger(): Promise<BankLedger>;
  githubPr?(): Promise<GitHubPrSource>;
  usageBreakdown?(): Promise<UsageBreakdown>;
  warmup?():Promise<WarmupStatus>;
  saveWarmup?(provider:WarmupProvider,value:WarmupSettings):Promise<WarmupStatus>;
  runWarmup?(provider:WarmupProvider):Promise<WarmupRunResult>;
  /** Starts Google sign-in for one configured account and resolves to the authorization URL. */
  googleConnect(email: string): Promise<string>;
  googleCallback(params: URLSearchParams): Promise<{ ok: boolean; message: string }>;
}

/** A source failure answered with this HTTP status instead of a body. */
export class SourceError extends Error {
  constructor(readonly status: number) { super(`source failed with ${status}`); }
}

/** GET endpoints answered with JSON; shared by the HTTP server and UI tests. */
export function jsonRoutes(sources: PanelSources): Record<string, (url: URL) => Promise<unknown>> {
  return {
    '/api/cezar': () => sources.cezar(),
    '/api/calendar': () => sources.calendar(),
    '/api/training': () => sources.training(),
    '/api/mail': url => sources.mail(Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || MAIL_PAGE))),
    '/api/google/accounts': () => sources.googleAccounts(),
    '/api/system': () => sources.system(),
    '/api/quotas': () => sources.quotas(),
    '/api/todos': () => sources.todos(),
    '/api/bank': () => sources.bank(),
    '/api/bank/labels': () => sources.bankLabels(),
    '/api/github/prs': () => sources.githubPr ? sources.githubPr() : Promise.resolve({ pullRequests: [] }),
    '/api/usage-breakdown': () => { if (!sources.usageBreakdown) throw new SourceError(503); return sources.usageBreakdown(); },
    '/api/quotas/warmup': () => {if(!sources.warmup)throw new SourceError(503);return sources.warmup();},
  };
}
