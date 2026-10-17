import type { CezarSnapshot } from '../src/cezar-contract';
import type { CalendarSource } from '../src/calendar-contract';
import type { GoogleAccountStatus } from '../src/google-contract';
import { MAIL_PAGE, type MailAction, type MailSource } from '../src/mail-contract';
import type { SystemSource } from '../src/system-contract';
import type { QuotaSource } from '../src/quota-contract';
import type { UsageBreakdown } from '../src/usage-breakdown-contract';
import type { WarmupStatus, WarmupProvider, WarmupSettings } from '../src/warmup-contract';

/**
 * Everything the panel API serves. The UI only sees these contracts, never which
 * implementation (real integrations or a scenario file) produced them.
 */
export interface PanelSources {
  cezar(): Promise<CezarSnapshot>;
  calendar(): Promise<CalendarSource>;
  /** First `limit` unread inbox conversations of all mail accounts, newest first. */
  mail(limit: number): Promise<MailSource>;
  mailAction(account: string, threadId: string, action: MailAction): Promise<void>;
  googleAccounts(): Promise<GoogleAccountStatus[]>;
  system(): Promise<SystemSource>;
  quotas(): Promise<QuotaSource>;
  usageBreakdown?(): Promise<UsageBreakdown>;
  warmup?():Promise<WarmupStatus>;
  saveWarmup?(provider:WarmupProvider,value:WarmupSettings):Promise<WarmupStatus>;
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
    '/api/mail': url => sources.mail(Math.min(500, Math.max(1, Number(url.searchParams.get('limit')) || MAIL_PAGE))),
    '/api/google/accounts': () => sources.googleAccounts(),
    '/api/system': () => sources.system(),
    '/api/quotas': () => sources.quotas(),
    '/api/usage-breakdown': () => { if (!sources.usageBreakdown) throw new SourceError(503); return sources.usageBreakdown(); },
    '/api/quotas/warmup': () => {if(!sources.warmup)throw new SourceError(503);return sources.warmup();},
  };
}
