import type { BankSource } from '../src/bank-contract';
import type { BankLabelAction, BankLabelResult, BankLabelsSource } from '../src/bank-labels-contract';
import type { BankLedger } from './bank-labels';
import type { CezarAction, CezarCreateRunInput, CezarCreatedRun, CezarSnapshot } from '../src/cezar-contract';
import type { CalendarSource } from '../src/calendar-contract';
import type { GoogleAccountStatus } from '../src/google-contract';
import { MAIL_PAGE, type MailAction, type MailSource, type MailThread } from '../src/mail-contract';
import type { SmartRuleStore } from './smart-rules';
import type { SystemSource } from '../src/system-contract';
import type { QuotaSource } from '../src/quota-contract';
import type { TrainingSource } from '../src/training-contract';
import type { TodoAction, TodoResult, TodoSource } from '../src/todo-contract';
import type { UsageBreakdown } from '../src/usage-breakdown-contract';
import type { WarmupStatus, WarmupProvider, WarmupSettings, WarmupRunResult } from '../src/warmup-contract';
import type { GitHubPrSource } from '../src/types';
import type { OpenRouterUsage } from '../src/openrouter-contract';
import type { AppointmentService } from './appointments';
import type { ObserverList } from '../src/observers-contract';
import type { Automation, AutomationList, AutomationUpdate } from '../src/automation-contract';

/**
 * Everything the panel API serves. The UI only sees these contracts, never which
 * implementation (real integrations or a scenario file) produced them.
 */
export interface PanelSources {
  /** Read-only proposals; Google is written only by the user's Origin-checked confirmation in the chat route. */
  appointments?: AppointmentService;
  automationCalendarWrite?: (key: string, draft: import('../src/appointment-contract').CalendarDraft) => Promise<import('../src/appointment-contract').CalendarSaved>;
  cezar(): Promise<CezarSnapshot>;
  /** Raw details of a single run from Cezar (steps, error, worktreePath) for agent views. */
  cezarRun?(id: string): Promise<Record<string, any> | null>;
  /** Archive or restore a finished task, or mark it read or unread, in Cezar itself. */
  cezarAction(id: string, action: CezarAction): Promise<void>;
  /** Start a new task run in Cezar (used by the chat dispatcher after user confirmation). */
  cezarCreateRun?(input: CezarCreateRunInput): Promise<CezarCreatedRun>;
  /** `pinned`: agent steps whose runner (and model) the workflow fixes; the run's choice does not reach them. */
  cezarDefaults?(workflow: string, runner?: string): Promise<{ runner: string | null; model: string | null; models: { id: string; label: string }[]; catalogSource: string; modelsLocked: boolean; pinned?: { id: string; runner: string; model: string | null; follows?: string }[] }>;
  calendar(): Promise<CalendarSource>;
  /** Garmin Connect plan, the coming workouts' steps and recent recordings. */
  training(): Promise<TrainingSource>;
  /** First `limit` unread inbox conversations of all mail accounts, newest first. */
  mail(limit: number): Promise<MailSource>;
  mailAction(account: string, threadId: string, action: MailAction): Promise<void>;
  /** Read-only: conversations of the whole mailbox for a Gmail query (Smart Actions rules are tested on them). */
  mailSearch?(q: string, limit: number): Promise<MailThread[]>;
  /** Read-only: one conversation, read or not. */
  mailThread?(account: string, threadId: string): Promise<MailThread>;
  /** Smart Actions rules: changed only by the user (the tile's switch, or his click on Wektor's card). */
  smartRules?: SmartRuleStore;
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
  openrouterUsage?(): Promise<OpenRouterUsage>;
  usageBreakdown?(): Promise<UsageBreakdown>;
  warmup?():Promise<WarmupStatus>;
  saveWarmup?(provider:WarmupProvider,value:WarmupSettings):Promise<WarmupStatus>;
  runWarmup?(provider:WarmupProvider):Promise<WarmupRunResult>;
  /** The chat's active one-shot observers (`server/observers.ts`); readable even when automations are off. */
  observers?(): Promise<ObserverList>;
  /** Cancels one observer, so it never fires; answers with the active list. */
  observerCancel?(id: string): Promise<ObserverList>;
  /** Wektor's automations: the panel's own scheduled tasks (read-only here; changed by an Origin-checked action). */
  automations?(): Promise<AutomationList>;
  automationAction?(input: AutomationUpdate): Promise<Automation>;
  /** Starts Google sign-in for one configured account and resolves to the authorization URL. */
  googleConnect(email: string): Promise<string>;
  googleCallback(params: URLSearchParams): Promise<{ ok: boolean; message: string }>;
}

/** A source failure answered with this HTTP status instead of a body. */
export class SourceError extends Error {
  /** `detail`: what failed, safe to show and log (no credentials), e.g. `HTTP 429 rateLimitExceeded`. */
  constructor(readonly status: number, readonly detail?: string) { super(`source failed with ${status}`); }
}
/** What Wektor reads when a source failed: the cause and what to do, not a bare status. */
export function sourceFailure(error: SourceError): string {
  if (error.status === 429) return `Gmail chwilowo ogranicza liczbę zapytań (${error.detail ?? 'HTTP 429'}). Panel już ponowił zapytanie po 2 i 5 s. Odczekaj ok. 30 s i wywołaj narzędzie raz; nie ponawiaj w pętli i nie zmieniaj przez to argumentów.`;
  if (error.status === 401) return `Panel nie ma dostępu do Gmaila (${error.detail ?? 'logowanie'}): użytkownik musi połączyć konto ponownie w Ustawieniach. Nie ponawiaj.`;
  if (error.status === 404) return 'Nie ma takiego maila: sprawdź id (konto:wątek) w wyniku panel_mail_search.';
  return `Nie udało się pobrać danych źródła (${error.status}${error.detail ? `, ${error.detail}` : ''}).`;
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
    '/api/observers': () => sources.observers ? sources.observers() : Promise.resolve({ observers: [] }),
    '/api/automations': () => sources.automations ? sources.automations() : Promise.resolve({ automations: [] }),
    '/api/github/prs': () => sources.githubPr ? sources.githubPr() : Promise.resolve({ pullRequests: [] }),
    '/api/openrouter': () => { if (!sources.openrouterUsage) throw new SourceError(503); return sources.openrouterUsage(); },
    '/api/usage-breakdown': () => { if (!sources.usageBreakdown) throw new SourceError(503); return sources.usageBreakdown(); },
    '/api/quotas/warmup': () => {if(!sources.warmup)throw new SourceError(503);return sources.warmup();},
  };
}
