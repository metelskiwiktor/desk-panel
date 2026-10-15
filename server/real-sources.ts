import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCezar } from './cezar';
import { createCalendarReader } from './calendar';
import { createCalendarOAuth, CalendarAuthError } from './calendar-oauth';
import { createSystemReader } from './system';
import { createQuotaReader } from './quotas';
import type { PanelSources } from './sources';

export function createRealSources(options: { port: number; cezarUrl: string; calendarId: string; env: NodeJS.ProcessEnv }): PanelSources {
  const { calendarId, env } = options;
  const oauth = createCalendarOAuth({ email: calendarId,
    clientFile: env.DESK_GOOGLE_OAUTH_CLIENT_FILE || join(homedir(), '.desk-panel', 'google-oauth-client.json'),
    tokenFile: join(homedir(), '.desk-panel', 'calendar-token.dpapi'),
    redirectUri: `http://127.0.0.1:${options.port}/api/calendar/callback`,
  });
  const readCalendar = createCalendarReader(calendarId, oauth.request);
  const readSystem = createSystemReader();
  const readQuotas = createQuotaReader(env.DESK_ADAPTER_ENV_FILE || fileURLToPath(new URL('../../cezar-adapter/.env', import.meta.url)));
  let pending: ReturnType<typeof readCezar> | undefined;
  let cache: Awaited<ReturnType<typeof readCezar>> | undefined;
  let fetchedAt = 0;
  return {
    async cezar() {
      if (!cache || Date.now() - fetchedAt >= 4000) {
        pending ??= readCezar(options.cezarUrl).then(value => { cache = value; fetchedAt = Date.now(); return value; }).finally(() => { pending = undefined; });
        await pending;
      }
      return cache!;
    },
    calendar: () => readCalendar(),
    calendarConnection: () => oauth.status(),
    system: async () => readSystem(),
    quotas: () => readQuotas(),
    calendarConnect: () => oauth.begin(),
    async calendarCallback(params) {
      try {
        await oauth.finish(params);
        return { ok: true, message: 'Kalendarz połączony. Możesz wrócić do Desk Panelu.' };
      } catch (error) {
        if (error instanceof CalendarAuthError && error.reason === 'wrong_account') return { ok: false, message: `Wybrano inne konto. Zaloguj się na ${calendarId.replace(/[<>&"']/g, '')}.` };
        if (error instanceof CalendarAuthError && error.reason === 'storage_failed') return { ok: false, message: 'Nie udało się bezpiecznie zapisać połączenia na tym komputerze.' };
        return { ok: false, message: 'Nie udało się połączyć. Wróć do panelu i rozpocznij logowanie ponownie.' };
      }
    },
  };
}
