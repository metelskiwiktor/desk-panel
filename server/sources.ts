import type { CezarSnapshot } from '../src/cezar-contract';
import type { CalendarConnection, CalendarSource } from '../src/calendar-contract';
import type { SystemSource } from '../src/system-contract';
import type { QuotaSource } from '../src/quota-contract';

/**
 * Everything the panel API serves. The UI only sees these contracts, never which
 * implementation (real integrations or a scenario file) produced them.
 */
export interface PanelSources {
  cezar(): Promise<CezarSnapshot>;
  calendar(): Promise<CalendarSource>;
  calendarConnection(): Promise<CalendarConnection>;
  system(): Promise<SystemSource>;
  quotas(): Promise<QuotaSource>;
  /** Starts Google sign-in and resolves to the authorization URL. */
  calendarConnect(): Promise<string>;
  calendarCallback(params: URLSearchParams): Promise<{ ok: boolean; message: string }>;
}

/** A source failure answered with this HTTP status instead of a body. */
export class SourceError extends Error {
  constructor(readonly status: number) { super(`source failed with ${status}`); }
}

/** GET endpoints answered with JSON; shared by the HTTP server and UI tests. */
export function jsonRoutes(sources: PanelSources): Record<string, () => Promise<unknown>> {
  return {
    '/api/cezar': () => sources.cezar(),
    '/api/calendar': () => sources.calendar(),
    '/api/calendar/connection': () => sources.calendarConnection(),
    '/api/system': () => sources.system(),
    '/api/quotas': () => sources.quotas(),
  };
}
